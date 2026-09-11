#!/usr/bin/env node
/**
 * bid-check-cn v3.0.1.1 WPS/MS-Word .doc（CFB/OLE）文本抽取脚本
 *
 * 策略：
 *   1) 解析 CFB 找到 WordDocument stream
 *   2) 同时尝试 FIB 段（fcMin/fcMac）和 UTF-16 LE 中文长段扫描
 *   3) 选有效输出（较长者）
 *
 * 路径安全：禁止写入 input/。
 */

import fs from 'fs';
import path from 'path';

const docPath = process.argv[2];
const outPath = process.argv[3];

if (!docPath || !outPath) {
  console.error('用法: node scripts/extract_doc_text.mjs <doc路径> <输出文本路径>');
  process.exit(1);
}

const cwd = process.cwd();
const absOut = path.resolve(outPath);
const absInput = path.resolve(path.join(cwd, 'input'));
if (absOut === absInput || absOut.startsWith(absInput + path.sep)) {
  console.error('[extract_doc_text] 禁止向 input/ 写入：', absOut);
  process.exit(2);
}

function parseCFB(buf) {
  if (buf.readUInt32LE(0) !== 0xE011CFD0) throw new Error('Not OLE/CFB');
  const secSize = 1 << buf.readInt16LE(30);
  const dirSecId = buf.readInt32LE(48);
  const MSATSize = buf.readInt32LE(72);
  const headerSize = 512;
  const secOff = (id) => headerSize + id * secSize;
  const msat = new Array(MSATSize * (secSize / 4) + 109);
  for (let i = 0; i < 109; i++) msat[i] = buf.readInt32LE(76 + i * 4);
  let cur = buf.readInt32LE(68);
  let off109 = 109;
  while (cur !== 0xFFFFFFFE && cur !== 0xFFFFFFFF && cur >= 0) {
    const off = secOff(cur);
    const cnt = secSize / 4 - 1;
    const nextMSATSec = buf.readInt32LE(off + secSize - 4);
    for (let i = 0; i < cnt; i++) msat[off109 + i] = buf.readInt32LE(off + i * 4);
    off109 += cnt;
    cur = nextMSATSec;
  }
  const totalFAT = msat.length;
  const FAT = new Array(totalFAT).fill(-1);
  for (let i = 0; i < totalFAT; i++) {
    if (msat[i] >= 0) {
      const off = secOff(msat[i]);
      for (let j = 0; j < secSize / 4; j++) FAT[i * (secSize / 4) + j] = buf.readInt32LE(off + j * 4);
    }
  }
  function chain(startId) {
    const ids = []; let c = startId; const seen = new Set();
    while (c >= 0 && !seen.has(c)) { ids.push(c); seen.add(c); c = FAT[c]; }
    return ids;
  }
  const dirIds = chain(dirSecId);
  const dirBuf = Buffer.alloc(dirIds.length * secSize);
  let p = 0;
  for (const id of dirIds) {
    buf.copy(dirBuf, p, secOff(id), secOff(id) + secSize);
    p += secSize;
  }
  const entries = [];
  for (let i = 0; i < dirBuf.length / 128; i++) {
    const off = i * 128;
    const nameLen = Math.max(dirBuf.readInt16LE(64 + off) - 1, 0);
    const name = dirBuf.toString('utf16le', off, off + nameLen);
    const type = dirBuf.readInt8(66 + off);
    const startSec = dirBuf.readInt32LE(116 + off);
    const size = dirBuf.readInt32LE(120 + off);
    if (type === 0) continue;
    entries.push({ name, type, startSec, size });
  }
  return { entries, secSize, secOff, chain, buf };
}

function readStream(cfb, startSec, size) {
  const ids = cfb.chain(startSec);
  const out = Buffer.alloc(size);
  let p = 0;
  for (const id of ids) {
    const o = cfb.secOff(id);
    const len = Math.min(cfb.secSize, size - p);
    cfb.buf.copy(out, p, o, o + len);
    p += len;
    if (p >= size) break;
  }
  return out;
}

// 策略 A：FIB 段
function extractFIB(cfb) {
  const wd = cfb.entries.find(e => e.name === 'WordDocument');
  if (!wd) return '';
  const WD = readStream(cfb, wd.startSec, wd.size);
  let fcMin, fcMac;
  try {
    fcMin = WD.readUInt32LE(418);
    fcMac = WD.readUInt32LE(422);
  } catch (e) { return ''; }
  if (!fcMac || fcMac <= fcMin || fcMac > WD.length) return '';
  const textBuf = WD.subarray(fcMin, fcMac);
  let text = '';
  for (let i = 0; i < textBuf.length; i++) {
    const b = textBuf[i];
    if (b === 0x0D || b === 0x0C || b === 0x0B) text += '\n';
    else if (b === 0x07) { /* cell */ }
    else if (b >= 0x20 || b === 0x09) text += String.fromCharCode(b);
  }
  return text;
}

// 策略 B：UTF-16 LE 中文长段扫描
function extractUtf16(buf) {
  const segments = [];
  let cur = '', curStart = 0;
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf.readUInt16LE(i);
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0x0020 && code <= 0x007E)) {
      if (!cur) curStart = i;
      cur += String.fromCharCode(code);
    } else {
      if (cur && cur.length >= 8) segments.push({ start: curStart, text: cur });
      cur = '';
    }
  }
  if (cur && cur.length >= 8) segments.push({ start: curStart, text: cur });
  return segments
    .filter(s => s.start > 30000 && s.start < 250000 && s.text.length > 20)
    .map(s => s.text)
    .join('\n');
}

const cfb = parseCFB(fs.readFileSync(docPath));
const fibText = extractFIB(cfb);
const utfText = extractUtf16(fs.readFileSync(docPath));
const final = (utfText.length > fibText.length ? utfText : fibText);

fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, final);
console.log(`[extract_doc_text] wrote ${final.length} chars (FIB=${fibText.length}, UTF16=${utfText.length}) to ${absOut}`);