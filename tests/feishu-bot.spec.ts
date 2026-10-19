import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { AgentRuntime } from '../src/core/runtime.ts'
import { BotError } from '../src/core/errors.ts'
import { SessionRegistry } from '../src/core/registry.ts'
import { FeishuBot } from '../src/frontends/feishu/bot.ts'
import { parseMessageEvent } from '../src/frontends/feishu/lark.ts'
import type { FeishuGateway, FeishuMessage } from '../src/frontends/feishu/gateway.ts'

class FakeRuntime implements AgentRuntime {
  readonly prompts: { sessionId: string; input: string }[] = []
  readonly cwds = new Map<string, string>()
  reply = '收到'
  failWith: BotError | null = null
  delayMs = 0

  async start() {}

  async prompt(input: string, sessionId: string) {
    this.prompts.push({ sessionId, input })
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    if (this.failWith) throw this.failWith
    return { sessionId, finalResponse: this.reply, toolCallCount: 0, toolNames: [] }
  }

  async setCwd(path: string, sessionId: string) {
    this.cwds.set(sessionId, path)
    return `/abs/${path}`
  }

  subscribeSession(): () => void {
    return () => undefined
  }
}

class FakeGateway implements FeishuGateway {
  readonly sent: { chatId: string; text: string }[] = []
  handler: ((message: FeishuMessage) => void) | null = null

  async sendText(chatId: string, text: string) {
    this.sent.push({ chatId, text })
  }

  async start(onMessage: (message: FeishuMessage) => void) {
    this.handler = onMessage
  }

  async stop() {
    this.handler = null
  }
}

function message(overrides: Partial<FeishuMessage> = {}): FeishuMessage {
  return { chatId: 'chat-1', chatType: 'group', text: '跑一下测试', messageId: 'm-1', mentioned: true, ...overrides }
}

let dir: string
let runtime: FakeRuntime
let gateway: FakeGateway
let registry: SessionRegistry
let bot: FeishuBot

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-codebot-feishu-'))
  runtime = new FakeRuntime()
  gateway = new FakeGateway()
  registry = new SessionRegistry(join(dir, 'registry.json'))
  await registry.load()
  bot = new FeishuBot(runtime, registry, gateway, { defaultCwd: 'D:\\repo' })
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function repliesTo(chatId: string): string[] {
  return gateway.sent.filter((entry) => entry.chatId === chatId).map((entry) => entry.text)
}

describe('FeishuBot', () => {
  it('群消息未 @bot 直接忽略', async () => {
    gateway.sent.length = 0
    await bot.handle(message({ mentioned: false }))
    assert.equal(runtime.prompts.length, 0)
    assert.equal(gateway.sent.length, 0)
  })

  it('p2p 消息无需 @ 即处理', async () => {
    gateway.sent.length = 0
    await bot.handle(message({ chatType: 'p2p', mentioned: false }))
    assert.equal(runtime.prompts.length, 1)
    assert.deepEqual(repliesTo('chat-1'), ['收到'])
  })

  it('同一 chat 复用同一 session，不同 chat 互相隔离', async () => {
    runtime.prompts.length = 0
    await bot.handle(message({ text: '第一件事' }))
    await bot.handle(message({ text: '第二件事' }))
    await bot.handle(message({ chatId: 'chat-2', text: '别群的事' }))
    assert.equal(runtime.prompts.length, 3)
    const [first, second, other] = runtime.prompts
    assert.ok(first && second && other)
    assert.equal(first.sessionId, second.sessionId)
    assert.notEqual(first.sessionId, other.sessionId)
  })

  it('并发消息按 FIFO 串行', async () => {
    runtime.prompts.length = 0
    runtime.delayMs = 20
    await Promise.all([bot.handle(message({ text: 'A' })), bot.handle(message({ text: 'B' }))])
    runtime.delayMs = 0
    assert.deepEqual(
      runtime.prompts.map((entry) => entry.input),
      ['A', 'B'],
    )
  })

  it('/cwd 切换工作目录并回报', async () => {
    gateway.sent.length = 0
    await bot.handle(message({ text: '/cwd sub' }))
    assert.deepEqual(repliesTo('chat-1'), ['工作目录 → /abs/sub'])
  })

  it('/cwd 缺参数给出用法', async () => {
    gateway.sent.length = 0
    await bot.handle(message({ text: '/cwd' }))
    assert.deepEqual(repliesTo('chat-1'), ['用法: /cwd <目录>'])
  })

  it('/new 重置后下一条消息开新 session', async () => {
    runtime.prompts.length = 0
    await bot.handle(message({ text: 'before' }))
    const before = runtime.prompts[0]
    assert.ok(before)
    await bot.handle(message({ text: '/new' }))
    await bot.handle(message({ text: 'after' }))
    const after = runtime.prompts.at(-1)
    assert.ok(after)
    assert.notEqual(after.sessionId, before.sessionId)
  })

  it('wire 错误原样回报；transport 错误附重启指引且保留绑定', async () => {
    gateway.sent.length = 0
    runtime.failWith = new BotError('wire', '模型不可用')
    await bot.handle(message({ text: 'x' }))
    assert.deepEqual(repliesTo('chat-1'), ['模型不可用'])

    runtime.failWith = new BotError('transport', '运行时已断开')
    await bot.handle(message({ text: 'y' }))
    const replies = repliesTo('chat-1')
    assert.ok(replies.some((text) => text.includes('请重启 bot 进程')))
    const binding = registry.bindingFor('chat-1')
    assert.ok(binding, 'transport 错误不应解绑')
    runtime.failWith = null
  })

  it('超长回复被截断', async () => {
    gateway.sent.length = 0
    runtime.reply = 'x'.repeat(50)
    const truncating = new FeishuBot(runtime, registry, gateway, { defaultCwd: '.', maxReplyChars: 10 })
    await truncating.handle(message({ chatId: 'chat-9', text: 'z' }))
    assert.deepEqual(repliesTo('chat-9'), [`${'x'.repeat(10)}…（已截断）`])
  })
})

