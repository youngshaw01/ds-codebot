/**
 * VS Code API 的最小 seam（capability seam 的 Definition 角色）。
 * controller 只依赖本接口：测试用内存假实现，extension.ts 用真实 vscode 对象装配。
 * 形状刻意与 `vscode.WebviewPanel` / `vscode.WorkspaceFolder` 保持一致，
 * 使真实对象无需断言即可赋值。
 */

/** Webview 侧句柄（`vscode.Webview` 的结构子集）。 */
export interface WebviewLike {
  html: string
  cspSource: string
  postMessage(message: unknown): unknown
  onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): void }
}

/** Webview 面板句柄（`vscode.WebviewPanel` 的结构子集）。 */
export interface WebviewPanelLike {
  reveal(): unknown
  dispose(): void
  onDidDispose(listener: () => unknown): { dispose(): void }
  readonly webview: WebviewLike
}

/** 工作区文件夹（`vscode.WorkspaceFolder` 的结构子集）。 */
export interface WorkspaceFolderLike {
  readonly uri: string
  readonly name: string
  readonly index: number
}

/** controller 消费的 VS Code 能力面。 */
export interface VscodeApi {
  workspaceFolders(): readonly WorkspaceFolderLike[]
  createWebviewPanel(viewType: string, title: string): WebviewPanelLike
}
