# fold-skill-into-mindmap — 代码检视

> 检视日期：2026-09-16 ｜ 检视范围：将 clear-mind 技能退役、最佳实践折叠进 mind_map 工具的 description + 返回  
> 参照基线：dsh 平台（`/usr/lib/node_modules/@deepseek-ai/dsh/` 下 dsh-tools 的 defineTool、dsh-skill 的 ctx.skills.register）  
> 验证命令：`npm run check`（tsc clean）/ `npm test`（44/44 pass）/ `npm run build`（dist + client bundle 正常）——均通过

---

## 总体评价

**架构合理，实施干净，准入。** 技能退役 → 折叠进工具本身的核心思路正确：技能内容（何时清、怎么清）只在清空那一刻需要，把它从「技能目录条目 + 按需读取」变成「mind_map description 常驻信号 + 返回内附 playbook」，既省了一轮 skill 读取的工具调用，又让指引恰好在需要时出现、随 map 一起自动折叠回收。移除 `ctx.skills.register`、`inject["skills"]`、`type {} from "dsh-skill"` 和 `skill.ts` 的手术干净彻底——`grep ctx.skills src/` 零命中，tsc 无残留类型引用，重建后 dist 中无 `skill.js`。

发现 **0 个阻塞问题**，3 个建议，3 个非阻塞观察。

---

## 阻塞问题

无。

---

## 建议问题（非阻塞，推荐修复）

### B1 · `collapse.ts:17` 残留「the skill teaches」引用

**文件**：`src/collapse.ts` 第 17 行

**现状**：注释原文 `Mixed batches (clear_mind/mind_map alongside other tools) are skipped: the sibling results may never have been seen yet, and the skill teaches solo calls.`

技能已退役，「the skill teaches solo calls」指向了一个不再存在的技能。读者会去 `src/skill.ts` 找来源，但该文件已删除。

**建议**：改为 `...and the mind_map playbook teaches solo calls.` 或 `...and the clear-mind playbook (in the mind_map result) teaches solo calls.`

**影响**：仅注释，零运行时风险，但违反「移除彻底」的承诺。

### B2 · 被拒绝调用的补救指引被丢弃

**文件**：`src/render.ts` playbook 段（对比 `clear-mind-skill.backup.md` 第 49 行 e 项）

**现状**：原技能有一段 error-recovery 指引：

> 调用被拒绝（校验不过）时，失败调用的 notes 会留在参数里——重试成功后用一次区间覆盖它的清理把它一并收掉。

playbook 中只保留了「若已混用，下次 clear_mind 把残留区间一起清掉即可补救」，但丢弃了「调用被拒绝后 notes 残留在参数」的补救路径。这是 clear_mind 独有的一个非平凡边界（校验失败后失败调用的 toolCall+result 留在表面，不折叠），模型若遇到此场景可能不知道怎么收尾。

**建议**：在 playbook 的「调用」行末尾补一句，例如：

> 调用被拒绝（校验不过）时，失败调用的 notes 残留在参数里——重试成功后用一次区间覆盖它的清理一并收掉。

**影响**：边界场景指引缺失，模型可能需要额外试错才能自悟。非阻塞——失败调用最终也会被后续 clear_mind 或自动折叠清理。

### B3 · 缺少「playbook 不出现」的负向测试

**文件**：`test/scan.test.ts`

**现状**：新增了 3 条 playbook 存在性断言（`/clear-mind playbook/`、`/已放弃的路径/`、`/clear_mind 单独一条消息/`），但只验证了 `latestEndSeq !== undefined` 的正向路径。没有测试验证 `latestEndSeq === undefined`（无可清理终点）时 playbook **不**出现——这是门控逻辑的正确性边界。

**建议**：补一个最小测试（例如空 session 或仅有 pre-turn 节点的 session），断言 `renderSurvey` 输出含 `No clearable boundary` 且**不含** `clear-mind playbook`。

**影响**：门控逻辑当前正确（代码已 review），但缺少回归保护。如果未来有人误改门控条件，不会被测试捕获。

---

## 非阻塞观察

### O1 · description 中英混排的信号取舍

**文件**：`src/tools.ts` 第 37 行（mind_map description）

