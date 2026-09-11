#!/usr/bin/env node
/**
 * bid-check-cn v3.1.0-rc Phase P2：廉价页级侦察（v3.1 能力 A）
 *
 * 任务书第八节硬约束：
 *   "所有页面都要进入侦察 ≠ 所有页面都渲染 ≠ 所有页面都 OCR
 *    ≠ 所有页面都视觉理解"
 *
 * 职责：
 *   1) 廉价读取每页：native text 长度 + 嵌入图片数量 + 大图占页面面积
 *   2) 输出 4-case 判定（Case A 文字页 / Case B 纯扫描证书页 /
 *                       Case C 文字+大面积证书图 / Case D 普通 Logo）
 *   3) 跨页传播：候选页 N → 把 N+1 也标记为候选（任务书第九节 + E-006）
 *
 * 输入：<pdf_path> [out_dir]
 * 输出：<out_dir>/<pdf_basename>.recon.json
 *
 * 不调用 render 工具；不输出 PNG；不输出 base64。
 * 复用 os.tmpdir()/pdfjs-workdir（与 hash_match_experiment.mjs 同约定）。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

function importAbs(p) {
  return import(pathToFileURL(p).href);
}

const TMP_ROOT = os.tmpdir();
const WORKDIR = path.join(TMP_ROOT, 'pdfjs-workdir');

// 4-case 判定阈值（任务书第八节）
const TEXT_THRESHOLD = 30;             // < 30 chars 视为"几乎无 text"
const MAJOR_IMAGE_FRAC = 0.20;         // 最大嵌入图占页面面积 >= 20% 视为"大面积"
const LOGO_FRAC = 0.05;               // < 5% 视为"小 logo"
const PT2_PER_PNG_BYTE = 3;           // render_bytes_estimate 估算系数

function usage() {
  console.error('用法: node scripts/pdf_page_recon.mjs <pdf路径> [out_dir]');
  console.error('       默认 out_dir = <pdf所在目录>/_work/recon/');
  process.exit(1);
}

const pdfPath = process.argv[2];
const outDirArg = process.argv[3];
if (!pdfPath) usage();
if (!fs.existsSync(pdfPath)) {
  console.error('[pdf_page_recon] NOT FOUND:', pdfPath);
  process.exit(2);
}

// 路径安全：禁止写入 input/ （与 render_pdf_pages.mjs 同款约定）
const cwd = process.cwd();
const inputDir = path.join(cwd, 'input');
const absOutDir = outDirArg ? path.resolve(outDirArg) : path.join(path.dirname(path.resolve(pdfPath)), '_work', 'recon');
if (absOutDir === path.resolve(inputDir) || absOutDir.startsWith(path.resolve(inputDir) + path.sep)) {
  console.error('[pdf_page_recon] 禁止向 input/ 写入：', absOutDir);
  process.exit(3);
}

fs.mkdirSync(absOutDir, { recursive: true });

async function main() {
  const pdfjsLib = await importAbs(path.join(WORKDIR, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;

  console.log(`[pdf_page_recon] pdf=${path.basename(pdfPath)} pages=${pdf.numPages}`);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    let page;
    try {
      page = await pdf.getPage(i);
    } catch (e) {
      pages.push({
        page: i,
        error: `getPage failed: ${e.message}`,
        is_visual_candidate: false,
        candidate_reasons: ['page_load_failed'],
      });
      continue;
    }

    let w_pt = 0, h_pt = 0, text_chars = 0, image_count = 0, largest_image_area_pt2 = 0;
    try {
      const vp = page.getViewport({ scale: 1.0 });
      w_pt = vp.width;
      h_pt = vp.height;
      const pageArea = w_pt * h_pt;

      // 1) Native text 长度
      try {
        const tc = await page.getTextContent();
        for (const item of tc.items) {
          const s = item.str || '';
          text_chars += s.length;
        }
      } catch (_) { /* ignore */ }

      // 2) 嵌入图片（paintImageXObject/paintJpegXObject + 显式 drawImage）
      try {
        const ops = await page.getOperatorList();
        // 等 pdfjs 把对象解析完（同款约定见 scripts/extract_pdf_images.mjs）
        await new Promise(r => setTimeout(r, 20));
        const seen = new Set();
        for (let j = 0; j < ops.fnArray.length; j++) {
          const fn = ops.fnArray[j];
          // OPS.paintImageXObject = 85, OPS.paintJpegXObject = 86
          if (fn === 85 || fn === 86) {
            const imgIdx = ops.argsArray[j][0];
            if (seen.has(imgIdx)) continue;
            seen.add(imgIdx);
            image_count++;
            try {
              const img = await page.objs.get(imgIdx);
              if (img && img.width && img.height) {
                const a = img.width * img.height;
                if (a > largest_image_area_pt2) largest_image_area_pt2 = a;
              }
            } catch (_) { /* skip unresolved */ }
          }
        }
      } catch (_) { /* ignore */ }

      const has_text = text_chars >= TEXT_THRESHOLD;
      const largest_image_area_frac = pageArea > 0 ? largest_image_area_pt2 / pageArea : 0;
      const render_bytes_estimate = Math.round((w_pt * h_pt * PT2_PER_PNG_BYTE));

      // 4-case 判定
      const reasons = [];
      let is_visual_candidate = false;
      if (!has_text && image_count === 0) {
        // 完全空白页
        reasons.push('blank_page');
        is_visual_candidate = false;
      } else if (has_text && largest_image_area_frac < LOGO_FRAC) {
        // Case A 文字页（允许小 logo / 页码 / 图标）
        is_visual_candidate = false;
        if (image_count > 0) reasons.push('text_with_small_icons');
        else reasons.push('text_only');
      } else if (has_text && largest_image_area_frac < MAJOR_IMAGE_FRAC) {
        // Case A 文字页（含中等图但不到大面积）
        is_visual_candidate = false;
        if (image_count > 0) reasons.push('text_with_mid_images');
      } else if (!has_text && image_count >= 1) {
        // Case B 纯扫描证书页
        is_visual_candidate = true;
        reasons.push('scanned_cert_page');
      } else if (has_text && largest_image_area_frac >= MAJOR_IMAGE_FRAC) {
        // Case C 文字+大面积证书图
        is_visual_candidate = true;
        reasons.push('text_plus_major_image');
      } else {
        // 不可分类兜底（has_text=true, image=0 但 frac>=0.2 不可达；不可能）
        is_visual_candidate = false;
        reasons.push('unclassified');
      }

      pages.push({
        page: i,
        w_pt: Math.round(w_pt * 100) / 100,
        h_pt: Math.round(h_pt * 100) / 100,
        page_area_pt2: Math.round(w_pt * h_pt),
        text_chars,
        has_text,
        image_count,
        largest_image_area_pt2,
        largest_image_area_frac: Math.round(largest_image_area_frac * 10000) / 10000,
        render_bytes_estimate,
        is_visual_candidate,
        candidate_reasons: reasons,
        cross_page_propagated_for: null,
      });
    } catch (e) {
      pages.push({
        page: i,
        error: `recon failed: ${e.message}`,
        is_visual_candidate: true,                 // 失败页面默认进候选（保守）
        candidate_reasons: ['recon_failed_treated_as_candidate'],
      });
    }
  }

  // 跨页传播：候选页 N → 把 N+1 也标记为候选
  // 任务书第九节 + E-006：证书跨页连续性
  // D6 单向 N+1 + 收紧条件：N+1 必须本身有 image_count >= 2
  //   避免级联：单图（页眉 logo / 装饰）不应触发跨页传播
  for (let n = 0; n < pages.length - 1; n++) {
    if (pages[n].is_visual_candidate && !pages[n + 1].is_visual_candidate) {
      const n1 = pages[n + 1];
      const n1MultiImage = (n1.image_count || 0) >= 2;
      if (n1MultiImage) {
        n1.cross_page_propagated_for = [pages[n].page];
        n1.is_visual_candidate = true;
        n1.candidate_reasons = [...(n1.candidate_reasons || []), 'cross_page_from_' + pages[n].page];
      }
    }
  }

  // 汇总
  const total_pages = pages.length;
  const visual_candidate_pages = pages.filter(p => p.is_visual_candidate).length;
  const skipped_pages = pages.filter(p => !p.is_visual_candidate).length;
  const cross_page_propagated_pages = pages.filter(p => p.cross_page_propagated_for && p.cross_page_propagated_for.length > 0).length;
  const blank_pages = pages.filter(p => p.candidate_reasons && p.candidate_reasons.includes('blank_page')).length;
  const candidate_lists = pages.filter(p => p.is_visual_candidate).map(p => p.page);

  const out = {
    schema_version: 1,
    pdf_path: path.resolve(pdfPath),
    pdf_pages: total_pages,
    generated_at: new Date().toISOString(),
    heuristic_thresholds: {
      text_threshold: TEXT_THRESHOLD,
      major_image_frac: MAJOR_IMAGE_FRAC,
      logo_frac: LOGO_FRAC,
    },
    summary: {
      total_pages,
      visual_candidate_pages,
      skipped_pages,
      cross_page_propagated_pages,
      blank_pages,
    },
    visual_candidate_pages: candidate_lists,
    pages: pages,
  };

  const outFile = path.join(absOutDir, `${path.basename(pdfPath, path.extname(pdfPath))}.recon.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

  console.log(`[pdf_page_recon] WROTE ${outFile}`);
  console.log(`[pdf_page_recon] SUMMARY: total=${total_pages}  candidates=${visual_candidate_pages}  cross_page=${cross_page_propagated_pages}  blank=${blank_pages}  skipped=${skipped_pages}`);
}

main().catch(e => {
  console.error('[pdf_page_recon] FATAL:', e.stack);
  process.exit(99);
});
