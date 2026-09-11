#!/usr/bin/env node
/**
 * T4：普通文字 + 小 logo 不进视觉候选（避免退化到全文本扫描）
 * 期望：recon P1.is_visual_candidate=false, candidate_reasons 含 text_with_small_icons 或 text_only
 */
import { reconFor, reportPass, reportFail } from './helpers.mjs';

const rec = reconFor('T4-small-logo.pdf');
const p1 = rec.pages.find(p => p.page === 1);
if (!p1) { console.log(JSON.stringify(reportFail('T4', 'no page 1'))); process.exit(1); }
const ok = p1.is_visual_candidate === false
  && Array.isArray(p1.candidate_reasons)
  && (p1.candidate_reasons.includes('text_with_small_icons') || p1.candidate_reasons.includes('text_only'));
if (ok) {
  console.log(JSON.stringify(reportPass('T4', '小 logo + 文字不进候选（避免退化全文渲染）', p1)));
  process.exit(0);
}
console.log(JSON.stringify(reportFail('T4', 'P1 should not be candidate (small logo with text)', p1)));
process.exit(1);
