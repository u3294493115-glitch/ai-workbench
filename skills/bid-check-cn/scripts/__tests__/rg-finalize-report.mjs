#!/usr/bin/env node
/**
 * RG-FINAL-1~10：finalize_report.mjs 单元测试（机械闸门核心证据）
 *
 * 关键 case：
 *   RG-FINAL-1：完整 happy path → draft → 原子改名 → final 落盘 + run_registry
 *   RG-FINAL-2：缺 report_gate.md → ok=false，final 不被创建（机械闸门）
 *   RG-FINAL-3：report_gate.md run_id 不匹配 → 阻止落盘
 *   RG-FINAL-4：report_gate.md 用未来 completed_at → 阻止落盘
 *   RG-FINAL-5：hit_ids 含 C-999 非法编号 → 阻止落盘
 *   RG-FINAL-6：final 已存在且无 --force-overwrite → 阻止落盘
 *   RG-FINAL-7：read_failed 状态合法 → 允许（主体报告继续落盘 + 显式降级声明）
 *   RG-FINAL-8：复用过时 report_gate.md（run_id 与当前一致但来自"上次运行"）→ 阻止落盘
 *     （run_id 一致且 completed_at 早于 draft mtime 时被时间闸门识别）
 *   RG-FINAL-9：completed_at 晚于 draft mtime → 阻止（防事后补 Gate）
 *   RG-FINAL-10：复用过时 report_gate.md（completed_at 早于 main_audit_completed_at）→ 阻止
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const SKILL_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'finalize_report.mjs');

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
    '',
    '## 历史案例清单',
    '',
    '- C-001 单位名称',
    '- C-002 资格人员',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# 项目\n\n## 8. 历史案例库入口\n\n`AI审查/历史废标与扣分案例库.md`\n');
  fs.mkdirSync(path.join(root, 'output', '_work'), { recursive: true });
  // v3.3.3：创建被扫描的 draft（Gate 须记录该 draft 的 SHA）
  const draftPath = path.join(root, 'output', '_work', 'report_draft.md');
  fs.writeFileSync(draftPath, '# 草稿报告\n\n## 模块1\n');
  return { libPath, draftPath };
}
function writeGateMd(root, fm, body = '') {
  const p = path.join(root, 'output', '_work', 'report_gate.md');
  const fmText = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(p, `---\n${fmText}\n---\n\n${body}\n`);
  return p;
}
function runFinalize(args) {
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

// 1. happy path：no_hit 完整 → 原子改名成功
cases.push({
  id: 'RG-FINAL-1', desc: 'happy path（no_hit 完整 + draft 绑定） → final 落盘 + registry',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'no_hit', completed_at: NOW,
    case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    draft_path: draftPath, draft_sha256: draftSha,
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === true)) return false;
    const finalPath = path.join(root, 'output', '审核报告.md');
    return fs.existsSync(finalPath) && !fs.existsSync(path.join(root, 'output', '_work', 'report_draft.md'));
  },
});

// 2. 缺 report_gate.md → 阻止落盘
cases.push({
  id: 'RG-FINAL-2', desc: 'report_gate.md 缺失 → 阻止 final 落盘（机械闸门）',
  setup: () => {},
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false && /preflight|不存在/.test(r.reason))) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

// 11. P1-2 修复回归：Gate 声称扫描 A，finalize 传入 B → 阻止
cases.push({
  id: 'RG-FINAL-11', desc: 'Gate 绑定 draft A，finalize 用 B → 阻止（防替换 draft 攻击）',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'no_hit', completed_at: NOW,
    case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    draft_path: draftPath, draft_sha256: draftSha,
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'replacement.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false)) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
  postSetup: (root) => {
    // 写一份未被扫描的 replacement 草稿
    fs.writeFileSync(path.join(root, 'output', '_work', 'replacement.md'), '# 完全不同的草稿 - 没被扫描过');
  },
});

// 12. P1-2 修复回归：篡改已扫描的 draft 内容 → 阻止
cases.push({
  id: 'RG-FINAL-12', desc: 'Gate 绑定 draft，但 finalize 前修改 draft 内容 → 阻止',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'no_hit', completed_at: NOW,
    case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    draft_path: draftPath, draft_sha256: draftSha,
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false)) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
  postSetup: (root) => {
    // 篡改 draft 内容（但保持文件名不变）
    fs.writeFileSync(path.join(root, 'output', '_work', 'report_draft.md'), '# 篡改后的草稿\n');
  },
});

// 13. P1-3 修复回归：read_failed 但 draft 无披露 → 阻止
cases.push({
  id: 'RG-FINAL-13', desc: 'read_failed + draft 不含披露 → 阻止落盘',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'read_failed', completed_at: NOW,
    failure_reason: '案例库不存在', failure_at: NOW,
    draft_path: draftPath, draft_sha256: draftSha,
  }, '# Gate 正文\n\n本次审核未参考历史案例\n\n失败原因：案例库不存在\n失败时间：' + NOW + '\n'),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false && /披露|未参考历史案例/.test(r.preflight_reason || r.reason))) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
  preSetup: (root) => {
    // draft 不包含披露
    fs.writeFileSync(path.join(root, 'output', '_work', 'report_draft.md'), '# 草稿\n');
  },
});

// 14. P1-3 修复回归：read_failed 完整披露 → 允许
cases.push({
  id: 'RG-FINAL-14', desc: 'read_failed + Gate + draft 都含披露块 → 允许落盘',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'read_failed', completed_at: NOW,
    failure_reason: '案例库不存在', failure_at: NOW,
    draft_path: draftPath, draft_sha256: draftSha,
  }, '# Gate 正文\n\n本次审核未参考历史案例（read_failed 降级声明）\n\n失败原因：案例库不存在\n失败时间：' + NOW + '\n'),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === true && r.preflight.status === 'read_failed')) return false;
    return fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
  preSetup: (root) => {
    // draft 含披露
    fs.writeFileSync(path.join(root, 'output', '_work', 'report_draft.md'),
      '# 报告\n\n## AI 报告声明\n本次审核未参考历史案例（案例库读取失败）\n\n失败原因：案例库不存在\n失败时间：' + NOW + '\n');
  },
});

// 3. run_id 不匹配
cases.push({
  id: 'RG-FINAL-3', desc: 'report_gate.md run_id 不匹配 → 阻止落盘',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'OTHER', status: 'no_hit', completed_at: NOW,
    case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    draft_path: draftPath, draft_sha256: draftSha,
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false)) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

// 4. completed_at 在未来
cases.push({
  id: 'RG-FINAL-4', desc: 'Gate completed_at 在未来 → 阻止落盘',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'no_hit', completed_at: AFTER,
    case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    draft_path: draftPath, draft_sha256: draftSha,
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', NOW,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false)) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

// 5. hit_ids 含 C-999
cases.push({
  id: 'RG-FINAL-5', desc: 'hit_ids 含 C-999 非法编号 → 阻止落盘',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'hit', completed_at: NOW,
    case_library_path: libPath, case_library_sha256: sha, hit_ids: 'C-999',
    draft_path: draftPath, draft_sha256: draftSha,
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false && /C-999/.test(r.preflight_reason || ''))) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

// 6. final 已存在
cases.push({
  id: 'RG-FINAL-6', desc: 'final 已存在无 --force-overwrite → 阻止落盘',
  setup: (root, libPath, sha, draftPath, draftSha) => {
    writeGateMd(root, {
      run_id: 'r1', status: 'no_hit', completed_at: NOW,
      case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
      draft_path: draftPath, draft_sha256: draftSha,
    });
    fs.writeFileSync(path.join(root, 'output', '审核报告.md'), '# 旧报告\n');
  },
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false && /已存在/.test(r.reason))) return false;
    const finalPath = path.join(root, 'output', '审核报告.md');
    return fs.readFileSync(finalPath, 'utf-8') === '# 旧报告\n';
  },
});

// 7. read_failed → 允许（主体报告继续落盘）
cases.push({
  id: 'RG-FINAL-7', desc: 'read_failed 完整 + 披露 → 允许落盘（主体报告继续 + 显式降级声明）',
  setup: (root, libPath, sha, draftPath, draftSha) => writeGateMd(root, {
    run_id: 'r1', status: 'read_failed', completed_at: NOW,
    failure_reason: '案例库路径不存在', failure_at: NOW,
    draft_path: draftPath, draft_sha256: draftSha,
  }, '# Gate 正文\n\n本次审核未参考历史案例\n\n失败原因：案例库路径不存在\n失败时间：' + NOW + '\n'),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', BEFORE,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === true && r.preflight.status === 'read_failed')) return false;
    return fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
  preSetup: (root) => {
    // draft 含披露
    fs.writeFileSync(path.join(root, 'output', '_work', 'report_draft.md'),
      '# 报告\n\n## AI 报告声明\n本次审核未参考历史案例（案例库读取失败）\n\n失败原因：案例库路径不存在\n失败时间：' + NOW + '\n');
  },
});

// 8. 复用过时 Gate（run_id 一致但 Gate 在更早；防复用 → 时间闸门触发）
// 主体审核完成时间 NOW，Gate completed_at 在 main 之前很久 → 时间倒序失败
cases.push({
  id: 'RG-FINAL-8', desc: 'Gate completed_at 早于 main_audit_completed_at → 阻止（防复用旧 Gate）',
  setup: (root, libPath, sha) => writeGateMd(root, {
    run_id: 'r1', status: 'no_hit', completed_at: BEFORE, // 远早于 main
    case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
  }),
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', NOW,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false)) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

// 9. 事后伪造 Gate：mtime 设为远早于 main_audit_completed_at
cases.push({
  id: 'RG-FINAL-9', desc: '事后伪造 Gate（mtime 早于 main_audit_completed_at） → 阻止落盘',
  setup: (root, libPath, sha) => {
    const gatePath = writeGateMd(root, {
      run_id: 'r1', status: 'no_hit', completed_at: NOW,
      case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    });
    // 把 Gate 文件 mtime 设为 main 之前很久
    fs.utimesSync(gatePath, new Date(Date.now() - 600000), new Date(Date.now() - 600000));
    return gatePath;
  },
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', NOW,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false && /mtime|事后补|早于/.test(r.preflight_reason || r.reason || ''))) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

// 10. 复用过时 Gate（run_id 一致，mtime 太早） → 阻止
cases.push({
  id: 'RG-FINAL-10', desc: '复用上一次运行留下的 Gate（mtime 太早） → 阻止落盘',
  setup: (root, libPath, sha) => {
    const gatePath = writeGateMd(root, {
      run_id: 'r1', status: 'no_hit', completed_at: NOW,
      case_library_path: libPath, case_library_sha256: sha, scanned_ids: 'C-001,C-002',
    });
    fs.utimesSync(gatePath, new Date(Date.now() - 7 * 86400_000), new Date(Date.now() - 7 * 86400_000));
    return gatePath;
  },
  runArgs: (root) => ['--project-root', root, '--run-id', 'r1', '--main-audit-completed-at', NOW,
                      '--draft', path.join(root, 'output', '_work', 'report_draft.md')],
  expect: (r, root) => {
    if (!(r && r.ok === false)) return false;
    return !fs.existsSync(path.join(root, 'output', '审核报告.md'));
  },
});

for (const c of cases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-final-'));
  const { libPath, draftPath } = setupBase(root);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(libPath)).digest('hex');
  // preSetup 先于 setup（用于修改 draft → setup 用新 SHA）
  if (c.preSetup) c.preSetup(root);
  const draftSha = crypto.createHash('sha256').update(fs.readFileSync(draftPath)).digest('hex');
  c.setup(root, libPath, sha, draftPath, draftSha);
  // postSetup 后于 setup（用于篡改 draft → finalize 应拒绝）
  if (c.postSetup) c.postSetup(root);
  const r = runFinalize(c.runArgs(root));
  const parsed = parseResult(r);
  const cond = c.expect(parsed, root);
  check(c.id, c.desc, cond, c.skipDetail ? { skipped: true } : { exit: r.status, parsed });
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`---`);
console.log(`RG-FINAL: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);