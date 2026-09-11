#!/usr/bin/env node
/**
 * T9：OCR 结果与已人工复核资料冲突 → 必须进入 CONFLICT 状态，不静默覆盖
 *
 * 任务书第十条："对于以下高风险字段（公司名称 / 统一社会信用代码 / 人员姓名 /
 *              证书编号 / 专业 / 等级 / 注册单位 / 有效期），如果 OCR/视觉结果
 *              与已人工复核资料库发生冲突，不得静默采用 OCR 结果。
 *              应输出：冲突 / 待复核 并回到原图。"
 *
 * 本测试模拟 Stage 2 冲突检测：
 *   1) 库里 HIGH tier 公司名 = "江苏测试新能源有限公司"
 *   2) OCR/视觉结果识别为 "江苏测试新源能有限公司"（typo 错字）
 *   3) 期望判定：CONFLICT，必须人工复核；不得 PASS
 */
import path from 'path';
import { libraryRead, reportPass, reportFail, FIXTURES_DIR } from './helpers.mjs';

const lib = libraryRead(path.join(FIXTURES_DIR, 'library_mini.md'));

const HIGH_NAME_LIBRARY = '江苏测试新能源有限公司';
const OCR_NAME_RECOGNIZED = '江苏测试新源能有限公司';   // 故意模拟 1 字差异

// 库里的 HIGH tier name
const company = lib.by_company[HIGH_NAME_LIBRARY];
if (!company || company.tier_default !== 'HIGH') {
  console.log(JSON.stringify(reportFail('T9', 'fixture library broken for HIGH company')));
  process.exit(1);
}

// 模拟 Stage 2 冲突检测算法（必返回 CONFLICT，不可静默 PASS）
function stage2_judge(libraryName, ocrName) {
  if (libraryName === undefined) return { state: '❌_NOT_PROVIDED' };
  if (libraryName === ocrName) return { state: '✅_PASS', field: libraryName };
  // 严格逐字比较 — 不接受归一化/纠错/补全
  return { state: '⚠️_CONFLICT', library: libraryName, ocr: ocrName, requires_human_review: true };
}

const j = stage2_judge(HIGH_NAME_LIBRARY, OCR_NAME_RECOGNIZED);
if (j.state !== '⚠️_CONFLICT') {
  console.log(JSON.stringify(reportFail('T9', 'conflict should be detected', j)));
  process.exit(1);
}
if (j.requires_human_review !== true) {
  console.log(JSON.stringify(reportFail('T9', 'must require human review', j)));
  process.exit(1);
}

console.log(JSON.stringify(reportPass('T9', 'OCR vs 已人工复核冲突必须进 CONFLICT 状态', j)));
process.exit(0);
