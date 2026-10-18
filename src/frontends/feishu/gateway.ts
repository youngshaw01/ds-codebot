/** 一条归一化的入站消息：网关负责把飞书事件剥成这个形状（wire 边界校验在实现内）。 */
export interface FeishuMessage {
  chatId: string
  chatType: 'group' | 'p2p'
  /** 已剔除 @占位符 并 trim 的文本。 */
  text: string
  messageId: string
  /** 群内是否 @了机器人（p2p 恒为 false，由 bot 按 chatType 判定）。 */
  mentioned: boolean
}

/**
 * 飞书通道能力（capability seam 的 Definition 角色）。
 * bot 核心只依赖此接口：测试用内存假网关，生产用 Lark SDK 实现。
 */
export interface FeishuGateway {
  /** 发送纯文本回复。 */
  sendText(chatId: string, text: string): Promise<void>
  /** 建立长连接并把入站消息交给 handler。 */
  start(onMessage: (message: FeishuMessage) => void): Promise<void>
  /** 断开连接。 */
  stop(): Promise<void>
}
