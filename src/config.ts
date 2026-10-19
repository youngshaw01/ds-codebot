import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** dsh 运行时启动参数（ DESIGN.md §5 的 runtime 节）。 */
export interface RuntimeConfig {
  /** 驱动 SDK 协议的 dsh profile，默认 `sdk`。 */
  profile: string
  /** 有序 profile patch，相对路径相对于配置文件所在目录解析。 */
  patches: string[]
  /** 模型提供方路由。 */
  provider: string
  /** 模型标识。 */
  model: string
  /** 单次请求输出上限；省略用模型默认值。 */
  maxTokens?: number
  /** 推理强度，adapter 自有标识；省略保留模型默认。 */
  reasoningEffort?: ReasoningEffortId
  /** 显式 dsh 可执行文件；省略由 SDK client 按同版本解析。 */
  dshBin?: string
  /** initialize 握手超时（毫秒）；冷启动/慢盘机器可调大，默认 10000。 */
  initializeTimeoutMs?: number
}

/** ds-codebot 配置文件结构。 */
export interface BotConfig {
  runtime: RuntimeConfig
  /** 飞书前端配置；appId/appSecret 只走环境变量，绝不入此文件。 */
  feishu?: {
    /** 新会话默认工作目录；省略用进程 cwd。 */
    defaultCwd?: string
  }
}

/** 配置缺失或非法：启动期 fail loud。 */
export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'ConfigError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export const DEFAULT_CONFIG_PATH = 'ds-codebot.config.json'

const DEFAULT_PROFILE = 'sdk'
const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-v4-flash'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string, cause?: unknown): never {
  throw new ConfigError(message, { cause })
}

/**
 * 读取并校验配置文件。非法配置在启动期抛出 `ConfigError`，
 * 不允许带病进入运行期（AGENTS.md：握手失败即拒绝所有 prompt）。
 */
export async function loadConfig(path: string = DEFAULT_CONFIG_PATH): Promise<BotConfig> {
  const absolute = resolve(path)
  let text: string
  try {
    text = await readFile(absolute, 'utf8')
  } catch (cause) {
    fail(`无法读取配置文件 ${absolute}`, cause)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    fail(`配置文件不是合法 JSON: ${absolute}`, cause)
  }
  if (!isRecord(raw)) fail(`配置文件顶层必须是对象: ${absolute}`)
  const runtime = raw.runtime
  if (!isRecord(runtime)) fail(`配置文件缺少 "runtime" 配置节: ${absolute}`)

  const patches = runtime.patches
  if (patches !== undefined && (!Array.isArray(patches) || patches.some((p) => typeof p !== 'string'))) {
    fail('"runtime.patches" 必须是由相对路径字符串组成的数组')
  }

  const maxTokens = runtime.maxTokens
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    fail('"runtime.maxTokens" 必须是正整数')
  }

  const reasoningEffort = runtime.reasoningEffort
  if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
    fail('"runtime.reasoningEffort" 必须是非空字符串')
  }

  const dshBin = runtime.dshBin
  if (dshBin !== undefined && (typeof dshBin !== 'string' || dshBin.length === 0)) {
    fail('"runtime.dshBin" 必须是非空路径字符串')
  }

  const initializeTimeoutMs = runtime.initializeTimeoutMs
  if (
    initializeTimeoutMs !== undefined &&
    (typeof initializeTimeoutMs !== 'number' || !Number.isSafeInteger(initializeTimeoutMs) || initializeTimeoutMs <= 0)
  ) {
    fail('"runtime.initializeTimeoutMs" 必须是正整数')
  }

  const feishu = raw.feishu
  if (feishu !== undefined) {
    if (!isRecord(feishu)) fail('"feishu" 必须是对象')
    if (feishu.defaultCwd !== undefined && (typeof feishu.defaultCwd !== 'string' || feishu.defaultCwd.length === 0)) {
      fail('"feishu.defaultCwd" 必须是非空路径字符串')
    }
  }

  const config: RuntimeConfig = {
    profile: DEFAULT_PROFILE,
    patches: [],
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
  }
  if (typeof runtime.profile === 'string' && runtime.profile.length > 0) config.profile = runtime.profile
  if (patches !== undefined) config.patches = [...(patches as string[])]
  if (typeof runtime.provider === 'string' && runtime.provider.length > 0) config.provider = runtime.provider
  if (typeof runtime.model === 'string' && runtime.model.length > 0) config.model = runtime.model
  if (maxTokens !== undefined) config.maxTokens = maxTokens
  if (typeof reasoningEffort === 'string') config.reasoningEffort = ReasoningEffortId(reasoningEffort)
  if (typeof dshBin === 'string') config.dshBin = dshBin
  if (initializeTimeoutMs !== undefined) config.initializeTimeoutMs = initializeTimeoutMs
  const bot: BotConfig = { runtime: config }
  if (feishu !== undefined) {
    bot.feishu = { ...(typeof feishu.defaultCwd === 'string' ? { defaultCwd: feishu.defaultCwd } : {}) }
  }
  return bot
}
