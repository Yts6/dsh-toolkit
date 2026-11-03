# dsh-session-delete

Harness 只提供「归档」，本插件补上真正的删除：会话日志目录 + 工作区记账 +
归档/置顶标记一起清掉，并通知已连接的页面。单个会话与批量删除共用同一套
Host 删除流程。

## 为什么删除「打开过的对话」需要额外做事

Harness 从不卸载已打开的会话：Agent 会一直留在 `ctx.agents` / `ctx.sessions`
里，直到应用退出。而 `ctx.agents` 没有「卸载单个 Agent」的公开接口：

* 只 dispose Agent 的 scope fiber **不会**执行生命周期 teardown——那个闭包属于
  agent-loop 的创建事务，不属于 scope fiber；
* 真正可用的 teardown 是 `agents.create()` / `agents.resume()` 解析出的
  `{ agent, dispose }` 句柄，而 Session controller 只取了 `.agent`，把
  `dispose` 丢掉了；
* 不执行 teardown 就关不掉写句柄，Windows 上日志文件仍被占用，`rm` 会失败
  （或删掉后被重新写回）。

所以 Host 半在加载时给 agent-loop 工厂的 `createAgent` / `resume` /
`setupAndPublish` 各包一层，按 session id 保存每个 Agent 的 `dispose`，
删除时直接调用它：取消回合 → 等空闲 → 关写句柄 → 从两个注册表 detach。
效果与「应用退出」时同一套收尾，因此删完不会再有写入。

## 删除流程（Host）

1. `sessionPersistence.stat(id)` 确认存在；
2. `workspace/session-activity` 询问是否有运行中的工作；没有 `force` 就 409；
3. `force`：先 `workspace/session-stop` 停各提供方的工作，再调用捕获到的
   生命周期 `dispose()`（没有捕获到时退化为 scope 释放，并在卸载不干净时
   返回 `session/release-timeout`，**不删文件**）；
4. 轮询直到 `ctx.agents` / `ctx.sessions` 都不再持有该 id；
5. `persistence.locate()` 定位目录并校验「目录名 == session id」且在会话根内；
6. 删目录（EBUSY/EPERM 重试一次，仍失败返回 `storage/locked` 且不谎报成功）；
7. 发 `api-session/removed`，再从工作区记账、归档、置顶里移除；
8. 返回回执：`{ released, notified, cleanup, warning?, revision }`。

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-session-delete/health` | `{ ok, build, capture }`，`build` 用来确认加载的是哪一版 |
| GET | `/dsh-session-delete/inspect?sessionId=` | 只读诊断：是否 live、是否有捕获句柄、占用中的写句柄、目录 |
| POST | `/dsh-session-delete/delete` | `{ sessionId, force?, dryRun? }` |

## 客户端

* 单项菜单项：`sidebar.workspaces.session.menu.item`，id `dsh-session-delete`，order 500；
* 批量菜单项：同一个 slot，id `dsh-session-delete.batch`，order 510（显示会话总数）；
* 单项确认框：`shell.overlay`，id `dsh-session-delete.dialog`；
* 批量确认框：`shell.overlay`，id `dsh-session-delete.batch-dialog`；
* 删除当前对话：先执行「新建会话」动作并等到页面放手旧会话（`retainedBy.mainView`
  归零），再请求 Host；失败会**切回原对话**，不把用户扔在空白会话里；
* 批量删除：列出页面会话存储里的全部会话（含归档，空白的「新会话」不列出），
  支持搜索、全选/取消全选；当前对话在列表中置灰、不可勾选——它需要先放手旧
  会话，这条路径交给单项删除；
* 批量执行是**逐条**调用 `POST /delete`（带 `force`）：每条单独回报成功/失败，
  列表随删除实时缩短，某一条失败不会吞掉其他条的结果；失败的条目会保持勾选，
  按钮变成「重试失败项」，重试只重发失败的那几条；
* Host 回 `notified: false` 时主动 `sessions.refresh()` 拉一次基线，避免残留行。

## 已知边界

* 启动前就已在内存里的 Agent（例如配置里声明的 agent）没有捕获到句柄，此时会
  明确报 `session/release-timeout` 并保留数据；重启后再删即可。
* 只删目标会话本身，不会级联删除它的子代理（subagent）会话日志。
* 批量删除没有单独的 Host 路由：浏览器逐条调用单项路由，因此中途关掉页面只会
  让**尚未开始**的那几条保留下来（已删的不会回滚，也不会重复删除）。
