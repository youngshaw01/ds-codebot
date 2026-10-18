import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { EventRouter, type UiEvent } from '../src/core/router.ts'

const SESSION = 'session-test'
const OTHER = 'session-other'

function eventNotification(sessionId: string, event: unknown): HarnessNotification {
  return { method: 'session.event', params: { sessionId, event } }
}

function statusNotification(sessionId: string, status: 'running' | 'idle'): HarnessNotification {
  return { method: 'session.status', params: { sessionId, status } }
}

const turnStart = { type: 'turn/start', seq: 1, time: 1, data: { turn: 0 } }
const userMessage = {
  type: 'user/message',
  seq: 2,
  time: 2,
  data: { role: 'user', content: [{ type: 'text', text: '列出文件' }] },
}
const assistantMessage = {
  type: 'assistant/message',
  seq: 4,
  time: 4,
  data: { role: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] }, stream: [] },
}
const toolCall = {
  type: 'tool/call',
  seq: 3,
  time: 3,
  data: { turn: 0, step: 0, callId: 'call-1', name: 'fs_read', arguments: '{"path":"."}' },
}
const toolResult = {
  type: 'tool/result',
  seq: 5,
  time: 5,
  data: { turn: 0, step: 0, message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: '...' }], isError: true } },
}
const turnEnd = { type: 'turn/end', seq: 6, time: 6, data: { reason: { kind: 'completed' } } }

function collect(): { events: UiEvent[]; router: EventRouter } {
  const events: UiEvent[] = []
  return { events, router: new EventRouter(SESSION, (event) => events.push(event)) }
}

describe('EventRouter', () => {
  it('完整事件序列翻译为 UI 事件', () => {
    const { events, router } = collect()
    for (const notification of [
      statusNotification(SESSION, 'running'),
      eventNotification(SESSION, turnStart),
      eventNotification(SESSION, userMessage),
      eventNotification(SESSION, toolCall),
      eventNotification(SESSION, toolResult),
      eventNotification(SESSION, assistantMessage),
      eventNotification(SESSION, turnEnd),
      statusNotification(SESSION, 'idle'),
    ]) {
      router.dispatch(notification)
    }
    assert.deepEqual(
      events.map((event) => event.kind),
      ['status', 'turn-start', 'user-text', 'tool-call', 'tool-result', 'assistant-text', 'turn-end', 'status'],
    )
    assert.deepEqual(events[2], { kind: 'user-text', text: '列出文件' })
    assert.deepEqual(events[3], { kind: 'tool-call', name: 'fs_read', args: '{"path":"."}' })
    assert.deepEqual(events[4], { kind: 'tool-result', callId: 'call-1', isError: true })
    assert.deepEqual(events[5], { kind: 'assistant-text', text: '好的' })
    assert.deepEqual(events[7], { kind: 'status', running: false })
  })

  it('忽略其他 session 的通知（全局流过滤）', () => {
    const { events, router } = collect()
    router.dispatch(eventNotification(OTHER, userMessage))
    router.dispatch(statusNotification(OTHER, 'running'))
    assert.equal(events.length, 0)
  })

  it('忽略 subagent 等未知方法', () => {
    const { events, router } = collect()
    router.dispatch({ method: 'subagent.started', params: { sessionId: 'child-1' } })
    assert.equal(events.length, 0)
  })

  it('校验失败的事件被忽略且不抛错', () => {
    const { events, router } = collect()
    const malformed = { type: 'assistant/message', seq: 9, time: 9, data: { message: { content: 'not-array' } } }
    assert.doesNotThrow(() => router.dispatch(eventNotification(SESSION, malformed)))
    assert.equal(events.length, 0)
  })

  it('忽略未知事件类型', () => {
    const { events, router } = collect()
    router.dispatch(eventNotification(SESSION, { type: 'system/message', seq: 7, time: 7, data: {} }))
    assert.equal(events.length, 0)
  })
})
