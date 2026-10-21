#!/usr/bin/env node
/**
 * Add the "重启 DeepSeek Harness" tray entry to an installed DeepSeek Harness
 * desktop app.
 *
 * The tray menu is built inside `lib/main.js` in the install directory's
 * `resources/app.asar`, which no plugin can reach. This script is portable: it
 * reads the `lib/main.js` of the archive it is pointed at, applies the twelve
 * source edits, and only then writes the archive — so it works on any machine
 * whose DeepSeek Harness build matches these anchors, and safely refuses
 * (changing nothing) on one whose build does not.
 *
 * Why it does not replace the archive: Electron keeps `app.asar` open while it
 * runs, and its layout is [pickle][JSON header][data] where every offset is
 * relative to the data section. So it appends the patched `lib/main.js` at the
 * end and rewrites only that one header fragment, in place, at the same width.
 * A running app keeps its cached header (old bytes); the next launch reads the
 * new one.
 *
 * Usage:
 *   node apply-restart-patch.mjs                 # find the install automatically
 *   node apply-restart-patch.mjs --asar <path>   # explicit app.asar or install dir
 *   node apply-restart-patch.mjs --check         # report state, change nothing
 *   node apply-restart-patch.mjs --dry-run       # apply edits in memory, write nothing
 *   node apply-restart-patch.mjs --no-backup     # skip the 175 MiB archive backup
 *
 * Close the app before patching, then start it again to see the new tray item.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fdatasyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The twelve source edits, in file order; every `find` must occur exactly once. */
const EDITS = [
  {
    name: 'en locale: tray + confirm labels',
    find: '\tquitApplication: "Quit DeepSeek Harness",\n\topenApplication: "Open DeepSeek Harness",\n',
    replace:
      '\tquitApplication: "Quit DeepSeek Harness",\n\topenApplication: "Open DeepSeek Harness",\n\trestartApplicationMenu: "Restart DeepSeek Harness",\n',
  },
  {
    name: 'en locale: restart prompt title',
    find: '\tquitTitle: "Quit DeepSeek Harness?",\n',
    replace: '\tquitTitle: "Quit DeepSeek Harness?",\n\trestartTitle: "Restart DeepSeek Harness?",\n',
  },
  {
    name: 'zh locale: tray + confirm labels',
    find: '\topenApplication: "打开 DeepSeek Harness",\n',
    replace: '\topenApplication: "打开 DeepSeek Harness",\n\trestartApplicationMenu: "重启 DeepSeek Harness",\n',
  },
  {
    name: 'zh locale: restart prompt title',
    find: '\tquitTitle: "退出 DeepSeek Harness？",\n',
    replace: '\tquitTitle: "退出 DeepSeek Harness？",\n\trestartTitle: "重启 DeepSeek Harness？",\n',
  },
  {
    name: 'quit confirmation: accept a mode',
    find: '\t* @returns true to quit now, false when the user cancelled.\n\t*/\n\tconfirm() {\n',
    replace:
      '\t* @param mode - `quit` for the exit prompt, `restart` for the tray restart prompt whose copy names a restart.\n\t* @returns true to quit now, false when the user cancelled.\n\t*/\n\tconfirm(mode = "quit") {\n',
  },
  {
    name: 'quit confirmation: forward the mode',
    find: '\t\tconst pending = this.decide().finally(() => {\n',
    replace: '\t\tconst pending = this.decide(mode).finally(() => {\n',
  },
  {
    name: 'quit confirmation: decide(mode)',
    find: '\tasync decide() {\n',
    replace: '\tasync decide(mode = "quit") {\n',
  },
  {
    name: 'quit confirmation: restart flag',
    find:
      '\t\tconst { messages } = this.options.locale();\n\t\tconst windows = (this.options.platform ?? process.platform) === "win32";\n',
    replace:
      '\t\tconst { messages } = this.options.locale();\n\t\tconst windows = (this.options.platform ?? process.platform) === "win32";\n\t\tconst restart = mode === "restart";\n',
  },
  {
    name: 'quit confirmation: restart copy',
    find:
      '\t\t\tmessage: messages.quitTitle,\n\t\t\tdetail: messages[prompt],\n\t\t\tbuttons: [messages.quit, messages.cancel],\n',
    replace:
      '\t\t\tmessage: restart ? messages.restartTitle : messages.quitTitle,\n\t\t\tdetail: messages[prompt],\n\t\t\tbuttons: [restart ? messages.restartApplication : messages.quit, messages.cancel],\n',
  },
  {
    name: 'tray: restart menu item',
    find: '\t\t\t{ type: "separator" },\n\t\t\t{\n\t\t\t\tlabel: messages.quitApplication,\n',
    replace:
      '\t\t\t{ type: "separator" },\n\t\t\t{\n\t\t\t\tlabel: messages.restartApplicationMenu,\n\t\t\t\tclick: () => {\n\t\t\t\t\tthis.options.restart();\n\t\t\t\t}\n\t\t\t},\n\t\t\t{\n\t\t\t\tlabel: messages.quitApplication,\n',
  },
  {
    name: 'main: restartApplication()',
    find:
      '\tconst trayIconPath = development ? join(app.getAppPath(), "resources", "tray-windows.ico") : join(process.resourcesPath, "tray.ico");\n',
    replace:
      '\tconst trayIconPath = development ? join(app.getAppPath(), "resources", "tray-windows.ico") : join(process.resourcesPath, "tray.ico");\n' +
      '\tconst restartApplication = async () => {\n' +
      '\t\tif (quitting || shellInstallerOwnsQuit || sessionEnding) return;\n' +
      '\t\tif (!await quitConfirmation.confirm("restart")) return;\n' +
      '\t\tif (quitting || shellInstallerOwnsQuit) return;\n' +
      '\t\tapp.relaunch();\n' +
      '\t\tquitWithoutConfirmation();\n' +
      '\t};\n',
  },
  {
    name: 'main: hand the tray its restart callback',
    find:
      '\t\t\topen: () => {\n\t\t\t\tfocusPrimaryWindow();\n\t\t\t},\n\t\t\tquit: () => {\n\t\t\t\tapp.quit();\n\t\t\t}\n',
    replace:
      '\t\t\topen: () => {\n\t\t\t\tfocusPrimaryWindow();\n\t\t\t},\n\t\t\trestart: () => {\n\t\t\t\trestartApplication().catch((error) => {\n\t\t\t\t\tconsole.error(error);\n\t\t\t\t});\n\t\t\t},\n\t\t\tquit: () => {\n\t\t\t\tapp.quit();\n\t\t\t}\n',
  },
];

