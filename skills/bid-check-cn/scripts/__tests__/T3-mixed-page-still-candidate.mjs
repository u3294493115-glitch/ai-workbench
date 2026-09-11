#!/usr/bin/env node
/**
 * T3：文字 + 大面积证书图混合页 → 仍进候选（不像 v1 选择性扫描那样漏掉）
 * 期望：recon P1.is_visual_candidate=true, candidate_reasons 含 text_plus_major_image
 */
import { reconFor, reportPass, reportFail } from './helpers.mjs';

const rec = reconFor('T3-text-plus-cert.pdf');
const p1 = rec.pages.find(p => p.page === 1);
if (!p1) { console.log(JSON.stringify(reportFail('T3', 'no page 1'))); process.exit(1); }
const ok = p1.is_visual_candidate === true
  && Array.isArray(p1.candidate_reasons)
  && p1.candidate_reasons.includes('text_plus_major_image');
if (ok) {
  console.log(JSON.stringify(reportPass('T3', '文字+大面积图混合页不会被文字层掩盖（text_plus_major_image）', p1)));
  process.exit(0);
}
console.log(JSON.stringify(reportFail('T3', 'P1 should be text_plus_major_image candidate', p1)));
process.exit(1);
