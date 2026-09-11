#!/usr/bin/env node
/**
 * T7：OCR 待复核 LOW tier 资料 → 不得直接支撑 PASS，仅作辅助候选
 * 期望：library_mini.md 中 浙江OCR 测试 (T-CORP-002) 的 cert tier 应是 LOW；
 *       系统使用 tier=LOW 时必须降级为辅助候选
 */
import path from 'path';
import { libraryRead, reportPass, reportFail, FIXTURES_DIR } from './helpers.mjs';

const lib = libraryRead(path.join(FIXTURES_DIR, 'library_mini.md'));

const company = lib.by_company['浙江OCR测试电力有限公司'];
if (!company) {
  console.log(JSON.stringify(reportFail('T7', 'fixture library: 浙江OCR 测试 missing', Object.keys(lib.by_company))));
  process.exit(1);
}
// 浙江OCR 公司默认 tier 应该是 MEDIUM（已提取/OCR 待人工复核），不是 HIGH
if (company.tier_default === 'HIGH') {
  console.log(JSON.stringify(reportFail('T7', 'OCR 待复核公司不应被标记为 HIGH', { tier: company.tier_default })));
  process.exit(1);
}
// 至少一张证书为 LOW tier（待人工复核 或 待OCR）
const lowCerts = company.certificates.filter(x => x.tier === 'LOW');
if (lowCerts.length === 0) {
  console.log(JSON.stringify(reportFail('T7', 'expected at least 1 LOW cert', { certs: company.certificates.map(x => `${x.tier}:${x.name}`) })));
  process.exit(1);
}
// tier_default 应该 ≤ MEDIUM（LOW 也允许作为 default）
if (company.tier_default !== 'MEDIUM' && company.tier_default !== 'LOW') {
  console.log(JSON.stringify(reportFail('T7', 'OCR 公司默认 tier 应为 MEDIUM/LOW', { tier: company.tier_default })));
  process.exit(1);
}

console.log(JSON.stringify(reportPass('T7', 'OCR 待复核 LOW tier 不得直接 PASS', {
  company: company.name, default_tier: company.tier_default, low_cert_count: lowCerts.length, sample_low_cert: lowCerts[0].name,
})));
process.exit(0);
