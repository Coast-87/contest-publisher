#!/usr/bin/env node
// 给 bun 交叉编译出来的 Windows exe 就地打上图标与版本信息。
//
// 背景：bun 只在「在 Windows 上编译」时支持 --windows-icon / --windows-title，macOS 上交叉编译用不了；
// 而 resedit 那类库要重构 PE 段表（bun 的 .bun 段在 .rsrc 之后，会直接拒绝），所以这里只做**原地改写**：
//   - RT_ICON 的数据换成我们的 256×256 PNG，长度写回目录项，剩余空间清零（不改变任何段表/目录结构）；
//   - RT_GROUP_ICON 重写成「1 个 256×256、32bpp」的图标组；
//   - RT_VERSION 用 resedit 生成的标准 VS_VERSION_INFO 覆盖，放在 .rsrc 内的空闲间隙里。
// 除了 .rsrc 的数据字节，PE 头与其它段一律不动 —— scripts/inspect-exe.mjs --compare 会逐段核对哈希。
//
// 用法: node scripts/patch-exe-resources.mjs <exe> [--ico assets/icon.ico] [--version 0.1.0] [--description "..."] [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;
const LANG = 1033;
const PRODUCT = 'Contest Publisher';

const align = (value, to = 8) => Math.ceil(value / to) * to;

// ---- PE 解析（只读头与段表，够用即可；与 scripts/inspect-exe.mjs 保持同一套偏移）----
export function parsePe(buffer) {
  if (buffer.readUInt16LE(0) !== 0x5a4d) throw new Error('缺少 MZ 头，不是 PE 文件');
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) throw new Error('缺少 PE 签名');
  const coff = peOffset + 4;
  const numberOfSections = buffer.readUInt16LE(coff + 2);
  const optionalSize = buffer.readUInt16LE(coff + 16);
  const optional = coff + 20;
  const is64 = buffer.readUInt16LE(optional) === 0x20b;
  const subsystemOffset = optional + 0x44;
  const dataDirectory = optional + (is64 ? 0x70 : 0x60);
  const resourceRva = buffer.readUInt32LE(dataDirectory + 2 * 8);
  const resourceSize = buffer.readUInt32LE(dataDirectory + 2 * 8 + 4);
  const sections = [];
  const table = optional + optionalSize;
  for (let index = 0; index < numberOfSections; index += 1) {
    const base = table + index * 40;
    sections.push({
      name: buffer.toString('utf8', base, base + 8).replace(/\0.*$/, ''),
      virtualSize: buffer.readUInt32LE(base + 8),
      virtualAddress: buffer.readUInt32LE(base + 12),
      rawSize: buffer.readUInt32LE(base + 16),
      rawPointer: buffer.readUInt32LE(base + 20),
    });
  }
  const find = rva => sections.find(section => rva >= section.virtualAddress && rva < section.virtualAddress + Math.max(section.virtualSize, section.rawSize)) ?? null;
  return {
    buffer, sections, is64,
    subsystem: buffer.readUInt16LE(subsystemOffset),
    resourceRva, resourceSize,
    section: find(resourceRva),
    toOffset(rva) { const section = find(rva); return section ? rva - section.virtualAddress + section.rawPointer : null; },
  };
}

