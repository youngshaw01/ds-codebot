import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { AgentRuntime } from '../src/core/runtime.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { SessionRegistry } from '../src/core/registry.ts'
import { ChatController, parseWebviewMessage } from '../src/vscode/controller.ts'
import type { HostToWebview } from '../src/vscode/controller.ts'
import type { VscodeApi, WebviewPanelLike, WorkspaceFolderLike } from '../src/vscode/api.ts'

const TURN_EVENT: HarnessNotification = {
  method: 'session.event',
  params: { sessionId: 'session-x', event: { type: 'assistant/message', seq: 1, time: 1, data: { message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] }, stream: [] } } },
}

class FakeRuntime implements AgentRuntime {
  readonly prompts: { sessionId: string; input: string }[] = []
  started = 0

  async start() {
    this.started += 1
  }
  readonly subscriptions = new Map<string, (notification: HarnessNotification) => void>()
  /** prompt 期间由测试执行的副作用（模拟 agent 改文件）。 */
  effect: (folder: string) => Promise<void> = async () => undefined

  async prompt(input: string, sessionId: string) {
    this.prompts.push({ sessionId, input })
    await this.effect(this.folder)
    return { sessionId, finalResponse: '好的', toolCallCount: 0, toolNames: [] }
  }

  async setCwd(path: string) {
    return path
  }

  subscribeSession(handler: (notification: HarnessNotification) => void, sessionId: string) {
    this.subscriptions.set(sessionId, handler)
    return () => this.subscriptions.delete(sessionId)
  }

  folder = ''
}

class FakePanel implements WebviewPanelLike {
  readonly posted: HostToWebview[] = []
  revealed = 0
  disposed = 0
  private messageListener: ((message: unknown) => unknown) | null = null
  private disposeListener: (() => unknown) | null = null
  // webview 必须是稳定单例：controller 经 panel.webview 写 html/注册监听
  private readonly webviewHandle = {
    html: '',
    cspSource: 'https://webview.test',
    postMessage: (message: unknown) => this.postMessage(message),
    onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
      this.messageListener = listener
      return { dispose: () => undefined }
    },
  }

  get html() {
    return this.webviewHandle.html
  }

  postMessage(message: unknown) {
    this.posted.push(message as HostToWebview)
    return true
  }

  reveal() {
    this.revealed += 1
  }

  dispose() {
    this.disposed += 1
    this.disposeListener?.()
  }

  onDidDispose(listener: () => unknown) {
    this.disposeListener = listener
    return { dispose: () => undefined }
  }

  get webview() {
    return this.webviewHandle
  }
}

class FakeApi implements VscodeApi {
  readonly folders: WorkspaceFolderLike[]
  lastPanel: FakePanel | null = null
  createWebviewPanelCalls = 0

  constructor(folders: WorkspaceFolderLike[]) {
    this.folders = folders
  }

  workspaceFolders() {
    return this.folders
  }

  createWebviewPanel() {
    this.createWebviewPanelCalls += 1
    this.lastPanel = new FakePanel()
    return this.lastPanel
  }
}

let dir: string
let folderRoot: string
let runtime: FakeRuntime
let api: FakeApi
let registry: SessionRegistry
let controller: ChatController

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ds-codebot-vscode-'))
  folderRoot = join(dir, 'repo')
  await mkdir(folderRoot, { recursive: true })
  await writeFile(join(folderRoot, 'seed.txt'), 'seed\n', 'utf8')
  runtime = new FakeRuntime()
  runtime.folder = folderRoot
  api = new FakeApi([{ uri: folderRoot, name: 'repo', index: 0 }])
  registry = new SessionRegistry(join(dir, 'registry.json'))
  await registry.load()
  controller = new ChatController(runtime, api, registry)
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function panel(): FakePanel {
  assert.ok(api.lastPanel)
  return api.lastPanel
}

describe('ChatController', () => {
  it('open 创建面板、绑定工作区并推送 meta', async () => {
    await controller.open()
    assert.ok(api.lastPanel)
    assert.ok(api.lastPanel.html.includes('ds-codebot'))
    const meta = panel().posted.find((message) => message.type === 'meta')
    assert.ok(meta && meta.type === 'meta')
    assert.equal(meta.folder, 'repo')
    const binding = registry.bindingFor(folderRoot)
    assert.ok(binding)
    assert.equal(meta.sessionId, binding.sessionId)
  })

  it('重复 open 只聚焦不新建面板', async () => {
    await controller.open()
    assert.equal(panel().revealed, 1)
    assert.equal(api.createWebviewPanelCalls, 1)
  })

  it('wire 通知经 router 转为 ui-event 转发', () => {
    const sessionId = registry.bindingFor(folderRoot)?.sessionId ?? ''
    const handler = runtime.subscriptions.get(sessionId)
    assert.ok(handler)
    handler({ ...TURN_EVENT, params: { ...TURN_EVENT.params, sessionId } })
    const events = panel().posted.filter((message) => message.type === 'ui-event')
    assert.deepEqual(events.at(-1), { type: 'ui-event', event: { kind: 'assistant-text', text: '好的' } })
  })

  it('prompt 前后快照：agent 改动的文件进入 turn-diff', async () => {
    panel().posted.length = 0
    runtime.effect = async (folder) => {
      await writeFile(join(folder, 'seed.txt'), 'seed changed\n', 'utf8')
      await writeFile(join(folder, 'added.txt'), 'new\n', 'utf8')
    }
    await controller.handleWebviewMessage({ type: 'prompt', text: '改点东西' })

    const diff = panel().posted.find((message) => message.type === 'turn-diff')
    assert.ok(diff && diff.type === 'turn-diff')
    assert.deepEqual(
      diff.files.map((file) => file.path).sort(),
      ['added.txt', 'seed.txt'],
    )
    const seed = diff.files.find((file) => file.path === 'seed.txt')
    assert.ok(seed?.patch.includes('+seed changed'))
  })

  it('cwd 消息切换工作目录并回报', async () => {
    panel().posted.length = 0
    await controller.handleWebviewMessage({ type: 'cwd', path: 'src' })
    const notice = panel().posted.find((message) => message.type === 'notice')
    assert.ok(notice && notice.type === 'notice' && notice.text.includes('工作目录'))
  })

  it('runtime 错误以 notice 回报且不崩溃', async () => {
    panel().posted.length = 0
    runtime.effect = async () => {
      throw new Error('boom')
    }
    await controller.handleWebviewMessage({ type: 'prompt', text: 'x' })
    const notice = panel().posted.find((message) => message.type === 'notice')
    assert.ok(notice && notice.type === 'notice' && notice.tone === 'error')
    runtime.effect = async () => undefined
  })
})

describe('parseWebviewMessage', () => {
  it('合法消息解析', () => {
    assert.deepEqual(parseWebviewMessage({ type: 'prompt', text: 'hi' }), { type: 'prompt', text: 'hi' })
    assert.deepEqual(parseWebviewMessage({ type: 'cwd', path: 'src' }), { type: 'cwd', path: 'src' })
    assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' })
  })

  it('非法消息返回 null', () => {
    assert.equal(parseWebviewMessage(null), null)
    assert.equal(parseWebviewMessage({ type: 'prompt' }), null)
    assert.equal(parseWebviewMessage({ type: 'evil' }), null)
  })
})