/** Identifiers the inserted code relies on; a build without them is not patchable this way. */
const REQUIRED_IDENTIFIERS = [
  'function quitWithoutConfirmation',
  'const quitConfirmation',
  'let sessionEnding',
  'let shellInstallerOwnsQuit',
  'var DesktopTray',
];

/** Marker proving an archive already carries the patch. */
const PATCH_MARKER = 'restartApplicationMenu';

/** The DeepSeek Harness version these edits were derived from. */
const PATCHED_VERSION = '0.2.1-rc.2';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * Decode Windows console output: `reg` writes in the console code page, which is
 * GBK on a Chinese system; prefer whichever of UTF-8 / GBK decodes cleanly.
 */
function decodeConsole(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    if (!gbk.includes('\uFFFD')) return gbk;
  } catch {
    /* no GBK support in this Node build */
  }
  return utf8;
}

/** Read the uninstall entry's InstallLocation / DisplayName for DeepSeek Harness. */
function registryInstall() {
  if (process.platform !== 'win32') return undefined;
  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  for (const key of keys) {
    const result = spawnSync('reg', ['query', key, '/s', '/f', 'DeepSeek Harness'], { stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.error !== undefined && result.error !== null) return undefined;
    if (result.status !== 0 || result.stdout === null) continue;
    const text = decodeConsole(result.stdout);
    const blocks = [];
    let current = {};
    for (const line of text.split(/\r?\n/)) {
      if (/^HKEY_/.test(line)) {
        if (Object.keys(current).length > 0) blocks.push(current);
        current = {};
        continue;
      }
      const field = line.match(/^\s{4}(\S+)\s+REG_\w+\s+(.*)$/);
      if (field !== null) current[field[1]] = field[2].trim();
    }
    if (Object.keys(current).length > 0) blocks.push(current);
    const hit = blocks.find((block) => /deepseek harness/i.test(block.DisplayName ?? ''));
    if (hit !== undefined) {
      return {
        displayName: hit.DisplayName,
        installLocation: hit.InstallLocation,
        uninstallString: hit.UninstallString,
      };
    }
  }
  return undefined;
}

/** Every place an install may keep resources/app.asar, given a registry hint. */
function rootsFromRegistry(hint) {
  if (hint === undefined) return [];
  const roots = [];
  const fromUninstaller = hint.uninstallString?.match(/^"([^"]+)"|^(\S+\.exe)/);
  for (const raw of [hint.installLocation, fromUninstaller?.[1] ?? fromUninstaller?.[2]]) {
    if (typeof raw !== 'string' || raw === '') continue;
    // The value may be the app directory itself, its parent, or the uninstaller's directory.
    const seeds = /\.exe$/i.test(raw) ? [dirname(raw)] : [raw, dirname(raw)];
    for (const seed of seeds) {
      roots.push(seed, join(seed, 'deepseek-harness'));
      // An installer may place the app one level down (…\<vendor>\<app>).
      try {
        for (const entry of readdirSync(seed, { withFileTypes: true })) {
          if (entry.isDirectory()) roots.push(join(seed, entry.name));
        }
      } catch {
        /* unreadable: the plain candidates still apply */
      }
    }
  }
  return roots;
}

