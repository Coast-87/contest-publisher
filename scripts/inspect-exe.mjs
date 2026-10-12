#!/usr/bin/env node
// 只读检查 Windows exe 的 PE 结构，用来在没有 Windows 机器的前提下给出可核对的证据：
// 架构、子系统（窗口版必须不是控制台）、资源段是否存在、各段哈希。
// --compare 会和另一个 exe 逐段比对哈希：注入图标后代码段必须一字不差。
//
// 用法: node scripts/inspect-exe.mjs <exe> [--compare <exe>]
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MACHINES = { 0x014c: 'i386', 0x8664: 'amd64', 0xaa64: 'arm64' };
const SUBSYSTEMS = { 1: 'native', 2: 'windows-gui', 3: 'console' };

export function inspectExe(file) {
  const buffer = readFileSync(file);
  if (buffer.readUInt16LE(0) !== 0x5a4d) throw new Error(`${file}: 缺少 MZ 头，不是 PE 文件`);
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) throw new Error(`${file}: 缺少 PE 签名`);
  const coff = peOffset + 4;
  const machine = buffer.readUInt16LE(coff);
  const numberOfSections = buffer.readUInt16LE(coff + 2);
  const characteristics = buffer.readUInt16LE(coff + 18);
  const optional = coff + 20;
  const magic = buffer.readUInt16LE(optional);
  const optionalSize = buffer.readUInt16LE(coff + 16);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error(`${file}: 未知的 optional header magic 0x${magic.toString(16)}`);
  const is64 = magic === 0x20b;
  // PE32 与 PE32+ 的 Subsystem 偏移相同（0x44）：PE32 多一个 BaseOfData(4)，但 ImageBase 少 4 字节。
  const subsystemOffset = optional + 0x44;
  const subsystem = buffer.readUInt16LE(subsystemOffset);
  const numberOfRvaAndSizes = buffer.readUInt32LE(optional + (is64 ? 0x6c : 0x5c));
  const dataDirectoryOffset = optional + (is64 ? 0x70 : 0x60);
  const resourceRva = numberOfRvaAndSizes > 2 ? buffer.readUInt32LE(dataDirectoryOffset + 2 * 8) : 0;
  const resourceSize = numberOfRvaAndSizes > 2 ? buffer.readUInt32LE(dataDirectoryOffset + 2 * 8 + 4) : 0;

  const sections = [];
  const sectionTable = optional + optionalSize;
  for (let index = 0; index < numberOfSections; index += 1) {
    const base = sectionTable + index * 40;
    const name = buffer.toString('utf8', base, base + 8).replace(/\0.*$/, '');
    const virtualSize = buffer.readUInt32LE(base + 8);
    const virtualAddress = buffer.readUInt32LE(base + 12);
    const rawSize = buffer.readUInt32LE(base + 16);
    const rawPointer = buffer.readUInt32LE(base + 20);
    const raw = rawSize && rawPointer + rawSize <= buffer.length ? buffer.subarray(rawPointer, rawPointer + rawSize) : Buffer.alloc(0);
    sections.push({
      name, virtualSize, virtualAddress, rawSize, rawPointer,
      sha256: createHash('sha256').update(raw).digest('hex').slice(0, 16),
      withinFile: rawPointer + rawSize <= buffer.length,
    });
  }
  const resourceSection = sections.find(section => resourceRva >= section.virtualAddress && resourceRva < section.virtualAddress + Math.max(section.virtualSize, section.rawSize));
  return {
    file,
    bytes: statSync(file).size,
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    pe32Plus: is64,
    subsystem: SUBSYSTEMS[subsystem] ?? String(subsystem),
    resourceRva,
    resourceSize,
    resourceSection: resourceSection?.name ?? null,
    sections,
  };
}

function format(report) {
  const lines = [
    `${path.basename(report.file)}  ${(report.bytes / 1024 / 1024).toFixed(1)} MiB`,
    `  架构: ${report.machine} · PE32+ ${report.pe32Plus ? '是' : '否'} · 子系统: ${report.subsystem}`,
    `  资源段: ${report.resourceSection ?? '(无)'} rva=0x${report.resourceRva.toString(16)} size=${report.resourceSize}`,
    '  段表:',
  ];
  for (const section of report.sections) {
    lines.push(`    ${section.name.padEnd(8)} vsize=${String(section.virtualSize).padStart(9)} raw=${String(section.rawSize).padStart(9)} sha256=${section.sha256}${section.withinFile ? '' : ' 越界!'}`);
  }
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const compareIndex = argv.indexOf('--compare');
  const compare = compareIndex >= 0 ? argv[compareIndex + 1] : null;
  const target = argv[0];
  if (!target) throw new Error('用法: node scripts/inspect-exe.mjs <exe> [--compare <exe>]');
  const report = inspectExe(target);
  console.log(format(report));
  if (compare) {
    const before = inspectExe(compare);
    console.log(`\n与 ${path.basename(compare)} 逐段比对：`);
    let identical = 0;
    for (const section of report.sections) {
      const other = before.sections.find(item => item.name === section.name);
      if (!other) { console.log(`  ${section.name.padEnd(8)} 仅存在于 ${path.basename(target)}`); continue; }
      const same = other.sha256 === section.sha256 && other.rawSize === section.rawSize;
      if (same) identical += 1;
      console.log(`  ${section.name.padEnd(8)} ${same ? '一致' : `不一致（${other.sha256} → ${section.sha256}）`}`);
    }
    console.log(`  → ${identical}/${report.sections.length} 个段未改动`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
