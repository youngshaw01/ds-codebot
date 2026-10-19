import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BotError } from '../src/core/errors.ts'
import { RuntimePool } from '../src/core/runtime.ts'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../src/config.ts'

// 真实 API e2e：无 DEEPSEEK_API_KEY 时跳过（DESIGN.md §7 测试策略）
const key = process.env.DEEPSEEK_API_KEY
const maybe = key && key.length > 0 ? describe : describe.skip

maybe('e2e: 真实 dsh 运行时', () => {
  it('连续两轮对话保持同一 session', async () => {
    const { runtime } = await loadConfig(DEFAULT_CONFIG_PATH)
    const pool = new RuntimePool({ ...runtime, initializeTimeoutMs: 60000 })
    try {
      const first = await pool.prompt('请只回复：第一轮确认')
      assert.ok(first.finalResponse.length > 0)
      const second = await pool.prompt('请只回复：第二轮确认')
      assert.ok(second.finalResponse.length > 0)
      assert.equal(second.sessionId, first.sessionId)
    } catch (error) {
      if (error instanceof BotError && (error.kind === 'wire' || error.kind === 'transport')) {
        // 凭据/路由问题不属于被测行为：显式失败并保留原因
        assert.fail(`运行时不可用（${error.kind}）: ${error.message}`)
      }
      throw error
    } finally {
      await pool.close()
    }
  })
})