/** Resolve the archive from an explicit path (file or install dir), the registry, or a candidate list. */
function resolveAsar(explicit) {
  const asarIn = (dir) => join(dir, 'resources', 'app.asar');
  if (explicit !== undefined) {
    const given = resolve(explicit);
    const candidates = [given, asarIn(given)];
    const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (found === undefined) fail(`--asar ${explicit} does not name an app.asar (tried ${candidates.join(', ')})`);
    return found;
  }
  const hint = registryInstall();
  if (hint?.displayName !== undefined) {
    const version = hint.displayName.replace(/^DeepSeek Harness\s*/i, '') || 'unknown';
    console.log(`installed: ${hint.displayName}`);
    if (version !== PATCHED_VERSION) {
      console.log(
        `! this patch was derived from DeepSeek Harness ${PATCHED_VERSION}; ${version} may anchor differently — the run will stop rather than guess.`,
      );
    }
  }
  const roots = [
    ...rootsFromRegistry(hint),
    ...[process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
      .filter((root) => typeof root === 'string' && root !== '')
      .flatMap((root) => [join(root, 'Programs', 'deepseek-harness'), join(root, 'deepseek-harness')]),
    join(HERE, '..', '..'),
  ];
  const found = roots.map(asarIn).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (found === undefined) {
    fail(
      'could not find app.asar automatically. Pass it explicitly, for example:\n' +
        '  node apply-restart-patch.mjs --asar "D:\\Download\\APP\\deepseek-harness\\resources\\app.asar"',
    );
  }
  return found;
}

/** Parse the asar header: returns the buffer, the JSON, and the data-section start. */
function readHeader(archive) {
  const headerStart = archive.subarray(0, 64).toString('latin1').indexOf('{"files"');
  if (headerStart !== 16) return undefined;
  const jsonLength = archive.readUInt32LE(headerStart - 4);
  const headerText = archive.subarray(headerStart, headerStart + jsonLength).toString('utf8');
  let header;
  try {
    header = JSON.parse(headerText);
  } catch {
    return undefined;
  }
  return { headerStart, jsonLength, headerText, header, dataStart: headerStart + jsonLength };
}

const asarPath = resolveAsar(value('--asar'));
console.log(`archive: ${asarPath}`);
const archive = readFileSync(asarPath);
const parsed = readHeader(archive);
if (parsed === undefined) fail('this file is not an Electron asar archive (or its header is unreadable)');
const { headerStart, headerText, header, dataStart } = parsed;

const entry = header?.files?.lib?.files?.['main.js'];
if (entry === undefined) fail('the archive has no lib/main.js entry; this build is not patchable this way');
const oldOffset = Number(entry.offset);
const oldSize = Number(entry.size);
const oldHash = entry.integrity?.hash;
if (!Number.isSafeInteger(oldOffset) || !Number.isSafeInteger(oldSize) || typeof oldHash !== 'string') {
  fail('the lib/main.js header entry is not in the expected shape');
}
const mainStart = dataStart + oldOffset;
const main = archive.subarray(mainStart, mainStart + oldSize).toString('utf8');
if (createHash('sha256').update(archive.subarray(mainStart, mainStart + oldSize)).digest('hex') !== oldHash) {
  fail('lib/main.js bytes do not match the header hash; refusing to touch a corrupt archive');
}

if (main.includes(PATCH_MARKER)) {
  console.log('✓ already patched: the tray restart entry is present');
  console.log(`  lib/main.js: offset ${oldOffset}, ${oldSize} bytes, sha256 ${oldHash.slice(0, 12)}…`);
  process.exit(flag('--check') ? 0 : 0);
}
if (flag('--check')) {
  console.log('✗ not patched: the tray restart entry is absent');
  process.exit(1);
}

// Everything below changes only memory until the archive write at the end.
const missing = REQUIRED_IDENTIFIERS.filter((needle) => !main.includes(needle));
if (missing.length > 0) {
  fail(
    `this build does not look like the build the patch targets; missing: ${missing.join(', ')}\n` +
      '  The edits are anchored on that build’s source text. Do not force it: re-derive the edits for this version.',
  );
}

let patched = main;
for (const edit of EDITS) {
  const occurrences = patched.split(edit.find).length - 1;
  if (occurrences !== 1) {
    fail(
      `edit "${edit.name}" matched ${occurrences} times (expected exactly 1).\n` +
        '  This DeepSeek Harness build differs from the one the patch was written for; nothing was changed.',
    );
  }
  patched = patched.replace(edit.find, edit.replace);
}
console.log(`✓ ${EDITS.length} edits applied in memory (+${Buffer.byteLength(patched) - Buffer.byteLength(main)} bytes)`);

const patchedBytes = Buffer.from(patched, 'utf8');
const newHash = createHash('sha256').update(patchedBytes).digest('hex');
const newOffset = archive.length - dataStart;

const outDir = join(HERE, 'out');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'main.js');
writeFileSync(outFile, patched);

