// 生成图鉴缩略图：assets/{cards,characters,equipment} → 同目录 .thumbs/<名>.jpg
// 用法：node scripts/make-thumbs.mjs [--width 320] [--quality 78]
// 素材大图不入 git（.gitignore），缩略图同属 assets/ 也不入库；重建 = prepare-assets 后跑本脚本。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const widthOf = (names, fallback) => {
  const i = names.indexOf('--width');
  const w = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(w) && w > 0 ? w : fallback;
};
const qualityOf = (fallback) => {
  const i = args.indexOf('--quality');
  const q = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(q) && q > 0 && q <= 100 ? q : fallback;
};
const WIDTH = widthOf(['--width'], 320);
const QUALITY = qualityOf(78);

const DIRS = [
  { dir: path.join(root, 'assets', 'cards'), recursive: false },
  { dir: path.join(root, 'assets', 'characters'), recursive: true },
  { dir: path.join(root, 'assets', 'equipment'), recursive: false },
];

let made = 0;
let skipped = 0;
for (const { dir, recursive } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  const files = listImages(dir, recursive);
  for (const file of files) {
    const rel = path.relative(dir, file);
    const out = path.join(dir, '.thumbs', rel.replace(/\.png$/i, '.jpg'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const before = fs.statSync(file).size;
    await sharp(file).resize({ width: WIDTH, withoutEnlargement: true }).jpeg({ quality: QUALITY }).toFile(out);
    made += 1;
    skipped += 0;
    if (process.env.THUMB_VERBOSE) {
      console.log(`${rel}: ${(before / 1024).toFixed(0)}KB → ${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
    }
  }
}
console.log(`thumbs: ${made} generated (width=${WIDTH}, quality=${QUALITY})`);

function listImages(dir, recursive) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.thumbs') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...listImages(full, recursive));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(full);
  }
  return out;
}
