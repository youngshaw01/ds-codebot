import { createTwoFilesPatch } from 'diff'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** 快照中跳过一个文件的原因。 */
export type SkipReason = 'too-large' | 'binary' | 'unreadable'

export interface SnapshotOptions {
  /** 最多收录的文件数，超出部分跳过。 */
  maxFiles: number
  /** 单文件字节上限，超出跳过。 */
  maxFileBytes: number
  /** 忽略的目录名（按路径段匹配）。 */
  ignoreDirs: readonly string[]
}

export const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = {
  maxFiles: 500,
  maxFileBytes: 1024 * 1024,
  ignoreDirs: ['.git', 'node_modules', 'state', 'dist-vscode', 'out.txt', 'err.txt', 'tui-out.txt', 'tui-err.txt', 'lf-out.txt', 'lf-err.txt', 'all-out.txt', 'all-err.txt'],
}

/** 一个工作区在某一时刻的文本文件内容集合。 */
export interface WorkspaceSnapshot {
  root: string
  /** 相对路径（posix 分隔）→ 内容。 */
  files: Map<string, string>
  /** 被跳过的文件与原因（计数报告用，不进 diff）。 */
  skipped: Map<string, SkipReason>
}

function isBinary(content: string): boolean {
  return content.includes('\u0000')
}

async function walk(root: string, options: SnapshotOptions, skipped: Map<string, SkipReason>): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const queue: string[] = [root]
  while (queue.length > 0 && files.size < options.maxFiles) {
    const directory = queue.shift()
    if (directory === undefined) break
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files.size >= options.maxFiles) break
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (options.ignoreDirs.includes(entry.name)) continue
        queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(root, full).split(sep).join('/')
      try {
        const info = await stat(full)
        if (info.size > options.maxFileBytes) {
          skipped.set(rel, 'too-large')
          continue
        }
        const content = await readFile(full, 'utf8')
        if (isBinary(content)) {
          skipped.set(rel, 'binary')
          continue
        }
        files.set(rel, content)
      } catch {
        skipped.set(rel, 'unreadable')
      }
    }
  }
  return files
}

/** 对工作区做一次文本快照（DESIGN.md M4 diff 的数据源）。 */
export async function snapshotWorkspace(root: string, options?: Partial<SnapshotOptions>): Promise<WorkspaceSnapshot> {
  const resolved: SnapshotOptions = { ...DEFAULT_SNAPSHOT_OPTIONS, ...options }
  const skipped = new Map<string, SkipReason>()
  const files = await walk(root, resolved, skipped)
  return { root, files, skipped }
}

/** 单个文件的回合间差异。 */
export interface FileDiff {
  /** 工作区相对路径。 */
  path: string
  kind: 'added' | 'modified' | 'deleted'
  added: number
  removed: number
  /** unified diff 文本（新增/删除文件以 /dev/null 为对侧）。 */
  patch: string
}

function countLines(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1
    if (line.startsWith('-') && !line.startsWith('---')) removed += 1
  }
  return { added, removed }
}

/** 比较两个快照，产出按路径排序的差异列表。 */
export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileDiff[] {
  const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort()
  const diffs: FileDiff[] = []
  for (const path of paths) {
    const oldContent = before.files.get(path)
    const newContent = after.files.get(path)
    if (oldContent === newContent) continue
    const kind: FileDiff['kind'] = oldContent === undefined ? 'added' : newContent === undefined ? 'deleted' : 'modified'
    const patch = createTwoFilesPatch(path, path, oldContent ?? '', newContent ?? '')
    diffs.push({ path, kind, ...countLines(patch), patch })
  }
  return diffs
}

type BaselineEntry =
  | { kind: 'file'; size: number; mtimeMs: number; content: string }
  | { kind: 'skipped'; size: number; mtimeMs: number; reason: SkipReason }

/**
 * 增量工作区快照（DESIGN.md M5）。
 *
 * 维护 stat 索引 + 内容基线：每次 capture 只做一次 stat 遍历，**仅读取
 * size/mtimeMs 与基线不符的文件**，未变更文件直接复用基线内容。多轮对话的
 * turn 边界成本从 O(工作区内容) 降为 O(变更文件数)。
 *
 * 代价与边界：
 * - 基线常驻内存，体积受 maxFiles × maxFileBytes 约束——为长生命周期宿主
 *   （VS Code 扩展、常驻 bot）设计；一次性脚本仍用 snapshotWorkspace。
 * - 以 (size, mtimeMs) 判定变更：文件系统 mtime 粒度粗（常见 1–2s）时，
 *   同秒内等大小改写可能漏检。生产级可加内容哈希，留作后续演进。
 */
export class IncrementalWorkspace {
  readonly root: string
  #options: SnapshotOptions
  #baseline = new Map<string, BaselineEntry>()
  #reads = 0

  constructor(root: string, options?: Partial<SnapshotOptions>) {
    this.root = root
    this.#options = { ...DEFAULT_SNAPSHOT_OPTIONS, ...options }
  }

  /** 本实例累计真实读取的文件次数（测试与可观测用）。 */
  get readCount(): number {
    return this.#reads
  }

  async capture(): Promise<WorkspaceSnapshot> {
    const stats = await this.#statWalk()
    const files = new Map<string, string>()
    const skipped = new Map<string, SkipReason>()
    for (const [rel, info] of stats) {
      const cached = this.#baseline.get(rel)
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        if (cached.kind === 'file') files.set(rel, cached.content)
        else skipped.set(rel, cached.reason)
        continue
      }
      this.#reads += 1
      try {
        if (info.size > this.#options.maxFileBytes) {
          skipped.set(rel, 'too-large')
          this.#baseline.set(rel, { kind: 'skipped', size: info.size, mtimeMs: info.mtimeMs, reason: 'too-large' })
          continue
        }
        const content = await readFile(join(this.root, rel), 'utf8')
        if (isBinary(content)) {
          skipped.set(rel, 'binary')
          this.#baseline.set(rel, { kind: 'skipped', size: info.size, mtimeMs: info.mtimeMs, reason: 'binary' })
          continue
        }
        files.set(rel, content)
        this.#baseline.set(rel, { kind: 'file', size: info.size, mtimeMs: info.mtimeMs, content })
      } catch {
        skipped.set(rel, 'unreadable')
      }
    }
    // 消失的文件移出基线，避免无限增长
    for (const rel of [...this.#baseline.keys()]) {
      if (!stats.has(rel)) this.#baseline.delete(rel)
    }
    return { root: this.root, files, skipped }
  }

  /** stat-only 遍历：只取 size/mtimeMs，不读内容。 */
  async #statWalk(): Promise<Map<string, { size: number; mtimeMs: number }>> {
    const stats = new Map<string, { size: number; mtimeMs: number }>()
    const queue: string[] = [this.root]
    while (queue.length > 0 && stats.size < this.#options.maxFiles) {
      const directory = queue.shift()
      if (directory === undefined) break
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (stats.size >= this.#options.maxFiles) break
        const full = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (!this.#options.ignoreDirs.includes(entry.name)) queue.push(full)
          continue
        }
        if (!entry.isFile()) continue
        const rel = relative(this.root, full).split(sep).join('/')
        try {
          const info = await stat(full)
          stats.set(rel, { size: info.size, mtimeMs: info.mtimeMs })
        } catch {
          continue
        }
      }
    }
    return stats
  }
}
