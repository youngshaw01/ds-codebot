import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { RuntimePool } from '../src/core/runtime.ts'
import { SessionRegistry } from '../src/core/registry.ts'
import { FeishuBot } from '../src/frontends/feishu/bot.ts'
import type { FeishuGateway, FeishuMessage } from '../src/frontends/feishu/gateway.ts'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../src/config.ts'

// M3 验收（DESIGN.md §6）：群内 @bot 执行任务；同群上下文连续。
// 以真实 dsh 运行时 + 内存假网关替代真实飞书租户（无租户凭据时的最大验证深度）；
// 真实网关的长连接装配由 lark.ts 的 parseMessageEvent 单测覆盖。
// 真实 API e2e：无 DEEPSEEK_API_KEY 时跳过（DESIGN.md §7 测试策略）
const key = process.env.DEEPSEEK_API_KEY
const maybe = key && key.length > 0 ? describe : describe.skip

class CollectingGateway implements FeishuGateway {
  readonly sent: { chatId: string; text: string }[] = []

  async sendText(chatId: string, text: string) {
    this.sent.push({ chatId, text })
  }

  async start() {}
  async stop() {}

  repliesTo(chatId: string): string[] {
    return this.sent.filter((entry) => entry.chatId === chatId).map((entry) => entry.text)
  }
}

/** 构造一套 bot 三件套；调用方负责 finally 中 dispose。 */
async function setup(): Promise<{ bot: FeishuBot; registry: SessionRegistry; gateway: CollectingGateway; pool: RuntimePool; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-codebot-live-feishu-'))
  const { runtime } = await loadConfig(DEFAULT_CONFIG_PATH)
  const pool = new RuntimePool(runtime)
  await pool.start()
  const registry = new SessionRegistry(join(dir, 'registry.json'))
  await registry.load()
  const gateway = new CollectingGateway()
  const bot = new FeishuBot(pool, registry, gateway, { defaultCwd: process.cwd() })
  return { bot, registry, gateway, pool, dir }
}

maybe('live-feishu: 真实运行时 + 假网关', () => {
  it('群内 @bot 两轮对话：回复非空且同一 session 连续', async () => {
    const { bot, registry, gateway, pool, dir } = await setup()
    try {
      await bot.handle({ chatId: 'oc_live', chatType: 'group', text: '记住数字 42，只回复 OK', messageId: 'm1', mentioned: true })
      const first = gateway.repliesTo('oc_live').at(-1) ?? ''
      assert.ok(first.length > 0, `第一轮无回复: ${JSON.stringify(gateway.sent)}`)

      await bot.handle({ chatId: 'oc_live', chatType: 'group', text: '刚才让你记的数字是几？只回复数字', messageId: 'm2', mentioned: true })
      const second = gateway.repliesTo('oc_live').at(-1) ?? ''
      // 上下文连续性：第二轮能答出第一轮的数字，证明两轮落在同一 session 上
      assert.ok(second.includes('42'), `第二轮未体现第一轮上下文: ${second}`)

      const binding = registry.bindingFor('oc_live')
      assert.ok(binding)
    } finally {
      await pool.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('未 @bot 的群消息不产生任何回复', async () => {
    const { bot, gateway, pool, dir } = await setup()
    try {
      await bot.handle({ chatId: 'oc_quiet', chatType: 'group', text: '闲聊', messageId: 'm3', mentioned: false })
      assert.equal(gateway.sent.length, 0)
    } finally {
      await pool.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