// The desktop shell is an ES module, so the parse check needs a .mjs name.
const checkFile = join(outDir, 'main.check.mjs');
writeFileSync(checkFile, patched);
const syntax = spawnSync(process.execPath, ['--check', checkFile], { stdio: ['ignore', 'inherit', 'inherit'] });
rmSync(checkFile, { force: true });
if (syntax.error !== undefined && syntax.error !== null) {
  console.log(`! parse check skipped: ${syntax.error.message}`);
} else if (syntax.status !== 0) {
  fail('the patched lib/main.js does not parse (see the syntax error above); nothing was changed');
} else {
  console.log('✓ patched lib/main.js parses');
}
console.log(`✓ wrote ${outFile} (${patchedBytes.length} bytes, sha256 ${newHash.slice(0, 12)}…)`);

if (flag('--dry-run')) {
  console.log('\n--dry-run: archive untouched');
  process.exit(0);
}

const fragmentPattern = `"main.js":{"size":${oldSize},"offset":"${oldOffset}","integrity":{"algorithm":"SHA256","hash":"${oldHash}","blockSize":`;
if (!headerText.includes(fragmentPattern)) fail('the lib/main.js header fragment is not in the expected shape');
const oldFragmentStart = headerText.indexOf(fragmentPattern);
const oldFragmentEnd = headerText.indexOf('}}', oldFragmentStart) + 2;
const oldFragment = headerText.slice(oldFragmentStart, oldFragmentEnd);
const newFragment = oldFragment
  .replace(`"size":${oldSize}`, `"size":${patchedBytes.length}`)
  .replace(`"offset":"${oldOffset}"`, `"offset":"${newOffset}"`)
  .split(oldHash)
  .join(newHash);
if (Buffer.byteLength(oldFragment) !== Buffer.byteLength(newFragment)) {
  fail(
    'rewriting the header would change its width, which the in-place edit cannot do safely.\n' +
      `  old fragment ${Buffer.byteLength(oldFragment)} bytes, new ${Buffer.byteLength(newFragment)} bytes — patch this machine by hand instead.`,
  );
}

const backup = join(HERE, 'backup', `app.asar.orig-${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (flag('--no-backup')) {
  console.log('! --no-backup: no archive backup will be written');
} else {
  mkdirSync(dirname(backup), { recursive: true });
  copyFileSync(asarPath, backup);
  console.log(`✓ backup: ${backup} (${statSync(backup).size} bytes)`);
}

const fd = openSync(asarPath, 'r+');
try {
  // Append first: the new header must never point at bytes that are not on disk yet.
  let written = 0;
  while (written < patchedBytes.length) {
    const chunk = patchedBytes.subarray(written, Math.min(written + 4 * 1024 * 1024, patchedBytes.length));
    const count = writeSync(fd, chunk, 0, chunk.length, archive.length + written);
    if (count !== chunk.length) throw new Error(`short append at ${written}`);
    written += count;
  }
  fdatasyncSync(fd);
  writeSync(fd, Buffer.from(newFragment, 'utf8'), 0, Buffer.byteLength(newFragment), headerStart + Buffer.byteLength(headerText.slice(0, oldFragmentStart), 'utf8'));
  fdatasyncSync(fd);
} finally {
  closeSync(fd);
}

// Re-open from scratch and prove the result.
const after = readFileSync(asarPath);
const afterParsed = readHeader(after);
if (afterParsed === undefined) fail('the patched archive no longer parses; restore the backup');
const afterEntry = afterParsed.header.files.lib.files['main.js'];
const afterStart = afterParsed.dataStart + Number(afterEntry.offset);
const stored = after.subarray(afterStart, afterStart + Number(afterEntry.size));
console.log('\n--- verify ---');
console.log(`archive bytes: ${after.length} (expected ${archive.length + patchedBytes.length})`);
console.log(`pointer: offset ${afterEntry.offset}, size ${afterEntry.size}`);
console.log(`stored hash matches: ${createHash('sha256').update(stored).digest('hex') === newHash}`);
console.log(`tray restart label present: ${stored.toString('utf8').includes(PATCH_MARKER)}`);
console.log(
  `original lib/main.js bytes intact: ${after
    .subarray(mainStart, mainStart + oldSize)
    .equals(archive.subarray(mainStart, mainStart + oldSize))}`,
);
console.log('\n完成。启动 DeepSeek Harness，右键任务栏托盘图标即可看到「重启 DeepSeek Harness」。');
