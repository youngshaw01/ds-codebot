import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { diffSnapshots, snapshotWorkspace } from '../src/core/snapshot.ts'

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-codebot-snapshot-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('snapshotWorkspace', () => {
  it('收录文本文件并忽略 ignoreDirs', async () => {
    const root = join(dir, 'ws1')
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'noise\n', 'utf8')

    const snapshot = await snapshotWorkspace(root)
    assert.deepEqual([...snapshot.files.keys()], ['src/a.ts'])
  })

  it('二进制文件进 skipped，超大文件进 skipped', async () => {
    const root = join(dir, 'ws2')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'bin.dat'), '\u0000\u0001binary', 'utf8')
    await writeFile(join(root, 'big.txt'), 'x'.repeat(2048), 'utf8')

    const snapshot = await snapshotWorkspace(root, { maxFileBytes: 1024 })
    assert.equal(snapshot.files.size, 0)
    assert.equal(snapshot.skipped.get('bin.dat'), 'binary')
    assert.equal(snapshot.skipped.get('big.txt'), 'too-large')
  })

  it('相对路径使用 posix 分隔符', async () => {
    const root = join(dir, 'ws3')
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'c.txt'), 'x', 'utf8')
    const snapshot = await snapshotWorkspace(root)
    assert.ok(snapshot.files.has('a/b/c.txt'))
  })
})

describe('diffSnapshots', () => {
  async function snapshotOf(root: string) {
    return snapshotWorkspace(root)
  }

  it('识别新增/修改/删除并给出 unified patch', async () => {
    const root = join(dir, 'ws4')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'keep.txt'), 'line1\nline2\n', 'utf8')
    await writeFile(join(root, 'gone.txt'), 'bye\n', 'utf8')
    const before = await snapshotOf(root)

    await rm(join(root, 'gone.txt'))
    await writeFile(join(root, 'keep.txt'), 'line1\nline2 changed\n', 'utf8')
    await writeFile(join(root, 'new.txt'), 'hello\n', 'utf8')
    const after = await snapshotOf(root)

    const diffs = diffSnapshots(before, after)
    assert.deepEqual(
      diffs.map((file) => [file.path, file.kind]),
      [
        ['gone.txt', 'deleted'],
        ['keep.txt', 'modified'],
        ['new.txt', 'added'],
      ],
    )
    const keep = diffs.find((file) => file.path === 'keep.txt')
    assert.ok(keep)
    assert.equal(keep.added, 1)
    assert.equal(keep.removed, 1)
    assert.ok(keep.patch.includes('-line2'))
    assert.ok(keep.patch.includes('+line2 changed'))
  })

  it('无变化时产出空列表', async () => {
    const root = join(dir, 'ws5')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'x.txt'), 'same\n', 'utf8')
    const before = await snapshotOf(root)
    const after = await snapshotOf(root)
    assert.deepEqual(diffSnapshots(before, after), [])
  })
})
