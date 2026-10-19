import type { AgentRuntime } from '../core/runtime.ts'
import { SessionRegistry } from '../core/registry.ts'
import { EventRouter, type UiEvent } from '../core/router.ts'
import { diffSnapshots, IncrementalWorkspace, type FileDiff } from '../core/snapshot.ts'
import type { VscodeApi, WebviewPanelLike, WorkspaceFolderLike } from './api.ts'
import { webviewHtml } from './webview/html.ts'

export type HostToWebview =
  | { type: 'meta'; sessionId: string; folder: string; cwd: string }
  | { type: 'ui-event'; event: UiEvent }
  | { type: 'turn-diff'; files: FileDiff[] }
  | { type: 'notice'; tone: 'info' | 'error'; text: string }

/**
 * VS Code 聊天控制器（DESIGN.md M4）：
 * 工作区文件夹 ↔ session 绑定；prompt 前后快照工作区产出 turn diff；
 * wire 通知经 EventRouter 转为 UI 事件转发 webview。审批不可达 wire，
 * 权限必须在启动配置预置（见 README）- controller 不做审批交互。
 */
export class ChatController {
  readonly #queues = new Map<string, Promise<void>>()

  #panel: WebviewPanelLike | null = null
  #folder: WorkspaceFolderLike | null = null
  #workspaces = new Map<string, IncrementalWorkspace>()
  #disposable: (() => void) | null = null

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly api: VscodeApi,
    private readonly registry: SessionRegistry,
  ) {}

  /** 打开（或聚焦）聊天面板并绑定工作区；重复调用只聚焦。 */
  async open(folder?: WorkspaceFolderLike): Promise<void> {
    if (this.#panel) {
      this.#panel.reveal()
      return
    }
    const target = folder ?? this.api.workspaceFolders()[0]
    if (!target) throw new Error('没有打开的工作区文件夹')
    await this.runtime.start()
    await this.registry.load()

    const panel = this.api.createWebviewPanel('ds-codebot.chat', 'ds-codebot')
    this.#panel = panel
    this.#folder = target
    panel.webview.html = this.#html(panel)

    const binding = await this.registry.bindingOrCreate(target.uri, target.uri)
    const router = new EventRouter(binding.sessionId, (event) => this.#post({ type: 'ui-event', event }))
    this.#disposable = this.runtime.subscribeSession((notification) => router.dispatch(notification), binding.sessionId)

    panel.webview.onDidReceiveMessage((raw) => {
      void this.handleWebviewMessage(raw)
    })
    panel.onDidDispose(() => {
      this.#disposable?.()
      this.#disposable = null
      this.#panel = null
      this.#folder = null
    })

    this.#post({ type: 'meta', sessionId: binding.sessionId, folder: target.name, cwd: target.uri })
  }

  /** webview 入站消息入口：wire 边界校验后分发（公开以便测试直接驱动）。 */
  async handleWebviewMessage(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw)
    if (!message) return
    const folder = this.#folder
    if (!folder) return
    if (message.type === 'prompt') {
      await this.#enqueue(folder, message.text)
      return
    }
    if (message.type === 'cwd') {
      const binding = await this.registry.bindingOrCreate(folder.uri, folder.uri)
      try {
        await this.runtime.setCwd(message.path, binding.sessionId)
        await this.registry.updateCwd(folder.uri, message.path)
        this.#post({ type: 'notice', tone: 'info', text: `工作目录 → ${message.path}` })
      } catch (error) {
        this.#post({ type: 'notice', tone: 'error', text: describe(error) })
      }
    }
  }

  async #enqueue(folder: WorkspaceFolderLike, text: string): Promise<void> {
    const binding = await this.registry.bindingOrCreate(folder.uri, folder.uri)
    const previous = this.#queues.get(binding.sessionId) ?? Promise.resolve()
    const settled = previous.then(() => this.#turn(folder, binding.sessionId, text))
    this.#queues.set(
      binding.sessionId,
      settled.catch(() => undefined),
    )
    await settled
  }

  async #turn(folder: WorkspaceFolderLike, sessionId: string, text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    try {
      const workspace = this.#workspaceFor(folder)
      const before = await workspace.capture()
      await this.runtime.prompt(trimmed, sessionId)
      const after = await workspace.capture()
      const files = diffSnapshots(before, after)
      if (files.length > 0) this.#post({ type: 'turn-diff', files })
    } catch (error) {
      this.#post({ type: 'notice', tone: 'error', text: describe(error) })
    }
  }

  /** 释放：退订通知、关闭面板、丢弃增量工作区。deactivate 与测试拆卸路径共用。 */
  dispose(): void {
    this.#disposable?.()
    this.#disposable = null
    this.#workspaces.clear()
    this.#panel?.dispose()
    this.#panel = null
    this.#folder = null
  }

  /** 每 folder 一个增量基线（M5）：turn 边界只读变更文件。 */
  #workspaceFor(folder: WorkspaceFolderLike): IncrementalWorkspace {
    let workspace = this.#workspaces.get(folder.uri)
    if (!workspace) {
      workspace = new IncrementalWorkspace(folder.uri)
      this.#workspaces.set(folder.uri, workspace)
    }
    return workspace
  }

  #post(message: HostToWebview): void {
    if (!this.#panel) return
    void this.#panel.webview.postMessage(message)
  }

  #html(panel: WebviewPanelLike): string {
    return webviewHtml(panel.webview.cspSource)
  }
}

type WebviewMessage = { type: 'prompt'; text: string } | { type: 'cwd'; path: string } | { type: 'ready' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** webview → host 消息的 wire 边界校验：形状不符返回 null。 */
export function parseWebviewMessage(raw: unknown): WebviewMessage | null {
  if (!isRecord(raw)) return null
  if (raw.type === 'prompt') return typeof raw.text === 'string' ? { type: 'prompt', text: raw.text } : null
  if (raw.type === 'cwd') return typeof raw.path === 'string' ? { type: 'cwd', path: raw.path } : null
  if (raw.type === 'ready') return { type: 'ready' }
  return null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
