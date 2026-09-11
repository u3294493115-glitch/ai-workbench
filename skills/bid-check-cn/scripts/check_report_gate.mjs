#!/usr/bin/env node
/**
 * check_report_gate.mjs（v3.3.3 新增）
 *
 * Report Gate 产物 preflight 闸门：在正式报告 `output/审核报告.md` 落盘前必须先通过本检查。
 *
 * 校验项（硬约束；任何一条不过 → ok=false）：
 *   1. `output/_work/report_gate.md` 必须存在
 *   2. 必须含 run_id 字段（与本次运行的 run_id 完全一致，防复用旧产物）
 *   3. Gate 状态必须是 hit / no_hit / read_failed 三选一
 *   4. Gate 完成时间 ≥ 主体审核 Stage 完成时间
 *   5. Gate 完成时间 < 当前调用时间（防事后补文件；具体：调用方传入 main_audit_completed_at）
 *   6. 状态 == read_failed → 必须显式包含失败原因 + 失败时间戳
 *   7. 状态 == no_hit → 必须显式列出已扫描的触发信号 ID 集合；不允许"已扫描 / 无命中"含糊措辞
 *   8. 状态 == hit → 命中 ID 集合必须 ⊆ load_case_index 输出的合法 ID 集合；非法编号必须判失败
 *   9. 必须含 案例库路径 + 案例库 SHA-256（即使 read_failed 也允许"未获取"+ 失败原因）
 *
 * 用法：
 *   node scripts/check_report_gate.mjs \
 *     --project-root <dir> \
 *     --run-id <id> \
 *     --main-audit-completed-at <ISO8601> \
 *     --report-gate-md <path>     # 可选；默认 <project>/output/_work/report_gate.md
 *
 *   exit code: 0 = ok，1 = preflight 不通过；stdout: 单行 JSON
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1];
}

function fail(reason, detail = {}) {
  return { ok: false, reason, ...detail };
}

function ok(detail) {
  return { ok: true, reason: null, ...detail };
}

function sha256OfFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function isValidIso8601(s) {
  if (!s || typeof s !== 'string') return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

function parseGateMd(text) {
  // 简易 frontmatter 解析：首段 --- ... --- 之间的 KV
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fm) return { frontmatter: {}, body: text };
  const fmText = fm[1];
  const body = fm[2];
  const out = {};
  for (const line of fmText.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { frontmatter: out, body };
}

function main() {
  const projectRoot = path.resolve(arg('--project-root', process.cwd()));
  const runId = arg('--run-id', null);
  const mainAuditCompletedAt = arg('--main-audit-completed-at', null);
  const reportGateMd = arg('--report-gate-md', path.join(projectRoot, 'output', '_work', 'report_gate.md'));
  const draftPath = arg('--draft', null); // v3.3.3：Gate 必须绑定被扫描 draft

  if (!runId) { console.log(JSON.stringify(fail('missing --run-id'))); process.exit(1); }
  if (!mainAuditCompletedAt) { console.log(JSON.stringify(fail('missing --main-audit-completed-at'))); process.exit(1); }

  // 1. 存在性
  if (!fs.existsSync(reportGateMd)) {
    console.log(JSON.stringify(fail('report_gate.md 不存在', { report_gate_md: reportGateMd })));
    process.exit(1);
  }
  const stat = fs.statSync(reportGateMd);
  const gateMtime = stat.mtime.toISOString();

  // 1.5 文件 mtime ≥ main_audit_completed_at（防事后补 Gate——文件 mtime 是 OS 不可改时间）
  // 允许 5 秒时钟偏移
  const skewMs = 5000;
  if (Date.parse(gateMtime) + skewMs < Date.parse(mainAuditCompletedAt)) {
    console.log(JSON.stringify(fail(
      `report_gate.md mtime (${gateMtime}) 早于 main_audit_completed_at (${mainAuditCompletedAt})，疑似事后补文件`,
      { gate_mtime: gateMtime, main_audit_completed_at: mainAuditCompletedAt },
    )));
    process.exit(1);
  }

  // 2. 解析 frontmatter
  const text = fs.readFileSync(reportGateMd, 'utf-8');
  const { frontmatter, body } = parseGateMd(text);

  if (!frontmatter.run_id) {
    console.log(JSON.stringify(fail('frontmatter 缺 run_id', { report_gate_md: reportGateMd })));
    process.exit(1);
  }
  if (frontmatter.run_id !== runId) {
    console.log(JSON.stringify(fail(
      `run_id 不匹配：gate=${frontmatter.run_id} 调用方=${runId}`,
      { report_gate_run_id: frontmatter.run_id, caller_run_id: runId },
    )));
    process.exit(1);
  }

  const status = frontmatter.status;
  if (!['hit', 'no_hit', 'read_failed'].includes(status)) {
    console.log(JSON.stringify(fail(`status 非法：${status}`, { status })));
    process.exit(1);
  }

  if (!frontmatter.completed_at) {
    console.log(JSON.stringify(fail('frontmatter 缺 completed_at')));
    process.exit(1);
  }
  const completedAt = frontmatter.completed_at;

  // 4. 时间顺序：main_audit_completed_at ≤ completed_at < 现在
  const t1 = Date.parse(mainAuditCompletedAt);
  const t2 = Date.parse(completedAt);
  if (Number.isNaN(t1) || Number.isNaN(t2)) {
    console.log(JSON.stringify(fail('时间字段不可解析', { mainAuditCompletedAt, completedAt })));
    process.exit(1);
  }
  if (t2 < t1) {
    console.log(JSON.stringify(fail(
      'Gate 完成时间早于主体审核完成时间（违反时序）',
      { mainAuditCompletedAt, completedAt },
    )));
    process.exit(1);
  }
  if (t2 > Date.now()) {
    console.log(JSON.stringify(fail('Gate 完成时间晚于当前调用时间（疑似事后伪造）', { completedAt, now: new Date().toISOString() })));
    process.exit(1);
  }

  // 9. 必须含 路径 + SHA-256（read_failed 时允许空但必须有 reason）
  const caseLibPath = frontmatter.case_library_path || '';
  const caseLibSha = frontmatter.case_library_sha256 || '';

  // v3.3.3 收口：剥离 HTML 注释后再做披露关键字检查（防 <!-- read_failed --> 隐藏披露）
  const visibleBody = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  function visibleDisclosureOK() {
    if (!/未参考历史案例|本次审核未参考/.test(visibleBody)) return false;
    if (!/失败原因|failure_reason|failure_reason\s*[:：]/.test(visibleBody)) return false;
    if (!/失败时间|failure_at|failure_at\s*[:：]/.test(visibleBody)) return false;
    return true;
  }
  function draftDisclosureOK() {
    if (!draftPath) return true;
    const draftText = fs.readFileSync(draftPath, 'utf-8');
    const visibleDraft = draftText.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    if (!/未参考历史案例|本次审核未参考/.test(visibleDraft)) return false;
    if (!/失败原因|failure_reason/.test(visibleDraft)) return false;
    if (!/失败时间|failure_at/.test(visibleDraft)) return false;
    return true;
  }

  // v3.3.3：read_failed 必须满足完整披露要求（前移到此以防 hit/no_hit 校验抢先）
  if (status === 'read_failed') {
    if (!frontmatter.failure_reason || !frontmatter.failure_at) {
      console.log(JSON.stringify(fail('read_failed 状态必须含 failure_reason + failure_at')));
      process.exit(1);
    }
    if (!isValidIso8601(frontmatter.failure_at)) {
      console.log(JSON.stringify(fail(
        `failure_at 必须是合法 ISO8601 时间戳，当前="${frontmatter.failure_at}"`,
        { failure_at: frontmatter.failure_at },
      )));
      process.exit(1);
    }
    if (caseLibPath && !caseLibSha) {
      console.log(JSON.stringify(fail('若声明了 case_library_path，必须同时声明 case_library_sha256')));
      process.exit(1);
    }
    if (!visibleDisclosureOK()) {
      console.log(JSON.stringify(fail(
        'read_failed 状态 Gate 正文（剥离 HTML 注释）必须包含"未参考历史案例" + 失败原因 + 失败时间',
        { body_excerpt: visibleBody.slice(0, 120) },
      )));
      process.exit(1);
    }
    verifyDraftBinding();
    if (!draftDisclosureOK()) {
      console.log(JSON.stringify(fail(
        'read_failed 状态下最终报告 draft 也必须包含"未参考历史案例" + 失败原因 + 失败时间',
        { draft: draftPath },
      )));
      process.exit(1);
    }
    return console.log(JSON.stringify(ok({
      status, completed_at: completedAt,
      case_library_path: caseLibPath || null,
      case_library_sha256: caseLibSha || null,
      run_id: runId,
    })));
  }

  // hit / no_hit 都必须含 case_library_path + case_library_sha256
  if (!caseLibPath || !caseLibSha) {
    console.log(JSON.stringify(fail('hit / no_hit 状态必须含 case_library_path + case_library_sha256')));
    process.exit(1);
  }

  // v3.3.3：draft 绑定 — 所有 status（含 read_failed）都必须验证；防 read_failed 早返绕过
  verifyDraftBinding();
  function verifyDraftBinding() {
    if (!draftPath) return; // 调用方未传 --draft，跳过
    if (!frontmatter.draft_path || !frontmatter.draft_sha256) {
      console.log(JSON.stringify(fail(
        'Gate frontmatter 必须含 draft_path + draft_sha256（v3.3.3 强制 draft 绑定）',
        { has_draft_path: !!frontmatter.draft_path, has_draft_sha256: !!frontmatter.draft_sha256 },
      )));
      process.exit(1);
    }
    if (!fs.existsSync(draftPath)) {
      console.log(JSON.stringify(fail('draft 不存在', { draft: draftPath })));
      process.exit(1);
    }
    const currentSha = sha256OfFile(draftPath);
    if (currentSha !== frontmatter.draft_sha256) {
      console.log(JSON.stringify(fail(
        '当前 draft SHA 与 Gate 记录的 draft_sha256 不一致（防替换 draft 攻击）',
        { draft: draftPath, gate_recorded_sha256: frontmatter.draft_sha256, current_sha256: currentSha },
      )));
      process.exit(1);
    }
    const gateAbsDraft = path.resolve(frontmatter.draft_path);
    const actualAbsDraft = path.resolve(draftPath);
    if (gateAbsDraft !== actualAbsDraft) {
      console.log(JSON.stringify(fail(
        '当前 draft 路径与 Gate 记录的 draft_path 不一致',
        { gate_draft_path: gateAbsDraft, actual_draft_path: actualAbsDraft },
      )));
      process.exit(1);
    }
  }

  // v3.3.3：read_failed 状态必须满足完整披露要求（前移 block 已在 line 152 完成；此处仅留占位）
  // （重复 block 已删除，避免早返绕过）

  // 调 load_case_index 拿合法 ID 集合
  const idxScript = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'load_case_index.mjs');
  const r = spawnSync(process.execPath, [idxScript, projectRoot], { stdio: 'pipe' });
  if (r.status !== 0) {
    console.log(JSON.stringify(fail('load_case_index 失败，无法验证 ID 合法性', { stderr: r.stderr.toString() })));
    process.exit(1);
  }
  let idx;
  try {
    idx = JSON.parse(r.stdout.toString().trim().split('\n').pop());
  } catch (e) {
    console.log(JSON.stringify(fail('load_case_index 输出无法解析', { stderr: r.stderr.toString() })));
    process.exit(1);
  }

  // 案例库 SHA 必须一致（防调用方篡改 / 文件被改）
  if (idx.case_library_sha256 !== caseLibSha) {
    console.log(JSON.stringify(fail('case_library_sha256 与当前案例库不一致', {
      gate_sha256: caseLibSha, current_sha256: idx.case_library_sha256,
    })));
    process.exit(1);
  }
  if (idx.case_library_path !== caseLibPath) {
    console.log(JSON.stringify(fail('case_library_path 与当前 load_case_index 不一致', {
      gate_path: caseLibPath, current_path: idx.case_library_path,
    })));
    process.exit(1);
  }

  // 7. no_hit 必须显式列已扫描信号
  if (status === 'no_hit') {
    const scanned = (frontmatter.scanned_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (scanned.length === 0) {
      console.log(JSON.stringify(fail('no_hit 状态必须显式列出 scanned_ids（逗号分隔），不允许省略')));
      process.exit(1);
    }
    const knownIds = new Set([...idx.signal_ids, ...idx.case_ids]);
    const unknown = scanned.filter(s => !knownIds.has(s));
    if (unknown.length > 0) {
      console.log(JSON.stringify(fail('scanned_ids 包含 load_case_index 未收录的项', { unknown })));
      process.exit(1);
    }
    // 必须覆盖当前正式索引
    const missing = [...knownIds].filter(s => !scanned.includes(s));
    if (missing.length > 0) {
      console.log(JSON.stringify(fail('scanned_ids 未覆盖当前正式索引', { missing })));
      process.exit(1);
    }
    return console.log(JSON.stringify(ok({
      status, completed_at: completedAt,
      case_library_path: caseLibPath, case_library_sha256: caseLibSha,
      run_id: runId, scanned_ids: scanned,
    })));
  }

  // 8. hit 必须命中 ID ⊆ 合法集合
  const hits = (frontmatter.hit_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (hits.length === 0) {
    console.log(JSON.stringify(fail('hit 状态必须显式列出 hit_ids（逗号分隔）')));
    process.exit(1);
  }
  const knownIds = new Set([...idx.signal_ids, ...idx.case_ids]);
  const illegal = hits.filter(s => !knownIds.has(s));
  if (illegal.length > 0) {
    console.log(JSON.stringify(fail(
      `hit_ids 包含 load_case_index 未收录的非法编号：${illegal.join(', ')}（C-999 之类）`,
      { illegal },
    )));
    process.exit(1);
  }
  return console.log(JSON.stringify(ok({
    status, completed_at: completedAt,
    case_library_path: caseLibPath, case_library_sha256: caseLibSha,
    run_id: runId, hit_ids: hits,
  })));
}

main();