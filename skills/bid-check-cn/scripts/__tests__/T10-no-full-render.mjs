#!/usr/bin/env node
/**
 * T10：默认工作流不得全文渲染（v3.1 能力 B）
 * 期望：T10-mixed-bid.pdf（6 页，混合 text/scanned/mixed/small-logo）
 *       visual_candidate_pages < total_pages（即跳过部分文字页）
 *
 * 关键约束：候选页数必须远小于总页数（绝对值差），证明"没有退化到全文渲染"。
 * 真实 标段1.pdf（259 pages）产生 144 candidates（55.6%），T10 fixture 也应该有类似比例。
 */
import { reconFor, reportPass, reportFail } from './helpers.mjs';

const rec = reconFor('T10-mixed-bid.pdf');

const total = rec.pdf_pages;
const candidates = rec.visual_candidate_pages || [];
const skipped = rec.summary?.skipped_pages || 0;
const cand_pct = candidates.length / total;

// 要求：
//   1) 候选页数 < 总页数（必须有 skipped）
//   2) 跳过的页数 >= 2（T10 故意构造 3 个 text-only 页 + 1 个 small-logo 页 = 4 should skip）
if (candidates.length >= total) {
  console.log(JSON.stringify(reportFail('T10', 'all pages candidates = full-render behavior', { total, candidates: candidates.length })));
  process.exit(1);
}
if (skipped < 2) {
  console.log(JSON.stringify(reportFail('T10', 'too few skipped pages', { skipped, total })));
  process.exit(1);
}

// 进一步：候选页数不应该超过总页数的 80%（避免退化）
if (cand_pct > 0.80) {
  console.log(JSON.stringify(reportFail('T10', 'candidates too many (>80%)', { cand_pct })));
  process.exit(1);
}

console.log(JSON.stringify(reportPass('T10', '默认工作流不全渲染（v3.1 能力 B 已生效）', {
  total_pages: total,
  candidates: candidates.length,
  skipped,
  candidate_pct: Math.round(cand_pct * 100) + '%',
  candidate_pages: candidates,
})));
process.exit(0);
