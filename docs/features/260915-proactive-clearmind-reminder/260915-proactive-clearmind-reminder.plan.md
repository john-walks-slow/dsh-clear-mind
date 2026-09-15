# dsh-clear-mind：主动清理提醒与可视化设置页面

日期：2026-09-15 ｜ 状态：已实施（check 通过 / 37 项测试全绿 / 构建产物验证）

## 1. 背景与目标

`dsh-clear-mind` 当前提供了 `mind_map`、`clear_mind` 工具及 `clear-mind` 技能，由模型自主感知并发起上下文压缩。本次交付包含两项核心增强：

1. **系统主动提醒机制 (Proactive Reminder)**：
   在上下文长度超过设定阈值（绝对 Token 数量或模型最大 ContextWindow 百分比）或同一轮内连续 Step 超过设定步数时，在 `agent/pre-step` 阶段自动注入带 `<system-reminder>` 的提醒，警示模型关注上下文负荷并引导其主动整理。
2. **可视化设置页面与全量配置提取 (Settings Page & Config Extraction)**：
   将已有与新引入的配置项全面提取至 DSH 统一配置体系，并通过 Web 客户端在 DSH 设置中注册独立设置页面（`settings.section`），让用户可在图形界面中查看、修改并实时保存生效。

## 2. 配置项体系清单 (`src/config.ts`)

| 分组 | 配置项 Key | 类型 | 默认值 | 范围/约束 | 中文说明 |
|---|---|---|---|---|---|
| **主动提醒** | `reminderEnabled` | `boolean` | `true` | true/false | 主动提醒总开关 |
| | `reminderThresholdRatio` | `number` | `0.70` | 0.01 ~ 1.0 | 上下文占模型窗口比例阈值（默认 70%） |
| | `reminderThresholdTokens` | `number` | `0` | 整数 ≥ 0 | 上下文绝对 Token 阈值（0 表示不限，仅按比例） |
| | `reminderThresholdSteps` | `number` | `15` | 整数 ≥ 1 | 单轮连续 Step 步数阈值 |
| | `reminderStepInterval` | `number` | `5` | 整数 ≥ 1 | 同一轮提醒冷却间隔步数 |
| **压缩护栏** | `minClearTokens` | `number` | `1000` | 整数 ≥ 1 | 最小清理 Token 数（低于此数值判定不值得清理） |
| | `minNotesChars` | `number` | `200` | 整数 ≥ 1 | 检查点笔记最小字数 |
| | `maxNotesChars` | `number` | `16000` | 整数 > minNotesChars | 检查点笔记最大字数 |
| **行为特性** | `selfCollapse` | `boolean` | `true` | true/false | 自动折叠已提交的 clear_mind 调用与结果为单行墓碑 |

`resolveConfig` 签名：`raw: Partial<ClearMindConfig> | Record<string, unknown>`（联合类型——`ClearMindConfig` 无索引签名，不能直接赋给 `Record<string, unknown>`）。

## 3. 设置页面实现 (`src/client/`)

### 3.1 Web 客户端集成架构
1. **入口注册**：客户端注册 `settings.section`（id: `"clear-mind"`，order: `125`，label: `"Clear Mind"`），在 DSH 设置弹窗左侧导航拥有独立标签页。客户端 `inject = ["slots", "settingsScope"]`。
2. **状态与持久化绑定**：`inject` 面返回 `{ scope: ctx.settingsScope.bind<ClearMindSettings>({ namespace: "clear-mind" }) }`；面板通过 `scope.getSnapshot()` / `scope.set` / `scope.unset` 读写，保存即提交宿主持久化并热应用，无需重启。
3. **UI 模块划分**（`settings-panel.tsx`，JSX + `dcm-*` CSS 类，样式经 `styles.ts` 注入）：
   - 头部简介；
   - 主动提醒区：总开关（Toggle）+ 占比阈值 / 绝对 Token 阈值 / 单轮步数阈值 / 冷却步数（Number Input）；
   - 压缩护栏区：最小清理 Token / 笔记最小字数 / 笔记最大字数；
   - 运行时行为区：自折叠开关；
   - 操作栏：保存更改 / 恢复默认设置 / 保存反馈（已保存 / 校验错误 / 保存失败）。
   - 单字段「重置」：仅对已覆盖（override）字段显示，重置为 base 层默认。

### 3.2 类型要点
- `SettingsPanel` props = `{ close?: () => void; scope: ClearMindScope }`（`close` 由 shell 提供、面板未强制使用）；
- `register(entry, component)` 泛型：component 类型 = `SettingsSectionOwnerProps & ReturnType<NonNullable<T["inject"]>>`；
- `bind<ClearMindSettings>` 必须显式泛型，否则 scope 推断为 `SettingsScope<unknown>` 与面板类型不符。

## 4. 主动提醒引擎实现 (`src/reminder.ts`)