// ---- 资源目录遍历：拿到每个资源数据的「目录项位置 / 数据位置 / 声明长度」----
// 目录结构本身的结尾也要记下来：找空隙时绝不能落进目录区。
export function listResources(pe) {
  const { buffer } = pe;
  const base = pe.toOffset(pe.resourceRva);
  const found = [];
  let directoryEnd = base;
  const decodeId = raw => ((raw & 0x80000000) !== 0 ? (raw & 0x7fffffff) : raw);
  const walk = (dirOffset, type, id, lang) => {
    const named = buffer.readUInt16LE(base + dirOffset + 12);
    const ids = buffer.readUInt16LE(base + dirOffset + 14);
    directoryEnd = Math.max(directoryEnd, base + dirOffset + 16 + (named + ids) * 8);
    for (let index = 0; index < named + ids; index += 1) {
      const entry = base + dirOffset + 16 + index * 8;
      const nameOrId = buffer.readUInt32LE(entry);
      const offset = buffer.readUInt32LE(entry + 4);
      const value = decodeId(nameOrId);
      const child = offset & 0x7fffffff;
      if (offset & 0x80000000) {
        if (type === null) walk(child, value, null, null);
        else if (id === null) walk(child, type, value, null);
        else walk(child, type, id, value);
      } else {
        directoryEnd = Math.max(directoryEnd, base + child + 16);
        const rva = buffer.readUInt32LE(base + child);
        found.push({
          type, id, lang,
          dataEntryOffset: base + child,
          dataRva: rva,
          declaredSize: buffer.readUInt32LE(base + child + 4),
          offset: pe.toOffset(rva),
        });
      }
    }
  };
  walk(0, null, null, null);
  return { entries: found, directoryEnd };
}

// 每个资源数据可用到下一个资源数据之前；最后一个可用到段尾。原地改写绝不能越界。
function layout(entries, sectionRawEnd) {
  const sorted = [...entries].sort((a, b) => a.offset - b.offset);
  const capacity = new Map();
  sorted.forEach((entry, index) => {
    const next = sorted[index + 1];
    capacity.set(entry, (next ? next.offset : sectionRawEnd) - entry.offset);
  });
  return { sorted, capacity };
}

function replaceData(entry, capacity, payload, pbuffer) {
  if (payload.length > capacity) throw new Error(`资源 type=${entry.type} 需要 ${payload.length} 字节，只有 ${capacity} 字节可用`);
  payload.copy(pbuffer, entry.offset);
  pbuffer.fill(0, entry.offset + payload.length, entry.offset + capacity);
  pbuffer.writeUInt32LE(payload.length, entry.dataEntryOffset + 4);
  pbuffer.writeUInt32LE(entry.dataRva, entry.dataEntryOffset);
  entry.declaredSize = payload.length;
}

// 从 ICO 里取最大的那张 PNG（Vista 起 RT_ICON 允许直接放 PNG）。
export function largestPngFromIco(icoBuffer) {
  if (icoBuffer.readUInt16LE(0) !== 0 || icoBuffer.readUInt16LE(2) !== 1) throw new Error('不是 ICO 文件');
  const count = icoBuffer.readUInt16LE(4);
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const base = 6 + index * 16;
    const width = icoBuffer.readUInt8(base) || 256;
    const size = icoBuffer.readUInt32LE(base + 8);
    const offset = icoBuffer.readUInt32LE(base + 12);
    const data = icoBuffer.subarray(offset, offset + size);
    const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (isPng && (!best || width > best.width)) best = { width, data: Buffer.from(data) };
  }
  if (!best) throw new Error('ICO 里没有 PNG 条目');
  return best;
}

// 图标组：6 字节头 + 每项 14 字节。只有 1 个槽位（bun 预留的就是 20 字节），所以放单张 256×256。
export function buildIconGroup(pngSize, iconId = 1) {
  const group = Buffer.alloc(6 + 14);
  group.writeUInt16LE(0, 0);
  group.writeUInt16LE(1, 2);
  group.writeUInt16LE(1, 4);
  group.writeUInt8(0, 6);      // 宽 0 = 256
  group.writeUInt8(0, 7);      // 高 0 = 256
  group.writeUInt8(0, 8);      // 调色板
  group.writeUInt8(0, 9);
  group.writeUInt16LE(1, 10);  // planes
  group.writeUInt16LE(32, 12); // 位深
  group.writeUInt32LE(pngSize, 14);
  group.writeUInt16LE(iconId, 18);
  return group;
}

