import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 一个外部会话（飞书 chat）到 dsh session 的绑定。 */
export interface SessionBinding {
  /** 外部会话键：飞书 chat_id。 */
  externalKey: string
  /** dsh session 标识。 */
  sessionId: string
  /** 该会话的默认工作目录（新 session 创建时记录）。 */
  cwd: string
  createdAt: number
}

interface RegistryFile {
  version: 1
  bindings: SessionBinding[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBindings(raw: unknown): SessionBinding[] {
  if (!isRecord(raw) || !Array.isArray(raw.bindings)) return []
  return raw.bindings.flatMap((entry) => {
    if (
      isRecord(entry) &&
      typeof entry.externalKey === 'string' &&
      typeof entry.sessionId === 'string' &&
      typeof entry.cwd === 'string' &&
      typeof entry.createdAt === 'number'
    ) {
      return [{ externalKey: entry.externalKey, sessionId: entry.sessionId, cwd: entry.cwd, createdAt: entry.createdAt }]
    }
    return []
  })
}

/**
 * 外部会话 ↔ dsh session 映射（DESIGN.md §4.2）。
 * 持久化到 JSON，进程重启后飞书会话可续聊（session 历史由 dsh 侧保留，
 * 客户端只需记住 id）。并发写通过串行化的 flush 队列保证。
 */
export class SessionRegistry {
  #bindings = new Map<string, SessionBinding>()
  #flushChain: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  /** 从磁盘加载；文件不存在按空表，内容损坏同样按空表（fail-open：会话将自动重建）。 */
  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return
    }
    try {
      this.#bindings = new Map(parseBindings(JSON.parse(text)).map((binding) => [binding.externalKey, binding]))
    } catch {
      this.#bindings = new Map()
    }
  }

  /** 查询既有绑定；没有返回 undefined。 */
  bindingFor(externalKey: string): SessionBinding | undefined {
    return this.#bindings.get(externalKey)
  }

  /** 取或建：没有绑定时铸造新 session 并持久化。 */
  async bindingOrCreate(externalKey: string, cwd: string): Promise<SessionBinding> {
    const existing = this.#bindings.get(externalKey)
    if (existing) return existing
    const binding: SessionBinding = {
      externalKey,
      sessionId: `session-${randomUUID()}`,
      cwd,
      createdAt: Date.now(),
    }
    this.#bindings.set(externalKey, binding)
    await this.flush()
    return binding
  }

  /** 更新既有绑定的 cwd（/cwd 命令后调用）。 */
  async updateCwd(externalKey: string, cwd: string): Promise<void> {
    const existing = this.#bindings.get(externalKey)
    if (!existing) return
    existing.cwd = cwd
    await this.flush()
  }

  /** 解除绑定（运行时断开、会话作废时调用）。 */
  async unbind(externalKey: string): Promise<void> {
    if (!this.#bindings.delete(externalKey)) return
    await this.flush()
  }

  /** 原子落盘；并发调用按调用顺序串行执行。 */
  flush(): Promise<void> {
    const payload: RegistryFile = { version: 1, bindings: [...this.#bindings.values()] }
    this.#flushChain = this.#flushChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8')
      await rename(temporary, this.file)
    })
    return this.#flushChain
  }
}
