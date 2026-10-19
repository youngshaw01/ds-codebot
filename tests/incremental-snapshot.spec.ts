import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
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