async function buildVersionInfo({ version, description, originalFilename }) {
  let Resource;
  try { ({ Resource } = await import('resedit')); } catch { return null; }
  const info = Resource.VersionInfo.createEmpty();
  const translation = { lang: LANG, codepage: 1200 };
  info.setStringValues(translation, {
    ProductName: PRODUCT,
    FileDescription: description || PRODUCT,
    CompanyName: 'contest-publisher',
    InternalName: PRODUCT,
    OriginalFilename: originalFilename,
    LegalCopyright: 'Local build, no warranty',
  });
  if (version) {
    info.setFileVersion(version, LANG);
    info.setProductVersion(version, LANG);
  }
  const entries = [];
  info.outputToResourceEntries(entries);
  return Buffer.from(entries[0].bin);
}

// 在 .rsrc 里找一段够长的空隙：资源数据之间、以及最后一段资源之后；绝不落在资源目录区里。
function findFreeSpace(sorted, directoryEnd, sectionRawEnd, needed) {
  let cursor = directoryEnd;
  for (const entry of sorted) {
    if (entry.offset - cursor >= needed) return cursor;
    cursor = Math.max(cursor, entry.offset + entry.declaredSize);
  }
  return sectionRawEnd - cursor >= needed ? cursor : null;
}

// --verify：只读回查，确认 exe 里的图标 / 图标组 / 版本信息确实是我们要的内容。
async function verify(file) {
  const buffer = readFileSync(file);
  const pe = parsePe(buffer);
  const { entries } = listResources(pe);
  const icon = entries.find(entry => entry.type === RT_ICON);
  const group = entries.find(entry => entry.type === RT_GROUP_ICON);
  const version = entries.find(entry => entry.type === RT_VERSION);
  if (!icon || !group) throw new Error('缺少图标资源');
  const png = buffer.subarray(icon.offset, icon.offset + icon.declaredSize);
  const isPng = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = isPng ? png.readUInt32BE(16) : 0;
  const height = isPng ? png.readUInt32BE(20) : 0;
  const groupBuffer = buffer.subarray(group.offset, group.offset + group.declaredSize);
  const lines = [
    `  资源回查 ${path.basename(file)}:`,
    `    图标: ${isPng ? `PNG ${width}×${height}` : '非 PNG'} ${icon.declaredSize} 字节`,
    `    图标组: ${groupBuffer.readUInt16LE(4)} 项 · 位深 ${groupBuffer.readUInt16LE(12)} · 指向 RT_ICON/${groupBuffer.readUInt16LE(18)} · ${groupBuffer.readUInt32LE(14)} 字节`,
  ];
  if (version) {
    let product = '(未安装 resedit，无法解析)';
    try {
      const { Resource } = await import('resedit');
      const slice = buffer.subarray(version.offset, version.offset + version.declaredSize);
      const bin = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
      const parsed = Resource.VersionInfo.fromEntries([{ type: RT_VERSION, id: version.id ?? 1, lang: LANG, bin }])[0];
      const strings = parsed.getStringValues({ lang: LANG, codepage: 1200 });
      product = `${strings.ProductName ?? '?'} ${strings.FileVersion ?? strings.ProductVersion ?? ''}`.trim();
    } catch (error) { product = `解析失败: ${error.message}`; }
    lines.push(`    版本信息: ${version.declaredSize} 字节 → ${product}`);
  } else {
    lines.push('    版本信息: 无');
  }
  console.log(lines.join('\n'));
}

