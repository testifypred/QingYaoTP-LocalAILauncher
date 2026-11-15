// 前端自检夹具（ui-check）：造一个临时环境 + 一个「假但格式合法」的视觉增强包 zip。
// 用法：node ui-check-fixture.mjs <临时根目录>
// 产物：<root>\model\TestVision-9B-Q4_K_M.gguf、<root>\model\mmproj\TestVision-9B-mmproj-F16.gguf、
//       <root>\llama\（空安装目标）、<root>\packs\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip
// 只写临时目录，不碰仓库/发布包。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipStore } from '../../diag-zip.mjs';

const root = path.resolve(process.argv[2] || path.join(process.env.TEMP || 'C:/Temp', 'vp-ui-test'));
const out = {
  root,
  model: path.join(root, 'model'),
  llama: path.join(root, 'llama'),
  packs: path.join(root, 'packs'),
};
for (const d of [out.model, path.join(out.model, 'mmproj'), out.llama, out.packs]) {
  mkdirSync(d, { recursive: true });
}
// 假模型 + 假 mmproj：只为让 /api/vision/state 的 pairs >= 1（不加载、不启动）
writeFileSync(path.join(out.model, 'TestVision-9B-Q4_K_M.gguf'), 'fake-gguf-for-ui-check');
writeFileSync(path.join(out.model, 'mmproj', 'TestVision-9B-mmproj-F16.gguf'), 'fake-mmproj-for-ui-check');

const REQUIRED = ['llama-server.exe', 'llama-server-impl.dll', 'llama.dll', 'llama-common.dll', 'ggml.dll', 'ggml-base.dll', 'mtmd.dll', 'libomp.dll'];
const prefix = 'QingYaoTP-AILauncher-v1.6.0-vision-pack/';
const entries = [];
let bytes = 0;
for (const name of REQUIRED) {
  const data = Buffer.from('fake-sidecar-' + name + ' for ui-check only');
  bytes += data.length;
  entries.push({ name: prefix + 'llama/' + name, data });
}
const manifest = {
  format: 1,
  name: 'QingYaoTP AILauncher 视觉增强包（ui-check 假包）',
  version: '1.6.0',
  sidecar: 'b12144',
  createdAt: new Date().toISOString(),
  files: REQUIRED.length,
  bytes,
};
entries.unshift({ name: prefix + 'vision-pack.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
const zip = zipStore(entries);
const zipPath = path.join(out.packs, 'QingYaoTP-AILauncher-v1.6.0-vision-pack.zip');
writeFileSync(zipPath, zip);
console.log(JSON.stringify({ ...out, zipPath, zipBytes: zip.length, files: entries.length }));
