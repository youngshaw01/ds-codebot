# M5 复盘 — 增量工作区快照

日期：2026-10-19

## 背景

M4 复盘记录的已知限制：turn 边界对工作区做**全量文本快照**，巨型仓库每轮重读全部内容。M5 将快照改为增量。

## 实现

`src/core/snapshot.ts` 新增 `IncrementalWorkspace`：

- 每 folder 一份 stat 索引 + 内容基线（`IncrementalWorkspace` 实例），controller 持有到 dispose。
- `capture()` 只做一次 stat 遍历，**仅读取 (size, mtimeMs) 与基线不符的文件**；未变更文件直接复用基线内容；消失文件移出基线。
- 分类逻辑（ignoreDirs / maxFileBytes / 二进制 / unreadable）与一次性 `snapshotWorkspace` 完全一致——超大文件仍不读内容。
- 成本从 O(工作区内容) 降为 O(变更文件数)；代价是基线常驻内存（受 maxFiles × maxFileBytes 约束），为长生命周期宿主设计。

**边界（记录在案的取舍）**：以 (size, mtimeMs) 判定变更。文件系统 mtime 粒度粗（NTFS 常见 100ns，但部分系统 1–2s）时，同粒度内等大小改写可能漏检。生产级演进方向是内容哈希，本次不做。

## 验收

| 标准 | 结论 | 证据 |
|---|---|---|
| 无变化的轮次零新增读取 | **通过** | 单测：二次 capture 后 `readCount` 不变；多轮场景再 capture 无新增读取 |
| stat 伪装不变时复用基线 | **通过** | 单测：等长改写 + mtime 整秒还原 → 不触发读取、内容保持基线旧值（m 秒粒度精确还原） |
| 变更/新增/删除检测 | **通过** | 单测覆盖三种 kind 与 diff 列表正确性 |
|  ignoreDirs/maxFileBytes 语义不回退 | **通过** | 单测：node_modules 跳过、超大文件进 skipped 且不读内容 |
| 与 M4 行为兼容 | **通过** | live-vscode 带 key 复跑：agent 建 proof.txt → turn-diff 正确上报（19.5s，真实运行时） |
| （执行标准）typecheck + 全量 | **通过** | `tsc --noEmit` 0 错误；59/59 非 live 测试通过 |

## 补联调状态

- **VS Code 真实宿主**：本机未安装 VS Code（`code` CLI 不存在），无法执行。README 已载明步骤（`npm run build:vscode` + `code --extensionDevelopmentPath=dist-vscode`）；esbuild 打包已验证可用。**待用户在有 VS Code 的机器上首跑。**
- **飞书真实租户**：无应用凭据（`FEISHU_APP_ID/SECRET`）。已在无凭据下做到最深验证：`parseMessageEvent` 按 SDK 官方事件类型（`@larksuiteoapi/node-sdk` types 中 `im.message.receive_v1` 的完整字段集，含 sender/mentions/可选字段）构造真实形状测试通过；bot 全链路经真实 dsh 运行时 + 假网关 live 验证（含上下文连续性）。**待用户提供飞书自建应用凭据后做长连接联调。**
- DeepSeek key 来自用户（本轮复用），联调全部真实 API 通过。

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | 接 `AgentRuntime.start()` 后 feishu 测试替身未同步实现 | 已修复：补 `start()`；typecheck 回归通过 |
| 2 | extension.ts 命令回调里 `controller` 空值收窄 | 已修复：回调内显式判空 |
| 3 | mtime 还原测试初版用浮点毫秒还原，NTFS 精度下偶发不匹配 | 已修复：测试先把 mtime 规范到整秒再还原，确定性成立 |

## 后续候选

- 快照持久化到磁盘（跨重启增量）——当前为进程内基线，长驻进程已覆盖主要场景。
- (size, mtimeMs) → 内容哈希，消除粗粒度 mtime 漏检窗口。
- VS Code 工作区文件监听（`createFileSystemWatcher`）替代 stat 轮询。
