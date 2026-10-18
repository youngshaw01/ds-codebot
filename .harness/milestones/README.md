# milestones/ — 逐刀执行协议

本目录管理 [DESIGN.md §6](../DESIGN.md) 里程碑的执行：一刀一刀做，每刀完成后先评审复盘、修复缺陷，再开下一刀。

## SMARTER 验收标准

每刀的验收标准来自 DESIGN.md §6，必须可度量（Measurable）。一刀未达验收标准不得进入下一刀；标准本身如被证明不合理，先在复盘记录中修正标准再继续（Revised）。

## 执行流程（每刀固定四步）

1. **开工**：按 DESIGN.md 该刀的模块清单实现，代码进 `src/`，测试随代码同提交。
2. **验证**：typecheck + 全部测试通过（e2e 无 `DEEPSEEK_API_KEY` 时 skip 不算失败）；对照验收标准逐条核对。
3. **复盘**：在本目录写 `M<n>-review.md`，格式固定：
   - 验收标准逐条结论（通过/未通过 + 证据）
   - What went well / What didn't go well / What to try differently（下刀改进项）
   - 缺陷清单（含修复状态）
4. **修复**：复盘发现的缺陷在开下一刀前修复完成并回归验证；无法当场修复的记为已知限制，写入 DESIGN.md 对应章节。

## 跟踪表

| 里程碑 | 验收标准（摘要） | 状态 | 复盘 |
|---|---|---|---|
| M1 driver | CLI 连续对话 3 轮；Ctrl-C 安全 teardown；e2e 无 key skip | 已完成（复盘见 [M1-review.md](M1-review.md)，含 1 条已知限制） | [M1-review.md](M1-review.md) |
| M2 TUI | tool_call 可见；`/cwd` 后续聊连续；turn 指示 | 未开始 | — |
| M3 飞书 | 群内 @bot 完成任务；同群上下文连续 | 未开始 | — |
| M4 VSCode | 工作区会话绑定；diff 展示 | 未开始 | — |

## 防陷阱（来自 goal pitfalls）

- 一次只打一刀（最多一个 in-progress），禁止多刀并行。
- 验收标准不许做到一半才后补；先写测试再写实现。
- 每刀结束公开进度（本目录的复盘记录即公开承诺），未完成不静默跳过。