async function main() {
  const argv = process.argv.slice(2);
  const options = { exe: argv[0], ico: path.join(ROOT, 'assets', 'icon.ico'), version: null, description: '', dryRun: false, verifyOnly: false };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--ico') { options.ico = argv[++index]; }
    else if (key === '--version') { options.version = argv[++index]; }
    else if (key === '--description') { options.description = argv[++index]; }
    else if (key === '--dry-run') { options.dryRun = true; }
    else if (key === '--verify') { options.verifyOnly = true; }
    else throw new Error(`Unknown option: ${key}`);
  }
  if (!options.exe) throw new Error('用法: node scripts/patch-exe-resources.mjs <exe> [--ico <ico>] [--version <x.y.z>] [--description <text>] [--dry-run|--verify]');
  if (options.verifyOnly) { await verify(options.exe); return; }

  const before = readFileSync(options.exe);
  const working = Buffer.from(before);
  const pe = parsePe(working);
  const { entries, directoryEnd } = listResources(pe);
  const sectionRawEnd = pe.section.rawPointer + pe.section.rawSize;
  const { sorted, capacity } = layout(entries, sectionRawEnd);

  const iconEntry = entries.find(entry => entry.type === RT_ICON);
  const groupEntry = entries.find(entry => entry.type === RT_GROUP_ICON);
  const versionEntry = entries.find(entry => entry.type === RT_VERSION);
  if (!iconEntry || !groupEntry) throw new Error('exe 里没有 ICON / GROUP_ICON 资源，无法原地替换（请改用 bun 的 --windows-icon）');

  const { width, data: png } = largestPngFromIco(readFileSync(options.ico));
  replaceData(iconEntry, capacity.get(iconEntry), png, working);
  const group = buildIconGroup(png.length, iconEntry.id ?? 1);
  replaceData(groupEntry, capacity.get(groupEntry), group, working);

  let versionBlob = null;
  if (versionEntry) {
    versionBlob = await buildVersionInfo({ version: options.version, description: options.description, originalFilename: path.basename(options.exe) });
    if (versionBlob) {
      const free = findFreeSpace(sorted, directoryEnd, sectionRawEnd, align(versionBlob.length));
      if (free === null) {
        console.warn(`  警告：.rsrc 里没有 ${versionBlob.length} 字节的空隙，保留原有版本信息`);
        versionBlob = null;
      } else {
        // 版本信息的 RVA 改指到图标数据后面那段空闲空间；目录结构不变，只改这一项的 RVA/长度。
        const rva = free - pe.section.rawPointer + pe.section.virtualAddress;
        versionBlob.copy(working, free);
        working.writeUInt32LE(rva, versionEntry.dataEntryOffset);
        working.writeUInt32LE(versionBlob.length, versionEntry.dataEntryOffset + 4);
        versionEntry.declaredSize = versionBlob.length;
      }
    }
  }

  // 自检：除 .rsrc 外每个段必须一字不差；新资源要能按目录声明读回同样的长度。
  for (const section of pe.sections) {
    if (section.name === '.rsrc') continue;
    const a = before.subarray(section.rawPointer, section.rawPointer + section.rawSize);
    const b = working.subarray(section.rawPointer, section.rawPointer + section.rawSize);
    if (!a.equals(b)) throw new Error(`段 ${section.name} 被改动了，拒绝写回`);
  }
  const recheck = listResources(parsePe(working)).entries;
  const checkIcon = recheck.find(entry => entry.type === RT_ICON);
  const checkVersion = recheck.find(entry => entry.type === RT_VERSION);
  if (checkIcon.declaredSize !== png.length) throw new Error('图标长度自检失败');
  if (versionBlob && checkVersion.declaredSize !== versionBlob.length) throw new Error('版本信息长度自检失败');

  if (options.dryRun) {
    console.log(`  试运行：图标 ${width}×${width} ${png.length}B、图标组 ${group.length}B、版本信息 ${versionBlob ? `${versionBlob.length}B` : '未生成'}（未写回）`);
    return;
  }
  writeFileSync(options.exe, working);
  console.log(`  已就地替换资源：图标 ${width}×${width} ${png.length}B、版本信息 ${versionBlob ? `${versionBlob.length}B` : '未生成'}（仅 .rsrc 数据变化）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`打补丁失败: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
