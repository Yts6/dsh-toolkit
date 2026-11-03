# 验证记录与已知限制

记录本仓库两个功能在开发机上的实测结果，以及**没有**验证到的部分。写清楚是为了让后来的人知道哪里可以信、哪里要自己再试一次。

## 删除会话

**已实测（Windows，DSH 0.2.1-rc.2）**

| 项 | 结果 |
|---|---|
| 主机路由存活 | `GET /dsh-session-delete/health` → `{"ok":true,…,"build":7}` |
| 非法会话 id | `session/invalid-id`（拒绝，未触碰磁盘） |
| 不存在的会话 | `session/not-found` |
| 真实删除 | 删除后日志目录从磁盘消失，返回回执含 `directory` / `revision` |
| 忙碌拒绝 | 打开的会话不带 `force` → `409 session/busy`，带 `forceable: true` 与工作清单，**文件保持完好** |
| 强制删除（已打开） | 带 `force` → 先 `agent.ctx.fiber.dispose()` 卸载 Agent，再删目录，返回 `ok` |
| 工作区记账 | 属于某工作区的会话删除后，`tables.workspaces[*].sessionIds` 中对应条目消失 |
| 归档/置顶 | 清理调用成功（`unarchiveSession` / `unpinSession`），无残留 |
| 对账 | 删除后「磁盘会话目录数」与「记账会话数」一致，无悬空条目 |
| 页面同步 | 删除后发 `api-session/removed`，侧栏不再残留空的「未分组」 |

强制删除路径用假 Host 上下文做了自动化验证（`_work/test-force.mjs` 的等价逻辑）：无 `force` → 409 且文件保留；带 `force` → `agent.ctx.fiber.dispose()` 被调用 → 目录删除 → 发出 `api-session/removed`。

**未验证 / 限制**

* 浏览器里的视觉呈现与「删除后回到空白会话」的观感由用户目视确认；开发机无法截图验证。
* 只在一个 profile 上验证过；多 profile 并发未测。
* 删除是不可逆的；插件刻意不提供撤销。
* 卸载 Agent 后的收尾有 20 秒上限：若有未结束的轮次超过它，请求以 `session/release-timeout` 失败且不删文件。
* 若删除后 `notified: false`，说明通知没发出去——页面刷新即可恢复一致。

### 1.3.0 批量删除

**已实测**

| 项 | 结果 |
|---|---|
| 实时 slot 注册 | `sidebar.workspaces.session.menu.item` 出现 `dsh-session-delete.batch`（order 510，`active: true`）；`shell.overlay` 出现 `dsh-session-delete.batch-dialog`；各自只有一份，无重复注册 |
| 列表与勾选 | 渲染级自动化：空白会话不列出、归档行有标签、当前对话的勾选框 disabled、全选跳过当前对话 |
| 逐条删除 | 渲染级自动化：请求顺序与请求体 `{ sessionId, force: true }` 正确；删完弹窗关闭 |
| 部分失败 | 渲染级自动化：失败原因显示、失败项保持勾选、「重试失败项」只重发失败项，成功后关闭 |
| 搜索与空态 | 渲染级自动化：标题过滤生效；空列表/无匹配有说明，确认按钮 disabled |
| 单项回归 | 渲染级自动化：1.2.0 的菜单文案、当前对话流程、错误与中止路径全部保持通过 |
| 主机路由 | 对两个真实会话各跑一次 `POST /delete` + `dryRun`：返回目录与 revision 正确，未触碰数据 |
| 版本标记 | `health.build` 从 6 提到 7（主机删除逻辑不变，仅标记「带批量删除的发布」） |

**未验证 / 限制**

* 浏览器里的视觉观感（列表滚动、弹窗高度）由用户目视确认；没有截图验证。
* 没有对几十个会话跑完整批量耗时测试；已知单条收尾上限 20 秒。
* 批量是浏览器逐条调用主机接口：中途关掉页面，未开始删除的条目会保留。

## 托盘重启

**已实测（Windows，DSH 0.2.1-rc.2）**

| 项 | 结果 |
|---|---|
| 可移植脚本 | 在**未打补丁的原始归档副本**上跑全流程，产出的 `lib/main.js` 与开发机上已打补丁的版本**逐字节一致**（517 645 字节，sha256 `79af197f3ee9…`） |
| 幂等 | 对已打补丁的归档再跑 → 识别为 `already patched` 直接跳过 |
| `--check` | 已打 → 退出码 0；未打 → 退出码 1 |
| 归档校验 | 指针、SHA-256、旧字节完整性、`restartApplicationMenu` 标记全部通过 |
| 自动定位 | 能从注册表卸载项找到自定义安装目录（如 `D:\Download\APP`），并打印版本号 |
| 语法 | 改后的 `lib/main.js` 通过 `node --check` |
| 托盘菜单渲染 | 开发机上打过补丁后可在托盘看到「重启」，点击能完成重启 |

**未验证 / 限制**

* 仅在 Windows + `0.2.1-rc.2` 验证；其它版本锚点可能不同（脚本会拒绝而不是改坏）。
* 应用自动更新会整包替换 `app.asar`，补丁丢失需重跑。
* 打补丁要求应用完全退出。
* 备份约 175 MB。
