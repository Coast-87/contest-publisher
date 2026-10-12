#!/usr/bin/env node
// 从 assets/icon-1024.png 生成 assets/icon.ico（Windows 可执行文件图标）。
// 不依赖 ImageMagick：多尺寸用 macOS 的 sips 栅格化，ICO 容器按规范手工拼（Vista 起允许每项直接放 PNG）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets', 'icon-1024.png');
const TARGET = path.join(ROOT, 'assets', 'icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

function resize(source, size, dest) {
  try {
    execFileSync('sips', ['-z', String(size), String(size), source, '--out', dest], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base);      // 宽（0 表示 256）
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);  // 高
    directory.writeUInt8(0, base + 2);                                   // 调色板数
    directory.writeUInt8(0, base + 3);                                   // reserved
    directory.writeUInt16LE(1, base + 4);                                // color planes
    directory.writeUInt16LE(32, base + 6);                               // bits per pixel
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, directory, ...entries.map(entry => entry.data)]);
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`缺少 ${path.relative(ROOT, SOURCE)}（请先把 assets/icon.svg 渲染成 1024×1024 PNG）`);
    process.exit(1);
  }
  const stage = mkdtempSync(path.join(os.tmpdir(), 'contest-publisher-ico-'));
  try {
    const entries = [];
    for (const size of SIZES) {
      const file = path.join(stage, `${size}.png`);
      if (resize(SOURCE, size, file) && existsSync(file)) entries.push({ size, data: readFileSync(file) });
    }
    if (!entries.length) {
      // 没有 sips（非 macOS）时至少放进原始尺寸，Windows 会自行缩放。
      entries.push({ size: 256, data: readFileSync(SOURCE) });
    }
    writeFileSync(TARGET, packIco(entries));
    console.log(`已生成 ${path.relative(ROOT, TARGET)}（${entries.map(entry => entry.size).join('/')}，${statSync(TARGET).size} 字节）`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

main();
