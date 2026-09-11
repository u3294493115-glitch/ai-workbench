#!/usr/bin/env node
/**
 * finalize_report.mjs（v3.3.3 新增）
 *
 * 唯一允许写入 `output/审核报告.md` 的程序入口（机械闸门）。
 *
 * 工作流：
 *   1. 校验调用方传入的 draft 路径存在
 *   2. 校验 output/_work/report_gate.md 通过 check_report_gate.mjs
 *   3. 原子重命名 draft → output/审核报告.md（不允许直接 Write 覆盖）
 *   4. 若 output/审核报告.md 已存在（来自上一次成功运行）→ 拒绝并要求先 backup
 *   5. 写入 _work/run_registry.json（run_id ↔ finalize 时间戳 ↔ report_gate_md 引用）
 *
 * 失败时不会修改 output/审核报告.md；只产出日志到 stderr + stdout JSON。
 *
 * 用法：
 *   node scripts/finalize_report.mjs \
 *     --project-root <dir> \
 *     --run-id <id> \
 *     --main-audit-completed-at <ISO8601> \
 *     --draft <path/to/审核报告-draft.md> \
 *     [--force-overwrite]   # 仅在确认要替换旧报告时使用
 */
import fs from 'fs';
import path from 'path';
import { renameSync, existsSync } from 'fs';
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

function main() {
  const projectRoot = path.resolve(arg('--project-root', process.cwd()));
  const runId = arg('--run-id', null);
  const mainAuditCompletedAt = arg('--main-audit-completed-at', null);
  const draft = arg('--draft', null);
  const forceOverwrite = process.argv.indexOf('--force-overwrite') >= 0;

  if (!runId) { console.log(JSON.stringify(fail('missing --run-id'))); process.exit(1); }
  if (!mainAuditCompletedAt) { console.log(JSON.stringify(fail('missing --main-audit-completed-at'))); process.exit(1); }
  if (!draft) { console.log(JSON.stringify(fail('missing --draft'))); process.exit(1); }

  const draftAbs = path.resolve(draft);
  if (!existsSync(draftAbs)) {
    console.log(JSON.stringify(fail('draft 不存在', { draft: draftAbs })));
    process.exit(1);
  }

  const finalPath = path.join(projectRoot, 'output', '审核报告.md');
  if (existsSync(finalPath) && !forceOverwrite) {
    console.log(JSON.stringify(fail(
      'output/审核报告.md 已存在，必须先备份或显式 --force-overwrite',
      { final: finalPath },
    )));
    process.exit(1);
  }

  // Step 1: 跑 check_report_gate（v3.3.3 强制传 draft 绑定）
  const checkScript = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'check_report_gate.mjs');
  const r = spawnSync(process.execPath, [
    checkScript,
    '--project-root', projectRoot,
    '--run-id', runId,
    '--main-audit-completed-at', mainAuditCompletedAt,
    '--draft', draftAbs,
  ], { stdio: 'pipe' });
  let checkResult;
  try {
    checkResult = JSON.parse(r.stdout.toString().trim().split('\n').pop());
  } catch (e) {
    console.log(JSON.stringify(fail('check_report_gate 输出无法解析', { stderr: r.stderr.toString() })));
    process.exit(1);
  }
  if (!checkResult.ok) {
    console.log(JSON.stringify(fail('preflight 未通过，禁止落盘正式报告', {
      preflight_reason: checkResult.reason,
      preflight_detail: checkResult,
    })));
    process.exit(1);
  }

  // Step 2: 原子重命名 draft → final
  if (forceOverwrite && existsSync(finalPath)) {
    const backup = `${finalPath}.bak-${runId}`;
    fs.copyFileSync(finalPath, backup);
  }
  try {
    renameSync(draftAbs, finalPath);
  } catch (e) {
    console.log(JSON.stringify(fail('原子重命名失败', { error: e.message })));
    process.exit(1);
  }

  // Step 3: 写 run registry
  const regDir = path.join(projectRoot, 'output', '_work');
  fs.mkdirSync(regDir, { recursive: true });
  const regPath = path.join(regDir, 'run_registry.json');
  let reg = { runs: [] };
  if (existsSync(regPath)) {
    try { reg = JSON.parse(fs.readFileSync(regPath, 'utf-8')); } catch { /* 损坏则覆盖 */ }
  }
  reg.runs.push({
    run_id: runId,
    finalized_at: new Date().toISOString(),
    main_audit_completed_at: mainAuditCompletedAt,
    report_gate: {
      status: checkResult.status,
      completed_at: checkResult.completed_at,
      case_library_path: checkResult.case_library_path,
      case_library_sha256: checkResult.case_library_sha256,
    },
    final_report_path: finalPath,
    draft_source: draftAbs,
  });
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));

  console.log(JSON.stringify(ok({
    final_report_path: finalPath,
    run_id: runId,
    preflight: checkResult,
    run_registry_path: regPath,
  })));
  process.exit(0);
}

main();