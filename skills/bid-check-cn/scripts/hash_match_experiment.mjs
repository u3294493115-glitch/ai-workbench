#!/usr/bin/env node
/**
 * bid-check-cn v3.1.0-rc Phase P1：真实样本 hash 命中率实验
 *
 * 任务书第五节硬约束：
 *   "如果精确方法命中率足够：采用。如果命中不了：
 *    不要强行做模糊自动匹配。允许：识别失败 → 正常视觉识别。"
 *
 * 职责：
 *   1) 选少量资质库原 PDF（已人工复核 HIGH 字段）
 *   2) 选 1 份真实投标 PDF
 *   3) 用 4 种粒度的 hash 对比
 *   4) 输出结论 JSON（不入 git；落 output/_work/experiments/）
 *
 * 4 种粒度：
 *   M1: 原始 PDF 文件 SHA256
 *   M2: PDF 内嵌图片（paintImageXObject）字节 SHA256
 *   M3: 候选页 @150dpi PNG 字节 SHA256
 *   M4: 候选页 @150dpi 解码为 raw RGBA → SHA256
 *
 * 路径安全：禁止写入 input/；实验输出落到 out_dir 默认值。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

// pathToFileURL wrapper to support Windows absolute paths in dynamic import.
function importAbs(p) {
  return import(pathToFileURL(p).href);
}

const LIBRARY_SAMPLES_DEFAULT = [
  // 来自 11下游分包方资料/ — 已是 HIGH 复核状态
  '<PARTNER_LIBRARY_DIR>\\<PARTNER_QUALIFICATION_PDF>',
  '<PARTNER_LIBRARY_DIR>\\外部资质业绩\\1.2某科技公司营业执照——副本（2026.7.31）.pdf',
];
const BID_SAMPLES_DEFAULT = [
  // 该项目 smoke-only，git 已 ignore
  '<PROJECT_INPUT_DIR>\\投标文件\\投标人C\\标段1.pdf',
];

// 复用现有 render_pdf_pages.mjs 的同一约定：
// Git Bash on Windows 把 /tmp 映射到 os.tmpdir() (= %TEMP%)。
// 因此 Node 端用 os.tmpdir()（而不是字面 /tmp）以确保解析正确。
const TMP_ROOT = os.tmpdir();
const WORKDIR = path.join(TMP_ROOT, 'pdfjs-workdir');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256OfFile(p) {
  return sha256(fs.readFileSync(p));
}

async function extractImageHashes(pdfPath) {
  // 用 pdfjs-dist legacy build；与 extract_pdf_images.mjs 同款行为
  const pdfjsLib = await importAbs(path.join(WORKDIR, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const hashes = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const ops = await page.getOperatorList();
      const seen = new Set();
      for (let j = 0; j < ops.fnArray.length; j++) {
        const fn = ops.fnArray[j];
        if (fn === 85 || fn === 86) {
          const imgIdx = ops.argsArray[j][0];
          if (seen.has(imgIdx)) continue;
          seen.add(imgIdx);
          try {
            const img = await page.objs.get(imgIdx);
            if (!img || !img.data || !img.width || !img.height) continue;
            const h = sha256(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength));
            hashes.push({
              page: i,
              imageIndex: seen.size,
              width: img.width,
              height: img.height,
              bytes: img.data.byteLength,
              sha256: h,
            });
          } catch (_) { /* skip */ }
        }
      }
    } catch (_) { /* page fail skip */ }
  }
  return { hashes, numPages: pdf.numPages };
}

