import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { RuntimePool } from '../src/core/runtime.ts'
import { SessionRegistry } from '../src/core/registry.ts'
import { ChatController } from '../src/vscode/controller.ts'
import type { HostToWebview } from '../src/vscode/controller.ts'
import type { VscodeApi, WebviewPanelLike, WorkspaceFolderLike } from '../src/vscode/api.ts'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../src/config.ts'

// M4 验收（DESIGN.md §6）：工作区会话绑定；turn diff 展示。
// 真实 dsh 运行时 + 内存假 vscode API；真实 VS Code 宿主联调需安装扩展（README）。
// 真实 API e2e：无 DEEPSEEK_API_KEY 时跳过（DESIGN.md §7 测试策略）
const key = process.env.DEEPSEEK_API_KEY
const maybe = key && key.length > 0 ? describe : describe.skip

class FakePanel implements WebviewPanelLike {
  readonly posted: HostToWebview[] = []
  html = ''

  postMessage(message: unknown) {
    this.posted.push(message as HostToWebview)
    return true
  }

  reveal() {}
  dispose() {}
  onDidDispose() {
    return { dispose: () => undefined }
  }

  get webview() {
    return {
      html: '',
      cspSource: 'https://webview.test',
      postMessage: (message: unknown) => this.postMessage(message),
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
    }
  }
}

class FakeApi implements VscodeApi {
  lastPanel: FakePanel | null = null

  constructor(private readonly folders: WorkspaceFolderLike[]) {}

  workspaceFolders() {
    return this.folders
  }

  createWebviewPanel() {
    this.lastPanel = new FakePanel()
    return this.lastPanel
  }
}

maybe('live-vscode: 真实运行时 + 假 vscode API', () => {
  it('工作区绑定 + agent 建文件后 turn-diff 上报新增文件', { timeout: 180_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ds-codebot-live-vscode-'))
    try {
      const { runtime: runtimeConfig } = await loadConfig(DEFAULT_CONFIG_PATH)
      const pool = new RuntimePool({ ...runtimeConfig, initializeTimeoutMs: 60000 })
      await pool.start()
      const registry = new SessionRegistry(join(dir, 'registry.json'))
      await registry.load()

      // 工作区用独立临时目录：agent 在其中建文件，快照差分必须看得到
      const folderRoot = join(dir, 'repo')
      await mkdir(folderRoot, { recursive: true })
      await writeFile(join(folderRoot, 'README.md'), '# demo\n', 'utf8')
      const api = new FakeApi([{ uri: folderRoot, name: 'repo', index: 0 }])
      // snapshotDir 启用持久化基线 + 文件监听（M6 全路径）
      const controller = new ChatController(pool, api, registry, { snapshotDir: join(dir, 'snapshots') })
      await controller.open()

      const panel = api.lastPanel
      assert.ok(panel)

      const binding = registry.bindingFor(folderRoot)
      assert.ok(binding, 'open 后应建立工作区 ↔ session 绑定')

      await controller.handleWebviewMessage({ type: 'prompt', text: '在当前目录创建文件 proof.txt，内容为 ok，然后只回复 done' })

      const diff = panel.posted.find((message) => message.type === 'turn-diff')
      assert.ok(diff && diff.type === 'turn-diff', `期望 turn-diff，实际: ${JSON.stringify(panel.posted.map((m) => m.type))}`)
      const proof = diff.files.find((file) => file.path === 'proof.txt')
      assert.ok(proof, `期望 proof.txt 出现在 diff 中: ${diff.files.map((file) => file.path).join(',')}`)
      assert.equal(proof.kind, 'added')

      await controller.dispose()
      await pool.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
