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
