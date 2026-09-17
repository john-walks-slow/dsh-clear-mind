# mindmap-tool-hint-ui-parity 用户验证

## 验证说明

- 验证对象：mind_map 地图中工具行与 Web UI 未展开工具行摘要的一致性——assistant 调用行与 tool 结果行都显示 `name · summary`（bash 显示 description、read/edit 显示路径、grep 显示 pattern、web_search 显示合并 queries）+ 路径变换（工作区相对化、home `~` 缩写）。
- 环境/前置条件：**需重启 dsh 使新构建的 dist 生效**（本插件在 dsh 进程内加载，改码后旧进程仍运行旧构建）。重启后在任一会话中制造带工具调用的历史，再让模型调用 mind_map。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 重启 dsh 后，在有 bash 调用（带 description）的会话里触发 mind_map | assistant 调用行显示 `bash · <description 首行>`，命令本身不出现 | 用户 260917 在 compare-llm 会话实机核对：assistant 行已显示 description（如 `→ bash · Check project workspace state`） | 通过 | 第一轮（260916 构建） |
| 有 read/edit 调用（绝对路径参数）的会话里触发 mind_map | hint 显示工作区相对路径（如 `read · src/config.ts`）；home 下路径显示 `~/…` | 同上轮实机核对：`→ edit · src/config.ts` 已相对化 | 通过 | 第一轮（260916 构建） |
| 有 grep/web_search 调用的会话里触发 mind_map | `grep · <pattern>`、`web_search · <query1, query2>` | 未单独核对（与上述同一机制） | 待验证 | |
| **重启后看 tool 结果行（`bash: …` 这类行）** | tool 结果行显示其调用的 summary（`bash · <description>`），不再显示原始输出；错误结果显示 `bash ! <失败首行>`（与 UI 错误行一致） | | 待验证 | 第二轮（260917 修复：第一轮用户反馈「mindmap 还是没像 UI 那样输出 bash 的 summary」——根因是 tool 结果行仍显示输出原文，用户眼里的「bash 行」是这些行） |

## 验证结论

部分通过（第一轮 3 项中 2 项实机通过；用户反馈暴露 tool 结果行未镜像，已修复待第二轮验证）。

## 待跟进

第一轮反馈（260917）：assistant 调用行已是新格式，但 tool 结果行仍显示原始输出（`bash: /root/projects/...`），与 UI 未展开行不符。已在 260917 修复：tool 结果行改为显示其调用的 UI 行 summary（成功态），错误态显示失败首行（与 UI error 行一致），孤儿结果保留输出回退。需再次重启 dsh 后验证。
