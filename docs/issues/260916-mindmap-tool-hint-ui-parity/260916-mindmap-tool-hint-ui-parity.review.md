# 检视报告：mindmap 工具行 hint 与 Web UI 未展开行对齐

## 概要

本次检视 `src/scan.ts` 的 `callHint` 重写（镜像 dsh-client-ui-tool 未展开行 summary 推导，`name · summary` 格式）及 `test/scan.test.ts` 配套更新。镜像与参照实现（client.js 的 `deriveSummary`/`toolRowModel`）逐项核对一致，降级路径无抛错可能，协议路径零接触，用户报告的 bash 显示命令而非 description 的缺陷已正确修复并测试钉住。存在一处建议修改：UI 对 read/edit/write 的路径 summary 还叠加了 cwd 相对化 + home 缩写，地图未镜像，且新注释的「word-for-word comparable」声明对此言过其实。

## 需求对齐

以 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/lib/client.js` 为权威参照逐项核对：

- **TOOL_VARIANTS**（client.js:66-82 ↔ src/scan.ts:95-111）：15 条映射逐条一致（pwsh→bash、web_fetch/cordis_package_inspect/cordis_runtime_inspect→read、grep/glob→search、run_code→code、cordis_run/stop/undefine→others），未知名 `?? "others"` 语义一致。
- **SUMMARY_KEYS**（client.js:132-148 ↔ src/scan.ts:114-122）：每个 variant 的键序完全一致（bash description→command；read path→file_path→url；search query→pattern→url；write/edit path→file_path；code description；others 空）。
- **queries join**（client.js:165-167 ↔ src/scan.ts:132-135）：`Array.isArray` 守卫、过滤非字符串与空串、逐条 `firstLine`、`", "` 连接，逐字一致；空数组回退到后续分支也一致。
- **firstLine**（client.js:121-124 ↔ src/scan.ts:125-128）：仅按 `\n` 截断，语义一致。
- **首字符串值回退**（client.js:171 ↔ src/scan.ts:140-142）：`Object.values` 顺序取第一个非空 string，一致（同一 JSON 串解析，键序相同，结果相同）。
- **bash 路径**：`SUMMARY_KEYS` 的 description→command 与 BashRow 的 `terminal?.description ?? model.summary`（client.js:1771）汇聚到同一结果——良构调用时 `shellCall`（client.js:684-709）返回的 `description` 即 `args.description`；`shellCall` 校验不过（非法 timeout 等）时 BashRow 走 generic 路径仍回到 `deriveSummary`。测试断言 description 优先且命令本身不出现（`!first.includes("npm test")`），正确钉住行为。
- **行为变化符合缺陷预期**：grep 从旧 HINT_KEYS 的 `path`（"src"）改为 `pattern`（"loadSettings"），与 UI 一致；bash 不再按 `;|&` 切首段（旧 `firstCommandSegment`），与 UI 的整首行一致。
- **有意分歧均按 Context 声明实现**：解析失败/无有效值 → 裸工具名（UI 为 `firstLine(argsRaw)` 或 callId）；每段经 `toPreviewLine`（折叠空白、48 字符截断），整行 `CALL_HINT_MAX=96` 截断不变。
- **`name · summary` 组合格式**与 UI others 变体行的 `` `${toolName} · ${base}` ``（client.js:220）完全同构；已知 variant 行在 UI 由本地化行标题承载工具名、行内只显示 summary，地图无标题列，以 `·` 组合是合理的等价表达。
- **协议安全**：`callHint` 仅流入 `SurveyNode.preview` → `renderSurvey` 的 `JSON.stringify` 展示行（render.ts:30-31）；commit/collapse/replace 路径未触碰，tombstone 使用 stats 不消费 preview，无其它消费者重解析 preview。核心契约（surface 位置语义、user/message 可见替换、step 窗口、compaction 括号）不受影响。
- **构建产物**：`dist/src/scan.js`（package.json `main` 入口）在源码修改后重建（13:16 > src 13:14），`lib/` 仅含 client bundle，无陈旧产物误导。
- **边界安全（代码走查，未执行）**：arguments 为 `""`/undefined/非对象 JSON（裸字符串、数字、null）/数组被当 record/纯空白值/空 queries 数组/坏 JSON——`rowSummary` 与 `callHint` 均无抛错路径，降级合理（裸名或空 summary 回退裸名）。TypeScript strict 下类型收窄正确；`?? "others"` 在当前无 `noUncheckedIndexedAccess` 的配置下是防御性冗余，无害。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | src/scan.ts:86-90（注释）、src/scan.ts:130-144（rowSummary） | UI 的 `toolRowModel` 在 `deriveSummary` 之上还套 `abbreviateHomePath(relativizeToCwd(summary, cwd), home)`（client.js:218），且 ReadRow（client.js:1880）与 FileMutationRow（client.js:1837，edit/write）确实解构并传入 cwd/home——即 read/edit/write 的未展开行显示工作区相对路径或 `~` 缩写，而地图显示原始绝对路径。深绝对路径在地图端被 48 字符头部截断丢掉文件名（区分度最高的尾部），UI 行反而保留，恰好削弱「用户指着 UI 行、模型在地图上找到对应行」的核心场景。注释「stay word-for-word comparable / exactly as the UI collapses them」对文件工具不成立，会误导后续维护者。 | 二选一：(a) 在 rowSummary/callHint 镜像 `relativizeToCwd` + `abbreviateHomePath`——`session.header.cwd` 在 scanSurface 内可直接取（dsh-session `SessionHeader.cwd`，`Session.header` 恒存在），home 用 `os.homedir()`，header.cwd 缺省时优雅退化为原值；(b) 若有意保留绝对路径（模型可直接复用路径），把注释收窄为「镜像 deriveSummary 的取值优先级」，并显式注明与 UI 展示层相对化的分歧。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | test/scan.test.ts:148-190 | 覆盖缺口：joined 长度从未超过 96，`CALL_HINT_MAX` 的 `"…"` 截断分支零覆盖（:183 的界限断言在 88 字符下不触发截断，截断逻辑回归不会被捕获）；`queries: []` 回退、pwsh→bash 映射、arguments 为 `""`/undefined 未测（helper 对无参调用默认填 `"{}"`，:82，实际测的是空对象而非缺参）。 | 补一个多 call 长行用例钉住 `"…"` 截断；可选补 `queries: []` 与缺参用例。 |
| N2 | src/scan.ts:95-122 | 镜像表与 dsh-client-ui-tool 的推导表无编译期 linkage，UI 包演进时地图会静默漂移。导入 client bundle 服务端不可行（React/CSS 依赖图 + AGENTS.md 的 link-package ESM 坑），镜像本身是正确取舍，风险仅剩漂移。 | 在注释中记录镜像时对应的 dsh-client-ui-tool 版本/commit，或把「升级 dsh 时 diff 两张表」列入升级清单。 |
| N3 | src/scan.ts:151-166 | 已知分歧备忘：UI 对 error 态 bash 行显示 failureLine（错误输出首行，client.js:1771）而非 description；地图恒显示调用侧 summary，错误由 tool-result 节点的 `name !` 前缀承载。调用标识与结果状态分离的设计自洽，且不在本次声明契约（Context 定义权威为 description ?? deriveSummary）之内。 | 记录为有意分歧即可；若用户后续反馈 error 行对不齐再议。 |

## 准入结论

**结论**：`条件准入`

**说明**：报告的缺陷（bash 显示 description 而非命令）已忠实修复并被测试钉住，镜像取值逻辑与 UI 参照逐项一致，协议路径零接触，无阻塞问题。S1（read/edit/write 路径未镜像 UI 的 cwd 相对化、注释声明过强）建议在合并前以「镜像实现」或「注释收窄」二者择一处理。

## S1 处理记录（合并前落实）

采用方案 (a) 镜像实现：`src/scan.ts` 新增 `isWindowsStylePath` / `relativizeToCwd` / `abbreviateHomePath` 三个镜像函数（逐行对照 client.js:16-18、36-44、155-160 的实现核对），`scanSurface` 从 `session.header.cwd`（缺省时优雅退化）与 `os.homedir()` 构造 `RowDisplayContext`，经 `previewOfMessage` 穿线至 `callHint`，对 `rowSummary` 结果按 UI 的应用顺序 `abbreviateHomePath(relativizeToCwd(summary, cwd), home)`（client.js:218）均匀作用于全部 variant，且在 `toPreviewLine` 截断之前（先缩短再截断，保住文件名尾部）。注释块重写为「值推导镜像 deriveSummary + 路径变换镜像 toolRowModel 的均匀应用」，并记录已接受分歧（BashRow 裸 description 不做路径变换、error 行 failureLine、坏参数降级裸名、地图硬截断）与镜像来源及升级时 re-diff 提示（N2 一并落实）。新增测试覆盖：header.cwd 工作区相对化、home `~` 缩写、两层之外路径不动、`CALL_HINT_MAX` 截断分支、pwsh→bash 映射、`queries: []` 回退 `query` 键（N1 一并补齐）。N3 的 error 态分歧已在注释中记录为有意分歧。`npm run check` / `npm test`（43/43）/ `npm run build` 全部通过。
