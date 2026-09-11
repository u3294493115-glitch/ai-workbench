#!/usr/bin/env node
/**
 * RG-CHECK-1~10：check_report_gate.mjs 单元测试
 *
 * 每个 case 在隔离 tmpdir 建立 fake project_root + CLAUDE.md + 案例库，
 * 然后调用 check_report_gate.mjs 校验不同 frontmatter 形态。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const SKILL_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'check_report_gate.mjs');

function setupBase(root) {
  const libDir = path.join(root, 'AI审查');
  fs.mkdirSync(libDir, { recursive: true });
  const libPath = path.join(libDir, '历史废标与扣分案例库.md');
  fs.writeFileSync(libPath, [
    '# 历史废标与扣分案例库',
    '',
    '## 触发信号表',
    '',
    '| C-001 单位名称 | 保证金 |',
    '| C-002 资格人员 | 资质 |',
    '| C-009 报价金额 | 报价 |',
    '',
    '## 历史案例清单',
    '',
    '- C-001 单位名称',
    '- C-002 资格人员',
    '- C-009 报价金额',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# 项目', '', '## 8. 历史案例库入口', '',
    '`AI审查/历史废标与扣分案例库.md`', '',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'output', '_work'), { recursive: true });
  // v3.3.3：创建示例 draft（用于 draft 绑定校验）
  const draftPath = path.join(root, 'output', '_work', 'report_draft.md');
  fs.writeFileSync(draftPath, '# 草稿报告\n\n模块 1：…\n');
  return { libPath, draftPath };
}
function writeGateMd(root, fm, body = '') {
  const p = path.join(root, 'output', '_work', 'report_gate.md');
  const fmText = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(p, `---\n${fmText}\n---\n\n${body}\n`);
  return p;
}
function runCheck(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe' });
}
function parseResult(r) {
  try { return JSON.parse(r.stdout.toString().trim().split('\n').pop()); } catch { return null; }
}

let pass = 0, fail = 0;
function check(id, desc, cond, detail = {}) {
  if (cond) { console.log(JSON.stringify({ id, state: 'PASS', message: desc, detail })); pass++; }
  else { console.log(JSON.stringify({ id, state: 'FAIL', message: desc, detail })); fail++; }
}

const NOW = new Date().toISOString();
const BEFORE = new Date(Date.now() - 60000).toISOString();
const AFTER = new Date(Date.now() + 60000).toISOString();

const cases = [];

function makeCase(id, desc, gateFm, expect, body = '') {
  cases.push({ id, desc, gateFm, body, expect });
}

// 1. 缺失 file
makeCase('RG-CHECK-1', 'report_gate.md 不存在',
  {}, (r) => r && r.ok === false && /不存在/.test(r.reason));
cases[cases.length - 1].skipWrite = true;

// 2. 缺 run_id
makeCase('RG-CHECK-2', 'frontmatter 缺 run_id',
  { status: 'no_hit', completed_at: NOW }, (r) => r && r.ok === false && /run_id/.test(r.reason));

// 3. run_id 不匹配
makeCase('RG-CHECK-3', 'run_id 与调用方不匹配',
  { run_id: 'OTHER', status: 'no_hit', completed_at: NOW, case_library_path: '/x', case_library_sha256: 'a' },
  (r) => r && r.ok === false && /不匹配/.test(r.reason));

// 4. status 非法
makeCase('RG-CHECK-4', 'status 非法',
  { run_id: 'r1', status: 'pending', completed_at: NOW },
  (r) => r && r.ok === false && /status/.test(r.reason));

// 5. 时间倒序（no_hit + 合法 scanned_ids；main_audit_completed_at 用 NOW，Gate 用 BEFORE）
makeCase('RG-CHECK-5', 'Gate 完成时间早于 main_audit_completed_at',
  { run_id: 'r1', status: 'no_hit', completed_at: BEFORE, scanned_ids: 'C-001,C-002,C-009' },
  (r) => r && r.ok === false && /早于|时序/.test(r.reason));
cases[cases.length - 1].mainAuditAt = NOW;

// 6. 时间在未来
makeCase('RG-CHECK-6', 'Gate 完成时间晚于当前调用（疑似伪造）',
  { run_id: 'r1', status: 'no_hit', completed_at: AFTER },
  (r) => r && r.ok === false && /伪造|未来|晚于/.test(r.reason));

// 7. read_failed 缺 failure_reason
makeCase('RG-CHECK-7', 'read_failed 缺 failure_reason',
  { run_id: 'r1', status: 'read_failed', completed_at: NOW, failure_at: NOW },
  (r) => r && r.ok === false && /failure_reason/.test(r.reason));

// 8. read_failed 缺 failure_at
makeCase('RG-CHECK-8', 'read_failed 缺 failure_at',
  { run_id: 'r1', status: 'read_failed', completed_at: NOW, failure_reason: 'path missing' },
  (r) => r && r.ok === false && /failure_at/.test(r.reason));

// 9. read_failed 完整 → 通过
makeCase('RG-CHECK-9', 'read_failed 完整字段 + Gate 正文披露 → 通过',
  { run_id: 'r1', status: 'read_failed', completed_at: NOW, failure_reason: '案例库未找到', failure_at: NOW },
  (r) => r && r.ok === true && r.status === 'read_failed',
  '# Gate 正文\n\n本次审核未参考历史案例\n\n失败原因：案例库未找到\n失败时间：' + NOW + '\n');

// 10. no_hit 缺 scanned_ids → 失败
makeCase('RG-CHECK-10', 'no_hit 缺 scanned_ids',
  { run_id: 'r1', status: 'no_hit', completed_at: NOW },
  (r) => r && r.ok === false && /scanned_ids/.test(r.reason));

// 11. no_hit 含未收录 ID → 失败
makeCase('RG-CHECK-11', 'no_hit scanned_ids 含未收录 ID',
  { run_id: 'r1', status: 'no_hit', completed_at: NOW, scanned_ids: 'C-001,C-002,C-999' },
  (r) => r && r.ok === false && /未收录|非法/.test(r.reason));

// 12. no_hit 缺部分案例 → 失败（覆盖度校验）
makeCase('RG-CHECK-12', 'no_hit scanned_ids 未覆盖当前正式索引',
  { run_id: 'r1', status: 'no_hit', completed_at: NOW, scanned_ids: 'C-001' },
  (r) => r && r.ok === false && /覆盖/.test(r.reason));

// 13. no_hit 完整覆盖 → 通过
makeCase('RG-CHECK-13', 'no_hit scanned_ids 完整覆盖正式索引 → 通过',
  { run_id: 'r1', status: 'no_hit', completed_at: NOW, scanned_ids: 'C-001,C-002,C-009' },
  (r) => r && r.ok === true && r.status === 'no_hit');

// 14. hit 含 C-999 → 失败（非法编号）
makeCase('RG-CHECK-14', 'hit_ids 含 C-999 非法编号',
  { run_id: 'r1', status: 'hit', completed_at: NOW, hit_ids: 'C-999' },
  (r) => r && r.ok === false && /C-999/.test(r.reason));

// 15. hit 合法 ID → 通过
makeCase('RG-CHECK-15', 'hit_ids 全部合法 → 通过',
  { run_id: 'r1', status: 'hit', completed_at: NOW, hit_ids: 'C-001' },
  (r) => r && r.ok === true && r.status === 'hit');

// 16. hit + draft 绑定：当前 draft SHA 与 Gate 记录的 draft_sha256 不一致 → 拒绝
makeCase('RG-CHECK-16', 'draft SHA 与 Gate 记录不一致 → 拒绝（防替换 draft）',
  { run_id: 'r1', status: 'no_hit', completed_at: NOW, scanned_ids: 'C-001,C-002,C-009',
    draft_path: '__DRAFT_ABS__', draft_sha256: 'WRONG_SHA' },
  (r) => r && r.ok === false && /draft_sha256|SHA/.test(r.reason));
cases[cases.length - 1].withDraft = true;

// 17. read_failed + failure_at 非 ISO8601 → 拒绝
makeCase('RG-CHECK-17', 'read_failed + failure_at=not-a-time → 拒绝',
  { run_id: 'r1', status: 'read_failed', completed_at: NOW,
    failure_reason: '案例库不存在', failure_at: 'not-a-time' },
  (r) => r && r.ok === false && /ISO8601|failure_at/.test(r.reason));

// 18. read_failed + Gate 正文无披露块 → 拒绝
makeCase('RG-CHECK-18', 'read_failed + Gate 正文无披露块 → 拒绝',
  { run_id: 'r1', status: 'read_failed', completed_at: NOW,
    failure_reason: '案例库不存在', failure_at: NOW },
  (r) => r && r.ok === false && /披露|未参考历史案例/.test(r.reason),
  '## 无披露的正文\n');

for (const c of cases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-check-'));
  const { libPath, draftPath } = setupBase(root);
  // 计算真实 SHA-256 填入
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(libPath)).digest('hex');
  const draftSha = crypto.createHash('sha256').update(fs.readFileSync(draftPath)).digest('hex');
  const libAbs = path.resolve(libPath);
  const fm = { ...c.gateFm };
  if (fm.status === 'no_hit' || fm.status === 'hit') {
    fm.case_library_path = libAbs;
    fm.case_library_sha256 = sha256;
  }
  if (c.id === 'RG-CHECK-14' || c.id === 'RG-CHECK-15') {
    fm.case_library_path = libAbs;
    fm.case_library_sha256 = sha256;
  }
  // v3.3.3 draft 绑定：替换占位符
  if (fm.draft_path === '__DRAFT_ABS__') fm.draft_path = draftPath;
  // 当测试要求绑定时，注入真实 draft_sha256
  if (c.withDraft && !fm.draft_sha256) fm.draft_sha256 = draftSha;
  if (!c.skipWrite) writeGateMd(root, fm, c.body);
  const args = [
    '--project-root', root,
    '--run-id', 'r1',
    '--main-audit-completed-at', c.mainAuditAt || BEFORE,
  ];
  if (c.withDraft) args.push('--draft', draftPath);
  const r = runCheck(args);
  const parsed = parseResult(r);
  check(c.id, c.desc, c.expect(parsed), { exit: r.status, parsed });
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`---`);
console.log(`RG-CHECK: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);