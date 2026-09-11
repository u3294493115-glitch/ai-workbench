#!/usr/bin/env node
/**
 * bid-check-cn thin PDF recon adapter (v3.3.0-pymupdf).
 *
 * Wraps scripts/py/pdf_inspect.py (PyMuPDF) and applies bid-check-cn business
 * judgment: 4-Case classification + cross-page N+1 propagation.
 *
 * This file does NOT implement PDF parsing, rendering, OCR or image bboxes.
 * All of those are delegated to PyMuPDF via pdf_inspect.py.
 *
 * Usage:
 *   node scripts/py/pdf_recon.mjs <pdf_path>
 *
 * Output: JSON object on stdout
 *   { ok: true,  pdf_pages, pages:[{page, text_chars, image_count,
 *                                  max_image_frac, is_visual_candidate,
 *                                  candidate_reasons, cross_page_propagated_for}],
 *     visual_candidate_pages:[1,5,6,9,...] }
 *   { ok: false, error }
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const PYTHON_BIN = process.env.PYTHON_BIN
  || '<PYTHON_EXE>';
const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'pdf_inspect.py');

// 4-Case thresholds (mirrors scripts/pdf_page_recon.mjs TEXT_THRESHOLD / MAJOR_IMAGE_FRAC)
const TEXT_THRESHOLD = 30;       // text_chars < 30 => "几乎无 text"
const MAJOR_IMAGE_FRAC = 0.20;   // max image area / page area >= 0.20 => "大面积"
const CROSS_PAGE_MIN_IMAGES = 2; // N+1 must have image_count >= this to be propagated

function usage() {
  console.error('用法: node scripts/py/pdf_recon.mjs <pdf_path>');
  process.exit(2);
}

const pdfPath = process.argv[2];
if (!pdfPath) usage();
if (!fs.existsSync(pdfPath)) {
  console.log(JSON.stringify({ ok: false, error: `pdf not found: ${pdfPath}` }, null, 2));
  process.exit(0);
}
if (!fs.existsSync(SCRIPT)) {
  console.log(JSON.stringify({ ok: false, error: `pdf_inspect.py missing: ${SCRIPT}` }, null, 2));
  process.exit(0);
}

const r = spawnSync(PYTHON_BIN, [SCRIPT, 'summary', pdfPath], { encoding: 'utf-8', timeout: 180000 });
let inspect;
try { inspect = JSON.parse(r.stdout); } catch (e) {
  console.log(JSON.stringify({ ok: false, error: `pdf_inspect.py returned non-JSON: ${r.stdout.slice(0, 200)} stderr=${r.stderr.slice(0, 200)}` }, null, 2));
  process.exit(0);
}

if (!inspect || inspect.ok !== true) {
  console.log(JSON.stringify({
    ok: false,
    error: inspect?.error || 'pdf_inspect.py returned ok=false (no error message)',
    pdf_path: pdfPath,
  }, null, 2));
  process.exit(0);
}

// Apply 4-Case judgment + cross-page N+1 propagation.
const pages = inspect.pages.map(p => ({ ...p, is_visual_candidate: false, candidate_reasons: [], cross_page_propagated_for: null }));

function classify(p) {
  const { text_chars, image_count, max_image_frac } = p;
  const has_text = text_chars >= TEXT_THRESHOLD;
  if (!has_text && image_count === 0) {
    return { is_visual_candidate: false, reasons: ['blank_page'] };
  }
  if (has_text && max_image_frac < 0.05) {
    return { is_visual_candidate: false, reasons: [image_count > 0 ? 'text_with_small_icons' : 'text_only'] };
  }
  if (has_text && max_image_frac < MAJOR_IMAGE_FRAC) {
    return { is_visual_candidate: false, reasons: ['text_with_mid_images'] };
  }
  if (!has_text && image_count >= 1) {
    return { is_visual_candidate: true, reasons: ['scanned_cert_page'] };
  }
  if (has_text && max_image_frac >= MAJOR_IMAGE_FRAC) {
    return { is_visual_candidate: true, reasons: ['text_plus_major_image'] };
  }
  return { is_visual_candidate: false, reasons: ['unclassified'] };
}

for (const p of pages) {
  const { is_visual_candidate, reasons } = classify(p);
  p.is_visual_candidate = is_visual_candidate;
  p.candidate_reasons = reasons;
}

// Cross-page N+1 propagation: candidate page N -> if N+1 image_count >= 2, mark N+1 as candidate
for (let i = 0; i < pages.length - 1; i++) {
  const cur = pages[i];
  const nxt = pages[i + 1];
  if (cur.is_visual_candidate && !nxt.is_visual_candidate && nxt.image_count >= CROSS_PAGE_MIN_IMAGES) {
    nxt.cross_page_propagated_for = [cur.page];
    nxt.is_visual_candidate = true;
    nxt.candidate_reasons = [...nxt.candidate_reasons, `cross_page_from_${cur.page}`];
  }
}

const out = {
  schema_version: 1,
  ok: true,
  pdf_path: path.resolve(pdfPath),
  pdf_pages: inspect.pdf_pages,
  heuristic_thresholds: { text_threshold: TEXT_THRESHOLD, major_image_frac: MAJOR_IMAGE_FRAC, cross_page_min_images: CROSS_PAGE_MIN_IMAGES },
  summary: {
    total_pages: pages.length,
    visual_candidate_pages: pages.filter(p => p.is_visual_candidate).length,
    cross_page_propagated_pages: pages.filter(p => p.cross_page_propagated_for && p.cross_page_propagated_for.length > 0).length,
    blank_pages: pages.filter(p => p.candidate_reasons.includes('blank_page')).length,
  },
  pages,
  visual_candidate_pages: pages.filter(p => p.is_visual_candidate).map(p => p.page),
};

console.log(JSON.stringify(out, null, 2));