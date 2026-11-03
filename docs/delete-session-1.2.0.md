# 删除会话 1.2.0：为什么「打开过的对话」以前删不掉

> 适用版本：`dsh-session-delete` 1.2.0（`health.build = 6`）。旧版 1.0.0 / 1.1.0 的表现是：
> 已打开过的会话、以及当前正在使用的对话，点删除后等十几秒失败，报 `session/release-timeout`，
> 磁盘上的会话目录还在。
>
> 1.3.0 新增的批量删除见 [delete-session-1.3.0.md](delete-session-1.3.0.md)（主机逻辑与本版相同，`health.build = 7`）。

## 症状

- 从没打开过的会话：能删。
- 本次应用运行期间打开过的会话（哪怕只是点开看一眼、没有在跑任何东西）：删不掉。
- 当前正在看的那个对话：菜单项被置灰，根本点不了（旧客户端规则）。
- 失败信息形如 `该会话正在打开或有未释放的会话实例`，或者等 15 秒后 `session/release-timeout`。

看起来像「文件被占用」，其实是**内存里的 Agent 没被卸载**。

## 根因

DSH 从不主动卸载已打开的会话：Agent 一直留在 `ctx.agents` / `ctx.sessions` 里，直到进程退出。
而 `ctx.agents` 没有「卸载单个 Agent」的公开方法，唯一受支持的收尾是
`agents.create()` / `agents.resume()` 解析出的 `{ agent, dispose }` 句柄：

```js
// dsh-api-session-controller（打包在 app.asar 里）
(await this.ctx.agents.create({ ... })).agent   // ← dispose 被丢掉了
```

那份 `dispose` 做的是（`AgentLoop.prepare` 的 teardown）：

1. 取消当前回合 `machine.cancel({ kind: "disposed" })`；
2. `await machine.whenIdle()`；
3. `await machine.scope.dispose()`；
4. `await handle?.close()` —— **关闭持久化写句柄**；
5. `detachAgent()` / `detachSession()` —— 从两个注册表移除。

这个生命周期 effect 挂在 **agent-loop 的创建事务**上，不在 Agent 的 scope fiber 上。所以旧插件
`agent.ctx.fiber.dispose()` 只会拆掉 scope 效果，**第 4、5 步永远不会执行**：

- 写句柄还开着 → Windows 上日志文件被占用，`rm` 失败或删掉后被写回；
- 注册表还持有该 id → 插件的「等它卸载」轮询必然超时 → `session/release-timeout`。

而「当前对话」和「打开过的对话」恰恰都是 live agent，于是这两类必挂——与用户反馈完全一致。

## 修复

### 1) 捕获真正的卸载句柄

插件加载时给 agent-loop 工厂的三个入口各包一层，按 session id 保存句柄（存在
`globalThis` 上，插件热重载也不会丢）：

```js
for (const method of ['createAgent', 'resume', 'setupAndPublish']) {
  const original = loop[method];
  loop[method] = async function (...args) {
    const handle = await original.apply(this, args);
    const id = handle?.agent?.id;
    if (typeof id === 'string' && typeof handle.dispose === 'function') {
      lifecycleHandles.set(id, handle.dispose);
    }
    return handle;
  };
}
```

删除时优先调用这份 `dispose`，与「退出应用」完全同一套收尾。

### 2) 收尾必须有上限，并且要复核

- teardown 与 20 秒预算 `Promise.race`：卡住的回合不会让请求永远挂着；
- teardown 返回后再轮询 `ctx.agents` / `ctx.sessions`，确认两个注册表都放手；
- 没捕获到句柄（插件加载前就建好的 Agent）才退化为 scope 释放，并且**宁可报错也不删**还可能在写的文件。

### 3) 删文件不再「乐观成功」

`locate()` 定位 + 校验（目录名 == session id、位于会话根内）→ 删目录（`EBUSY/EPERM` 重试一次）
→ `stat` 复核目录确实不存在 → 才发 `api-session/removed` 并清理工作区记账。

### 4) 客户端不再替主机做判断

- 去掉主机端的 `current: true` 拒绝：需要「先切走」是页面的事，不该让一个过期的客户端把请求打死；
- 删除当前对话：先执行「新建会话」，等 `retainedBy.mainView` 归零再请求；
- 删除失败自动切回原对话，不把人扔在空白会话里；
- `session/not-found` 当成功处理；`notified: false` 时主动拉一次会话基线。

### 5) 可观测

新增只读诊断 `GET /dsh-session-delete/inspect?sessionId=`，直接看：
`stored` / `live` / `captured` / `handles`（还开着的写句柄）/ `directory` / `workspace`。
`/health` 另外回报 `capture` 三项是否安装成功。

## 验证

主机逻辑用假 ctx 跑了真实路由代码（`tests/route.test.mjs`，六个场景）：

| 场景 | 期望 | 结果 |
|---|---|---|
| 有捕获句柄的 live 会话 | 200，目录删除，发出 `api-session/removed` + 记账 detach | ✅ |
| 无捕获句柄的 live 会话 | 409 `release-timeout`，**目录保留** | ✅ |
| `dryRun` 未带 force | 409 `session/busy`，不删 | ✅ |
| 不存在的会话 | 404 `session/not-found` | ✅ |
| `inspect` | 200，`build=6`、`capture` 全 true | ✅ |
| teardown 永不返回 | 按预算 409，目录保留，请求不悬挂 | ✅ |

端到端（真机）：`health.build=6` 且 `capture` 全 true 后，打开两个对话，删其中一个 →
行与目录同时消失；停在某个对话上删它 → 页面切到新的空白对话、该会话的行与目录消失。

## 已知边界

- 插件加载**之前**就已在内存里的 Agent 没有被捕获到句柄（例如配置里声明的 agent）：会明确报
  `session/release-timeout` 并保留数据，重启 DSH 后再删即可。
- 只删目标会话本身，不级联删除它的子代理（subagent）会话日志。
- 故意删除正在跑回合的当前对话会终止那个回合——这是该功能的设计（确认框写「删除并新建对话」）。
