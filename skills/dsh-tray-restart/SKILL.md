---
name: dsh-tray-restart
description: 为 Windows 版 DeepSeek Harness 的托盘右键菜单增加「重启 DeepSeek Harness」，并在用户机器上就地给 resources/app.asar 打补丁（可移植脚本，自动校验版本锚点、可备份可回滚）。当用户嫌每次改插件后都要退出再手动打开、想要一键重启、或要安装 dsh-toolkit 里的托盘重启功能时使用。
whenToUse: 用户要求「重启 DSH」「加个重启按钮」「改完插件要重启太麻烦」；或用户要安装 dsh-tray-restart / dsh-toolkit 的托盘部分。
metadata:
  version: "1.0.0"
  upstream: "https://github.com/<owner>/dsh-toolkit"
  platform: windows
---

# 给 DSH 的托盘菜单加「重启 DeepSeek Harness」

DSH 的托盘右键菜单只有「打开」「退出」。这个功能加一项「重启」，复用退出的完整收尾再自动拉起。

**关键前提：** 托盘菜单写死在 Electron 主进程的 `lib/main.js` 里，它在安装目录的 `resources\app.asar` 内部，**插件够不到**，只能用补丁脚本改归档。

---

## 0. 先判断该不该做

* 只支持 **Windows**。其它平台停在这里，告诉用户不适用。
* 需要能运行 **Node.js**（≥18）。没有的话用 DSH 自带的那个：
  ```
  <安装目录>\resources\runtime\primary-runtime\dependencies\node\bin\node.exe
  %USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
  ```
* **应用必须完全退出**才能打补丁（运行中归档被锁住）。先让用户确认托盘里没有 DSH 在跑。

## 1. 只读体检（不要先动手改）

```powershell
node <本 SKILL.md 所在目录>\payload\apply-restart-patch.mjs --check
```

退出码含义：`0` = 已经打过补丁（什么都不用做，告诉用户去托盘看菜单）；`1` = 还没打，继续第 2 步。

脚本会自己找安装目录（注册表卸载项的 `InstallLocation` / `UninstallString`，再试常见目录），并打印它读到的版本号。
**如果它报告「锚点匹配 N 次（应为 1）」或「missing: …」，说明用户版本与本补丁针对的版本（0.2.1-rc.2）不同**：停止，把两边的版本号告诉用户，说明需要针对该版本重新推导补丁，不要强行套用。

## 2. 打补丁

让用户先退出 DSH，然后：

```powershell
node <本 SKILL.md 所在目录>\payload\apply-restart-patch.mjs
```

想先演练（不写盘）：加 `--dry-run`。想跳过备份（不建议）：`--no-backup`。
找不到安装目录时显式指定（可给 `app.asar` 本身、`resources` 目录或安装根目录）：

```powershell
node ...\apply-restart-patch.mjs --asar "D:\Download\APP\deepseek-harness"
```

**成功时输出里的这几行必须都是 true / ok：**

```
✓ 12 edits applied in memory (+929 bytes)
✓ patched lib/main.js parses
✓ backup: ...\backup\app.asar.orig-<时间戳>
--- verify ---
stored hash matches: true
tray restart label present: true
original lib/main.js bytes intact: true
```

任何一步报错都是**中止且归档未被改动**（脚本会自己说明原因），如实转告用户即可，不要绕过检查手改归档。

## 3. 验证

让用户重新打开 DSH，右键托盘图标，菜单里应出现「重启 DeepSeek Harness」。
点它会：有正在运行/定时任务时先弹一次确认 → 走退出收尾 → 自动重新启动。

**你（模型）无法看到托盘菜单**，所以这一步只能由用户确认；如实说明"已打补丁、待用户目视确认"。

## 4. 后续维护

* 应用自动更新会整包替换 `app.asar`，菜单项消失是正常现象：重跑一次脚本即可（幂等）。
* 撤销：把 `payload\backup\app.asar.orig-<时间戳>` 复制回 `resources\app.asar`（应用必须完全退出）。
* 版本升级后补丁失效：按仓库 `docs/tray-restart-changes.md` 里的 12 处改动逐条重新定位。

## 5. 不要做的事

* 不要在应用运行时打补丁（文件被锁，脚本会失败）。
* 不要手工编辑 `app.asar` 或从别处下载"改好的 main.js"覆盖——版本不同会直接让应用起不来。
* 不要把补丁结果当成永久：升级会覆盖，需要重打。
* 不要在没有备份的情况下加 `--no-backup` 去试不同版本的锚点。

---

## 附：12 处改动的概览（细节见 docs/tray-restart-changes.md）

| # | 位置 | 改动 |
|---|---|---|
| 1–2 | `en` 文案表 | 新增 `restartApplicationMenu` / `restartTitle` |
| 3–4 | `zh` 文案表 | 同上（中文） |
| 5 | 退出确认类 | `confirm()` → `confirm(mode = "quit")` |
| 6 | 退出确认类 | `this.decide()` → `this.decide(mode)` |
| 7 | 退出确认类 | `async decide()` → `async decide(mode = "quit")` |
| 8 | 退出确认类 | 新增 `const restart = mode === "restart";` |
| 9 | 退出确认类 | 弹窗标题/主按钮按 mode 切换 |
| 10 | `DesktopTray` 模板 | 「退出」前插入「重启」项 |
| 11 | `main()` | 新增 `restartApplication()`：确认 → `app.relaunch()` → `quitWithoutConfirmation()` |
| 12 | `new DesktopTray({...})` | 传入 `restart` 回调 |
