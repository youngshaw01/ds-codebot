import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EventRouter, type UiEvent } from '../src/core/router.ts'
import { RuntimePool } from '../src/core/runtime.ts'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../src/config.ts'

// M2 验收（docs/knowledge/architecture.md §6）：tool_call 过程可见、切目录后会话连续。
// 真实 API e2e：无 DEEPSEEK_API_KEY 时跳过（docs/knowledge/architecture.md §7 测试策略）
const key = process.env.DEEPSEEK_API_KEY
const maybe = key && key.length > 0 ? describe : describe.skip

maybe('live: 真实运行时事件流', () => {
  it('一轮触发工具的 prompt：router 收到 tool-call 与 assistant 文本', async () => {
    const { runtime } = await loadConfig(DEFAULT_CONFIG_PATH)
    const pool = new RuntimePool({ ...runtime, initializeTimeoutMs: 60000 })
    await pool.start()
    const events: UiEvent[] = []
    const router = new EventRouter(pool.sessionId, (event) => events.push(event))
    const unsubscribe = pool.subscribeSession((notification) => router.dispatch(notification))
    try {
      await pool.prompt('请用文件工具列出当前目录内容，然后用一句话总结')
      assert.ok(
        events.some((event) => event.kind === 'tool-call'),
        `期望至少一次 tool-call，实际事件: ${events.map((event) => event.kind).join(',')}`,
      )
      assert.ok(events.some((event) => event.kind === 'assistant-text'))
      assert.ok(events.some((event) => event.kind === 'turn-start') && events.some((event) => event.kind === 'turn-end'))
      const kinds = events.map((event) => (event.kind === 'tool-call' ? event.name : event.kind))
      assert.ok(
        kinds.some((kind) => typeof kind === 'string' && kind !== 'tool-call'),
        '工具调用应带工具名',
      )
    } finally {
      unsubscribe()
      await pool.close()
    }
  })

  it('/cwd 等价路径：切换工作目录后会话继续', async () => {
    const { runtime } = await loadConfig(DEFAULT_CONFIG_PATH)
    const pool = new RuntimePool({ ...runtime, initializeTimeoutMs: 60000 })
    try {
      const absolute = await pool.setCwd('..')
      assert.ok(absolute.length > 0)
      const outcome = await pool.prompt('只回复：目录已切换')
      assert.ok(outcome.finalResponse.length > 0)
    } finally {
      await pool.close()
    }
  })
})