### 4.1 判定机制
1. **状态跟踪**：`WeakMap<Agent, AgentReminderState>`（lastRemindedTurn/Step/Tokens），生命周期随 Agent。
2. **触发条件（OR）**：
   - 条件 A：step ≥ `reminderThresholdSteps`；
   - 条件 B：`reminderThresholdTokens > 0` 且 totalTokens ≥ 阈值；
   - 条件 C：contextWindow 可解析时 totalTokens / contextWindow ≥ `reminderThresholdRatio`。
3. **冷却抑制**：同 turn 内 step 差 < `reminderStepInterval` 或 totalTokens 未增长 → 不触发（稳态会话永不刷屏）。
4. **静默路径**：`reminderEnabled:false`、`signal.aborted`、route 不可得（`session.requestHeader()?.config` → `agent.options` 兜底）、contextWindow 解析失败（静默降级为 undefined）均返回 null。
5. **消息注入**：`agent/pre-step` 中先 `await next()`，对 `kind==="enter"` 的 registered root agent 追加 `buildReminderMessage(trigger)` 到 `decision.messages`（返回 `{...decision, messages:[...]}`，不改变决策本体）；异常仅 `logger.warn`，不影响主流程。

### 4.2 提醒消息文案
```markdown
<system-reminder>
[Context / Step Alert] 当前会话已达到主动清理检查点：
- 原因：{triggerReasons}
- 建议：长上下文或单轮过多 Step 容易累积过时试错过程与冗余工具输出，分散注意力并增加推理成本。
- 行动指引：建议根据 clear-mind 技能，先调用 mind_map 审视当前上下文表面，将已完成阶段/已确认放弃的探索通过 clear_mind 提炼为移交检查点，仅保留核心目标、约束与下一步。若当前处于原子操作中间，可在完成该动作后立刻清理。
</system-reminder>
```

## 5. 宿主端生命周期与热更新集成 (`src/index.ts`)

1. **Inject**：`["tools", "tokenMeter", "skills", "agents", "llm"]`（`llm` 用于 `ctx.llm.resolveModelInfo` 解析 contextWindow）。
2. **设置 Namespace 注册**：`ctx.get("settings", false)` 可选获取（headless 无 settings 服务时降级为 info 日志，不阻塞插件加载）。可注册时：`settings.register("clear-mind", Config, { base: resolved })`，`scope.watch(next => Object.assign(resolved, resolveConfig(next)))` 热更新运行态配置——`base` 传同一 `resolved` 对象引用，工具端持有的 config 随动，无需重启。
3. **Pre-Step 调度**：Self-collapse（`next()` 前）→ `await next()` → 对 enter 决策执行 `evaluateReminder` 并注入提醒消息。

## 6. 构建与打包 (`scripts/build-client.mjs`, `package.json`)

1. esbuild 打包 `src/client/index.ts` → `lib/client.js`（window.__ModuleLoader__.load lazy-CJS 格式；external: react / react-dom/* / react/jsx-runtime / @deepseek-ai/*）。客户端源码仅 type-only 引用 `@deepseek-ai/*`，bundle 运行时只需 react。
2. `package.json`：exports 增加 `"./client": "./lib/client.js"`；files 增加 `lib/client.js`；`build = "rm -rf dist lib/client.js && tsc -p tsconfig.build.json && node scripts/build-client.mjs"`（先清 dist 防止 npm test 全量编译残留的 `dist/src/client` 误入发布包）。
3. `tsconfig.json`：lib 增加 `"DOM"`（客户端 document）、`jsx: "react-jsx"`、include 增加 tsx；`tsconfig.build.json` exclude `src/client`。
4. `dsh.client.inject` 仅列 `@deepseek-ai/dsh-client-ui-settings`（`dsh-client-runtime` 不在 npm registry，无需也不能列为 devDep）。

## 7. 测试与验证状态

1. **`test/reminder.test.ts`**（13 项，minimal fakes 直接测试 evaluateReminder / buildReminderMessage）：
   - step 超阈值触发、低于全部阈值静默、冷却内节流、冷却后 tokens 增长再触发、稳态（tokens 未增长）保持静默、新 turn 重置冷却；
   - token 绝对阈值、比例阈值（含 70% 原因文案）、`reminderEnabled:false` 静默、route 不可得静默、aborted signal 静默、contextWindow 解析失败降级；
   - buildReminderMessage 含 `<system-reminder>` 闭标签与 source.kind = plugin。
2. **回归**：全部现有测试通过（scan / commit / collapse 全量）。
3. **验证命令**：`npm run check`（tsc --noEmit 全绿）→ `npm test`（37/37 pass）→ `npm run build`（dist/src 9 文件 + lib/client.js 19.2KB，dist 无 client 残留）。

## 8. 待用户验证

1. DSH Web 设置中「Clear Mind」页面出现，字段显示并保存生效（需重启 dsh 使新 client bundle 生效）。
2. 长会话中提醒按阈值触发、冷却生效、不刷屏；关闭开关后静默。