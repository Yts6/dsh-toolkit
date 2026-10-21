---
name: dsh-delete-session
description: 为 DeepSeek Harness 增加「删除会话」功能：在会话行「⋯」菜单里注册一项可真正删除会话的入口（连同会话日志、工作区记账、归档/置顶标记一起清除，并通知已连接的页面刷新）。当用户抱怨 DSH 只能归档不能删除、想要清掉某个会话、或已经下载本仓库希望装上这个功能时使用。
whenToUse: 用户要求删除某个会话但发现 DSH 没有删除入口；用户说要装 dsh-delete-session / dsh-toolkit；或用户想真正从磁盘清掉会话历史而不是归档。
metadata:
  version: "1.0.0"
  upstream: "https://github.com/Yts6/dsh-toolkit"
---

# 给 DSH 装上「删除会话」

DeepSeek Harness 官方设计是「会话只归档、从不删除」，所以界面上没有删除入口。本 skill 把仓库里自带的插件安装到当前 profile，装好后会话行「⋯」菜单会多一项「删除会话」。

**你做这件事的目标：** 在用户这台机器上把插件装好、确认它真的活着，并把「怎么用、注意什么」讲清楚。

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
* 出现 `restart-required`：让用户重启一次 DSH（托盘「退出」后重新打开）。
* 出现 `failed`：把 `error` 与诊断原样告诉用户，不要反复重试，也不要手改 profile。

## 2. 自检（必须做，别只看安装返回）

找端口：Web GUI 地址形如 `http://127.0.0.1:<端口>`；用户没告诉你时问一下，或用
`webApp.getAdvertisedUrl()` / 环境变量确认。

```bash
curl -s http://127.0.0.1:<端口>/dsh-session-delete/health
# 期望：{"ok":true,"plugin":"dsh-session-delete","build":3}
```

健康检查过了就只能说明主机侧活着；**菜单项在浏览器里**，请让用户刷新页面（Ctrl+R）后打开任意会话的「⋯」菜单确认出现「删除会话」。如果用户说看不到，见第 4 节。

## 3. 告诉用户怎么用

* 位置：侧栏会话行 →「⋯」→ 删除会话（在「复制 Session ID」下面，红色）。
* 会真的删除：会话日志目录 + 工作区记账 + 归档/置顶标记，**不可撤销**。
* 只想要「不显示」而不是删掉，请用内置的「归档会话」。
* 正在打开、或仍在跑的会话会被拒绝并给出原因——先切到别的会话再删。
* 卸载：插件页停用/移除，或 `plugin_manager` 的 `remove_bundle`（名字 `dsh-session-delete`）。

## 4. 排错

| 现象 | 处理 |
|---|---|
| `curl` 连不上 | 端口错，或插件没装到当前运行的 profile；确认 profile 名与端口 |
| `health` 404 | 主机行没挂上：看安装结果是否为 `applied`，必要时重启 DSH |
| 安装返回 `not-bundle` | target 指错了：必须指向 `dsh-session-delete` 目录（含 `package.json` / `cordis.patch.yml`），不是它的上级 |
| 用户看不到菜单项 | 先刷新页面；再看实时 slot 注册（`cordis_inspect_query` 的 client `Slots.listSubTree`，root=`sidebar.workspaces.session.menu.item`）里是否有 `dsh-session-delete`、是否 `active: true` |
| 删除报 `session/in-use` | 该会话正被保留/打开：先切走再删（这是刻意的保护） |
| 删除报 `session/active` | 还有运行中的回合/后台任务/子代理/提醒：先停掉 |
| 删除后侧栏残留空「未分组」 | 用旧版本插件删过会话；刷新页面即可，或 `session/delete` 返回里 `notified: false` 说明通知没发出去 |
| 想批量清理 | 仓库另有维护脚本思路：删前用 `sessionPersistence.stat()` 确认存在，删后对账「磁盘目录 vs 工作区记账」，别直接 `rm -rf` |

## 5. 不要做的事

* 不要让模型自己去删会话文件来「实现删除功能」——必须装插件，否则会留下悬空的记账条目。
* 不要给这个能力加「模型自动删除会话」的路径：删除是不可逆的用户决定，入口只应来自用户点击。
* 不要修改 `app.asar` 来做这件事（插件已足够，且升级会被覆盖）。

---

## 附：插件做了什么（排查时有用）

* 菜单项：slot `sidebar.workspaces.session.menu.item`，id `dsh-session-delete`，order 500。
* 确认框：slot `shell.overlay`，id `dsh-session-delete.dialog`。
* 删除动作：主机路由 `POST /dsh-session-delete/delete`，body `{"sessionId": "..."}`；另有 `GET /dsh-session-delete/health`。
* 顺序：会话存在 → 非 live（`ctx.sessions` / `ctx.agents`）→ `workspace/session-activity` 无运行中工作 → 用 `sessionPersistence.locate()` 定位目录并校验（目录名==session id、位于会话根内）→ 删目录 → `detachSession()` + 取消归档/置顶 → 发 `api-session/removed`。
