---
name: dsh-delete-session
description: 为 DeepSeek Harness 增加「删除会话」和「批量删除会话」：在会话行「⋯」菜单里注册单项删除入口，以及一个可勾选多个会话一次删完的批量入口（连同会话日志、工作区记账、归档/置顶标记一起清除，并通知已连接的页面刷新）。当用户抱怨 DSH 只能归档不能删除、想要清掉某个会话、想一次清理多个旧对话、或已经下载本仓库希望装上这个功能时使用。
whenToUse: 用户要求删除某个会话但发现 DSH 没有删除入口；用户要清理多个/几十个旧对话；用户说要装 dsh-delete-session / dsh-toolkit；或用户想真正从磁盘清掉会话历史而不是归档。
metadata:
  version: "1.3.0"
  upstream: "https://github.com/Yts6/dsh-toolkit"
---

# 给 DSH 装上「删除会话」

DeepSeek Harness 官方设计是「会话只归档、从不删除」，所以界面上没有删除入口。本 skill 把仓库里自带的插件安装到当前 profile，装好后会话行「⋯」菜单会多两项：单项「删除会话」与「批量删除会话…」。

**你做这件事的目标：** 在用户这台机器上把插件装好、确认它真的活着（包括批量入口），并把「怎么用、注意什么」讲清楚。

---

## 0. 先摸清环境（不要跳过）

需要知道三件事：skill 文件在哪、DSH 的主目录在哪、当前 profile 装了什么。

```bash
# 这个 SKILL.md 自己的绝对路径（读它是加载 skill 时给出的路径）
# 插件 payload 就在它旁边的 payload/dsh-session-delete
ls -la "<本 SKILL.md 所在目录>/payload/dsh-session-delete"

# DSH 主目录：环境变量优先，否则 ~/.dsh
echo "DSH_HOME=${DSH_HOME:-$HOME/.dsh}"
echo "profile=${DSH_PROFILE:-unknown}"

# 当前 profile 已装的 bundle（有 plugin_manager 工具就直接用它，没有就看 package.json）
cat "${DSH_HOME:-$HOME/.dsh}/profiles/${DSH_PROFILE:-desktop}/package.json"
```

要点：
* 插件必须从**一个固定目录**安装。如果 payload 在临时目录、下载目录或仓库副本里，先复制到长期位置，例如
  `~/.dsh/plugins/dsh-session-delete`（Windows：`%USERPROFILE%\.dsh\plugins\dsh-session-delete`），再安装。
  **因为本地目录安装是软链接**，装完再移动或删除源目录，插件立刻失效。
* 不要手动改写 profile 的 `package.json` / `cordis.patch.yml`，也不要自己跑 pnpm——用安装工具，它才会正确处理依赖与 bundle 选择。

## 1. 安装

优先用 `plugin_manager` 工具（参数是 **payload 目录的绝对路径**）：

```
plugin_manager(action: "install_bundle", target: "<固定位置>/dsh-session-delete")
```

没有这个工具时，让用户在 GUI 里装：「插件」页 → 安装 → 粘贴该目录的绝对路径。

安装结果里要看到 `application: "applied"`（不是 `restart-required` / `failed`）。
* 出现 `restart-required`：让用户重启一次 DSH（托盘「重启 DeepSeek Harness」或退出后重新打开）。
* 出现 `failed`：把 `error` 与诊断原样告诉用户，不要反复重试，也不要手改 profile。

> 从旧版本（1.0.0 / 1.1.0）升级时**必须重启一次**：主机侧的逻辑只在启动时加载，且要在启动后才会捕获到内存中会话的卸载句柄。
> 从 1.2.0 升到 1.3.0（批量删除）**不需要为批量重启**：批量是浏览器端能力，刷新页面就会加载；但 1.3.0 的 `health.build` 是 **7**，不重启主机仍是 6——重启一次能让自检显示 7（两者删除行为相同）。

## 2. 自检（必须做，别只看安装返回）

找端口：Web GUI 地址形如 `http://127.0.0.1:<端口>`；用户没告诉你时问一下，或用
`webApp.getAdvertisedUrl()` / 环境变量确认。

```bash
curl -s http://127.0.0.1:<端口>/dsh-session-delete/health
# 期望：{"ok":true,"plugin":"dsh-session-delete","build":7,
#        "capture":{"createAgent":true,"resume":true,"setupAndPublish":true}}
```

* `build` 是版本号：**7 = 1.3.0（带批量删除），6 = 1.2.0**；更小说明进程里跑的还是旧代码，重启 DSH。
* `capture` 三项都为 `true` 才说明「能卸载已打开的会话」；有 `false` 时那个入口点的会话删不掉（见第 4 节）。

