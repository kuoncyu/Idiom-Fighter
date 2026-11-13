#!/usr/bin/env node
// 成語戰機：發佈工具（在專案資料夾執行：node release.js）
//
// 做三件事：
//   1. 產生新版本號：日期＋英文字母。當天第一版 20261113a，第二版 20261113b……隔天從 a 重新開始。
//   2. 把版本號寫進 index.html 的 APP_VERSION 與 sw.js 的 VERSION（不用手動改）。
//   3. 掃描所有遊戲檔案，產生 version.json（每個檔案的雜湊值與大小）。
//      玩家端比對雜湊值，只會下載有變動的檔案。
//
// 用法：
//   node release.js            自動產生下一個版本號（沒有任何檔案變動時不會發佈）
//   node release.js --force    就算沒有變動也強制發佈新版本
//   node release.js 20261113c  指定版本號（必須比目前版本新）
//
// 發佈流程：改完遊戲 → node release.js → 把整個資料夾（含 version.json）一起上傳。

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = __dirname;
const FILES = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];   // 固定要納入的檔案
const DIRS = ['assets', 'music'];                                                      // 這些資料夾（含子資料夾，如 assets/bg、assets/music）全部納入
const SKIP = /(^|\/)(\.|Thumbs\.db$|desktop\.ini$)/;                                   // 略過隱藏檔與系統檔
const VER_RE = /^\d{8}[a-z]$/;

const read = f => fs.readFileSync(path.join(ROOT, f));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const fail = msg => { console.error('✗ ' + msg); process.exit(1); };

function walk(dir, out) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return;
    for (const name of fs.readdirSync(full)) {
        const rel = dir + '/' + name;
        if (SKIP.test(rel)) continue;
        const st = fs.statSync(path.join(ROOT, rel));
        if (st.isDirectory()) walk(rel, out); else out.push(rel);
    }
}

function stamp(file, re, version) {
    const text = read(file).toString('utf8');
    if (!re.test(text)) fail(`在 ${file} 找不到版本號欄位，無法寫入`);
    return text.replace(re, (_, pre) => `${pre}'${version}'`);
}
const INDEX_RE = /(const APP_VERSION = )'[^']*'/, SW_RE = /(const VERSION = )'[^']*'/;

function nextVersion(old) {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    if (!old || !VER_RE.test(old)) return today + 'a';
    const oldDate = old.slice(0, 8), letter = old[8];
    if (oldDate > today) fail(`目前版本 ${old} 的日期比今天（${today}）還晚，請檢查電腦日期，或用 node release.js <版本號> 指定`);
    if (oldDate < today) return today + 'a';
    if (letter === 'z') fail(`今天（${today}）已經發佈到 z，不能再增加了，請明天再發佈`);
    return today + String.fromCharCode(letter.charCodeAt(0) + 1);
}

// ---- 讀取舊版 version.json ----
let oldMan = null;
try { oldMan = JSON.parse(read('version.json').toString('utf8')); } catch (e) {}
const oldVersion = oldMan && oldMan.version;

// ---- 蒐集檔案 ----
const list = [...FILES];
DIRS.forEach(d => walk(d, list));
for (const f of FILES) if (!fs.existsSync(path.join(ROOT, f))) fail(`找不到必要檔案：${f}`);
const paths = [...new Set(list)].sort();

// ---- 決定版本號 ----
const args = process.argv.slice(2), force = args.includes('--force'), given = args.find(a => !a.startsWith('--'));
let version;
if (given) {
    if (!VER_RE.test(given)) fail(`版本號格式錯誤：${given}（要像 20261113a：8 位數日期＋1 個小寫英文字母）`);
    if (oldVersion && VER_RE.test(oldVersion) && given <= oldVersion) fail(`指定的版本 ${given} 不比目前版本 ${oldVersion} 新`);
    version = given;
} else version = nextVersion(oldVersion);

// ---- 沒有任何變動就不發佈 ----
if (oldMan && oldMan.files && !given && !force) {
    // index.html 內含版本號：先用「舊版本號」蓋上去再算雜湊，才能和舊清單比較出真正的內容差異
    const idxOld = Buffer.from(stamp('index.html', INDEX_RE, oldVersion), 'utf8');
    let changed = Object.keys(oldMan.files).length !== paths.length;
    for (const p of paths) {
        if (changed) break;
        const h = p === 'index.html' ? sha(idxOld) : sha(read(p));
        if (!oldMan.files[p] || oldMan.files[p][0] !== h) changed = true;
    }
    if (!changed) { console.log(`沒有檔案變動，維持版本 ${oldVersion}，不需要發佈。（要強制發佈請加 --force）`); process.exit(0); }
}

// ---- 寫入版本號 ----
fs.writeFileSync(path.join(ROOT, 'index.html'), stamp('index.html', INDEX_RE, version));
if (fs.existsSync(path.join(ROOT, 'sw.js'))) fs.writeFileSync(path.join(ROOT, 'sw.js'), stamp('sw.js', SW_RE, version));

// ---- 產生 version.json ----
const files = {};
for (const p of paths) { const b = read(p); files[p] = [sha(b), b.length]; }
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ version, built: new Date().toISOString(), files }, null, 1) + '\n');

// ---- 摘要 ----
const oldFiles = (oldMan && oldMan.files) || {};
const added = paths.filter(p => !oldFiles[p]), removed = Object.keys(oldFiles).filter(p => !files[p]);
const changed = paths.filter(p => oldFiles[p] && oldFiles[p][0] !== files[p][0]);
const mb = n => (n / 1048576).toFixed(2) + ' MB';
const dl = [...added, ...changed].reduce((s, p) => s + files[p][1], 0);
console.log(`✓ 已發佈版本 ${version}${oldVersion ? `（上一版 ${oldVersion}）` : ''}`);
console.log(`  共 ${paths.length} 個檔案｜新增 ${added.length}・變動 ${changed.length}・刪除 ${removed.length}｜玩家更新時只需下載約 ${mb(dl)}`);
[...added.map(p => '  ＋ ' + p), ...changed.map(p => '  ～ ' + p), ...removed.map(p => '  － ' + p)].slice(0, 30).forEach(l => console.log(l));
console.log('→ 請把整個資料夾（含 version.json）上傳。');
