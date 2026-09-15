# 检视报告

## 概要

检视范围：dsh-clear-mind 插件「主动清理提醒 + 可视化设置页面」需求的全部新增/修改文件（config.ts、reminder.ts、index.ts、client/*、scripts/build-client.mjs、test/reminder.test.ts、package.json、tsconfig 等）。整体评价：实现质量高，架构清晰，平台 API 使用正确，插件四铁律无违反，测试覆盖全面。发现 0 个阻塞问题、3 个建议修改项和 6 个非阻塞问题。

## 需求对齐

需求两项：(1) 上下文超阈值或单轮 step 过多时自动提醒主动 clear mind；(2) 新增设置页面提取全部配置项。

- 提醒机制完整实现：step 阈值 / 绝对 token 阈值 / 比例阈值三条 OR 触发 + 冷却抑制 + 新 turn 重置，符合需求。
- 设置页面覆盖全部 9 个配置项（提醒 5 + 压缩护栏 3 + 行为 1），支持逐字段保存、重置、恢复默认，符合需求。
- 提醒消息通过 `agent/pre-step` 的 enter 决策注入 user/message（source.kind=plugin, form=notice），不触碰 compaction 事务，符合平台契约。
- 设置热更新通过 `scope.watch` → `Object.assign(resolved, ...)` 原地修改，工具端持有同一引用随动，模式正确。
- 客户端 bundle 构建格式 `window.__ModuleLoader__.load`、external 列表、tsconfig 分离均与平台约定一致。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S-1 | `src/index.ts:93-96` | `scope.watch` 回调内 `resolveConfig(next)` 可因跨字段校验失败而 throw。平台文档（dsh-settings `watch`）声明回调 reject/throw 会被 contain+log，不会崩溃，但 `Object.assign` 不执行 → `resolved` 保持旧值，运行态配置与 UI 显示产生静默脱节。用户可通过面板设置 `minNotesChars=20000`（schemastery 单字段校验通过）同时 `maxNotesChars` 保持默认 16000，保存后 UI 显示成功但运行态未更新，无任何用户侧反馈。 | 1) 在 watch 回调内包 try/catch，catch 中 warn 并保留 `resolved` 不变；2) 在设置面板 `handleSave` 前增加跨字段校验（`minNotesChars < maxNotesChars`），不满足时禁用保存并显示错误提示。 |
| S-2 | `src/client/settings-panel.tsx:115-123, 243-253` | 单字段「重置」按钮仅将 draft 设为 base 值（`onDraft(formatValue(...))`），不调用 `scope.unset(field.key)`。override 仍留在 settings 持久层，用户看到 draft 已变回 base 但「已覆盖」badge 仍在，点保存后无变化（draft===base 不 dirty），override 永不清除。与底部「恢复默认设置」按钮（正确调用 `scope.unset`）行为不一致，语义混淆。 | 单字段「重置」改为直接调用 `scope.unset(field.key)`（async），完成后清除该字段 draft 并刷新 snapshot。或改为两步操作：先 unset override 再预览 base 值。 |
| S-3 | `src/tools.ts:20-29` 与 `src/reminder.ts:48-57` | `routeOf` 函数在两个文件中重复实现（`session.requestHeader()?.config → agent.options` 兜底）。仅差异：tools.ts throw on failure，reminder.ts return undefined。重复逻辑在 route 解析方式变更时需同步修改两处，维护风险。 | 抽取共享函数 `tryRouteOf(agent): { provider; model } \| undefined` 到独立模块（如 `route.ts` 或放入 `scan.ts`），tools.ts 调用后 throw on undefined，reminder.ts 直接使用返回值。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N-1 | `src/client/styles.ts:13` | `.dcm-field:first-of-type { border-top: none; }` 选择器不生效。`:first-of-type` 匹配同级同标签的第一个元素，而 `.dcm-section-title`（也是 div）在 `.dcm-field` 之前，故首个 `.dcm-field` 永非 first-of-type。首个 field 与 section title 之间出现冗余 border-top 双线。 | 改用 `.dcm-section-title + .dcm-field { border-top: none; }`。 |
| N-2 | `src/reminder.ts:30-34`, `src/index.ts:57` | `AgentReminderState` 接口未从 reminder.ts 导出；index.ts 用内联结构类型 `{ lastRemindedTurn: number; ... }` 创建 WeakMap。若 `AgentReminderState` 字段变更，index.ts 内联类型不会同步，静默漂移。 | 导出 `AgentReminderState`，index.ts 用 `WeakMap<Agent, AgentReminderState>`。 |
| N-3 | `src/client/settings-panel.tsx:37, 46-49, 56-58` | `FieldDef.step` 字段声明并赋值但 `parseDraft` 从不读取它，属死元数据。input 元素用 `type="text"` 也不消费 `step` 属性。 | 要么在 `parseDraft` 中使用 `step`（如校验粒度对齐），要么从接口和字段定义中移除。 |
| N-4 | `src/client/settings-panel.tsx:106, 135` | `NumberField` 每次 render 调用 `parseDraft(field, draft)` 两次：第 106 行计算 `invalid`，第 135 行取 error 文本。面板字段少无实际性能影响，但不够整洁。 | 在函数体计算一次 `const { error } = parseDraft(field, draft)`，派生 `invalid = error !== null` 和错误文本。 |
| N-5 | `src/client/settings-panel.tsx:287-293` | 「恢复默认设置」按钮无确认对话框，误触即丢失全部自定义配置。 | 添加 `window.confirm` 或自定义确认弹窗。优先级低——多数设置面板有此行为。 |
| N-6 | `src/client/styles.ts:10, 12, 21, 28, 34` | 多处使用 `border: 0.5px solid ...`。在标准 DPI（1x）显示器上 `0.5px` 可能渲染为 `0px`（不可见）或 `1px`，行为依赖浏览器。2x retina 上正常渲染 1 物理像素。 | 若需跨 DPI 一致发丝级边框，可用 `1px` + `box-shadow` 模拟或 `@media (-webkit-min-device-pixel-ratio: 2)` 条件。非关键视觉问题。 |

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题，实现正确且符合平台契约，可进入下一阶段。3 个建议修改项中 S-1（watch 回调 try/catch + 跨字段校验）影响设置热更新的可靠性，建议在合并前处理；S-2 和 S-3 可在后续迭代中解决。6 个非阻塞问题记录备忘。