健康检查过了就只能说明主机侧活着；**菜单项在浏览器里**，请让用户刷新页面（Ctrl+R）后打开任意会话的「⋯」菜单，确认出现「删除会话」与「批量删除会话…」两项。批量入口是纯客户端注册，`health.build=6` 也可能已经带上它；还可以查实时 slot 注册（`cordis_inspect_query` 的 client `Slots.listSubTree`，root=`sidebar.workspaces.session.menu.item`）里是否有 `dsh-session-delete.batch`、是否 `active: true`。如果用户说看不到，见第 4 节。

## 3. 告诉用户怎么用

* 位置：侧栏会话行 →「⋯」→ 删除会话（在「复制 Session ID」下面，红色）。
* 会真的删除：会话日志目录 + 工作区记账 + 归档/置顶标记，**不可撤销**。
* **当前正在看的对话也能删。** 确认框写「删除并新建对话」：客户端先切到一个新的空白对话，等页面放手旧会话，再让主机删；如果删除失败会自动**切回原对话**，不会把人扔在空白会话里。
* 打开的、加载着的、有运行中回合/后台任务/子代理/提醒的会话都能删：主机先 `workspace/session-stop` 停掉这些工作，再用这个会话 Agent 的**生命周期句柄**做一次完整收尾（取消回合 → 等空闲 → 关持久化写句柄 → 从 `agents`/`sessions` 注册表 detach，与「退出应用」同一套），确认两个注册表都放手后才删文件。收尾有 20 秒上限，超时报 `session/release-timeout` 且**不删**。
* **批量删除会话…**（同一菜单，红色，右侧显示会话总数）：弹窗里列出所有存储的会话（含已归档，空白新会话不列），可搜索、全选；勾选后点「删除 N 个会话」，逐条执行并显示进度。有失败时失败项会保持勾选并列出原因，按钮变「重试失败项」，只重发失败的那几条。
  * **当前正在看的对话在批量列表里显示但置灰、不可勾选**：它要先让页面切到新对话，请用单项删除。
  * 批量是逐条调用同一个主机删除接口（带 `force`），中途关页面只会让还没开始的条目保留下来。
* 只想要「不显示」而不是删掉，请用内置的「归档会话」。
* 卸载：插件页停用/移除，或 `plugin_manager` 的 `remove_bundle`（名字 `dsh-session-delete`）。

## 4. 排错

先跑只读诊断，再动手：

```bash
curl -s "http://127.0.0.1:<端口>/dsh-session-delete/inspect?sessionId=<会话ID>"
# session.stored / session.live / session.captured / session.handles / session.directory
```

| 现象 | 处理 |
|---|---|
| `curl` 连不上 | 端口错，或插件没装到当前运行的 profile；确认 profile 名与端口 |
| `health` 404 | 主机行没挂上：看安装结果是否为 `applied`，必要时重启 DSH |
| `health.build` 小于 6 | 1.2.0 之前的旧代码：重启 DSH |
| `health.build` = 6 但有「批量删除会话…」 | 正常：批量是纯客户端更新，主机侧不重启也能用；重启后自检显示 7 |
| 安装返回 `not-bundle` | target 指错了：必须指向 `dsh-session-delete` 目录（含 `package.json` / `cordis.patch.yml`），不是它的上级 |
| 用户看不到菜单项 | 先刷新页面；再看实时 slot 注册（`cordis_inspect_query` 的 client `Slots.listSubTree`，root=`sidebar.workspaces.session.menu.item`）里是否有 `dsh-session-delete`、是否 `active: true` |
| 有「删除会话」但没有「批量删除会话…」 | 浏览器里还是 1.2.0 的客户端：确认 payload 版本是 1.3.0，让用户强制刷新（Ctrl+Shift+R）；slot 树里缺 `dsh-session-delete.batch` 就是这个原因 |
| 批量删除有失败项 | 失败项会保持勾选并显示主机原因，按该原因处理后再点「重试失败项」；**不要**直接 `rm -rf`，否则会留下悬空的记账条目 |
| 删除报 `session/busy` | 该会话仍有工作且调用方没要求强制：界面确认框会自动带 `force`；手工调接口时加 `{"force": true}` |
| 删除报 `session/release-timeout` | 两种原因：① Agent 收尾 20 秒内没结束（通常有卡住的回合）→ 等它空闲或重启 DSH；② `inspect` 里 `captured: false` → 这个 Agent 在插件加载前就建好了，重启 DSH 后再删。**两种情况都不会删文件** |
| 删除报 `storage/locked` | 日志仍被占用（写句柄没关掉/别的进程在读）：重试；一直失败就重启 DSH 后再删 |
| 删除报 `session/not-found` | 目标已经不存在了；界面上当成功处理，不用管 |
| 删除后侧栏残留空「未分组」 | 旧版本遗留；刷新页面即可。新版在 `notified: false` 时会自己拉一次会话基线 |
| 批量删到一半关了页面 | 已发出的删除会完成，还没开始的那几条会保留；重新打开批量删除即可 |

