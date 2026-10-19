# change-units — 变更单元执行规则（项目对 Layer 0 工作流的裁剪）

本规则是 ai-engineering-standards（Harness Contract v3）变更单元工作流的**项目特化执行层**：契约定义形状（proposal/tasks/verify/archive），本规则定义 ds-codebot 的执行纪律。历史执行轨迹见 `.harness/workspace/archive/`（M1–M6 retro）。

## 逐刀协议

ds-codebot 的能力建设按"刀"推进（一刀 = 一个 change 单元）：一刀一刀做，每刀完成后先评审复盘、修复缺陷，再开下一刀。

## SMARTER 验收标准

每刀的验收标准必须可度量（Measurable），写在 change 的 proposal 并用 `AC-<n>` 编号。一刀未达验收标准不得进入下一刀；标准本身如被证明不合理，先在 retro 中修正标准再继续（Revised）。

## 执行流程（每刀固定四步）

1. **开工**：按该刀的模块清单实现，代码进 `src/`，测试随代码同提交。
2. **验证**：typecheck + 全部测试通过（e2e 无 `DEEPSEEK_API_KEY` 时 skip 不算失败）；对照验收标准逐条核对。
3. **复盘**：归档时写 `retro.md`，格式固定：
   - 验收标准逐条结论（通过/未通过 + 证据）
   - What went well / What didn't go well / What to try differently（下刀改进项）
   - 缺陷清单（含修复状态）
4. **修复**：复盘发现的缺陷在开下一刀前修复完成并回归验证；无法当场修复的记为已知限制，写入 `docs/knowledge/architecture.md` 对应章节。

## 历史刀次（M1–M6，均已归档）

| 刀次 | 验收标准（摘要） | retro |
|---|---|---|
| M1 driver | CLI 连续对话 3 轮；Ctrl-C 安全 teardown；e2e 无 key skip | `archive/20261018-feature-m1-driver-001/retro.md` |
| M2 TUI | tool_call 可见；`/cwd` 后续聊连续；turn 指示 | `archive/20261018-feature-m2-tui-001/retro.md` |
| M3 飞书 bot | 群内 @bot 完成任务；同群上下文连续 | `archive/20261018-feature-m3-feishu-bot-001/retro.md` |
| M4 VS Code 扩展 | 工作区会话绑定；diff 展示 | `archive/20261019-feature-m4-vscode-extension-001/retro.md` |
| M5 增量快照 | 无变化轮次零新增读取；变更检测不回退 | `archive/20261019-feature-m5-incremental-snapshot-001/retro.md` |
| M6 快照增强 | 持久化 / 内容哈希 / 文件监听 | `archive/20261019-feature-m6-snapshot-enhancements-001/retro.md` |

## 防陷阱

- 一次只打一刀（最多一个进行中 change），禁止多刀并行。
- 验收标准不许做到一半才后补；先写测试再写实现。
- 每刀结束公开进度（retro 即公开承诺），未完成不静默跳过。
- 涉及真实运行时的测试必须等待被测路径完成——禁止 `void` 桥接后立即断言（此错误在 M3/M4 各犯过一次）。

## 变更记录

| 日期 | 来源 change-id | 摘要 |
| --- | --- | --- |
| 2026-10-18 | bootstrap | 逐刀协议建立（.harness/milestones/ 原名） |
| 2026-10-19 | docs-harness-contract-adoption-001 | 迁移至 docs/rules/change-units.md 并挂接 Layer 0 工作流 |
