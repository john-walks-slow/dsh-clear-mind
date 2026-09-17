# mindmap 工具行 hint 与 Web UI 未展开行对齐 — 总结

## 问题

用户报告：mind_map 里工具行包含的东西应该和用户在界面上看到的未展开工具行一样——比如 bash 应该显示 description（summary）而不是命令本身。

根因：`src/scan.ts` 的 `callHint` 旧实现（HINT_KEYS 取 `command` 等参数首段、按 `;|&` 切命令首段）与 Web UI 未展开行（dsh-client-ui-tool `toolRowModel`/`deriveSummary`）的推导完全不同源，模型看到的地图行与用户指着屏幕比对不上。

## 修复

`callHint` 重写为镜像 UI 推导（镜像来源：dsh checkout `/usr/lib/node_modules/@deepseek-ai/dsh` 下 `dsh-client-ui-tool/lib/client.js`，升级 dsh 时需 re-diff）：

1. **取值镜像**：`TOOL_VARIANTS`（bash/pwsh→bash；read/web_fetch/cordis 包检查→read；web_search/grep/glob→search；write/edit；run_code→code；未知→others）+ `SUMMARY_KEYS`（bash: description→command；read: path→file_path→url；search: query→pattern→url；write/edit: path→file_path；code: description）+ web_search 的 `queries` 数组 join + 首字符串参数回退，均与 `deriveSummary` 逐行一致。
2. **路径变换镜像**（review S1 方案 a）：`rowSummary` 结果按 UI 应用顺序均匀套 `abbreviateHomePath(relativizeToCwd(summary, cwd), home)`——工作区根下的绝对路径显示相对路径、home 下显示 `~` 缩写，且在截断**之前**应用（先缩短再截断，保住文件名尾部）。`scanSurface` 从 `session.header.cwd` 与 `os.homedir()` 构造上下文穿线到 `callHint`，cwd 缺省时优雅退化。
3. **格式与降级**：`name · summary` 组合（与 UI others 变体行同构）；每段 `toPreviewLine` 48 截断、整行 `CALL_HINT_MAX=96` 不变；坏 JSON/空参数降级裸工具名。
4. **已记录的有意分歧**：BashRow 裸 description 不做路径变换（均匀应用的微差异）；UI error 态 bash 行显示 failureLine，地图恒显示调用侧 summary（错误由 tool-result 节点 `name !` 前缀承载）；UI 坏参数回退 `firstLine(argsRaw)`/callId，地图降级裸名；UI 行仅 CSS 截断，地图保留硬截断。

## 测试

`test/scan.test.ts`：原有镜像测试更新（description 优先且命令不出现、edit/grep/web_search 取值、未知工具、malformed 降级）+ 新增三组：header.cwd 相对化 / `~` 缩写 / 两者之外不动；`CALL_HINT_MAX` 截断分支（两段长 summary 触发 98 字符截断）；pwsh→bash 映射与 `queries: []` 回退 `query` 键。`npm run check` / `npm test`（43/43）/ `npm run build` 通过。

## 文档

- review：`260916-mindmap-tool-hint-ui-parity.review.md`（条件准入 + S1 方案 a 落实记录）
- validation：`260916-mindmap-tool-hint-ui-parity.validation.md`（需重启 dsh 后实机验证三场景）

## 追加修复（260917）：tool 结果行也镜像 UI 未展开行

**用户实机反馈**：重启后「mindmap 还是没像 UI 那样输出 bash 的 summary」。排查（读取线上会话日志 compare-llm 实际渲染的 mind_map 文本）确认：新构建已生效，assistant 调用行已显示 `bash · <description>`（如 `→ bash · Check project workspace state`）；但**tool 结果行**（`bash: <原始输出>`）仍显示输出原文——这是用户眼里最像「bash 行」的行，UI 未展开行显示的是调用 summary 而非输出，故仍不一致。

**修复**：`scanSurface` 日志遍历时为每个 tool-call 计算 hint 并存 `callHints` map（callId → `name · summary`，与调用行同源同值）；`previewOfMessage` 的 tool-result 分支改为：成功结果直接显示其调用的 hint（UI parity）；错误结果显示 `name ! <失败首行>`（与 UI error 行以 failureLine 替换 summary 一致，维持原状）；孤儿结果（日志中无对应调用）保留 `name: <输出>` 回退。assistant 调用行不变（已正确）。

**取舍**：无参/坏参工具（如 mind_map 自身，args 为 `{}`）的结果行降级为裸名——UI 对这类调用也只显示 callId 或原始 JSON 头，且 mind_map/clear_mind 调用对下一步即折叠为墓碑，信息损失极小；退出码失败的 bash（isError=false + `[exit code: N]`）保留 summary——UI 同样保留 description 文本、只翻「失败」徽标，文本行无法镜像徽标（已记为 accepted divergence）。测试：镜像测试扩展 tool 行断言（9 行）+ 错误态用例 + 孤儿结果回退用例；首个 scan 测试与 renderSurvey 测试的 bash 调用补上 description 参数以钉住 summary 行为。`npm run check` / `npm test`（46/46）/ `npm run build` 通过。需再次重启 dsh 生效。
