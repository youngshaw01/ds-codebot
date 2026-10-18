import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.ts'

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-codebot-config-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeConfig(name: string, content: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, content, 'utf8')
  return path
}

describe('loadConfig', () => {
  it('缺省配置补全默认值', async () => {
    const path = await writeConfig('default.json', JSON.stringify({ runtime: {} }))
    const config = await loadConfig(path)
    assert.equal(config.runtime.profile, 'sdk')
    assert.deepEqual(config.runtime.patches, [])
    assert.equal(config.runtime.provider, 'deepseek-official')
    assert.equal(config.runtime.model, 'deepseek-v4-flash')
    assert.equal(config.runtime.maxTokens, undefined)
    assert.equal(config.runtime.reasoningEffort, undefined)
  })

  it('读取合法配置节', async () => {
    const path = await writeConfig(
      'full.json',
      JSON.stringify({
        runtime: {
          profile: 'sdk',
          patches: ['./a.yml', './b.yml'],
          provider: 'deepseek-official',
          model: 'deepseek-v4-pro',
          maxTokens: 8192,
          reasoningEffort: 'medium',
          dshBin: 'node_modules/.bin/dsh',
        },
      }),
    )
    const config = await loadConfig(path)
    assert.deepEqual(config.runtime.patches, ['./a.yml', './b.yml'])
    assert.equal(config.runtime.model, 'deepseek-v4-pro')
    assert.equal(config.runtime.maxTokens, 8192)
    assert.equal(String(config.runtime.reasoningEffort), 'medium')
    assert.equal(config.runtime.dshBin, 'node_modules/.bin/dsh')
  })

  it('文件不存在时抛 ConfigError', async () => {
    await assert.rejects(loadConfig(join(dir, 'missing.json')), ConfigError)
  })

  it('非法 JSON 时抛 ConfigError', async () => {
    const path = await writeConfig('bad.json', '{ not json')
    await assert.rejects(loadConfig(path), ConfigError)
  })

  it('缺少 runtime 节时抛 ConfigError', async () => {
    const path = await writeConfig('noruntime.json', JSON.stringify({ other: 1 }))
    await assert.rejects(loadConfig(path), ConfigError)
  })

  it('patches 含非字符串时抛 ConfigError', async () => {
    const path = await writeConfig('badpatches.json', JSON.stringify({ runtime: { patches: [1] } }))
    await assert.rejects(loadConfig(path), ConfigError)
  })

  it('maxTokens 非正整数时抛 ConfigError', async () => {
    const path = await writeConfig('badmaxtokens.json', JSON.stringify({ runtime: { maxTokens: 0 } }))
    await assert.rejects(loadConfig(path), ConfigError)
  })
})
