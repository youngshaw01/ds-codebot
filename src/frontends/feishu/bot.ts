import type { AgentRuntime } from '../../core/runtime.ts'
import { SessionRegistry } from '../../core/registry.ts'
import type { BotError } from '../../core/errors.ts'
import type { FeishuGateway, FeishuMessage } from './gateway.ts'

export interface FeishuBotOptions {
  /** 新会话的默认工作目录（registry 绑定 cwd 用）。 */
  defaultCwd: string
  /** 单条回复的最大字符数，超出截断（飞书文本消息有长度上限）；默认 20000。 */
  maxReplyChars?: number
}

const DEFAULT_MAX_REPLY_CHARS = 20_000

/**
 * 飞书 bot 核心（docs/knowledge/architecture.md M3）：
 * 群消息必须 @bot、p2p 全收；chat_id → session 绑定持久化；
 * 同一 chat 的 prompt 按 FIFO 串行（协议无排队语义）；
 * 全局通知流的 session 过滤由 RuntimePool.subscribeSession 完成，本类不直接消费通知。
 */
export class FeishuBot {
  readonly #queues = new Map<string, Promise<void>>()
  readonly #maxReplyChars: number

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly registry: SessionRegistry,
    private readonly gateway: FeishuGateway,
    private readonly options: FeishuBotOptions,
  ) {
    this.#maxReplyChars = options.maxReplyChars ?? DEFAULT_MAX_REPLY_CHARS
  }

  start(): Promise<void> {
    return this.gateway.start((message) => {
      void this.handle(message)
    })
  }

  /** 处理一条入站消息：await 返回时该消息对应的 turn 已完整结束（测试依赖此语义）。 */
  async handle(message: FeishuMessage): Promise<void> {
    if (message.chatType === 'group' && !message.mentioned) return
    const text = message.text.trim()
    if (text.length === 0) return

    if (text === '/help') {
      await this.gateway.sendText(
        message.chatId,
        '直接发送任务文本即可；/cwd <目录> 切换工作目录；/new 开新会话；/help 查看帮助',
      )
      return
    }
    if (text === '/new') {
      await this.registry.unbind(message.chatId)
      await this.gateway.sendText(message.chatId, '已重置，下一条消息开始新会话')
      return
    }
    if (text.startsWith('/cwd')) {
      const target = text.slice('/cwd'.length).trim()
      if (target.length === 0) {
        await this.gateway.sendText(message.chatId, '用法: /cwd <目录>')
        return
      }
      const binding = await this.registry.bindingOrCreate(message.chatId, this.options.defaultCwd)
      try {
        const absolute = await this.runtime.setCwd(target, binding.sessionId)
        await this.registry.updateCwd(message.chatId, absolute)
        await this.gateway.sendText(message.chatId, `工作目录 → ${absolute}`)
      } catch (error) {
        await this.gateway.sendText(message.chatId, describe(error))
      }
      return
    }

    const binding = await this.registry.bindingOrCreate(message.chatId, this.options.defaultCwd)
    const previous = this.#queues.get(message.chatId) ?? Promise.resolve()
    const settled = previous.then(() => this.#turn(message, binding.sessionId))
    this.#queues.set(
      message.chatId,
      settled.catch(() => undefined),
    )
    await settled
  }

  async #turn(message: FeishuMessage, sessionId: string): Promise<void> {
    try {
      const outcome = await this.runtime.prompt(message.text, sessionId)
      const reply = outcome.finalResponse.length > 0 ? outcome.finalResponse : '（本轮无文本回复）'
      await this.gateway.sendText(message.chatId, truncate(reply, this.#maxReplyChars))
    } catch (error) {
      const described = error as BotError
      await this.gateway.sendText(message.chatId, describe(error))
      if (described.kind === 'transport') {
        // 运行时断开是进程级的，会话历史仍在 dsh 侧：保留绑定，
        // 重启 bot 进程后同一 chat 自动续聊；自动重建运行时列为后续候选。
        await this.gateway.sendText(message.chatId, 'dsh 运行时已断开，会话已保留；请重启 bot 进程后继续')
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（已截断）`
}
