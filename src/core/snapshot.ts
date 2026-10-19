import { createHash } from 'node:crypto'
import { createTwoFilesPatch } from 'diff'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'

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

/** 对工作区做一次文本快照（docs/knowledge/architecture.md M4 diff 的数据源）。 */
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
  | { kind: 'file'; size: number; mtimeMs: number; hash: string; content: string }
  | { kind: 'skipped'; size: number; mtimeMs: number; reason: SkipReason }

function contentHash(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * 增量工作区快照（docs/knowledge/architecture.md M5；M6.1 持久化 / M6.2 内容哈希 / M6.3 文件监听）。
 *
 * 维护 stat 索引 + 内容基线：每次 capture 只做一次 stat 遍历，**仅读取
 * size/mtimeMs 与基线不符（M6.3：或被监听器标记）的文件**，未变更文件直接
 * 复用基线内容。多轮对话的 turn 边界成本从 O(工作区内容) 降为 O(变更文件数)。
 *
 * 代价与边界：
 * - 基线常驻内存，体积受 maxFiles × maxFileBytes 约束——为长生命周期宿主
 *   （VS Code 扩展、常驻 bot）设计；一次性脚本仍用 snapshotWorkspace。
 * - 以 (size, mtimeMs) 判定变更仍作为快路径（读盘前的最廉价过滤）；重读后
 *   以内容哈希校验（M6.2）；粗粒度 mtime 下等大小改写的漏检由文件监听闭合
 *   （M6.3）——仍存在监听器漏报的理论窗口，见复盘。
 */
export class IncrementalWorkspace {
  readonly root: string
  #options: SnapshotOptions
  #baselineFile: string | undefined
  #watch: boolean
  #loaded = false
  #baseline = new Map<string, BaselineEntry>()
  #reads = 0
  #dirty = new Set<string>()
  #watcher: FSWatcher | null = null

  constructor(root: string, options?: Partial<SnapshotOptions> & { baselineFile?: string; watch?: boolean }) {
    this.root = root
    this.#options = { ...DEFAULT_SNAPSHOT_OPTIONS, ...options }
    this.#baselineFile = options?.baselineFile
    this.#watch = options?.watch === true
  }

  /** 本实例累计进入读取路径（确实读了内容或因超限未读）的文件次数（测试与可观测用）。 */
  get readCount(): number {
    return this.#reads
  }

  /** 监听器已标记待复核的文件数（测试与可观测用）。 */
  get dirtyCount(): number {
    return this.#dirty.size
  }

  /** 文件监听是否活着（false = 未启用或监听器出错退化为纯 stat 模式）。 */
  get watcherActive(): boolean {
    return this.#watcher !== null
  }

  async capture(): Promise<WorkspaceSnapshot> {
    if (this.#baselineFile && !this.#loaded) {
      await this.#loadPersisted()
      this.#loaded = true
    }
    if (this.#watch && !this.#watcher) this.#ensureWatcher()
    const stats = await this.#statWalk()
    const files = new Map<string, string>()
    const skipped = new Map<string, SkipReason>()
    for (const [rel, info] of stats) {
      const cached = this.#baseline.get(rel)
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && !this.#dirty.has(rel)) {
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
        // 内容哈希校验（M6.2）：stat 变了但内容没变（touch/原子保存的邻居写入）时
        // 复用基线内容，避免把无变化的文件搅进 turn-diff。
        const hash = contentHash(content)
        const previous = this.#baseline.get(rel)
        if (previous?.kind === 'file' && previous.hash === hash) {
          this.#baseline.set(rel, { kind: 'file', size: info.size, mtimeMs: info.mtimeMs, hash, content: previous.content })
          files.set(rel, previous.content)
          continue
        }
        files.set(rel, content)
        this.#baseline.set(rel, { kind: 'file', size: info.size, mtimeMs: info.mtimeMs, hash, content })
      } catch {
        skipped.set(rel, 'unreadable')
      }
    }
    // 消失的文件移出基线，避免无限增长
    for (const rel of [...this.#baseline.keys()]) {
      if (!stats.has(rel)) this.#baseline.delete(rel)
    }
    this.#dirty.clear()
    return { root: this.root, files, skipped }
  }

  /** 启动文件监听（M6.3）：闭合粗粒度 mtime 下 stat 无法分辨的等大小改写。 */
  #ensureWatcher(): void {
    try {
      const watcher = chokidarWatch(this.root, {
        ignoreInitial: true,
        awaitWriteFinish: false,
        ignored: (path: string) => {
          const rel = relative(this.root, path)
          if (rel.length === 0) return false
          return rel.split(sep).some((segment) => this.#options.ignoreDirs.includes(segment))
        },
      })
      watcher.on('all', (_event, path) => {
        const rel = relative(this.root, path).split(sep).join('/')
        if (rel.length > 0) this.#dirty.add(rel)
      })
      watcher.on('error', () => {
        // 监听失败不致命：退化为纯 stat 模式（正确性回落到 M5 语义）
        void watcher.close()
        this.#watcher = null
      })
      this.#watcher = watcher
    } catch {
      this.#watcher = null
    }
  }

  /** 停止文件监听并清空脏标记。 */
  async stop(): Promise<void> {
    const watcher = this.#watcher
    this.#watcher = null
    this.#dirty.clear()
    if (watcher) await watcher.close()
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

  /**
   * 把基线持久化到磁盘（M6.1）：gzip JSON，tmp + rename 原子替换。
   * 未配置 baselineFile 时是 no-op。损坏/旧版本文件在加载时被丢弃。
   */
  async flush(): Promise<void> {
    const file = this.#baselineFile
    if (!file) return
    const payload = JSON.stringify({
      version: BASELINE_FORMAT_VERSION,
      root: this.root,
      entries: [...this.#baseline.entries()].map(([path, entry]) => ({ path, ...entry })),
    })
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, gzipSync(Buffer.from(payload, 'utf8')))
    await rename(temporary, file)
  }

  async #loadPersisted(): Promise<void> {
    const file = this.#baselineFile
    if (!file) return
    let raw: Buffer
    try {
      raw = await readFile(file)
    } catch {
      return
    }
    try {
      const parsed: unknown = JSON.parse(gunzipSync(raw).toString('utf8'))
      if (typeof parsed !== 'object' || parsed === null) return
      const record = parsed as { version?: unknown; root?: unknown; entries?: unknown }
      if (record.version !== BASELINE_FORMAT_VERSION || record.root !== this.root) return
      if (!Array.isArray(record.entries)) return
      this.#baseline = new Map(record.entries.flatMap((entry: unknown) => (isBaselineEntry(entry) ? [[entry.path, entry] as const] : [])))
    } catch {
      this.#baseline = new Map() // 损坏文件按冷启动处理
    }
  }
}

const BASELINE_FORMAT_VERSION = 2

function isBaselineEntry(value: unknown): value is BaselineEntry & { path: string } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.path !== 'string') return false
  if (typeof record.size !== 'number' || typeof record.mtimeMs !== 'number') return false
  if (record.kind === 'file') return typeof record.content === 'string'
  if (record.kind === 'skipped') return typeof record.reason === 'string'
  return false
}
