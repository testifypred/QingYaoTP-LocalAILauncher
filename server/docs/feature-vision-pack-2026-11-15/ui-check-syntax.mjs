// 前端自检：把 app.html 里的内联 <script> 块抽出来写临时 .js，再逐个 node --check。
// 用法：node server\docs\feature-vision-pack-2026-11-15\ui-check-syntax.mjs
// 两个 <script>（头部小脚本 + 主体脚本）都必须过；任一失败 exit 1。
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const APP = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..', 'app.html'));
const html = readFileSync(APP, 'utf8');
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const blocks = [];
let m;
while ((m = re.exec(html))) {
  if (/\bsrc\s*=/i.test(m[1] || '')) continue; // 外链脚本不内联
  blocks.push({ start: html.slice(0, m.index).split('\n').length, code: m[2] });
}
const tmp = mkdtempSync(path.join(tmpdir(), 'vp-syntax-'));
let bad = 0;
try {
  blocks.forEach((b, i) => {
    const file = path.join(tmp, 'script-' + (i + 1) + '.js');
    writeFileSync(file, b.code, 'utf8');
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    const ok = r.status === 0;
    if (!ok) bad += 1;
    console.log((ok ? 'PASS' : 'FAIL') + ' inline script #' + (i + 1) + ' (line ' + b.start + ', ' + b.code.split('\n').length + ' lines)' + (ok ? '' : '\n' + r.stderr.trim()));
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(bad ? 'RESULT: ' + bad + ' / ' + blocks.length + ' script block(s) failed' : 'RESULT: ' + blocks.length + ' / ' + blocks.length + ' script blocks pass node --check');
process.exit(bad ? 1 : 0);
