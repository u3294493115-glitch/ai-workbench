#!/usr/bin/env node
/**
 * bid-check-cn v3.1.0-rc Phase P3：视觉候选 manifest 构建（v3.1 能力 B）
 *
 * 任务书第八节硬约束：
 *   "正常文字页：直接沿用现有文字流程
 *    视觉候选页：才调用 scripts/render_pdf_pages.mjs 并只渲染
 *                 start_page ~ end_page 或明确的候选页面集合
 *    不得再默认：1 ~ PDF最后一页 全部渲染。"
 *
 * 职责：
 *   1) 调用（或复用）pdf_page_recon.mjs 产出 <pdf>.recon.json
 *   2) 合并连续候选页为区间（减少 render 调用）
 *   3) fork/exec render_pdf_pages.mjs（不修改现有脚本）
 *   4) 输出 <pdf>.visual_candidates.json（决策可追溯）
 *
 * 输入：<pdf_path> <out_dir> [--dpi 150] [--recon-only] [--max-ranges N]
 * 输出：
 *   - <out_dir>/<pdf_basename>.recon.json
 *   - <out_dir>/<pdf_basename>.visual_candidates.json
 *   - <out_dir>/pages/<pdf_basename>/pNNN.png （由 render_pdf_pages.mjs 产生）
 *
 * 路径安全：禁止写入 input/。
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function usage() {
  console.error('用法: node scripts/build_visual_manifest.mjs <pdf路径> <out_dir> [options]');
  console.error('options:');
  console.error('  --dpi N              渲染 DPI（默认 150）');
  console.error('  --recon-only         只做侦察，不渲染');
  console.error('  --max-ranges N       最多渲染 N 个区间（smoke 测试用）');
  console.error('  --no-fork            不 fork render_pdf_pages（仅打印指令）');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();
const pdfPath = args[0];
const outDir = args[1];
const opts = { dpi: 150, reconOnly: false, maxRanges: Infinity, noFork: false };
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--dpi') { opts.dpi = parseInt(args[++i], 10); }
  else if (args[i] === '--recon-only') { opts.reconOnly = true; }
  else if (args[i] === '--max-ranges') { opts.maxRanges = parseInt(args[++i], 10); }
  else if (args[i] === '--no-fork') { opts.noFork = true; }
}

if (!fs.existsSync(pdfPath)) {
  console.error('[build_visual_manifest] NOT FOUND:', pdfPath);
  process.exit(2);
}

const absOutDir = path.resolve(outDir);
const cwd = process.cwd();
const inputDir = path.join(cwd, 'input');
if (absOutDir === path.resolve(inputDir) || absOutDir.startsWith(path.resolve(inputDir) + path.sep)) {
  console.error('[build_visual_manifest] 禁止向 input/ 写入：', absOutDir);
  process.exit(3);
}

fs.mkdirSync(absOutDir, { recursive: true });
const pagesDir = path.join(absOutDir, 'pages');
fs.mkdirSync(pagesDir, { recursive: true });

const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const scriptDirResolved = process.platform === 'win32'
  ? path.resolve(scriptDir)
  : scriptDir;
const reconScript = path.join(scriptDirResolved, 'pdf_page_recon.mjs');
const renderScript = path.join(scriptDirResolved, 'render_pdf_pages.mjs');

const pdfBase = path.basename(pdfPath, path.extname(pdfPath));
const reconFile = path.join(absOutDir, `${pdfBase}.recon.json`);
const manifestFile = path.join(absOutDir, `${pdfBase}.visual_candidates.json`);

// 1) 调用 pdf_page_recon.mjs
console.log(`[build_visual_manifest] step 1: recon → ${reconFile}`);
const r1 = spawnSync(process.execPath, [reconScript, pdfPath, absOutDir], { stdio: 'inherit' });
if (r1.status !== 0) {
  console.error('[build_visual_manifest] recon failed, exit', r1.status);
  process.exit(r1.status || 4);
}

if (opts.reconOnly) {
  console.log('[build_visual_manifest] --recon-only: skip rendering');
  process.exit(0);
}

// 2) 解析 recon.json
const recon = JSON.parse(fs.readFileSync(reconFile, 'utf-8'));
const candidates = recon.visual_candidate_pages || [];
const totalPages = recon.pdf_pages;
console.log(`[build_visual_manifest] step 2: parsed ${totalPages} pages, ${candidates.length} candidates`);

// 3) 合并连续候选页为区间 [start, end]
function rangesFromCandidates(sorted) {
  if (!sorted.length) return [];
  const ranges = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    if (p === prev + 1) { prev = p; continue; }
    ranges.push([start, prev]);
    start = p; prev = p;
  }
  ranges.push([start, prev]);
  return ranges;
}

const ranges = rangesFromCandidates(candidates);
console.log(`[build_visual_manifest] step 3: ${ranges.length} ranges`);

const limitedRanges = ranges.slice(0, opts.maxRanges);
if (limitedRanges.length < ranges.length) {
  console.log(`[build_visual_manifest] --max-ranges=${opts.maxRanges}: truncated from ${ranges.length} ranges`);
}

// 4) 对每个区间 fork render_pdf_pages.mjs
const renderedPngs = [];
const renderFailures = [];
let totalPngBytes = 0;
let renderedPageCount = 0;

for (const [start, end] of limitedRanges) {
  // 命名：pages/<pdfBase>/pNNN.png  (与 render_pdf_pages.mjs 现有命名一致)
  const subDir = path.join(pagesDir, pdfBase);
  fs.mkdirSync(subDir, { recursive: true });
  const prefix = path.join(subDir, 'p');
  const renderArgs = ['-r', String(opts.dpi), '-f', String(start), '-l', String(end), '-png', pdfPath, prefix];
  if (opts.noFork) {
    console.log(`[build_visual_manifest] (no-fork) pdftoppm ${renderArgs.join(' ')}`);
    continue;
  }
  console.log(`[build_visual_manifest] step 4: render p${start}-p${end} @ ${opts.dpi}dpi`);
  const rr = spawnSync('pdftoppm', renderArgs, { stdio: 'inherit' });
  if (rr.status !== 0) {
    // fallback to existing render_pdf_pages.mjs (handles pdftoppm probing)
    const fbArgs = [renderScript, pdfPath, String(start), String(end), subDir, String(opts.dpi)];
    const fb = spawnSync(process.execPath, fbArgs, { stdio: 'inherit' });
    if (fb.status !== 0) {
      renderFailures.push({ start, end, error: `pdftoppm+fallback both failed (${rr.status}, ${fb.status})` });
      continue;
    }
  }
  // 验证 PNG 写入 + 累计字节
  // pdftoppm 输出名字：p-N.png（默认）/ p-0NN.png（≥10 页时变 2 位 padding）/ p-NNN.png（render_pdf_pages.mjs fallback 的 3 位 padding）
  // 三种全尝试，避免因命名差异误报 missing
  for (let p = start; p <= end; p++) {
    const candidates = [
      path.join(subDir, `p-${p}.png`),
      path.join(subDir, `p-${String(p).padStart(2, '0')}.png`),
      path.join(subDir, `p-${String(p).padStart(3, '0')}.png`),
    ];
    const f = candidates.find(c => fs.existsSync(c));
    if (f) {
      const sz = fs.statSync(f).size;
      renderedPngs.push({ page: p, path: f, bytes: sz });
      totalPngBytes += sz;
      renderedPageCount++;
    } else {
      renderFailures.push({ start, end, missing_png: candidates });
    }
  }
}

// 5) 输出 manifest
const skippedPages = [];
for (const p of recon.pages) {
  if (!p.is_visual_candidate) skippedPages.push(p.page);
}

const manifest = {
  schema_version: 1,
  pdf_path: path.resolve(pdfPath),
  pdf_pages: totalPages,
  generated_at: new Date().toISOString(),
  heuristic_thresholds: recon.heuristic_thresholds,
  inputs: {
    recon_json: path.relative(absOutDir, reconFile),
    render_dpi: opts.dpi,
  },
  candidate_pages: candidates,
  skipped_pages: skippedPages,
  ranges: limitedRanges,
  cross_page_propagations: recon.pages.filter(p => p.cross_page_propagated_for && p.cross_page_propagated_for.length > 0).map(p => ({ anchor_pages: p.cross_page_propagated_for, propagated_to: p.page })),
  rendered_pngs: renderedPngs,
  render_failures: renderFailures,
  totals: {
    total_pages: totalPages,
    candidate_pages: candidates.length,
    skipped_pages: skippedPages.length,
    ranges_total: ranges.length,
    ranges_rendered: limitedRanges.length,
    pages_rendered: renderedPageCount,
    png_bytes: totalPngBytes,
    png_mb_estimate: Math.round(totalPngBytes / 1024 / 1024 * 100) / 100,
  },
};

fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`[build_visual_manifest] WROTE ${manifestFile}`);
console.log(`[build_visual_manifest] TOTAL: pages=${totalPages} candidates=${candidates.length} rendered=${renderedPageCount} png_bytes=${totalPngBytes} (${manifest.totals.png_mb_estimate} MB)`);
if (renderFailures.length > 0) {
  console.warn(`[build_visual_manifest] FAILURES: ${renderFailures.length}`);
  process.exit(5);
}
