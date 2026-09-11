#!/usr/bin/env node
/**
 * RG-LOAD-1~5：load_case_index.mjs 单元测试
 *
 * 验证：
 *   RG-LOAD-1：正常项目根（向上找到 CLAUDE.md 含第 8 节）→ ok + signal_ids 非空
 *   RG-LOAD-2：项目根无 CLAUDE.md → ok=false read_failed=true
 *   RG-LOAD-3：CLAUDE.md 不含第 8 节 → ok=false read_failed=true（不穿透）
 *   RG-LOAD-4：第 8 节只给 _archive 路径 → ok=false read_failed=true
 *   RG-LOAD-5：第 8 节给不存在的相对路径 → ok=false read_failed=true
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const SKILL_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'load_case_index.mjs');

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe', cwd: SKILL_ROOT });
}
function parseResult(r) {
  try { return JSON.parse(r.stdout.toString().trim().split('\n').pop()); } catch { return null; }
}

function mkTmp(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-load-'));
  setup(dir);
  return dir;
}

function setupNormal(root) {
  // 案例库
  const libDir = path.join(root, 'AI审查');
  fs.mkdirSync(libDir, { recursive: true });
  const libPath = path.join(libDir, '历史废标与扣分案例库.md');
  fs.writeFileSync(libPath, [
    '# 历史废标与扣分案例库',
    '',
    '## 触发信号表',
    '',
    '| C-001 单位名称 | 保证金、分公司、单位名称 |',
    '| C-002 资格人员 | 资质、人员、社保 |',
    '| C-009 报价金额 | 大写金额、小写金额、报价 |',
    '',
    '## 历史案例清单',
    '',
    '- C-001 单位名称',
    '- C-002 资格人员',
    '- C-009 报价金额',
    '',
  ].join('\n'));
  // 项目根 CLAUDE.md
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# 项目',
    '',
    '## 1. xxx',
    '',
    '## 8. 历史案例库入口',
    '',
    '`AI审查/历史废标与扣分案例库.md`（稳定入口，不带版本号）',
    '',
    '## 9. yyy',
    '',
  ].join('\n'));
}

function setupNoClaude(root) {
  // 只有项目根，没 CLAUDE.md
  fs.writeFileSync(path.join(root, 'README.md'), '# project');
}

function setupWrongSection(root) {
  // CLAUDE.md 没有第 8 节
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# 项目',
    '',
    '## 1. 简介',
    '',
    '## 2. 用法',
    '',
  ].join('\n'));
}

function setupArchiveOnly(root) {
  const archive = path.join(root, 'AI审查', '_archive');
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(path.join(archive, '案例库_v0.4.md'), '# 旧版');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# 项目',
    '',
    '## 8. 历史案例库入口',
    '',
    '`AI审查/_archive/案例库_v0.4.md`',
    '',
  ].join('\n'));
}

function setupMissingFile(root) {
  // CLAUDE.md 给出路径，但文件不存在
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# 项目',
    '',
    '## 8. 历史案例库入口',
    '',
    '`AI审查/不存在的库.md`',
    '',
  ].join('\n'));
}

let pass = 0, fail = 0;
function check(id, desc, cond, detail = {}) {
  if (cond) { console.log(JSON.stringify({ id, state: 'PASS', message: desc, detail })); pass++; }
  else { console.log(JSON.stringify({ id, state: 'FAIL', message: desc, detail })); fail++; }
}

const cases = [
  { id: 'RG-LOAD-1', desc: '正常项目根 + 第 8 节 + 案例库存在', setup: setupNormal,
    expect: (r) => r && r.ok === true && r.read_failed === false && r.signal_ids.length === 3 && r.case_library_sha256 },
  { id: 'RG-LOAD-2', desc: '项目根无 CLAUDE.md', setup: setupNoClaude,
    expect: (r) => r && r.ok === false && r.read_failed === true && /CLAUDE\.md/.test(r.reason) },
  { id: 'RG-LOAD-3', desc: 'CLAUDE.md 不含第 8 节', setup: setupWrongSection,
    expect: (r) => r && r.ok === false && r.read_failed === true },
  { id: 'RG-LOAD-4', desc: '第 8 节只给 _archive 路径', setup: setupArchiveOnly,
    expect: (r) => r && r.ok === false && r.read_failed === true && /_archive|_v\d/i.test(r.reason) },
  { id: 'RG-LOAD-5', desc: '第 8 节给不存在的相对路径', setup: setupMissingFile,
    expect: (r) => r && r.ok === false && r.read_failed === true && /不存在/.test(r.reason) },
];

function setupArchiveCanary(root) {
  // 稳定入口
  const libDir = path.join(root, 'AI审查');
  fs.mkdirSync(libDir, { recursive: true });
  const libPath = path.join(libDir, '历史废标与扣分案例库.md');
  fs.writeFileSync(libPath, '| C-001 单位名称 | 保证金 |\n| C-002 资格人员 | 资质 |\n');
  // _archive 内有 canary
  const archive = path.join(root, 'AI审查', '_archive');
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(path.join(archive, '案例库_v0.4.md'),
    '# 旧版\n\nCANARY_TOKEN_PLACEHOLDER_v04\n| Z-999 伪造案例 | 无 |\n');
  fs.writeFileSync(path.join(archive, '案例库_v0.3.md'),
    '# 更旧版\n\nCANARY_TOKEN_PLACEHOLDER_v03\n| Z-998 另一伪造 | 无 |\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'),
    '# 项目\n\n## 8. 历史案例库入口\n\n`AI审查/历史废标与扣分案例库.md`\n');
}
cases.push({
  id: 'RG-LOAD-6', desc: '稳定入口 + _archive/ 含 canary；验证不读 _archive/',
  setup: setupArchiveCanary,
  expect: (r, root) => {
    if (!(r && r.ok === true)) return false;
    // 读取 access log
    const logPath = path.join(root, 'output', '_work', 'archive_access_log.json');
    if (!fs.existsSync(logPath)) return false;
    const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    // 任何 entry 都不在 _archive/
    if (log.entries.some(e => /[\\/]_archive[\\/]/i.test(e.path) || /_v\d+/.test(e.path))) return false;
    // canary token 不能出现在 log 中（如果出现过 _archive 路径，里面的 占位 token会被 grep 到）
    const logText = JSON.stringify(log);
    if (/CANARY_TOKEN_PLACEHOLDER/.test(logText)) return false;
    return true;
  },
});

function setupBodyPollution(root) {
  // 案例详情正文里塞一个伪造 ID C-999，验证 v3.3.3 切片后 C-999 不进入合法集合
  const libDir = path.join(root, 'AI审查');
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, '历史废标与扣分案例库.md'), [
    '# 历史案例库', '',
    '## 触发信号表', '',
    '| C-001 单位名称 | 保证金 |', '',
    '## 历史案例清单', '',
    '- C-001 单位名称', '',
    '## 案例详情', '',
    'C-001 是真实存在的。某项目伪造了 C-999 / Z-999 来骗 AI。', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'),
    '# 项目\n\n## 8. 历史案例库入口\n\n`AI审查/历史废标与扣分案例库.md`\n');
}
cases.push({
  id: 'RG-LOAD-7', desc: '正文含 C-999 伪造 ID；按章节切片后必须不进入合法集合',
  setup: setupBodyPollution,
  expect: (r) => r && r.ok === true &&
    !r.signal_ids.includes('C-999') && !r.case_ids.includes('C-999') &&
    !r.signal_ids.includes('Z-999') && !r.case_ids.includes('Z-999'),
});

for (const c of cases) {
  const root = mkTmp(c.setup);
  const r = runScript([root]);
  const parsed = parseResult(r);
  const cond = c.expect.length > 1 ? c.expect(parsed, root) : c.expect(parsed);
  check(c.id, c.desc, cond, { exit: r.status, parsed });
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`---`);
console.log(`RG-LOAD: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);