## 5. 不要做的事

* 不要让模型自己去删会话文件来「实现删除功能」——必须装插件，否则会留下悬空的记账条目。
* 不要给这个能力加「模型自动删除会话」的路径：删除是不可逆的用户决定，入口只应来自用户点击。
* 不要修改 `app.asar` 来做这件事（插件已足够，且升级会被覆盖）。
* 不要用「只 dispose Agent 的 scope fiber」来实现卸载：那条路不会执行生命周期收尾（见附录）。

## 6. 怎么验证真的修好了

1. `health` 的 `build` 是 7（或 6，见第 2 节）、`capture` 全 `true`。
2. 打开两个对话 A、B，先删 B（已打开过、空闲）→ 行消失、`sessions/*/*/B` 目录消失。
3. 停在 A 上删 A → 页面切到新的空白对话，A 的行与目录都消失。
4. `inspect` 一个不存在的 id → `stored: false`；再删返回 `session/not-found`。
5. 打开「批量删除会话…」：列表能看到 B/A 删掉的就不在了、空白新会话不在列表里；当前对话在列表里但置灰不可勾选；搜索能按标题过滤。
6. 勾两个旧会话 → 点「删除 N 个会话」→ 进度走完、弹窗关闭、两行消失；`sessions/*/*/<id>` 目录都不在了。

---

## 附：插件做了什么（排查时有用）

* 菜单项：slot `sidebar.workspaces.session.menu.item`，id `dsh-session-delete`，order 500。
* 批量菜单项：同一个 slot，id `dsh-session-delete.batch`，order 510。
* 确认框：slot `shell.overlay`，id `dsh-session-delete.dialog`。
* 批量弹窗：slot `shell.overlay`，id `dsh-session-delete.batch-dialog`。
* 路由：
  * `GET /dsh-session-delete/health` → `{ ok, build, capture }`，判断加载的是哪一版、捕获是否生效。
  * `GET /dsh-session-delete/inspect?sessionId=` → 只读诊断：`stored` / `live` / `captured` / `handles` / `directory` / `workspace`。
  * `POST /dsh-session-delete/delete` → body `{ sessionId, force?, dryRun? }`；`dryRun` 只解析目标不删。批量删除**没有**独立路由，就是客户端逐条调用它。
* 顺序：会话存在 → `workspace/session-activity` 询问运行中的工作 → 若「正在打开」或「有工作」则**没有 `force` 就拒绝**（`session/busy`，带 `forceable: true` 与工作清单）→ 有 `force` 时先 `workspace/session-stop` 停各提供方，再**用捕获的生命周期句柄** `dispose()`（取消回合 → 等 idle → 关写句柄 → detach）→ 轮询到 `agents`/`sessions` 都不再持有该 id → 用 `sessionPersistence.locate()` 定位目录并校验（目录名==session id、位于会话根内）→ 删目录（`EBUSY/EPERM` 重试一次）→ 复核目录确实不在 → 发 `api-session/removed` → `detachSession()` + 取消归档/置顶。
* 为什么需要「捕获句柄」：Harness 从不卸载已打开的会话，`ctx.agents` 也没有「卸载单个 Agent」的公开接口；只 dispose Agent 的 scope fiber **不会**执行生命周期收尾（那个闭包属于 agent-loop 的创建事务）。唯一受支持的收尾是 `agents.create()/resume()` 解析出的 `{ agent, dispose }` 句柄——而 Session controller 只取了 `.agent`，把 `dispose` 丢了。所以主机侧在本插件加载时给 loop 工厂的 `createAgent` / `resume` / `setupAndPublish` 各包一层，按 session id 保存这份句柄，删除时直接调用它。这也解释了旧版本为什么删「打开过的对话」必然失败（20 秒后 `release-timeout`，文件还在）。
* 客户端单项：确认框用 `sessions.retainInfo(id).getSnapshot().retainedBy.mainView` 判断「这是页面正在显示的对话」，需要时先执行「新建会话」并等它归零；失败则 `uiWorkspace.openSession(id)` 切回原对话。
* 客户端批量：列表来自 slot 标准 props `useSessions` / `useWorkspaces`（和侧栏同源），勾选后按「最新优先」逐条 `POST /delete`（带 `force`），每条单独记成败；全部成功关闭弹窗，有失败则保持失败项勾选、按钮变「重试失败项」。当前对话不参与批量（置灰），因为它需要「先切到新对话」那条单人状态机。
