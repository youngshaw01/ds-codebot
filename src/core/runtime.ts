import { randomUUID } from 'node:crypto'
import { DeepSeekHarness, type HarnessNotification, type RunResult } from '@deepseek-ai/dsh-sdk-client'
import type { RuntimeConfig } from '../config.ts'
import { BotError, toBotError } from './errors.ts'

/** 一轮 prompt 的结算结果（DESIGN.md §6 M1 验收口径）。 */
export interface PromptOutcome {
  sessionId: string
  /** 区间内最后一条 root assistant 文本，无回复时为空串。 */
  finalResponse: string
  /** 区间内 root session 的工具调用次数。 */
  toolCallCount: number
  /** 区间内工具名列表，按调用顺序。 */
  toolNames: string[]
}

function countTools(events: RunResult['events']): { count: number; names: string[] } {
  const names = events.flatMap((event) => (event.type === 'tool/call' ? [event.data.name] : []))
  return { count: names.length, names }
}

/**
 * 一个进程对一个 dsh 运行时子进程的独占句柄（DESIGN.md §4.1）。
 * 懒启动、首次 prompt 前完成 initialize 握手；多 prompt 串行由调用方
 * 通过 promise 链保证（协议无排队语义，M1 CLI 自带了 FIFO）。
 */
export class RuntimePool {
  readonly sessionId: string
  /** 本池驱动 agent 所用的模型标识（状态栏展示用）。 */
  get modelId(): string {
    return this.config.model
  }
  #harness: DeepSeekHarness | null = null
  #starting: Promise<void> | null = null
  #closed = false

  constructor(
    private readonly config: RuntimeConfig,
    sessionId: string = `session-${randomUUID()}`,
  ) {
    this.sessionId = sessionId
  }

  /** 启动子进程并完成握手；重复调用复用同一次握手。 */
  async start(): Promise<void> {
    if (this.#harness) return
    if (this.#closed) throw new BotError('transport', '运行时已关闭，无法重启')
    this.#starting ??= this.#start()
    await this.#starting
  }

  async #start(): Promise<void> {
    const harness = new DeepSeekHarness({
      profile: this.config.profile,
      patches: this.config.patches,
      provider: this.config.provider,
      model: this.config.model,
      cwd: process.cwd(),
      ...(this.config.maxTokens !== undefined ? { maxTokens: this.config.maxTokens } : {}),
      ...(this.config.reasoningEffort !== undefined ? { reasoningEffort: this.config.reasoningEffort } : {}),
      ...(this.config.dshBin !== undefined ? { dshBin: this.config.dshBin } : {}),
    })
    await harness.start()
    if (this.#closed) {
      // start 期间被并发关闭：立即回收子进程，不泄漏
      await harness.close()
      throw new BotError('transport', '运行时在启动期间被关闭')
    }
    this.#harness = harness
  }

  /** 提交一轮 prompt 并等待整机 idle；任何 wire 失败映射为 `BotError`。 */
  async prompt(input: string): Promise<PromptOutcome> {
    await this.start()
    const harness = this.#harness
    if (!harness) throw new BotError('transport', '运行时未启动')
    try {
      const result = await harness.run(input, { sessionId: this.sessionId })
      const { count, names } = countTools(result.events)
      return { sessionId: result.sessionId, finalResponse: result.finalResponse, toolCallCount: count, toolNames: names }
    } catch (error) {
      throw toBotError(error)
    }
  }

  /** 修改本 session 的有效工作目录（DESIGN.md M2 的 /cwd）；返回校验后的绝对路径。 */
  async setCwd(path: string): Promise<string> {
    await this.start()
    const harness = this.#harness
    if (!harness) throw new BotError('transport', '运行时未启动')
    try {
      return await harness.session(this.sessionId).setWorkingDirectory(path)
    } catch (error) {
      throw toBotError(error)
    }
  }

  /**
   * 订阅本 session（含已发现子代理）的 wire 通知，交给 handler 分发。
   * 运行时只推全局流，session 树过滤由 client 完成（DESIGN.md §4.3）。
   * @returns 退订函数。
   */
  subscribeSession(handler: (notification: HarnessNotification) => void): () => void {
    const harness = this.#harness
    if (!harness) throw new BotError('transport', '运行时未启动，先调用 start()')
    const subscription = harness.client.subscribeSessionTree(this.sessionId)
    let active = true
    // 运行时会话结束后迭代自然结束/拒绝：此处只是结束循环，不向调用方抛错
    void (async () => {
      for await (const notification of subscription) {
        if (!active) break
        handler(notification)
      }
    })().catch(() => undefined)
    return () => {
      active = false
      subscription.close()
    }
  }

  /** 关闭并回收子进程；幂等。 */
  async close(): Promise<void> {
    this.#closed = true
    const harness = this.#harness
    this.#harness = null
    if (!harness) return
    try {
      await harness.close()
    } catch (error) {
      throw toBotError(error)
    }
  }
}
