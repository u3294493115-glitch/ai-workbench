#!/usr/bin/env node
/**
 * bid-check-cn v3.3.0-pymupdf: runs all scripts/py/__tests__/*.mjs
 * and reports aggregated PASS / FAIL counts.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const SKILL_ROOT = path.resolve(HERE, '..', '..', '..');
// 测试报告写到 __tests__/test-runs/ 目录（gitignore 排除），不污染 SKILL_ROOT
const OUT_DIR = path.join(HERE, 'test-runs');
fs.mkdirSync(OUT_DIR, { recursive: true });

const tests = [
  ['T-py-evidence-basic', 'test_evidence_manifest_basic.mjs', 'evidence_manifest: basic candidate->render->vision status aggregation'],
  ['T-py-evidence-failures', 'test_evidence_manifest_failures.mjs', 'evidence_manifest: rejection / timeout / low_confidence handling'],
  ['T-py-parsefail', 'test_parse_failure.mjs', 'Parse failure: corrupt/empty/text-as-pdf surfaces errors'],
];

const results = [];
for (const [id, script, descr] of tests) {
  const scriptPath = path.join(HERE, script);
  if (!fs.existsSync(scriptPath)) {
    results.push({ id, descr, state: 'SKIP', exit: -1, detail: 'missing' });
    console.log(`SKIP  ${id}  ${descr}  (missing ${script})`);
    continue;
  }
  const r = spawnSync(process.execPath, [scriptPath], { encoding: 'utf-8', timeout: 600000, cwd: SKILL_ROOT });
  const lastLine = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let pass = -1, fail = -1, total = -1;
  const m = lastLine.match(/(\d+)\s*PASS\s*\/\s*(\d+)\s*FAIL\s*\/\s*(\d+)\s*TOTAL/);
  if (m) { pass = +m[1]; fail = +m[2]; total = +m[3]; }
  const state = r.status === 0 ? 'PASS' : 'FAIL';
  const detail = m ? `${pass}/${total}` : lastLine.slice(0, 80);
  results.push({ id, descr, state, exit: r.status, pass, fail, total, detail });
  console.log(`${state.padEnd(4)}  ${id}  ${descr}  (${detail})`);
}

const allPass = results.filter(r => r.state === 'PASS').length;
const allFail = results.filter(r => r.state === 'FAIL').length;
const allSkip = results.filter(r => r.state === 'SKIP').length;
console.log(`\n=== T-py: ${allPass} PASS / ${allFail} FAIL / ${allSkip} SKIP (total ${results.length}) ===`);

const date = new Date().toISOString().slice(0, 10);
const reportPath = path.join(OUT_DIR, `T-py-report-${date}.md`);
let md = `# T-py-* 行为测试报告\n\n执行日期: ${date}\nSkill 版本: v3.3.0-pymupdf (PyMuPDF + thin Node)\n\n\n`;
md += `| ID | 描述 | 状态 | 备注 |\n|---|---|---|---|\n`;
for (const r of results) {
  md += `| ${r.id} | ${r.descr} | ${r.state} | ${r.detail} |\n`;
}
md += `\n**总计**: ${allPass} / ${results.length} PASS; ${allFail} FAIL; ${allSkip} SKIP\n`;
fs.writeFileSync(reportPath, md);
console.log(`报告写入 ${reportPath}`);
process.exit(allFail > 0 ? 1 : 0);