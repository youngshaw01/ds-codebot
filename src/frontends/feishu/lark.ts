import * as Lark from '@larksuiteoapi/node-sdk'
import type { FeishuGateway, FeishuMessage } from './gateway.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 飞书 `im.message.receive_v1` 事件 → `FeishuMessage`。
 * 外部输入在 wire 边界校验：形状不符返回 null，调用方丢弃。
 * M3 只处理文本消息；@占位符（`@_user_N`）从正文剔除。
 */
export function parseMessageEvent(data: unknown): FeishuMessage | null {
  if (!isRecord(data)) return null
  const message = data.message
  if (!isRecord(message)) return null
  if (typeof message.chat_id !== 'string' || typeof message.message_id !== 'string') return null
  if (message.message_type !== 'text') return null
  if (typeof message.content !== 'string') return null

  let content: unknown
  try {
    content = JSON.parse(message.content)
  } catch {
    return null
  }
  if (!isRecord(content) || typeof content.text !== 'string') return null

  const mentions = Array.isArray(message.mentions) ? message.mentions : []
  const chatType = message.chat_type === 'p2p' ? 'p2p' : 'group'
  const text = content.text.replace(/@_user_\d+/g, ' ').trim()
  return {
    chatId: message.chat_id,
    chatType,
    text,
    messageId: message.message_id,
    mentioned: mentions.length > 0,
  }
}

/** 生产网关：飞书开放平台 Node SDK 的 WebSocket 长连接 + 消息发送。 */
export class LarkGateway implements FeishuGateway {
  readonly #client: Lark.Client
  #ws: Lark.WSClient | null = null

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {
    this.#client = new Lark.Client({ appId, appSecret })
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.#client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
    })
  }

  async start(onMessage: (message: FeishuMessage) => void): Promise<void> {
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data: unknown) => {
        const message = parseMessageEvent(data)
        if (message) onMessage(message)
      },
    })
    this.#ws = new Lark.WSClient({ appId: this.appId, appSecret: this.appSecret })
    await this.#ws.start({ eventDispatcher: dispatcher })
  }

  async stop(): Promise<void> {
    const ws = this.#ws
    this.#ws = null
    ws?.close({ force: true })
  }
}
