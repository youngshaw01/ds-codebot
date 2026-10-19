import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { IncrementalWorkspace, diffSnapshots } from '../src/core/snapshot.ts'

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-codebot-incremental-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function root(name: string): Promise<string> {
  const path = join(dir, name)
  await mkdir(path, { recursive: true })
  return path
}

describe('IncrementalWorkspace', () => {
  it('首次 capture 全量读取并收录文本文件', async () => {
    const ws = await root('ws1')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    const snapshot = await workspace.capture()
    assert.equal(snapshot.files.get('a.txt'), 'A1\n')
    assert.equal(workspace.readCount, 1)
  })

  it('二次 capture 无变化时零新增读取（readCount 不变）', async () => {
    const ws = await root('ws2')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    await writeFile(join(ws, 'b.txt'), 'B1\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    await workspace.capture()
    const after1 = workspace.readCount
    const second = await workspace.capture()
    assert.equal(workspace.readCount, after1)
    assert.equal(second.files.get('a.txt'), 'A1\n')
    assert.equal(second.files.get('b.txt'), 'B1\n')
  })

  it('磁盘内容变化被检测（大小变化）', async () => {
    const ws = await root('ws3')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    await workspace.capture()
    await writeFile(join(ws, 'a.txt'), 'A1 changed\n', 'utf8')
    const second = await workspace.capture()
    assert.equal(second.files.get('a.txt'), 'A1 changed\n')
  })

  it('stat 未变（同大小 + mtime 还原）时复用基线内容，不重读磁盘', async () => {
    const ws = await root('ws4')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    // 先把 mtime 规范到整秒（NTFS 100ns 粒度下整秒精确、可无损还原）
    const wholeSecond = new Date(Math.floor(Date.now() / 1000) * 1000)
    await utimes(join(ws, 'a.txt'), wholeSecond, wholeSecond)
    const workspace = new IncrementalWorkspace(ws)
    const first = await workspace.capture()
    assert.equal(first.files.get('a.txt'), 'A1\n')

    // 等长改写 + mtime 还原：stat 索引判定"未变" → 基线内容仍是旧值
    await writeFile(join(ws, 'a.txt'), 'X9\n', 'utf8')
    await utimes(join(ws, 'a.txt'), wholeSecond, wholeSecond)

    const readBefore = workspace.readCount
    const second = await workspace.capture()
    assert.equal(workspace.readCount, readBefore, 'stat 未变不应触发读取')
    assert.equal(second.files.get('a.txt'), 'A1\n', 'stat 未变时复用基线内容')
  })

  it('新增与删除文件都被反映', async () => {
    const ws = await root('ws5')
    await writeFile(join(ws, 'a.txt'), 'A\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    const first = await workspace.capture()
    await rm(join(ws, 'a.txt'))
    await writeFile(join(ws, 'b.txt'), 'B\n', 'utf8')
    const second = await workspace.capture()
    assert.equal(second.files.has('a.txt'), false)
    assert.equal(second.files.get('b.txt'), 'B\n')
    const diffs = diffSnapshots(first, second)
    assert.deepEqual(
      diffs.map((file) => [file.path, file.kind]),
      [
        ['a.txt', 'deleted'],
        ['b.txt', 'added'],
      ],
    )
  })

  it('ignoreDirs 与 maxFileBytes 仍生效；超大文件进 skipped 且不读内容', async () => {
    const ws = await root('ws6')
    await mkdir(join(ws, 'node_modules'), { recursive: true })
    await writeFile(join(ws, 'node_modules', 'skip.js'), 'noise\n', 'utf8')
    await writeFile(join(ws, 'big.txt'), 'x'.repeat(4096), 'utf8')
    const workspace = new IncrementalWorkspace(ws, { maxFileBytes: 1024 })
    const snapshot = await workspace.capture()
    assert.equal(snapshot.files.size, 0)
    assert.equal(snapshot.skipped.get('big.txt'), 'too-large')
  })

  it('多轮场景：一轮内 before→after 的 diff 只含真实变更', async () => {
    const ws = await root('ws7')
    await writeFile(join(ws, 'stable.txt'), 'same\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    const before = await workspace.capture()
    await writeFile(join(ws, 'stable.txt'), 'changed\n', 'utf8')
    const after = await workspace.capture()
    const diffs = diffSnapshots(before, after)
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0]?.path, 'stable.txt')
    assert.equal(diffs[0]?.kind, 'modified')
    // 基线已更新：再 capture 无新增读取
    const readsAfter = workspace.readCount
    await workspace.capture()
    assert.equal(workspace.readCount, readsAfter)
  })
})

describe('IncrementalWorkspace 持久化（M6.1）', () => {
  it('flush 落盘后新实例加载：已有文件零新增读取，仅读新文件', async () => {
    const ws = await root('p1')
    await writeFile(join(ws, 'a.txt'), 'A\n', 'utf8')
    await writeFile(join(ws, 'b.txt'), 'B\n', 'utf8')
    const baselineFile = join(ws, 'state', 'baseline.json.gz')

    const first = new IncrementalWorkspace(ws, { baselineFile })
    await first.capture()
    await first.flush()

    // 新实例（模拟重启）：加载持久化基线
    const second = new IncrementalWorkspace(ws, { baselineFile })
    const snapshot = await second.capture()
    assert.equal(second.readCount, 0, '持久化基线应覆盖已有文件，零读取')
    assert.equal(snapshot.files.get('a.txt'), 'A\n')
    assert.equal(snapshot.files.get('b.txt'), 'B\n')

    // 新文件仍被正常收录
    await writeFile(join(ws, 'c.txt'), 'C\n', 'utf8')
    const third = await second.capture()
    assert.equal(second.readCount, 1)
    assert.equal(third.files.get('c.txt'), 'C\n')
  })

  it('flush 产出的是 gzip 且原子替换（无 tmp 残留）', async () => {
    const ws = await root('p2')
    await writeFile(join(ws, 'a.txt'), 'A\n', 'utf8')
    const baselineFile = join(ws, 'state', 'baseline.json.gz')
    const workspace = new IncrementalWorkspace(ws, { baselineFile })
    await workspace.capture()
    await workspace.flush()
    const magic = await readFile(baselineFile)
    assert.equal(magic[0], 0x1f)
    assert.equal(magic[1], 0x8b, 'gzip magic')
    await assert.rejects(readFile(`${baselineFile}.tmp`))
  })

  it('损坏的基线文件按冷启动处理', async () => {
    const ws = await root('p3')
    await writeFile(join(ws, 'a.txt'), 'A\n', 'utf8')
    const baselineFile = join(ws, 'state', 'baseline.json.gz')
    await mkdir(join(ws, 'state'), { recursive: true })
    await writeFile(baselineFile, 'not gzip at all', 'utf8')
    const workspace = new IncrementalWorkspace(ws, { baselineFile })
    const snapshot = await workspace.capture()
    assert.equal(snapshot.files.get('a.txt'), 'A\n')
    assert.equal(workspace.readCount, 1)
  })

  it('root 不匹配的基线被丢弃', async () => {
    const ws = await root('p4')
    const other = await root('p4-other')
    await writeFile(join(ws, 'a.txt'), 'A\n', 'utf8')
    await writeFile(join(other, 'a.txt'), 'A\n', 'utf8')
    const baselineFile = join(ws, 'state', 'baseline.json.gz')
    const first = new IncrementalWorkspace(ws, { baselineFile })
    await first.capture()
    await first.flush()

    const mismatched = new IncrementalWorkspace(other, { baselineFile })
    const snapshot = await mismatched.capture()
    assert.equal(mismatched.readCount, 1, 'root 不匹配应冷启动全读')
    assert.equal(snapshot.files.get('a.txt'), 'A\n')
  })

  it('skipped 条目（too-large）也持久化，重启后不重读', async () => {
    const ws = await root('p5')
    await writeFile(join(ws, 'big.txt'), 'x'.repeat(4096), 'utf8')
    const baselineFile = join(ws, 'state', 'baseline.json.gz')
    const first = new IncrementalWorkspace(ws, { baselineFile, maxFileBytes: 1024 })
    const firstSnapshot = await first.capture()
    assert.equal(firstSnapshot.skipped.get('big.txt'), 'too-large')
    await first.flush()

    const second = new IncrementalWorkspace(ws, { baselineFile, maxFileBytes: 1024 })
    const secondSnapshot = await second.capture()
    assert.equal(second.readCount, 0)
    assert.equal(secondSnapshot.skipped.get('big.txt'), 'too-large')
  })
})

describe('IncrementalWorkspace 内容哈希（M6.2）', () => {
  it('touch（mtime 变、内容同）：触发重读但 diff 为空、基线内容不变', async () => {
    const ws = await root('h1')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    const before = await workspace.capture()
    const readsAfter1 = workspace.readCount

    // 等内容重写 + mtime 推后：stat 不匹配 → 走重读；哈希相同 → 复用
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const future = new Date(Date.now() + 60_000)
    await utimes(join(ws, 'a.txt'), future, future)

    const after = await workspace.capture()
    assert.equal(workspace.readCount, readsAfter1 + 1, 'touch 应触发重读（stat 是快路径）')
    assert.deepEqual(diffSnapshots(before, after), [], '内容未变 → diff 必须为空')
    assert.equal(after.files.get('a.txt'), 'A1\n')
  })

  it('真实内容变化：哈希不同 → 更新基线与快照', async () => {
    const ws = await root('h2')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const workspace = new IncrementalWorkspace(ws)
    await workspace.capture()
    await writeFile(join(ws, 'a.txt'), 'A1\nA2\n', 'utf8')
    const after = await workspace.capture()
    assert.equal(after.files.get('a.txt'), 'A1\nA2\n')
  })

  it('哈希随基线持久化：重启后 touch 仍被哈希识别为无变化', async () => {
    const ws = await root('h3')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const baselineFile = join(ws, 'state', 'baseline.json.gz')
    const first = new IncrementalWorkspace(ws, { baselineFile })
    await first.capture()
    await first.flush()

    const second = new IncrementalWorkspace(ws, { baselineFile })
    const before = await second.capture()
    assert.equal(second.readCount, 0)

    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const future = new Date(Date.now() + 120_000)
    await utimes(join(ws, 'a.txt'), future, future)
    const after = await second.capture()
    assert.deepEqual(diffSnapshots(before, after), [], '跨重启的哈希校验应抑制 touch 假阳性')
  })
})

describe('IncrementalWorkspace 文件监听（M6.3）', () => {
  it('stat 分辨不出（等大小 + mtime 还原）的改写被监听器捕获', async () => {
    const ws = await root('w1')
    await writeFile(join(ws, 'a.txt'), 'A1\n', 'utf8')
    const wholeSecond = new Date(Math.floor(Date.now() / 1000) * 1000)
    await utimes(join(ws, 'a.txt'), wholeSecond, wholeSecond)

    const workspace = new IncrementalWorkspace(ws, { watch: true })
    await workspace.capture()
    assert.equal(workspace.watcherActive, true)

    // 等长改写 + mtime 还原：纯 stat 路径（见 M5 测试）会漏检，监听器必须兜住
    await writeFile(join(ws, 'a.txt'), 'X9\n', 'utf8')
    await utimes(join(ws, 'a.txt'), wholeSecond, wholeSecond)

    // 等待监听器把该文件标记为脏（本地 tmpdir 上 chokidar 可靠；5s 预算）
    const deadline = Date.now() + 5000
    while (workspace.dirtyCount === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(workspace.dirtyCount > 0, '监听器应标记改写文件')

    const after = await workspace.capture()
    assert.equal(after.files.get('a.txt'), 'X9\n', '监听捕获的改写必须进入快照')
    await workspace.stop()
    assert.equal(workspace.watcherActive, false)
  })

  it('监听目录下 ignoreDirs 的改动不触发脏标记', async () => {
    const ws = await root('w2')
    await writeFile(join(ws, 'a.txt'), 'A\n', 'utf8')
    await mkdir(join(ws, 'node_modules'), { recursive: true })
    const workspace = new IncrementalWorkspace(ws, { watch: true })
    await workspace.capture()

    await writeFile(join(ws, 'node_modules', 'noise.js'), 'noise\n', 'utf8')
    const deadline = Date.now() + 1500
    while (Date.now() < deadline && workspace.dirtyCount === 0) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(workspace.dirtyCount, 0, '忽略目录不应产生脏标记')
    await workspace.stop()
  })
})
