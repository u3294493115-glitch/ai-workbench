#!/usr/bin/env node
/**
 * T1-T10 合成 fixture PDF 生成器（v3.1.0-rc Phase P6）
 *
 * 任务书第十三节 T1-T10 列表：
 *   - fixture 尽量无敏感信息（程序化生成）
 *   - 已人工复核字段直接在 library_mini.md 写出（不动正式资质库）
 *
 * 依赖 /tmp/pdfjs-workdir/node_modules/pdf-lib
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

function importAbs(p) { return import(pathToFileURL(p).href); }

const TMP_ROOT = os.tmpdir();
const WORKDIR = path.join(TMP_ROOT, 'pdfjs-workdir');

// 已确认依赖
const canvas = await importAbs(path.join(WORKDIR, 'node_modules', 'canvas', 'index.js'));
const pdfLib = await importAbs(path.join(WORKDIR, 'node_modules', 'pdf-lib', 'cjs', 'index.js'));
const { PDFDocument, rgb, StandardFonts } = pdfLib;

const FIXTURES_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')));
if (!fs.existsSync(FIXTURES_DIR)) fs.mkdirSync(FIXTURES_DIR, { recursive: true });

// helper: PNG buffer at given w/h with given RGBA
function makePng(w, h, fill = '#888888') {
  const c = canvas.createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.fillStyle = '#fff';
  ctx.font = '24px sans-serif';
  ctx.fillText(`cert ${w}x${h}`, 10, 30);
  return c.toBuffer('image/png');
}

async function buildPage(doc, kind) {
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (kind === 'text-only') {
    page.drawText('This is a text-only page with lots of native text characters that pdfjs getTextContent would detect.', {
      x: 60, y: 700, size: 12, font, color: rgb(0, 0, 0), maxWidth: 480,
    });
    page.drawText('More text content here, paragraphs and quotes, sufficient to exceed 30 characters and trigger has_text=true.', {
      x: 60, y: 600, size: 12, font,
    });
    return;
  }
  if (kind === 'pure-image-cert') {
    const png = makePng(800, 1000, '#ffffff');
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: 50, y: 100, width: 480, height: 600 });
    return;
  }
  if (kind === 'mixed-major-image') {
    page.drawText('MIXED PAGE - this text plus a big cert image occupies most of the page area.', {
      x: 60, y: 760, size: 12, font,
    });
    const png = makePng(800, 1000, '#fefefe');
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: 50, y: 80, width: 480, height: 600 });
    return;
  }
  if (kind === 'small-logo') {
    page.drawText('Page with small logo header plus substantial body text describing the paragraph content.', {
      x: 60, y: 760, size: 12, font, maxWidth: 480,
    });
    page.drawText('Body text continues here with multiple sentences to exceed the 30 character has_text threshold.', {
      x: 60, y: 720, size: 12, font,
    });
    const png = makePng(40, 40, '#cccccc');
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: 60, y: 790, width: 20, height: 20 });
    return;
  }
  if (kind === 'text-with-2-images') {
    // 用于 T8 跨页传播测试：本身 text 主导，但有 2 张小图（imgs>=2 触发 cross_page propagation）
    page.drawText('This page has two small embedded images plus substantial body text describing cert continuation.', {
      x: 60, y: 760, size: 12, font, maxWidth: 480,
    });
    page.drawText('Body text continues here. Second paragraph describing the cert continuation details.', {
      x: 60, y: 720, size: 12, font,
    });
    const png1 = makePng(40, 40, '#cccccc');
    const png2 = makePng(40, 40, '#dddddd');
    const img1 = await doc.embedPng(png1);
    const img2 = await doc.embedPng(png2);
    page.drawImage(img1, { x: 60, y: 690, width: 20, height: 20 });
    page.drawImage(img2, { x: 90, y: 690, width: 20, height: 20 });
    return;
  }
  throw new Error('unknown kind: ' + kind);
}

async function build(outName, pages) {
  const doc = await PDFDocument.create();
  doc.setTitle('v3.1.0-rc T1-T10 fixture');
  for (const kind of pages) await buildPage(doc, kind);
  const bytes = await doc.save();
  const outFile = path.join(FIXTURES_DIR, outName);
  fs.writeFileSync(outFile, bytes);
  console.log(`[fixtures] wrote ${outFile} (${bytes.length} bytes, ${pages.length} pages)`);
}

await build('T1-text-only.pdf', ['text-only']);
await build('T2-scanned-cert.pdf', ['pure-image-cert']);
await build('T3-text-plus-cert.pdf', ['mixed-major-image']);
await build('T4-small-logo.pdf', ['small-logo']);
await build('T5-library-match-cert.pdf', ['pure-image-cert']);
await build('T6-empty-bid.pdf', ['text-only']);
await build('T7-library-pending.pdf', ['pure-image-cert']);
// T8 跨页传播：P1 = 大证书（candidate），P2 = text + 2张小图（image_count>=2 触发 cross_page propagation）
await build('T8-two-page-cert.pdf', ['mixed-major-image', 'text-with-2-images']);
await build('T9-ocr-conflict.pdf', ['text-only']);
await build('T10-mixed-bid.pdf', ['text-only', 'mixed-major-image', 'text-only', 'pure-image-cert', 'small-logo', 'text-only']);

// library_mini.md (P4-style mini fixture, 1 HIGH + 1 MEDIUM + 1 LOW + 1 NOT_FOUND 公司)
// 用于 T5/T6/T7/T9 复用字段测试。
// 必须匹配 read_qualification_library.mjs 期望的格式：
//   - 〇、主体总览 section (master list)
//   - ## N. <公司名>  sections
//   - 9-column 核心资质 tables
//   - 复核状态含 HIGH/MEDIUM/LOW/NOT_FOUND 关键词
const LIBRARY_MINI = `# Library Mini Fixture（v3.1.0-rc P6, 不动正式资质库）

## 〇、主体总览

| # | 供应商主体 | 来源 | 主体确认状态 | 核心能力方向 | 是否已结构化 |
|---|---|---|---|---|---|
| 1 | 江苏测试新能源有限公司 | 测试fixtures（不连真实世界） | 已确认（用户复核通过 2026-01-01） | 测试 | 高（已复核） |
| 2 | 浙江OCR测试电力有限公司 | 测试fixtures | 已提取（OCR，待人工复核） | 测试 | 中（OCR待复核） |
| 3 | 上海占位测试有限公司 | 测试fixtures | 已识别（图片识别，待复核） | 测试 | 中（已识别） |
| 4 | 北京未确认测试有限公司 | 测试fixtures | 未发现 | 测试 | 低（未发现） |

## 1. 江苏测试新能源有限公司

- 公司名称：江苏测试新能源有限公司
- 简称：江苏测试
- 统一社会信用代码：91320000MA1TEST001
- 法定代表人：测试法人甲（复核通过 2026-01-01）
- 注册资本：1000 万元
- 注册地：江苏省南京市测试区测试路 1 号
- 成立日期：2024-01-01
- 一般纳税人：已确认
- 主体确认状态：已确认（用户复核通过 2026-01-01）

### 核心资质

| 资质名称 | 等级/范围 | 证书编号 | 有效期至 | 状态 | 依据文件 | 文件位置 | 页码 | 复核状态 |
|---|---|---|---|---|---|---|---|---|
| 企业营业执照 | 一般纳税人 | 91320000MA1TEST001 | 长期 | 正常 | 测试营业执照.pdf | \`fixtures/T5-library-match-cert.pdf\` | 第2页 | 已人工复核通过 |
| 安全生产许可证 | 建筑施工 | (苏)JZ安许证字[TEST]001 | 2029-01-01 | 正常 | 同上 | 同上 | 第3页 | 已人工复核通过 |

## 2. 浙江OCR测试电力有限公司

- 公司名称：浙江OCR测试电力有限公司
- 简称：浙江OCR
- 统一社会信用代码：91330000MA2OCR0002
- 法定代表人：测试法人乙
- 注册地：浙江省杭州市测试区
- 注册资本：2000 万元
- 主体确认状态：已提取（OCR，待人工复核）

### 核心资质

| 资质名称 | 等级/范围 | 证书编号 | 有效期至 | 状态 | 依据文件 | 文件位置 | 页码 | 复核状态 |
|---|---|---|---|---|---|---|---|---|
| 企业营业执照 | 一般纳税人 | 91330000MA2OCR0002 | 长期 | 已提取 | OCR_license.pdf | OCR扫描件/ | 第10页 | 待人工复核 |
| 安全生产许可证 | 建筑施工 | (浙)JZ安许证字[OCR]002 | 2027-01-01 | 待OCR | 安全许可证_OCR.pdf | OCR扫描件/ | 待人工复核 | 待OCR |

## 3. 上海占位测试有限公司

- 公司名称：上海占位测试有限公司
- 简称：上海占位
- 统一社会信用代码：91310000MA3PLACE003
- 法定代表人：测试法人丙
- 注册地：上海市测试区
- 主体确认状态：已识别（图片识别，待复核）

### 核心资质

| 资质名称 | 等级/范围 | 证书编号 | 有效期至 | 状态 | 依据文件 | 文件位置 | 页码 | 复核状态 |
|---|---|---|---|---|---|---|---|---|
| 企业营业执照 | 一般 | 91310000MA3PLACE003 | 长期 | 已识别 | placeholder.pdf | placeholder/ | 第5页 | 待人工复核 |

## 4. 北京未确认测试有限公司

- 公司名称：北京未确认测试有限公司
- 统一社会信用代码：未发现
- 法定代表人：未发现
- 注册地：未发现
- 注册资本：未发现
- 主体确认状态：未发现

### 核心资质

| 资质名称 | 等级/范围 | 证书编号 | 有效期至 | 状态 | 依据文件 | 文件位置 | 页码 | 复核状态 |
|---|---|---|---|---|---|---|---|---|
| 企业营业执照 | 未发现 | 未发现 | 未发现 | 未发现 | （未提供） | 未发现 | 未发现 | 未发现 |
`;

const LIBRARY_MINI_FILE = path.join(FIXTURES_DIR, 'library_mini.md');
fs.writeFileSync(LIBRARY_MINI_FILE, LIBRARY_MINI, 'utf-8');
console.log(`[fixtures] wrote ${LIBRARY_MINI_FILE}`);

console.log('[fixtures] all T1-T10 + library_mini built');
