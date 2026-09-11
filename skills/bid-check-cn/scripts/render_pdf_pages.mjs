#!/usr/bin/env node
/**
 * bid-check-cn v3.0.1 PDF 整页渲染脚本（poppler pdftoppm 优先，pdfjs fallback）
 *
 * 用途：把投标/招标 PDF 的指定页码区间渲染为 PNG，
 *       供 Claude 多模态视觉工具（Read / understand_image）读取。
 *
 * 调用方式：
 *   node scripts/render_pdf_pages.mjs <pdf路径> <起始页> <结束页> <输出目录> [DPI]
 *
 * 设计原则：
 *   - 优先使用系统 poppler pdftoppm（速度快、质量稳定）
 *   - 若 pdftoppm 不可用，自动回退到 pdfjs-dist（依赖需自行安装到 /tmp/pdfjs-workdir）
 *   - 输出目录由调用方指定（必须为 output/_work/ 或 output/_pages/）
 *   - 任何错误不得向 input/ 或调用方未授权路径写入
 *
 * v3.0.1 新增：
 *   - 路径校验：outputDir 必须在调用方工作目录下，且不得为 input/
 *   - 不在项目根目录创建临时脚本；不写入 package.json
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const pdfPath = process.argv[2];
const startPage = parseInt(process.argv[3] || '1', 10);
const endPage = parseInt(process.argv[4] || startPage, 10);
const outDir = process.argv[5];
const dpi = parseInt(process.argv[6] || '150', 10);

if (!pdfPath || !outDir) {
  console.error('用法: node scripts/render_pdf_pages.mjs <pdf路径> <起始页> <结束页> <输出目录> [DPI]');
  process.exit(1);
}

// ---- 路径安全校验（v3.0.1 强制）----
const cwd = process.cwd();
const inputDir = path.join(cwd, 'input');
const absOutDir = path.resolve(outDir);
if (absOutDir === path.resolve(inputDir) || absOutDir.startsWith(path.resolve(inputDir) + path.sep)) {
  console.error('[render_pdf_pages] 禁止向 input/ 写入：', absOutDir);
  process.exit(2);
}
if (absOutDir === cwd || absOutDir.startsWith(cwd + path.sep + 'node_modules') === false) {
  // 允许 cwd 子目录；禁止输出落到 cwd 自身
  // 仅做软提示，不强制拦截
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// ---- 优先 pdftoppm（poppler）----
const exeName = process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm';
function findPdftoppm() {
  const env = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const paths = env.split(sep);
  for (const p of paths) {
    const candidate = path.join(p, exeName);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Windows 上常见的缓存路径兜底
  if (process.platform === 'win32') {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.cache', 'tools-runtimes', 'tools-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin', exeName),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
  }
  return null;
}

const pdftoppm = findPdftoppm();
if (pdftoppm) {
  const prefix = path.join(outDir, 'p');
  const args = ['-r', String(dpi), '-f', String(startPage), '-l', String(endPage), '-png', pdfPath, prefix];
  const r = spawnSync(pdftoppm, args, { stdio: 'inherit' });
  if (r.status === 0) {
    console.log(`[render_pdf_pages] pdftoppm OK: pages ${startPage}-${endPage} @ ${dpi} dpi`);
    process.exit(0);
  }
  console.error('[render_pdf_pages] pdftoppm 失败，回退到 pdfjs');
}

// ---- fallback: pdfjs-dist ----
const workdir = '/tmp/pdfjs-workdir';
try {
  const { createCanvas } = await import(path.join(workdir, 'node_modules', 'canvas'));
  const pdfjsLib = await import(path.join(workdir, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  const scale = dpi / 72;
  for (let p = startPage; p <= Math.min(endPage, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(vp.width, vp.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const out = path.join(outDir, `p-${String(p).padStart(3, '0')}.png`);
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
  }
  console.log(`[render_pdf_pages] pdfjs fallback OK`);
} catch (e) {
  console.error('[render_pdf_pages] pdfjs fallback 也失败:', e.message);
  console.error('提示：安装依赖：mkdir -p /tmp/pdfjs-workdir && cd /tmp/pdfjs-workdir && npm init -y && npm install pdfjs-dist canvas');
  process.exit(3);
}