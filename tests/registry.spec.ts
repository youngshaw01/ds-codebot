import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { SessionRegistry } from '../src/core/registry.ts'

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-codebot-registry-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SessionRegistry', () => {
  it('bindingOrCreate 铸造并持久化，二次查询复用同一 session', async () => {
    const file = join(dir, 'a.json')
    const registry = new SessionRegistry(file)
    await registry.load()
    const first = await registry.bindingOrCreate('chat-1', 'D:\\work')
    assert.match(first.sessionId, /^session-/)
    const second = await registry.bindingOrCreate('chat-1', 'D:\\work')
    assert.equal(second.sessionId, first.sessionId)
  })

  it('flush 落盘后可被新实例加载（重启后续聊）', async () => {
    const file = join(dir, 'b.json')
    const first = new SessionRegistry(file)
    await first.load()
    const binding = await first.bindingOrCreate('chat-2', 'D:\\work')
    await first.updateCwd('chat-2', 'D:\\other')

    const second = new SessionRegistry(file)
    await second.load()
    const restored = second.bindingFor('chat-2')
    assert.ok(restored)
    assert.equal(restored.sessionId, binding.sessionId)
    assert.equal(restored.cwd, 'D:\\other')
  })

  it('文件不存在按空表；内容损坏同样按空表（fail-open）', async () => {
    const missing = new SessionRegistry(join(dir, 'missing.json'))
    await missing.load()
    assert.equal(missing.bindingFor('x'), undefined)

    const brokenPath = join(dir, 'broken.json')
    await writeFile(brokenPath, '{ not json', 'utf8')
    const broken = new SessionRegistry(brokenPath)
    await broken.load()
    assert.equal(broken.bindingFor('x'), undefined)
  })

  it('损坏文件中的合法条目被保留、非法条目被丢弃', async () => {
    const file = join(dir, 'mixed.json')
    await writeFile(
      file,
      JSON.stringify({ version: 1, bindings: [{ externalKey: 'ok', sessionId: 'session-1', cwd: '.', createdAt: 1 }, { bogus: true }] }),
      'utf8',
    )
    const registry = new SessionRegistry(file)
    await registry.load()
    assert.ok(registry.bindingFor('ok'))
    assert.equal(registry.bindingFor('bogus'), undefined)
  })

  it('unbind 后 bindingFor 返回 undefined', async () => {
    const file = join(dir, 'c.json')
    const registry = new SessionRegistry(file)
    await registry.load()
    await registry.bindingOrCreate('chat-3', '.')
    await registry.unbind('chat-3')
    assert.equal(registry.bindingFor('chat-3'), undefined)
    const reloaded = new SessionRegistry(file)
    await reloaded.load()
    assert.equal(reloaded.bindingFor('chat-3'), undefined)
  })

  it('flush 写出的文件是合法 JSON 且无临时文件残留', async () => {
    const file = join(dir, 'd.json')
    const registry = new SessionRegistry(file)
    await registry.load()
    await registry.bindingOrCreate('chat-4', '.')
    const text = await readFile(file, 'utf8')
    assert.deepEqual(JSON.parse(text).version, 1)
    await assert.rejects(readFile(`${file}.tmp`, 'utf8'))
  })
})
