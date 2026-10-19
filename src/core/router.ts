import { validatedSessionEvent, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** 前端可渲染的最小事件集：由 `EventRouter` 从 wire 通知派生（docs/knowledge/architecture.md §4.3）。 */
export type UiEvent =
  | { kind: 'turn-start' }
  | { kind: 'turn-end' }
  | { kind: 'user-text'; text: string }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'tool-call'; name: string; args: string }
  | { kind: 'tool-result'; callId: string; isError: boolean }
  | { kind: 'status'; running: boolean }

function textOf(content: readonly ContentBlock[]): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/**
 * 把一条 wire 通知翻译为 UI 事件。只处理本 session 的
 * `session.event` / `session.status`；其余（他 session 事件、subagent 通知）
 * 在 M2 显式忽略——多前端复用同一路由器时在此扩展。
 */
export class EventRouter {
  readonly sessionId: string
  readonly #emit: (event: UiEvent) => void

  constructor(sessionId: string, emit: (event: UiEvent) => void) {
    this.sessionId = sessionId
    this.#emit = emit
  }

  dispatch(notification: HarnessNotification): void {
    const params = notification.params
    if (typeof params.sessionId !== 'string' || params.sessionId !== this.sessionId) return
    if (notification.method === 'session.status') {
      if (params.status === 'running' || params.status === 'idle') {
        this.#emit({ kind: 'status', running: params.status === 'running' })
      }
      return
    }
    if (notification.method !== 'session.event') return
    let event
    try {
      event = validatedSessionEvent(params.event)
    } catch {
      return // 校验失败的事件不进入渲染：宁可少渲染，不渲染不可信数据
    }
    switch (event.type) {
      case 'turn/start':
        this.#emit({ kind: 'turn-start' })
        return
      case 'turn/end':
        this.#emit({ kind: 'turn-end' })
        return
      case 'user/message':
        this.#emit({ kind: 'user-text', text: textOf(event.data.content) })
        return
      case 'assistant/message':
        this.#emit({ kind: 'assistant-text', text: textOf(event.data.message.content) })
        return
      case 'tool/call':
        this.#emit({ kind: 'tool-call', name: event.data.name, args: event.data.arguments })
        return
      case 'tool/result':
        this.#emit({ kind: 'tool-result', callId: event.data.message.toolCallId, isError: event.data.message.isError === true })
        return
      default:
        return
    }
  }
}