async function renderPageHashes(pdfPath, dpi = 150) {
  // 复用 pdfjs + canvas；不依赖 pdftoppm
  const { createCanvas } = await importAbs(path.join(WORKDIR, 'node_modules', 'canvas', 'index.js'));
  const pdfjsLib = await importAbs(path.join(WORKDIR, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const hashes = [];
  const scale = dpi / 72;
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const png = canvas.toBuffer('image/png');
      hashes.push({ page: i, pngBytes: png.length, pngSha256: sha256(png), rawSha256: sha256(canvas.toBuffer('image/raw')) });
    } catch (e) {
      hashes.push({ page: i, error: e.message });
    }
  }
  return { hashes, numPages: pdf.numPages };
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function intersectCount(setA, setB) {
  let n = 0;
  for (const v of setA) if (setB.has(v)) n++;
  return n;
}

async function runPair(libPath, bidPath) {
  console.log(`[hash-experiment] lib=${path.basename(libPath)}  bid=${path.basename(bidPath)}`);
  const libRaw = sha256OfFile(libPath);
  const bidRaw = sha256OfFile(bidPath);
  const m1Match = libRaw === bidRaw;

  const libImgs = await extractImageHashes(libPath);
  const bidImgs = await extractImageHashes(bidPath);
  const libImgSet = new Set(libImgs.hashes.map(h => h.sha256));
  const bidImgSet = new Set(bidImgs.hashes.map(h => h.sha256));
  const m2Matches = intersectCount(libImgSet, bidImgSet);
  const m2TotalPairs = libImgSet.size * bidImgSet.size;

  const libRenders = await renderPageHashes(libPath, 100);
  const bidRenders = await renderPageHashes(bidPath, 100);
  const libRenderSet = new Set(libRenders.hashes.filter(h => h.pngSha256).map(h => h.pngSha256));
  const bidRenderSet = new Set(bidRenders.hashes.filter(h => h.pngSha256).map(h => h.pngSha256));
  const m3Matches = intersectCount(libRenderSet, bidRenderSet);
  const libRawSet = new Set(libRenders.hashes.filter(h => h.rawSha256).map(h => h.rawSha256));
  const bidRawSet = new Set(bidRenders.hashes.filter(h => h.rawSha256).map(h => h.rawSha256));
  const m4Matches = intersectCount(libRawSet, bidRawSet);

  return {
    library_pdf: libPath,
    target_pdf: bidPath,
    library_num_pages: libImgs.numPages,
    target_num_pages: bidImgs.numPages,
    library_images_count: libImgSet.size,
    target_images_count: bidImgSet.size,
    M1_raw_pdf_sha256_match: m1Match,
    M2_embedded_image_sha256_matches: m2Matches,
    M2_compared_pairs: m2TotalPairs,
    M3_rendered_png_sha256_matches: m3Matches,
    M4_rendered_raw_rgba_sha256_matches: m4Matches,
  };
}

const args = process.argv.slice(2);
const outDir = args[0] || path.join(process.cwd(), 'output', '_work', 'experiments');
const overridePairs = args[1] === '--pairs' ? args.slice(2) : null;

if (overridePairs && overridePairs.length % 2 === 0) {
  global.LIBRARY_OVERRIDE = overridePairs.filter((_, i) => i % 2 === 0);
  global.BID_OVERRIDE = overridePairs.filter((_, i) => i % 2 === 1);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const libPaths = global.LIBRARY_OVERRIDE || LIBRARY_SAMPLES_DEFAULT;
  const bidPaths = global.BID_OVERRIDE || BID_SAMPLES_DEFAULT;
  const results = [];
  for (const libPath of libPaths) {
    if (!fs.existsSync(libPath)) {
      console.log(`[hash-experiment] skip missing lib: ${libPath}`);
      continue;
    }
    for (const bidPath of bidPaths) {
      if (!fs.existsSync(bidPath)) {
        console.log(`[hash-experiment] skip missing bid: ${bidPath}`);
        continue;
      }
      try {
        const r = await runPair(libPath, bidPath);
        results.push(r);
        console.log(`[hash-experiment]   M1=${r.M1_raw_pdf_sha256_match}  M2=${r.M2_embedded_image_sha256_matches}  M3=${r.M3_rendered_png_sha256_matches}  M4=${r.M4_rendered_raw_rgba_sha256_matches}`);
      } catch (e) {
        console.error(`[hash-experiment] pair failed: ${e.message}`);
      }
    }
  }

  const totalM1 = results.filter(r => r.M1_raw_pdf_sha256_match).length;
  const totalM2 = results.reduce((s, r) => s + r.M2_embedded_image_sha256_matches, 0);
  const totalM3 = results.reduce((s, r) => s + r.M3_rendered_png_sha256_matches, 0);
  const totalM4 = results.reduce((s, r) => s + r.M4_rendered_raw_rgba_sha256_matches, 0);

  let conclusion;
  if (totalM1 + totalM2 + totalM3 + totalM4 === 0) {
    conclusion = 'ZERO_HASH_MATCHES';
  } else if (totalM2 + totalM3 + totalM4 >= 1) {
    conclusion = 'PARTIAL_HASH_MATCHES';
  } else {
    conclusion = 'NO_USEFUL_HASH_MATCHES';
  }

  const out = {
    experiment_date: new Date().toISOString(),
    skill_version: 'v3.1.0-rc-P1',
    sample_count: results.length,
    total_M1_matches: totalM1,
    total_M2_image_matches: totalM2,
    total_M3_render_png_matches: totalM3,
    total_M4_render_raw_matches: totalM4,
    conclusion,
    results,
  };

  const outFile = path.join(outDir, `hash_experiment_${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[hash-experiment] WROTE ${outFile}`);
  console.log(`[hash-experiment] CONCLUSION: ${conclusion}`);
})();