**观察**：description 结构为「英文机械描述 → 中文信号①–⑥+不宜 → 英文机械描述收尾」。中英切换在同一字符串内发生两次。信号列表本身是指导性内容（非机械规格），嵌入 tool description 打破了 DSH 平台 tool description 以简洁机械描述为主的惯例。

**评估**：这是用户明确接受的取舍（见 summary.md「取舍」段）。+~120 tok/turn 的常驻成本换来每次清空省一轮 skill 读取（一个完整的 LLM round-trip），在频繁清空的会话中净收益为正。信号常驻也有额外好处——模型不需要等到 reminder 触发就能主动判断何时清，比原来的被动提醒更积极。语言选择合理（技能原文中文、用户环境中文优先）。

**不构成问题**，仅记录设计决策。

### O2 · playbook 内 `##` 标题作为纯文本行的可读性

**文件**：`src/render.ts` 第 103–107 行

**观察**：notes 模板用 `  ## 任务与用户意图...` 等 5 行，`##` 是 markdown 语法但渲染为纯文本行（tool result 是 text block，非 markdown）。模型会看到带 `##` 前缀的缩进行，应能识别为结构化模板。

**评估**：模型将 `##` 理解为 section header 约定是可靠的（训练数据中大量存在）。如果模型将 `##` 带入实际 notes，checkpoint 作为 user-role message 会被 GUI 渲染为 markdown 标题——这反而是期望行为（结构化检查点更易读）。无问题。

### O3 · `@deepseek-ai/dsh-skill` 保留为未用 devDependency

**文件**：`package.json` 第 59 行

**观察**：`dsh-skill` 不再被任何 `src/` 文件引用（import、type-only import 均已移除），但仍保留在 `devDependencies`。summary.md 记录原因：移除需 `npm install`，会触发 link-package 坑（包内 node_modules 全量重建）。

**评估**：保留为未用 devDep 零运行时风险——它不在 `dependencies` 中，不会进入生产安装路径；devDep 只在本地 `npm install` 时安装。在 link-package 模式下它已被安装且 node_modules 存在，tsc 能找到类型声明（虽然不再 import）。策略合理。后续可在任何 `npm install` 操作中顺带移除。

---

## 逐文件检视

| 文件 | 变更 | 检视结论 |
|------|------|----------|
| `src/tools.ts` | mind_map description 增信号①–⑥+不宜+返回内附 playbook；clear_mind description 删 skill 指引改指 mind_map；notes 参数描述改指 mind_map result | ✅ 信号内容与原技能 whenToUse/什么时候用段逐条对应；clear_mind→mind_map 指引链自洽（见下方关注点回应#6）；notes 描述指向明确 |
| `src/render.ts` | `renderSurvey` 末尾追加 playbook（8 行中文，含选区间/notes 模板/自检/调用规则/安全声明/清后重述/指令性文字防护） | ✅ 门控正确（`latestEndSeq !== undefined`）；playbook 随 survey 文本一起经 mind_map 工具结果返回，随调用自动折叠；内容覆盖原技能核心要点（见 B2 有一处丢弃）；引号用「」避免转义 |
| `src/reminder.ts` | 提醒文案删「根据 clear-mind 技能」、改为「mind_map 返回内附 clear-mind 操作指引」 | ✅ 改后文案与新的指引位置一致；提醒→mind_map→playbook 链路完整 |
| `src/index.ts` | 移除 `ctx.skills.register`、`CLEAR_MIND_SKILL` import、`type {} from "dsh-skill"`、`inject` 中 `"skills"`；更新头注释与启动日志 | ✅ `grep ctx.skills src/` 零命中；`inject` 数组与实际使用的 ctx 服务一致（tools/tokenMeter/agents/llm）；头注释与启动日志准确反映新架构 |
| `src/skill.ts` | 删除（73 行） | ✅ 重建后 dist 中无 `skill.js`；tsconfig 用 glob `src/**/*.ts` 不需改 |
| `package.json` | description 字段同步；dsh-skill devDep 保留 | ✅ 见 O3 |
| `AGENTS.md` | 职责/地图段同步（移除 skill.ts 行、注明 playbook 落在 tools/render、index 无技能注册） | ✅ 与代码现状一致 |
| `test/scan.test.ts` | renderSurvey 测试追加 3 条 playbook 关键行断言 | ✅ 断言命中正确；缺负向测试（见 B3） |

