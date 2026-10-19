import * as vscode from 'vscode'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../config.ts'
import { RuntimePool } from '../core/runtime.ts'
import { SessionRegistry } from '../core/registry.ts'
import { ChatController } from './controller.ts'
import type { VscodeApi } from './api.ts'

/** 真实 VS Code 对象到 seam 的适配：seam 形状与 vscode 类型保持结构兼容，无需断言。 */
function toApi(): VscodeApi {
  return {
    workspaceFolders: () =>
      (vscode.workspace.workspaceFolders ?? []).map((folder, index) => ({
        uri: folder.uri.fsPath,
        name: folder.name,
        index,
      })),
    createWebviewPanel: (viewType, title) =>
      vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.One, {
        enableScripts: true,
        localResourceRoots: [],
      }),
  }
}

let pool: RuntimePool | null = null
let controller: ChatController | null = null

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const { runtime } = await loadConfig(DEFAULT_CONFIG_PATH)
  pool = new RuntimePool(runtime)

  // 会话绑定存放在扩展的 globalStorage（随 VS Code 账户/机器持久）
  const registry = new SessionRegistry(vscode.Uri.joinPath(context.globalStorageUri, 'ds-codebot-registry.json').fsPath)
  controller = new ChatController(pool, toApi(), registry)

  context.subscriptions.push(
    vscode.commands.registerCommand('ds-codebot.openChat', () => {
      void controller.open()
    }),
  )
}

export async function deactivate(): Promise<void> {
  controller?.dispose()
  await pool?.close()
  controller = null
  pool = null
}
