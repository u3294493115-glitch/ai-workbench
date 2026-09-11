#!/usr/bin/env node
/**
 * T1：纯文字页不进入视觉候选
 * 期望：recon P1.is_visual_candidate=false（text_only）
 */
import { reconFor, reportPass, reportFail } from './helpers.mjs';

const rec = reconFor('T1-text-only.pdf');
const p1 = rec.pages.find(p => p.page === 1);
if (!p1) { console.log(JSON.stringify(reportFail('T1', 'no page 1'))); process.exit(1); }
if (p1.is_visual_candidate === false) {
  console.log(JSON.stringify(reportPass('T1', '纯文字页不进入视觉候选', { reason: p1.candidate_reasons })));
  process.exit(0);
}
console.log(JSON.stringify(reportFail('T1', 'P1 should not be visual candidate', p1)));
process.exit(1);
