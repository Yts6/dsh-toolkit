# 托盘「重启 DeepSeek Harness」的 12 处改动

补丁脚本 `skills/dsh-tray-restart/payload/apply-restart-patch.mjs` 把下面 12 处改动应用到宿主机**自己那份** `resources/app.asar` 内的 `lib/main.js`。每处都以源码片段为锚点，要求「全文件恰好匹配 1 次」，否则整体中止。

本表基于 DeepSeek Harness **0.2.1-rc.2**（Windows 桌面版）。**升级后若脚本报锚点不匹配，就照这张表在新版本上重新定位、重新推导。**

## 改动清单

| # | 位置 | 原片段（锚点） | 改成 |
|---|---|---|---|
| 1 | `en` 文案表 | `quitApplication: "Quit DeepSeek Harness",\n openApplication: "Open DeepSeek Harness",` | 其后加 `restartApplicationMenu: "Restart DeepSeek Harness",` |
| 2 | `en` 文案表 | `quitTitle: "Quit DeepSeek Harness?",` | 其后加 `restartTitle: "Restart DeepSeek Harness?",` |
| 3 | `zh` 文案表 | `openApplication: "打开 DeepSeek Harness",` | 其后加 `restartApplicationMenu: "重启 DeepSeek Harness",` |
| 4 | `zh` 文案表 | `quitTitle: "退出 DeepSeek Harness？",` | 其后加 `restartTitle: "重启 DeepSeek Harness？",` |
| 5 | 退出确认类 | `*/ confirm() {`（前面那行 JSDoc 是 `@returns true to quit now…`） | `confirm(mode = "quit") {`，并补一行 `@param mode` |
| 6 | 退出确认类 | `const pending = this.decide().finally(() => {` | `this.decide(mode)` |
| 7 | 退出确认类 | `async decide() {` | `async decide(mode = "quit") {` |
| 8 | 退出确认类 | `const windows = (this.options.platform ?? process.platform) === "win32";` | 其后加 `const restart = mode === "restart";` |
| 9 | 退出确认类 | `message: messages.quitTitle,` / `buttons: [messages.quit, messages.cancel],` | `message: restart ? messages.restartTitle : messages.quitTitle,` / `buttons: [restart ? messages.restartApplication : messages.quit, messages.cancel],` |
| 10 | `DesktopTray` 的菜单模板 | `{ type: "separator" },\n{\n  label: messages.quitApplication,` | 在「退出」项之前插入「重启」项，`click: () => this.options.restart()` |
| 11 | `main()` | `const trayIconPath = …` | 其后新增 `restartApplication`：`quitConfirmation.confirm("restart")` → `app.relaunch()` → `quitWithoutConfirmation()` |
| 12 | `new DesktopTray({…})` | `open: () => { focusPrimaryWindow(); },` 之后是 `quit: …` | 中间加 `restart: () => { restartApplication().catch(console.error) }` |

## 为什么这样打补丁是安全的

* **不改动既有字节**：新的 `lib/main.js` 追加到归档末尾；只改写头部里描述它的那一个 JSON 片段（`size` / `offset` / `integrity.hash`），三者宽度不变，所以头部长度不变，其余 16 000+ 个条目的偏移全部不受影响。
* **旧字节仍在**：原来的 `main.js` 留在旧偏移处，可随时回滚（脚本还会另外备份整份归档）。
* **先校验后写入**：改完先 `node --check` 验语法，再写盘；写盘后重新读回比对 SHA-256 与旧字节完整性。
* **可重复执行**：靠 `restartApplicationMenu` 标记判断是否已打过，幂等。

## 版本升级时怎么重新推导

1. 在旧版本上跑一次脚本，`payload/out/main.js` 得到改好的文件。
2. 从一个**未打补丁**的同版本归档里取出原始 `lib/main.js`。
3. `diff -u 原始 改后` → 得到与上表一致的 12 个 hunk。
4. 在新版本的原始 `lib/main.js` 上逐条定位同样的语义位置，重写脚本里的 `EDITS` 数组（保持「每处唯一匹配」）。
5. 用 `--dry-run` 在**归档副本**上验证：语法通过、结果合理，再对真实安装下手。

> 绝不要把某个版本改好的 `main.js` 直接发出去覆盖别的版本——那会让应用起不来。
