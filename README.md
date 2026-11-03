# dsh-toolkit

两个 DeepSeek Harness 新功能，装好之后 DSH 就多两项能力：

| 能力 | 你能得到什么 | 类型 |
| --- | --- | --- |
| **[删除会话](#一删除会话)** | 侧栏会话行的「⋯」菜单多两项红色入口：**删除会话**（单个）与**批量删除会话…**（勾选多个一次删），确认后真正删掉会话日志、工作区记账与归档/置顶标记 | 插件（bundle）+ 安装它的 skill |
| **[重启 DeepSeek Harness](#二托盘重启)** | 托盘右键菜单多一项**重启 DeepSeek Harness** | 改动安装目录 `app.asar` 的补丁脚本 + 运行它的 skill |

> 有人会问：为什么不能只用一个 skill？
>
> **skill 本身不执行任何东西**——它是写给模型看的 Markdown 说明书（`SKILL.md`），不能注册菜单、不能改界面。所以要「别人装上 skill，DSH 就多出这两个功能」，实际形态是：
> **skill 负责「让模型知道怎么做、并带上安装文件」，安装动作由模型按说明书在你的机器上执行。**
> 本仓库就是这样组织的：每个 skill 目录里既有 `SKILL.md`，也有它要安装的插件/补丁文件。

支持环境：**Windows**（托盘重启是 Windows 专属；删除会话插件本身与平台无关），DeepSeek Harness **0.2.1-rc.2** 实测；其它版本见各章节的「版本不同怎么办」。

---

## 快速开始（两种方式）

### 方式 A：把 skill 交给 DSH，让模型自己装（推荐给普通用户）

1. 下载本仓库（`git clone` 或 GitHub 页面 → Code → Download ZIP）。
2. 把 `skills/` 下的两个目录复制到你的 skill 根目录：

   ```
   %USERPROFILE%\.dsh\skills\dsh-delete-session\
   %USERPROFILE%\.dsh\skills\dsh-tray-restart\
   ```

   最终应形如：

   ```   
   %USERPROFILE%\.dsh\skills\
   ├─ dsh-delete-session\
   │   ├─ SKILL.md
   │   └─ payload\dsh-session-delete\...
   └─ dsh-tray-restart\
       ├─ SKILL.md
       └─ payload\apply-restart-patch.mjs
   ```

3. 在 DSH 里新开一个会话，对它说一句：

   > 用 dsh-delete-session 这个 skill，帮我装上删除会话功能

   模型会读到 `SKILL.md`，按里面的步骤在你机器上安装，并在最后用 `curl` 自检给你看结果。
4. **刷新页面**（Ctrl+R）即可使用。

> skill 由文件系统 provider 扫描，**不需要重启**就会出现在模型目录里；但当前已打开的会话可能仍用旧目录，新开会话最稳妥。
> 若你的 DSH 里 skill 相关插件被关掉了，用模型装不了，请走方式 B。

### 方式 B：手动装（不依赖 skill）

* 删除会话：把 `skills/dsh-delete-session/payload/dsh-session-delete` 整个目录放到一个**固定位置**，然后在 DSH 的「插件」页安装这个目录的绝对路径。
* 托盘重启：完全退出 DSH，运行
  ```powershell
  node .\skills\dsh-tray-restart\payload\apply-restart-patch.mjs
  ```
  再打开 DSH。

---

## 一、删除会话

### 为什么需要它

DeepSeek Harness 的核心设计是「会话只归档、从不删除」（`dsh-client-ui-workspace` 与 `dsh-workspace` 的文档都明确写了这一点）。想真正清掉对话，此前只能自己上手删文件——而直接删文件会留下不一致：工作区记账里仍有这条会话、侧栏可能出现一个空的「未分组」。

本插件补上这个缺口。**没有一个对话是删不掉的**：包括你现在正看着的那个，也包括本次运行期间打开过的那些。

* 会话日志目录、工作区记账、归档/置顶标记**一起**清掉，不留悬空记录；
* **当前正在看的对话也能删**：确认框写「删除并新建对话」——客户端先切到一个新的空白对话、等页面放手旧会话，再让主机删；删除失败会自动切回原对话，不会把人扔在空白会话里；
* **打开过、仍被主机加载、或还有运行中的回合/后台任务/子代理/提醒的会话也能删**：主机先停掉这些工作，再用这个会话 Agent 的卸载句柄做一次与「退出应用」完全相同的收尾，确认两个注册表都放手后才动文件；
* 主机删除后**主动通知所有已连接的页面**，侧栏立刻消失，不会留下空的「未分组」分组。

### 用法

侧栏会话行 →「⋯」→ **删除会话** → 确认框显示会话标题与 ID 并提示不可撤销 → 点「删除」。

### 批量删除

同一个「⋯」菜单里还有 **批量删除会话…**（红色，右侧显示当前存储的会话总数），点开是一个可勾选的会话列表：

1. 列表按更新时间倒序，**含已归档会话**（标「已归档」），有运行中任务的标「运行中」；还没聊过的空白会话不列出；
2. 顶部搜索框按标题或会话 ID 过滤；「全选 / 取消全选」只作用于当前筛选结果；
3. 勾选后点「删除 N 个会话」，逐条执行并显示「正在删除 3 / 12…」，删掉的行走实时消失；
4. 有失败时不会静默：失败的会话保持勾选并列在下方（附主机返回的原因），按钮变成「重试失败项」，重试只重发失败的那几条。

两条规则：

* **当前正在看的对话不参与批量删除**：它在列表里显示但置灰、不可勾选——删它必须先让页面切到新对话，这条路径交给单项删除；
* 批量是**逐条**调用同一个主机删除接口（带 `force`）：某一条失败不影响其他条，`session/not-found` 当成功处理；中途关掉页面，只会让还没开始的那几条保留下来。

### 实现要点

* 单项菜单项注册在 `sidebar.workspaces.session.menu.item`（order 500，排在「复制 Session ID」之后），确认框注册在 `shell.overlay`（id `dsh-session-delete.dialog`）。
* 批量菜单项是同一个 slot 里的第二项（id `dsh-session-delete.batch`，order 510）；批量弹窗在 `shell.overlay`（id `dsh-session-delete.batch-dialog`），列表数据来自页面的 `useSessions` 会话存储与 `useWorkspaces` 的归档集合，和侧栏完全一致。
* 批量删除是**纯客户端**能力：浏览器逐条调用同一个 `POST /dsh-session-delete/delete`（带 `force`），主机半没有新增路由，因此「停工作 → 卸载 Agent → 删目录 → 清记账 → 通知页面」全部复用单项删除那套已经验过的流程。
* 「当前对话」由客户端读 `retainedBy.mainView` 判定：为真时先执行「新建会话」并等它归零，再请求主机；主机端**不再**检查 `current` 标记——「先切走」是页面的事，不该让一个过期的客户端把请求打死，所以手工调用 `/delete` 对任何会话都有效。
* 删除动作走插件自己的主机路由 `POST /dsh-session-delete/delete`：校验会话存在 → 询问运行中的工作 → 未带 `force` 且会话被加载/有工作则拒绝（`session/busy`，带工作清单）→ 带 `force` 时先停工作、再用捕获的卸载句柄卸载 Agent 并轮询注册表 → 用存储后端自己的 `locate()` 定位日志并校验目录名==会话 id 且位于会话根目录内 → 删目录（`EBUSY/EPERM` 重试一次）→ 复核目录确实不在 → `workspace.detachSession()` + 取消归档/置顶 → 发 `api-session/removed`。
* 「卸载 Agent」用的是 `agents.create()/resume()` 解析出的生命周期 `dispose` 句柄（插件加载时从 agent-loop 工厂的 `createAgent`/`resume`/`setupAndPublish` 捕获），与「退出应用」完全同一套收尾：取消当前回合 → 等 idle → 关闭持久化写句柄 → detach 两个注册表。**这一步才是删得掉已打开会话的关键**：只 dispose Agent 的 scope fiber 不会执行这套收尾（1.1.0 的 bug 就在这里）。收尾有 20 秒上限，超时报 `session/release-timeout` 且不删文件。
* 只用 Harness 公开接口，不改 `app.asar`；DSH 升级后依然可用。

### 安装

见 [方式 A](#方式-a把-skill-交给-dsh让模型自己装推荐给普通用户) 或：

```
「插件」页 → 安装 → 粘贴 payload 目录的绝对路径
```

也支持 tarball：`payload/dsh-session-delete-1.3.0.tgz`（装完原目录可删）。

⚠️ 本地目录安装是**链接**方式：装好后不要移动/删除那个目录，否则插件失效。

### 自检

端口在窗口地址里（如 `http://127.0.0.1:49712`）：

```bash
curl http://127.0.0.1:<端口>/dsh-session-delete/health
# {"ok":true,"plugin":"dsh-session-delete","build":6,
#  "capture":{"createAgent":true,"resume":true,"setupAndPublish":true}}

curl "http://127.0.0.1:<端口>/dsh-session-delete/inspect?sessionId=<会话ID>"
# 只读诊断：stored / live / captured / handles / directory / workspace
```

`build` 用来确认加载的是哪一版：**3** = 无 `force`；**4** = 有 `force`、但会误删当前对话；**5** = 有「当前对话」守卫、但删不掉已打开的会话；**6** = 真正卸载已打开的会话（1.2.0，`capture` 三项应全为 `true`）；**7** = 1.3.0（主机逻辑与 6 相同，仅作为「带批量删除的版本」标记）。

> 批量删除只改了浏览器端，所以主机侧 `build` 从 6 到 7 不改变任何删除行为。判断批量入口是否装上，直接看「⋯」菜单里有没有「批量删除会话…」；排查时也可以查实时 slot 注册：`sidebar.workspaces.session.menu.item` 里应有 id `dsh-session-delete.batch` 且 `active: true`。

`inspect` 里 `live` 说明会话还在内存、`captured` 说明拿到了卸载句柄、`handles` 列出还开着的写句柄——删除失败时先看这三个字段。

### 卸载

「插件」页移除，或让助手执行 `plugin_manager` 的 `remove_bundle`（名字 `dsh-session-delete`）。

---

## 二、托盘重启

### 为什么需要它

DSH 的托盘右键菜单只有「打开」和「退出」。改了插件、改了 `cordis.patch.yml` 之后往往需要重启，而「退出 + 重新双击图标」比「重启」麻烦得多。

补丁之后变成：

```
打开 DeepSeek Harness
──────────
重启 DeepSeek Harness
退出 DeepSeek Harness
```

「重启」复用「退出」的完整收尾流程（有正在运行/定时任务时先弹确认、不留孤儿进程），然后用同一命令行重新拉起。

### 为什么是一个脚本而不是一份改好的文件

托盘菜单写死在 Electron 主进程的 `lib/main.js` 里，而它在安装目录的 `resources\app.asar` 内部——**插件够不到**。不同版本的 `main.js` 内容不同，直接分发改好的文件在别的版本上会出问题。

所以本仓库提供的是**可移植补丁脚本**：读你机器上**自己那份** `main.js`，就地改 12 处，再写回归档。

```powershell
# 先完全退出 DeepSeek Harness
node .\skills\dsh-tray-restart\payload\apply-restart-patch.mjs --check     # 只看状态
node .\skills\dsh-tray-restart\payload\apply-restart-patch.mjs             # 打补丁
node .\skills\dsh-tray-restart\payload\apply-restart-patch.mjs --dry-run   # 只演练，不写盘
```

脚本会：自动定位安装目录（注册表卸载项 → 常见目录）→ 取 `lib/main.js` 并核对头部 SHA-256 → 在内存里应用 12 处改动（每处要求"全文件恰好匹配 1 次"）→ `node --check` 验证语法 → 备份原 `app.asar`（约 175 MB）→ 追加新 `main.js`、只改写头部那一个片段 → 重新读回校验（指针 / SHA-256 / 旧字节是否原样保留）。

**任何一步不符合预期都会中止且不改动归档**，所以版本不同不会把应用改坏，只会报「锚点匹配 N 次（应为 1）」。

### 原理

`app.asar` 的布局是 `[pickle][JSON header][data]`，header 里每个条目的 offset 相对 data 段。运行中的 Electron 会用文件锁占住归档，但可以**只追加、不移动**：把新的 `lib/main.js` 追加到文件末尾，再原地改写 header 里描述它的那一个片段（保持字段宽度不变，因此 header 长度不变，其余 16k+ 个条目的偏移全部不受影响）。运行中的进程缓存了旧 header，读到的仍是原来的字节；下次启动读新 header，加载的就是打好补丁的版本。

### 撤销与重打

* 撤销：把 `skills/dsh-tray-restart/payload/backup/app.asar.orig-<时间戳>` 复制回 `resources\app.asar`（应用必须完全退出）。
* 应用自动更新会整包替换 `app.asar`，菜单项随之消失——重跑一次脚本即可（幂等，已打过会直接跳过）。

---

## 仓库结构

```
dsh-toolkit/
├─ README.md
├─ LICENSE
├─ .gitignore
├─ skills/
│  ├─ dsh-delete-session/
│  │  ├─ SKILL.md                        ← 说明模型「怎么装、怎么验、怎么排查」
│  │  └─ payload/
│  │     └─ dsh-session-delete/          ← 插件本体（可直接安装）
│  │        ├─ index.js  client.js  package.json
│  │        ├─ cordis.patch.yml  icon.svg  locale/{zh,en}.json
│  └─ dsh-tray-restart/
│     ├─ SKILL.md
│     └─ payload/apply-restart-patch.mjs ← 可移植补丁脚本
├─ tests/
│  └─ route.test.mjs                    ← 假 ctx 跑真实删除路由（6 个场景）
└─ docs/
   ├─ delete-session-1.2.0.md           ← 「打开过的对话删不掉」的根因与修复
   ├─ delete-session-1.3.0.md           ← 1.3.0 批量删除：交互、逐条执行与验证
   ├─ tray-restart-changes.md            ← 12 处改动逐条说明（版本升级时照此重新推导）
   └─ verification.md                    ← 两个功能的验证记录与已知限制
```

## 兼容性与已知限制

* **删除会话**与平台无关；**托盘重启**仅 Windows（补丁锚点取自 Windows 版桌面应用）。
* 版本：`0.2.1-rc.2` 实测。删除会话插件只依赖公开服务，通常跨版本可用；托盘补丁锚点随 `main.js` 变化，脚本会拒绝不匹配的版本，升级后请先 `--check`。
* 删除会话**不支持撤销**（这就是"删除"的含义）；只想隐藏请用内置的「归档」。
* 批量删除时**当前正在看的对话不可勾选**（它需要先让页面切到新对话，请用单项删除）；空白新会话不出现在列表里。
* 批量删除逐条执行：单条收尾最长 20 秒，卡住的会话会让整批慢下来，但不会阻塞后面的条目；中途关掉页面只会让未开始的条目保留下来。
* 删除正在运行的会话会终止它当前那一轮（这就是删除的意思）；`inspect` 里 `captured: false` 的会话（插件加载前就已建好的 Agent）删不掉，重启 DSH 后再删即可。
* 补丁改的是安装目录里的文件，**不随应用升级保留**，需要重跑。