---

## 关注点回应

### #1 · description 常驻每请求的 token 成本与信号取舍是否合理

**合理。** 信号列表 +~120 tok/turn 常驻，换来每次清空省一轮 skill 读取（一个 LLM round-trip，成本远高于 120 tok）。信号常驻还有额外收益——模型无需等 reminder 触发即可主动判断清空时机，比被动提醒更积极。用户已明确接受此取舍（summary.md「取舍」段）。唯一代价是 tool description 从纯机械描述变为机械+指导混排，但这不违反任何平台契约。

### #2 · playback 仅在可清理时出现的门控是否正确

**正确。** `renderSurvey` 在 `survey.latestEndSeq !== undefined` 时追加 playbook；`latestEndSeq` 在 `scanSurface` 中从尾向前找第一个 `validEnd === true` 的节点 seq。当无任何节点可作清理终点时（空会话、仅 pre-turn 节点、所有节点 validEnd=false），`latestEndSeq` 为 `undefined`，playbook 不出现。门控逻辑正确。缺负向测试保护（B3）。

### #3 · 移除 ctx.skills/inject["skills"]/type-only dsh-skill import 是否彻底且无残留引用

**基本彻底，一处注释残留。**
- `ctx.skills`：src/ 零命中 ✓
- `inject["skills"]`：已移除，inject 数组与实际使用一致 ✓
- `type {} from "dsh-skill"`：已移除，tsc 通过 ✓
- `CLEAR_MIND_SKILL` import：已移除 ✓
- `skill.ts`：已删除，dist 重建后无残留 ✓
- **残留**：`collapse.ts:17` 注释 `the skill teaches solo calls` 指向已删除的技能（B1）
- `dsh-skill` devDep：保留为未用，有文档记录，零运行时风险（O3）

### #4 · 中文 playbook 与英文机械描述混排、及 playbook 内 markdown ## 标题对模型可读性的影响

**无实质影响。** 中英混排在 description 中是设计决策（机械描述英文保持一致、指导内容中文保留原技能语言），模型双语处理无碍。playbook 内 `##` 标题作为纯文本行，模型会识别为结构化模板约定；若带入实际 notes，checkpoint 作为 user-role message 被 GUI 渲染为 markdown 标题是期望行为。详见 O1、O2。

### #5 · 是否有遗漏的技能引用

- `src/collapse.ts:17`：`the skill teaches solo calls` — 残留（B1）
- `src/commit.ts`：无引用 ✓
- `src/scan.ts`：无引用 ✓
- `src/config.ts`：无引用 ✓
- `src/route.ts`：无引用 ✓
- `dist/` 产物：重建后无 `skill.js`，无 `CLEAR_MIND_SKILL` 残留 ✓
- `docs/` 历史文档：旧 feature 文档中的 skill 引用是历史记录，不需改 ✓
- `test/`：无 skill 引用 ✓

### #6 · clear_mind description 删除 skill 指向后模型是否仍能自洽完成清空流程

**能。** 完整流程自洽：
1. mind_map description 含信号①–⑥（何时清）+ 「返回内附 playbook」提示 → 模型知道何时调、调了能得指引
2. mind_map 返回 survey + playbook（选区间/notes 模板/自检/调用规则）→ 模型按模板写 notes、按规则单独调用
3. clear_mind description 指向 mind_map 获取 playbook；notes 参数描述指向 mind_map result 获取模板 → 指引链闭合
4. reminder 文案指向 mind_map 返回内附指引 → 被动提醒也能找到指引

唯一指引缺失：被拒绝调用的 notes 残留补救路径（B2），属边界场景，不影响主流清空流程的自洽性。

---

## 准入结论

**准入（可合并）。** 核心手术干净、测试通过、指引链自洽。建议在合并前或合并后顺手处理 B1（注释修正，1 行）和 B3（补负向测试，~5 行），B2（补 error-recovery 指引）可排期处理但不阻塞。
