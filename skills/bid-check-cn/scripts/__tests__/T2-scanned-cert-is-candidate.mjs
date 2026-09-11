#!/usr/bin/env node
/**
 * T2：纯扫描证书页（无 native text）进入视觉候选
 * 期望：recon P1.is_visual_candidate=true, candidate_reasons 含 scanned_cert_page
 */
import { reconFor, reportPass, reportFail } from './helpers.mjs';

const rec = reconFor('T2-scanned-cert.pdf');
const p1 = rec.pages.find(p => p.page === 1);
if (!p1) { console.log(JSON.stringify(reportFail('T2', 'no page 1'))); process.exit(1); }
const ok = p1.is_visual_candidate === true
  && Array.isArray(p1.candidate_reasons)
  && p1.candidate_reasons.includes('scanned_cert_page');
if (ok) {
  console.log(JSON.stringify(reportPass('T2', '纯扫描证书页进入视觉候选（scanned_cert_page）', p1)));
  process.exit(0);
}
console.log(JSON.stringify(reportFail('T2', 'P1 should be scanned_cert candidate', p1)));
process.exit(1);
