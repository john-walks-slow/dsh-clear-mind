# Review: tool 结果行镜像 UI 未展开行（260917 追加修复）

- 检视范围：工作树未提交改动（`git diff`）：`src/scan.ts`、`src/render.ts`、`test/scan.test.ts` + 2 个 docs 追加。第一轮（d168776，已合并）不在本次范围，但其镜像表被本轮依赖，做了抽查。
- 对照基准：dsh-client-ui-tool `lib/client.js`（行号以下述引用为准）。
- 验证：`npm run check` / `npm test`（45/45）/ `npm run build` 本机复跑全部通过；`lib/client.js` 构建产物无 diff。

## 逐项核对（对照 parent 列出的关注点）

### 1. callHints 与 assistant 行 join 是否严格同源同值 — 是

- `callHint` 是纯函数（解析参数字符串 → 查表 → 字符串变换，无外部状态、无随机、无时间依赖）。
- `display`（cwd + home）在 log walk 前构造一次，log walk 的 `callHints.set` 与 assistant 行的 `calls.map(callHint)` 共用同一对象；`homedir()` 只求值一次。两条路径对同一输入必然产出同一字符串。
- 唯一差异是重复计算（assistant 节点各算一遍），CPU 开销可忽略。**结论：同源同值成立。**

### 2. isError 分支回归 — 语义完全一致

旧代码：`(name ?? "tool") + " ! " + toPreviewLine(textOfBlocks(content))`。新 error 分支逐字符相同（prefix 拼接、toPreviewLine 截断、`isError: true` 字段均不变）。测试 `bash ! cat: missing.txt: No such file or directory` 钉住。**无回归。**

### 3. callHints 对非 surface 事件的计算 — 无副作用，且是必要行为

- `eventAt(seq)` 是 log 数组直查（client 侧 dsh-session/lib/index.js:1331）；session log 是 append-only，prune 是 surface 投影概念、不删 log。因此 log walk 天然看见全部事件（含已被 compaction 剪掉投影的 assistant/message）。
- 对这些事件算 hint 是纯计算，无变异、无顺序依赖（`toolNames` 与 `callHints` 在同一循环体内成对填充）。
- 这恰好匹配 UI 语义：UI 的行 summary 取自结果节点自带的 `block.call?.argsRaw` 引用（client.js:217），不依赖一条独立的 assistant 消息可见——即使调用方已被剪出 surface，结果行仍显示 args 摘要。**结论：正确且必要。**

### 4. 孤儿结果回退分支 — 可达性限于异常日志，行为正确

- 良构日志下 surface 上的 tool-result 的调用事件必然还在 log 里（append-only），两个 map 都能命中；孤儿 = callId 从未在任何 assistant/message 出现（伪造 callId、种子/外来历史等异常）。
- 此时 `toolNames` 也必然 miss（两 map 同键成对填充），回退输出与旧行为一致。**正确。**（测试覆盖缺口见 S1；死条件见 N1。）

### 5. 无参/坏参调用降级为裸名 vs UI 行为 — 合理对应，已文档化

- UI：`argsRaw === ""` → 显示 callId（client.js:218）；`argsRaw` 非对象 JSON（含 `"{}"`）→ `deriveSummary` 末路 `firstLine(argsRaw)`，即显示 `{}` 或原始 JSON 头（client.js:161-175）。
- 地图：一律降级为裸工具名。比 callId/`{}` 信息量更高且更稳定，注释「UI: raw JSON head or callId」如实记录了分歧。mind_map/clear_mind 自身调用下一步即折叠，损失极小。**接受。**

### 6. UI parity 主张逐条对源验证 — 全部成立

| 主张 | UI 源 | 验证 |
| --- | --- | --- |
| 成功行显示 summary（deriveSummary + 路径变换） | client.js:218 `base = …abbreviateHomePath(relativizeToCwd(deriveSummary(…)))` | ✓ |
| error 行以 failureLine 替换 summary | client.js:222 `errorSummary = state==="error" && output!==null ? firstLine(output) : null`；1129-1130 `summaryText = failureLine ?? terminalBody?.description ?? summary` | ✓ |
| 无参显示 callId | client.js:218 | ✓（`"{}"` 时显示 `{}`，见 N4） |
| bash 行显示 description（terminal 卡片优先于 summary） | client.js:1130 `terminalBody?.description ?? summary`；shellCall 的 description 键 = 调用参数 description | ✓（值同源；UI 不做路径变换，注释已记录该分歧） |
| SUMMARY_KEYS / TOOL_VARIANTS / relativizeToCwd / abbreviateHomePath / isWindowsStylePath | client.js:135-160、48-77 | ✓ 逐行核对无漂移（含 pwsh→bash、web_fetch→read、cordis_* 映射与 `~` 精确等值分支） |

