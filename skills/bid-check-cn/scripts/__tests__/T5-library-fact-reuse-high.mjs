#!/usr/bin/env node
/**
 * T5：已知资质库（HIGH 字段）可被 read_qualification_library 解析 + tier=HIGH
 * 期望：通过 统一社会信用代码 91320000MA1TEST001 查到江苏测试新能源，证书 tier=HIGH
 *
 * 注意：本测试只验证"已人工复核字段可被解析为 HIGH tier"。
 * 不测试"本 PDF 中是否实际含有该证书"——那是 T6 的职责。
 */
import path from 'path';
import { libraryRead, FIXTURES_DIR, reportPass, reportFail } from './helpers.mjs';

const lib = libraryRead(path.join(FIXTURES_DIR, 'library_mini.md'));

const company = lib.by_credit_code['91320000MA1TEST001'];
if (!company || !company.length) {
  console.log(JSON.stringify(reportFail('T5', 'by_credit_code lookup failed', Object.keys(lib.by_credit_code))));
  process.exit(1);
}
const c = lib.by_company[company[0]];
if (!c) {
  console.log(JSON.stringify(reportFail('T5', 'company object missing', { company: company[0] })));
  process.exit(1);
}
// 江苏测试 = HIGH tier（已确认 + 已人工复核通过）
if (c.tier_default !== 'HIGH') {
  console.log(JSON.stringify(reportFail('T5', 'tier_default not HIGH', { tier: c.tier_default })));
  process.exit(1);
}
// 至少 2 张证书（营业执照 + 安全生产许可证）
const highCerts = c.certificates.filter(x => x.tier === 'HIGH');
if (highCerts.length < 2) {
  console.log(JSON.stringify(reportFail('T5', 'expected >=2 HIGH certs', { certs: c.certificates.map(x => `${x.tier}:${x.name}`) })));
  process.exit(1);
}
console.log(JSON.stringify(reportPass('T5', '已人工复核 HIGH 字段可被精确解析', {
  company: c.name, tier_default: c.tier_default, high_cert_count: highCerts.length, sample_high_cert: highCerts[0].name,
})));
process.exit(0);
