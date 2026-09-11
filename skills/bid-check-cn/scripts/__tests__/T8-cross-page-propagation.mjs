#!/usr/bin/env node
/**
 * T8：跨页证书连续性（任务书第九节 + E-006）
 * 期望：T8-two-page-cert.pdf：
 *   P1 = mixed-major-image → is_visual_candidate=true (native)
 *   P2 = text + 2 small images → is_visual_candidate=true (cross_page_from_1)
 */
import { reconFor, reportPass, reportFail } from './helpers.mjs';

const rec = reconFor('T8-two-page-cert.pdf');
const p1 = rec.pages.find(p => p.page === 1);
const p2 = rec.pages.find(p => p.page === 2);
if (!p1 || !p2) { console.log(JSON.stringify(reportFail('T8', 'missing pages', rec.pages.map(x=>x.page)))); process.exit(1); }

// P1 必须原生候选
const p1Native = p1.is_visual_candidate === true
  && Array.isArray(p1.candidate_reasons)
  && p1.candidate_reasons.includes('text_plus_major_image')
  && !p1.candidate_reasons.some(r => r.startsWith('cross_page_from_'));
if (!p1Native) {
  console.log(JSON.stringify(reportFail('T8', 'P1 should be native candidate', p1)));
  process.exit(1);
}

// P2 必须被 P1 跨页传播触发
const p2Cross = p2.is_visual_candidate === true
  && Array.isArray(p2.cross_page_propagated_for)
  && p2.cross_page_propagated_for.includes(1)
  && Array.isArray(p2.candidate_reasons)
  && p2.candidate_reasons.some(r => r === 'cross_page_from_1');
if (!p2Cross) {
  console.log(JSON.stringify(reportFail('T8', 'P2 should be cross_page_from_1', p2)));
  process.exit(1);
}

console.log(JSON.stringify(reportPass('T8', '跨页传播触发（任务书第九节 + E-006）', {
  P1: { candidate: p1.is_visual_candidate, reasons: p1.candidate_reasons },
  P2: { candidate: p2.is_visual_candidate, cross_page_propagated_for: p2.cross_page_propagated_for, reasons: p2.candidate_reasons },
})));
process.exit(0);
