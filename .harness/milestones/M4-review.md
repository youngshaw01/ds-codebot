# M4 复盘 — VS Code 扩展后端

日期：2026-10-19

## 验收标准逐条结论

| 标准（DESIGN.md §6） | 结论 | 证据 |
|---|---|---|
| 工作区会话绑定 | **通过（内部全链路）** | `tests/live-vscode.spec.ts`（真实 key + 真实 dsh 运行时 + 假 vscode API）：`open()` 后 registry 建立 folder.uri → session 绑定并推送 meta；controller 单测覆盖重复 open 只聚焦 |
| diff 展示 | **通过** | live 测试：agent 在工作区创建 `proof.txt` 后 `turn-diff` 上报该文件（added + unified patch）；单测覆盖 modified/added/deleted 与计行；webview 渲染 diff 块 |
| （执行标准）typecheck + 单测 | **通过** | `tsc --noEmit` 0 错误；非 live 51/51；live 全部通过（e2e 1、live-events 2、live-feishu 2、live-vscode 1） |
| （执行标准）真实宿主冒烟 | 未做 | 真实 VS Code 宿主需安装扩展（`npm run build:vscode` + `code --extensionDevelopmentPath=dist-vscode`），README 已写步骤；**列为首跑手工冒烟** |

## 关键架构发现（记录备查）

- **SDK 协议不暴露 `workspace/changes` 的 diff 内容**：该 diff 是 dsh Host 侧服务（`ctx.workspaceChanges.diff`），wire 上只有 6 个请求方法，拿不到；且安装版运行时（0.2.1-rc.2）根本不发 `workspace/changes` 事件。因此 M4 的 diff **由扩展宿主在 turn 前后自行快照工作区 + jsdiff 计算**（`src/core/snapshot.ts`），这正是上游"log-only 事件 + Host 服务"架构在 wire 上的自然边界。

## What went well

- vscode API seam 让全部控制器逻辑用假 API 测透；真实对象无需断言即可装配（typecheck 把关 seam 形状）。
- live-vscode 用"agent 真建文件 → 快照差分"验证了 M4 最核心的端到端路径。
- 环境故障定位到了根因（ harness 杀进程留下的孤儿进程累积），不是产品缺陷。

## What didn't go well

- seam 形状第一版就错（`postMessage` 放错对象）——又没先查 `.d.ts`（M1 的教训第三次以不同形式复发：这次是 `@types/vscode` 没读）。
- **live 测试 `void` 桥接竞态第三次出现**（M3 飞书后立了规矩，M4 又踩）：`panel.deliver()` 经 `void handle()` 不等完成。已用公开 `handleWebviewMessage` + 直接 await 根治，测试侧再无可犯结构。
- `@types/diff@8` 是空壳（diff 8+ 自带类型），装错一个包。
- 我的测试 harness（Start-Process 杀 npx 包装层）多次留下孤儿进程，拖垮机器导致一次子进程原生崩溃（0xC0000409）被误判为产品缺陷，排查成本高。

## What to try differently（后续）

- 跑长测试用 Start-Process + 文件重定向 + 足够窗口；超时先杀进程树（`taskkill /T`）再杀表层，或干脆不杀、等自然结束。
- 接任何第三方 API 前先通读其 `.d.ts`/README 的导出面。

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | seam 形状错误：`postMessage` 定义在 panel 而非 webview | 已修复：移至 `WebviewLike`；typecheck 回归通过 |
| 2 | `@types/diff@8` 空壳 | 已修复：`diff@8` 自带类型，删空壳包 |
| 3 | FakePanel `get webview()` 每次返回新对象，html/监听全丢 | 已修复：webviewHandle 单例 |
| 4 | controller 测试经 `void` 桥接竞态 | 已修复：`handleWebviewMessage` 公开，测试直接 await |
| 5 | **生产缺陷**：`open()` 订阅时运行时未启动（activate 不 start 必炸） | 已修复：`AgentRuntime.start()` + `open()` 懒启动 |
| 6 | `deactivate` 未释放 controller（订阅/面板泄漏） | 已修复：模块级 controller + `dispose()` |
| 7 | webview 入站消息曾用 `as unknown as` | 已修复：`parseWebviewMessage` wire 边界校验 |
| 8 | 环境性：dsh 启动从 2s 退化到 35s、子进程原生崩溃 | 根因为孤儿进程累积；已清理。产品侧改进：`runtime.initializeTimeoutMs` 配置化（默认 10s，仓库配置与 live 测试用 60s） |

## 已知限制（最终状态）

- 真实 VS Code 宿主联调未做（无头环境），待用户首跑 `npm run build:vscode`。
- 无 approval 交互：wire 不支持 server→client 请求，权限须在启动配置预置（README）。
- 工作区快照是全量文本快照（有 `maxFiles`/`maxFileBytes` 上限），巨型仓库的 turn 边界开销待优化（M5 候选：增量/监听式）。
- 子进程在 Windows 上经 SDK 阶梯关闭后，句柄短暂残留（父进程自然退出无碍；测试 runner 会等待，属上游 client 行为）。
