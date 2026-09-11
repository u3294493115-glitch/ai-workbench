#!/usr/bin/env node
/**
 * T1-T10 + RG-* 编排入口：依次 fork 每个脚本，收集 exit code + stdout JSON
 * 支持单 case（最后一行 JSON）和多 case（每行 JSON）两种输出格式
 * 输出 Markdown 报告到 output/_work/test-runs/T-报告-<date>.md
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const SKILL_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(SKILL_ROOT, 'output', '_work', 'test-runs');

const tests = [
  ['T1', 'T1-text-page-not-candidate.mjs', '纯文字页不进入视觉候选'],
  ['T2', 'T2-scanned-cert-is-candidate.mjs', '纯扫描证书页进入视觉候选'],
  ['T3', 'T3-mixed-page-still-candidate.mjs', '文字+大面积证书图仍进候选'],
  ['T4', 'T4-small-logo-not-candidate.mjs', '小 logo + 文字不进候选'],
  ['T5', 'T5-library-fact-reuse-high.mjs', 'HIGH 资质字段可被解析'],
  ['T6', 'T6-library-present-but-bid-missing.mjs', '资质库有 ≠ 当前投标文件已提交'],
  ['T7', 'T7-library-low-tier-not-pass.mjs', 'LOW tier 不支撑 PASS'],
  ['T8', 'T8-cross-page-propagation.mjs', '跨页证书传播触发'],
  ['T9', 'T9-ocr-vs-library-conflict.mjs', 'OCR vs HIGH 冲突进 CONFLICT'],
  ['T10', 'T10-no-full-render.mjs', '默认不全渲染'],
  ['RG-LOAD', 'rg-load-case-index.mjs', 'load_case_index 路径发现 + 合法 ID + 归档 canary (6 case)'],
  ['RG-CHECK', 'rg-check-report-gate.mjs', 'check_report_gate preflight 9 项硬校验 (15 case)'],
  ['RG-FINAL', 'rg-finalize-report.mjs', 'finalize_report 机械闸门 (10 case)'],
];

const results = [];
for (const [id, script, descr] of tests) {
  const scriptPath = path.join(HERE, script);
  const r = spawnSync(process.execPath, [scriptPath], { stdio: 'pipe', cwd: SKILL_ROOT });
  const lines = r.stdout.toString().trim().split('\n').filter(Boolean);
  const parsedList = [];
  for (const line of lines) {
    try { parsedList.push(JSON.parse(line)); } catch { /* 非 JSON 行忽略 */ }
  }
  // v3.3.3 收口：汇总器强制要求子进程退出码 = 0；任意 sub-state=FAIL → 整体 FAIL。
  // 子进程打印 PASS 但 exit(1) 必须被识别为 FAIL（v3.3.2 第三方 审计 P1-4 攻击路径）。
  const exitCode = r.status;
  const subStates = [];
  if (parsedList.length === 0) {
    // 无 JSON 输出（v3.3.3 P2-2 收口）：零用例不能算 PASS
    subStates.push({ state: 'NOT_PROVEN', message: r.stderr.toString().trim() || 'no output (no test cases reported)' });
  } else {
    for (const p of parsedList) subStates.push({ state: p.state || 'NOT_PROVEN', message: p.message || '' });
  }
  // 整体状态：任何 sub FAIL → FAIL；否则任何 sub NOT_PROVEN → NOT_PROVEN；否则 PASS
  // 但必须 exit=0；exit≠0 → FAIL
  // v3.3.3 收口（P2-2）：零输出 + exit=0 → NOT_PROVEN（"没有产生任何测试用例"不是 PASS）
  let overallState;
  if (exitCode !== 0) overallState = 'FAIL';
  else if (subStates.length === 0) overallState = 'NOT_PROVEN';
  else if (subStates.some(x => x.state === 'FAIL')) overallState = 'FAIL';
  else if (subStates.some(x => x.state === 'NOT_PROVEN')) overallState = 'NOT_PROVEN';
  else overallState = 'PASS';
  results.push({
    id, descr, exit_code: exitCode,
    state: overallState,
    message: subStates.length > 1
      ? `${subStates.filter(x => x.state === 'PASS').length} PASS / ${subStates.filter(x => x.state === 'FAIL').length} FAIL (exit=${exitCode})`
      : (subStates[0]?.message || ''),
    sub_count: subStates.length,
    sub_pass: subStates.filter(x => x.state === 'PASS').length,
  });
}

const pass = results.filter(x => x.state === 'PASS').length;
const fail = results.filter(x => x.state === 'FAIL').length;
const notProven = results.filter(x => x.state === 'NOT_PROVEN').length;

console.log('---');
console.log(`T1-T10 + RG: ${pass} PASS / ${fail} FAIL / ${notProven} NOT_PROVEN (total ${results.length})`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const reportPath = path.join(OUT_DIR, `T-report-${date}.md`);
let md = `# T1-T10 + RG 行为测试报告\n\n`;
md += `执行日期：${date}\n`;
md += `Skill 版本：v3.3.3\n\n`;
md += `| ID | 描述 | 状态 | 备注 |\n|---|---|---|---|\n`;
for (const r of results) {
  const msg = (r.message || '').slice(0, 80).replace(/\|/g, '/');
  md += `| ${r.id} | ${r.descr} | ${r.state} | ${msg}${r.sub_count > 1 ? ` (${r.sub_count} sub)` : ''} |\n`;
}
md += `\n**总计**：${pass} / ${results.length} PASS；${fail} FAIL / ${notProven} NOT_PROVEN\n`;
fs.writeFileSync(reportPath, md);
console.log(`报告写入 ${reportPath}`);
process.exit(fail > 0 ? 1 : 0);