describe('parseMessageEvent', () => {
  it('解析文本消息并剔除 @占位符', () => {
    const parsed = parseMessageEvent({
      message: {
        chat_id: 'chat-1',
        chat_type: 'group',
        message_id: 'm-1',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 你好呀' }),
        mentions: [{ key: '@_user_1' }],
      },
    })
    assert.ok(parsed)
    assert.equal(parsed.text, '你好呀')
    assert.equal(parsed.mentioned, true)
    assert.equal(parsed.chatType, 'group')
  })

  it('p2p 无 mentions 也解析', () => {
    const parsed = parseMessageEvent({
      message: { chat_id: 'c', chat_type: 'p2p', message_id: 'm', message_type: 'text', content: JSON.stringify({ text: 'hi' }) },
    })
    assert.ok(parsed)
    assert.equal(parsed.chatType, 'p2p')
    assert.equal(parsed.mentioned, false)
  })

  it('非文本、坏 JSON、形状不符一律返回 null', () => {
    assert.equal(parseMessageEvent({ message: { chat_id: 'c', message_id: 'm', message_type: 'image', content: '{}' } }), null)
    assert.equal(parseMessageEvent({ message: { chat_id: 'c', message_id: 'm', message_type: 'text', content: 'not-json' } }), null)
    assert.equal(parseMessageEvent({ message: { message_id: 'm', message_type: 'text', content: '{"text":"x"}' } }), null)
    assert.equal(parseMessageEvent(null), null)
  })

  it('按 SDK 官方事件类型（@larksuiteoapi/node-sdk im.message.receive_v1）的完整字段解析', () => {
    // 字段集照抄 node_modules/@larksuiteoapi/node-sdk types/index.d.ts 的
    // im.message.receive_v1 负载：含可选 root_id/thread_id/sender 等
    const parsed = parseMessageEvent({
      event_id: 'ev-1',
      token: 'tk',
      create_time: '1730000000',
      event_type: 'im.message.receive_v1',
      tenant_key: 'tenant-1',
      ts: '1730000000.0001',
      uuid: 'uuid-1',
      type: 'event_callback',
      app_id: 'cli_app',
      sender: {
        sender_id: { union_id: 'u-1', user_id: 'u-2', open_id: 'ou_bot' },
        sender_type: 'user',
        tenant_key: 'tenant-1',
      },
      message: {
        message_id: 'om_official',
        root_id: 'om_root',
        parent_id: 'om_parent',
        create_time: '1730000000',
        update_time: '1730000001',
        chat_id: 'oc_official',
        thread_id: 'thd_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 跑一下测试' }),
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, mentioned_type: 'bot', name: 'ds-codebot', tenant_key: 'tenant-1' }],
      },
    })
    assert.ok(parsed)
    assert.equal(parsed.chatId, 'oc_official')
    assert.equal(parsed.chatType, 'group')
    assert.equal(parsed.text, '跑一下测试')
    assert.equal(parsed.mentioned, true)
    assert.equal(parsed.messageId, 'om_official')
  })
})