**额外追查的边界——退出码失败的 bash（isError=false，输出尾带 `[exit code: N]`）**：UI 的 `terminalFailed` 覆盖（client.js:616、1285）把这类行置为 error 态（红标 +「失败」状态），但 `errorSummary` 在 `toolRowModel` 内按 isError 态计算、保持 null，故 `failureLine = null`，**显示文本仍是 description**（`terminal?.description ?? model.summary`，client.js:1771）。地图 hint 与该文本一致——文本 parity 成立；丢失的只是「失败」徽标这一视觉维度（见 S2）。

## 问题清单

### 阻塞（P0/P1）

无。

### 建议（P2）

- **S1｜孤儿回退分支零测试覆盖**。`name: <输出>` 是新代码里唯一保留原始输出的路径，也是 parent 明确关注的可达性问题，但 `test/scan.test.ts` 没有任何用例走到它。补一个 ~5 行用例即可：直接 `session.append("tool/result", …)` 携带一个从未出现在任何 tool-call 里的 callId（sourceEventSeqs 引用任一已有 assistant 事件），断言 preview 为 `tool: <输出>`。顺带钉住「孤儿时 toolName 为 undefined」的现状。
- **S2｜退出码失败行丢失失败信号——建议显式决策（接受则补文档）**。编码会话里极常见的场景：bash 命令 exit≠0 时 wire 层 `isError=false`（client.js:610 注释明言「the exit status is result data」），新地图行显示 `bash · <description>`，与 UI 文本一致，但：① UI 还有「失败」徽标，文本地图无法表达；② 旧格式显示输出首行，通常恰好暴露失败原因（如 `npm error code ELIFECYCLE`）。对 clear_mind 选区（识别「已放弃的路径」）这是一个真实的信息回退。两个选项：
  - a) 镜像 `parseExitStatus`（client.js:742，约 10 行：尾部 `\n[exit code: N]` / `\n[killed by signal: X]` 正则，仅 bash/pwsh），命中非零退出/信号时给 tool 行加 `!` 失败标记；
  - b) 接受分歧，但在 scan.ts 注释块的「Known, accepted divergences」里补一条（当前注释让 error 行 parity 显得比实际更完整）。
  考虑到用户的验收标准是「像 UI」，且 UI 文本已一致，倾向 b + 可选 a；需 parent 定夺。

### 非阻塞（P3/nit）

- **N1｜孤儿分支死条件**。`toolNames` 与 `callHints` 在同一循环体、同一条件下成对 set，不变量 `toolNames.has(id) ⟺ callHints.has(id)` 恒成立；因此孤儿分支里 `name` 必为 undefined，`(name !== undefined ? name : "tool")` 恒取 `"tool"`。建议二选一：简化为 `"tool: " + preview`，或加一行注释写明该不变量（现写法读起来像 name 在该分支可能存在，误导后续维护）。
- **N2｜空输出错误行渲染为 `"bash ! "`**（尾随空格 + 空预览）。UI 对 errorSummary=null 的错误回退到 description。旧行为完全相同（非回归）、宿主错误无 content 块时才触发，罕见。仅记录。
- **N3｜`textOfBlocks` 只取首个 text 块**，UI `resultText`（client.js:107）拼接全部 text 块。多块错误结果的 failure line 推导可能有别。旧行为相同（非回归）、罕见。仅记录。
- **N4｜docs 措辞**。summary.md「UI 对无参调用也只显示 callId」略不精确：`argsRaw="{}"` 时 UI 显示 `{}`（deriveSummary 末路回退），仅 `argsRaw=""` 显示 callId。scan.ts 注释的表述（「UI: raw JSON head or callId」）才是准确的。 Cosmetic。

## 测试评价

- 新断言质量好：tool 行全部分支（成功 hint 精确等值 ×6、错误行 + isError 标志、坏参/无参降级、路径变换 ×4）都被钉住；首个 scan 测试与 renderSurvey 测试补 description 参数后从「匹配子串」升级为钉住 summary 行为，是强化不是弱化。
- 唯一缺口即 S1（孤儿分支）；旧的成功路径输出断言被有意反转，符合本次行为变更意图。

## 准入结论

**准入（通过）。** 三个命令全绿；isError 分支零回归；同源同值成立；非 surface 事件的 hint 计算无副作用且必要；UI parity 主张逐条对源核实成立（含退出码失败行这一隐蔽边界）。S1/S2 建议在合入前顺手处理（S1 是 5 行测试；S2 至少补一行 accepted-divergence 注释），不构成阻塞。
