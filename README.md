# dsh-toolkit

两个 DeepSeek Harness 新功能，装好之后 DSH 就多两项能力：

| 能力 | 你能得到什么 | 类型 |
| --- | --- | --- |
| **[删除会话](#一删除会话)** | 侧栏会话行的「⋯」菜单多一项红色**删除会话**，确认后真正删掉会话日志、工作区记账与归档/置顶标记 | 插件（bundle）+ 安装它的 skill |
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

本插件补上这个缺口，规则只有一条：**当前正在使用的那个对话不能删，其他都能删**。

* 会话日志目录、工作区记账、归档/置顶标记**一起**清掉，不留悬空记录；
* **当前对话的菜单项置灰禁用**（文案「删除会话（当前对话不可删）」，悬停说明原因），切到别的对话即可删它；
* **除当前对话外都能删**：即使它曾被打开过、仍被主机加载着，或还有运行中的回合/后台任务/子代理/提醒——插件会先停止这些工作、再卸载 Agent，然后删文件；
* 主机删除后**主动通知所有已连接的页面**，侧栏立刻消失，不会留下空的「未分组」分组。

### 用法

侧栏会话行 →「⋯」→ **删除会话** → 确认框显示会话标题与 ID 并提示不可撤销 → 点「删除」。

### 实现要点

* 菜单项注册在 `sidebar.workspaces.session.menu.item`（order 500，排在「复制 Session ID」之后），确认框注册在 `shell.overlay`。
* 「当前对话」由 `useSessions` 读 `retainedBy.mainView` 判定：为真时菜单项置灰，且请求体带上 `current: true`；主机端**优先**检查该标记并拒绝（`session/current`），所以过期页面或手工调用也绕不过这条规则。
* 删除动作走插件自己的主机路由 `POST /dsh-session-delete/delete`：`current` 检查 → 校验会话存在 → 询问运行中的工作 → 未带 `force` 且会话被加载/有工作则拒绝（`session/busy`，带工作清单）→ 带 `force` 时先停工作、再卸载 Agent → 用存储后端自己的 `locate()` 定位日志并校验目录名==会话 id 且位于会话根目录内 → 删目录 → `workspace.detachSession()` + 取消归档/置顶 → 发 `api-session/removed`。
* 「卸载 Agent」复用的是应用退出时的同一套收尾：取消当前回合 → 等 idle → 关闭持久化写句柄 → detach，因此被删会话不会留下半写入的日志。
* 只用 Harness 公开接口，不改 `app.asar`；DSH 升级后依然可用。

### 安装

见 [方式 A](#方式-a把-skill-交给-dsh让模型自己装推荐给普通用户) 或：

```
「插件」页 → 安装 → 粘贴 payload 目录的绝对路径
```

也支持 tarball：`payload/dsh-session-delete-1.0.0.tgz`（装完原目录可删）。

⚠️ 本地目录安装是**链接**方式：装好后不要移动/删除那个目录，否则插件失效。

### 自检

端口在窗口地址里（如 `http://127.0.0.1:49712`）：

```bash
curl http://127.0.0.1:<端口>/dsh-session-delete/health
# {"ok":true,"plugin":"dsh-session-delete","build":5}
```

`build` 用来确认加载的是哪一版：**3** = 无 `force`；**4** = 有 `force`、但会误删当前对话；**5** = 有「当前对话」守卫（本版）。

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
└─ docs/
   ├─ tray-restart-changes.md            ← 12 处改动逐条说明（版本升级时照此重新推导）
   └─ verification.md                    ← 两个功能的验证记录与已知限制
```

## 兼容性与已知限制

* **删除会话**与平台无关；**托盘重启**仅 Windows（补丁锚点取自 Windows 版桌面应用）。
* 版本：`0.2.1-rc.2` 实测。删除会话插件只依赖公开服务，通常跨版本可用；托盘补丁锚点随 `main.js` 变化，脚本会拒绝不匹配的版本，升级后请先 `--check`。
* 删除会话**不支持撤销**（这就是"删除"的含义）；只想隐藏请用内置的「归档」。
* 正在打开或正在运行的会话不能删除——先切到别的会话再删。
* 补丁改的是安装目录里的文件，**不随应用升级保留**，需要重跑。


