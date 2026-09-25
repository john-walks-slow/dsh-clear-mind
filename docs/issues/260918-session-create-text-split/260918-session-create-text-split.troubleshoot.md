# 260918 会话创建/打开即消失（text.split is not a function）

## 现象

1. 新建会话：一瞬间出现（工作区切到最近工作区），随即消失，工作区切回空。
2. 侧边栏打开任意历史会话：历史加载完的一瞬间，tab 被关闭，sidebar 里的项目也消失。

UI 报错（前端 console）：

```
new session failed: SessionCreateError: session create failed:
gateway/internal: failed to create session "session-…": TypeError: text.split is not a function
    at ClientSessions.create (client.js:2433)
```

## 根因（已实机复现验证）

`dsh-clear-mind` 仓库（link 进线上 profile 的本地插件）存在**未提交的工作区改动**
（commit `1291561` 之后的 `src/prompts.ts` / `src/config.ts` / `src/reminder.ts` /
`src/render.ts` / `test/prompts.test.ts`，及已编译产物 `dist/`）：

- `DEFAULT_PLAYBOOK.notesGuide` 与 `reminder` 保持为**数组**（`string[]`）；
- 改写后的 `resolvePlaybook()` 把这两个字段当字符串处理：
  `multiline(text("notesGuide"))` → `text.split("\n")`；
- 无 override 时 `text()` 回退到 `DEFAULT_PLAYBOOK[key]`，返回数组 →
  `TypeError: text.split is not a function`。

最小复现：

```bash
node -e "import('/root/projects/dsh-clear-mind/dist/src/prompts.js').then(m =>
  m.resolvePlaybook({ playbook: {}, presetPlaybook: {} }, undefined))"
# → TypeError: text.split is not a function
```

## 现象与根因的关联

- dsh-clear-mind 是全局 bundle 插件。`apply()` 在 `agent/created` 事件里对每个
  root agent 调 `resolvePlaybook(...)` 注册 `mind_map` / `clear_mind` 工具。
- **创建新会话** = 创建 agent → 注册时抛 TypeError → host 侧
  `rejectCreation()` 包装为 `RemoteError("gateway/internal", "failed to create
  session …")` → 前端收到 `SessionCreateError`，回滚刚乐观显示的会话 →
  「出现又消失」。磁盘上留有已 materialize 但被 UI 丢弃的空会话目录
  （如 `--root-projects-dsh-proactive--/session-c9b1bb4e-…/`，仅 4 行 header）。
- **打开历史会话** = resume agent → 同一注册路径崩溃 → 会话打不开、
  sidebar 条目随之消失。

时间线吻合：改动于 2026-09-18 13:57 前后落盘（dist 同步编译），故障同日 ~14:00 起
出现；与插件、版本升级无关，是 clear-mind 自身未完成的实现（`resolvePlaybook`
签名/回退类型与 `DEFAULT_PLAYBOOK` 不一致）。

## 复现与定位过程

1. 隔离 e2e 实例（`DSH_HOME=/root/.dsh-e2e`，端口 4188，共享同一 link 插件）
   用 `/api` 通道直接 POST `session/create` → 报错与线上一字不差 → 排除线上
   环境因素，确认可安全复现。
2. 全库搜 `text.split`，host 侧命中 `dsh-credentials-local`、
   `dsh-session-persistence-jsonl`、`dsh-cordis-host-runner` 等，均在 create
   路径之外；最终命中本地插件 `dsh-clear-mind/dist/src/prompts.js:45`。
3. 直接 `import` 调 `resolvePlaybook` 复现崩溃，无需 host。

## 修复方向（2A 单点修复）

统一 `resolvePlaybook` 的回退类型：`DEFAULT_PLAYBOOK` 的 `notesGuide` /
`reminder` 改为字符串（内部用 `\n` 分隔），`multiline()` 统一拆行；或让
`text()` 对数组字段直接返回数组、跳过 `multiline()`。任一方向都必须保证
无 override 路径返回 `PlaybookPrompts` 声明的类型（数组字段仍为数组）。

修复后 `pnpm build` 重新编译 dist（link 引用的是产物），无需重启线上：
仅影响后续创建/恢复的 agent。验证：

- e2e 实例 POST `session/create` 返回 ok；
- 线上 GUI 新建会话不再消失、历史会话可打开；
- `test/prompts.test.ts` 通过。

## 线上验证（2026-09-18 15:43，修复已生效）

- dsh 线上进程 15:27 重启（修复后的 dist 于 15:21 编译）。
- 最小复现通过：`resolvePlaybook({playbook:{}, presetPlaybook:{}}, undefined)` 正常返回。
- 线上 `POST /api/session/create`（cwd=/tmp/probe-final）→ `ok:true`（探针残留目录已清理）。
- 线上 `session/follow` stream（token-game 历史会话）→ snapshot 正常下发，无 `api-session/error`。
- `npm test`：53/53 通过。

## 备注

- 排查中在 e2e（4188）上用 curl 创建失败留下的空会话目录可忽略/删除。
- 前置教训：本地 link 插件的工作区未完成改动会即刻影响线上（shared
  `DSH_HOME`），半成品代码应避免留在被线上加载的路径上。
