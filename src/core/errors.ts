import { JsonRpcResponseError, RequestTimeoutError, SdkProtocolError, TransportClosedError } from '@deepseek-ai/dsh-sdk-client'

/** wire 失败分类，对应 DESIGN.md §4.5 的错误处理矩阵。 */
export type BotErrorKind = 'transport' | 'timeout' | 'protocol' | 'wire' | 'unknown'

/** 带分类的运行时错误；前端按 kind 分流用户可见行为。 */
export class BotError extends Error {
  readonly kind: BotErrorKind
  constructor(kind: BotErrorKind, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'BotError'
    this.kind = kind
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 把任意抛出的值映射为 `BotError`；已是 `BotError` 原样返回。 */
export function toBotError(error: unknown): BotError {
  if (error instanceof BotError) return error
  if (error instanceof TransportClosedError) {
    return new BotError('transport', `dsh 运行时已断开: ${error.message}`, { cause: error })
  }
  if (error instanceof RequestTimeoutError) {
    return new BotError('timeout', `请求超时: ${error.message}`, { cause: error })
  }
  if (error instanceof SdkProtocolError) {
    return new BotError('protocol', `协议错误（客户端与 dsh 运行时版本可能不匹配）: ${error.message}`, { cause: error })
  }
  if (error instanceof JsonRpcResponseError) {
    return new BotError('wire', `运行时拒绝请求: ${error.message}`, { cause: error })
  }
  return new BotError('unknown', `未知错误: ${messageOf(error)}`, { cause: error })
}
