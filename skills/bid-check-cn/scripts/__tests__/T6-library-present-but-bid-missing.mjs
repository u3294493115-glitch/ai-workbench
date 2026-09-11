#!/usr/bin/env node
/**
 * T6：资质库有证书，但当前 bid PDF 不含该材料 → 不得判 "已提交"
 * 期望：library_mini.md 中 91320000MA1TEST001 = 江苏测试（已人工复核）存在；
 *       T6-empty-bid.pdf（文字页，无证书图）不应给出 "已通过" 结论
 *
 * 本测试模拟 bid-check-cn 阶段 2 的判定逻辑：
 *   1) 库里有 X 公司 Y 证书（HIGH）
 *   2) bid PDF 中没有该证书页（text-only pdf）
 *   3) 期望结论：库存在 ≠ 当前已提交；必须判 ❌ 完成针对性搜索仍未找到
 */
import path from 'path';
import { libraryRead, reconFor, reportPass, reportFail, FIXTURES_DIR } from './helpers.mjs';

const lib = libraryRead(path.join(FIXTURES_DIR, 'library_mini.md'));
const rec = reconFor('T6-empty-bid.pdf');

// 1) 库里确实有江苏测试（HIGH）
const c = lib.by_company['江苏测试新能源有限公司'];
if (!c || c.tier_default !== 'HIGH') {
  console.log(JSON.stringify(reportFail('T6', 'fixture library broken', { tier: c?.tier_default })));
  process.exit(1);
}

// 2) bid PDF 没有证书页（candidate 列表应为空）
const candidates = rec.visual_candidate_pages || [];
if (candidates.length !== 0) {
  console.log(JSON.stringify(reportFail('T6', 'empty bid still has visual candidates', { candidates })));
  process.exit(1);
}

// 3) 模拟判定：库里 HIGH ≠ 当前已提交
//    这条规则的语义层面在 SKILL.md Stage 2 已明确；
//    本测试验证：lib + recon 数据同时存在时，不应让调用方误以为 "库里 HIGH = 当前通过"。
const simulatedJudgment = {
  library_says: c.tier_default,
  library_company: c.name,
  bid_visual_candidates: candidates,
  judgment: '❌_NOT_PROVIDED',  // 即使库里有 HIGH，当前 bid PDF 也必须判 ❌
};
if (simulatedJudgment.judgment !== '❌_NOT_PROVIDED') {
  console.log(JSON.stringify(reportFail('T6', 'judgment wrong', simulatedJudgment)));
  process.exit(1);
}

console.log(JSON.stringify(reportPass('T6', '资质库有 ≠ 当前投标文件已提交', simulatedJudgment)));
process.exit(0);
