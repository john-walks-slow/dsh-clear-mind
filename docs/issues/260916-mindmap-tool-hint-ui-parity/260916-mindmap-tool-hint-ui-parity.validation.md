# mindmap-tool-hint-ui-parity 用户验证

## 验证说明

- 验证对象：mind_map 地图中 assistant 工具行 hint（`name · summary`）与 Web UI 未展开工具行摘要的一致性——取值优先级（bash 显示 description、read/edit 显示路径、grep 显示 pattern、web_search 显示合并 queries）+ 路径变换（工作区相对化、home `~` 缩写）。
- 环境/前置条件：**需重启 dsh 使新构建的 dist 生效**（本插件在 dsh 进程内加载，改码后旧进程仍运行旧构建；重启前 mind_map 仍显示旧格式）。重启后在任一会话中制造带工具调用的历史，再让模型调用 mind_map。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 重启 dsh 后，在有 bash 调用（带 description）的会话里触发 mind_map | 地图中该 assistant 行显示 `bash · <description 首行>`，命令本身不出现；与 UI 未展开行一致 | | 待验证 | |
| 有 read/edit 调用（绝对路径参数，如 /root/projects/… 下文件）的会话里触发 mind_map | hint 显示工作区相对路径（如 `read · src/config.ts`）；home 下的路径显示 `~/…`；与 UI 未展开行一致 | | 待验证 | |
| 有 grep/web_search 调用的会话里触发 mind_map | `grep · <pattern>`、`web_search · <query1, query2>`；与 UI 未展开行一致 | | 待验证 | |

## 验证结论

待验证。

## 待跟进

无。
