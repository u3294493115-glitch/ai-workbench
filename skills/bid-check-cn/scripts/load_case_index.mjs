#!/usr/bin/env node
/**
 * load_case_index.mjs（v3.3.3 新增）
 *
 * 唯一允许读取外部历史案例库"索引"（触发信号表 + 历史案例清单）的程序入口。
 * 报告生成前 Report Gate 必须通过本脚本读取案例库；模型不得绕开。
 *
 * 关键约束：
 *   1. 路径发现：从当前 cwd 向上找最近的 CLAUDE.md（必须含 "## 8. 历史案例库入口" 章节），
 *      案例库相对路径以该 CLAUDE.md 所在目录为基准解析，记录规范化绝对路径
 *   2. 不读 _archive/ 下任何文件；不读带版本号归档路径（_v0.x / _v0.x.y）
 *   3. 只解析"触发信号表"+"历史案例清单"两节的案例 ID 集合；不读全文
 *   4. 计算案例库文件 SHA-256，调用方用于一致性校验
 *   5. 找不到 / 解析失败 → 返回 ok=false + reason + read_failed=true；调用方必须显式声明
 *
 * 用法：
 *   node scripts/load_case_index.mjs [project_root]
 *     不传 project_root → 用 cwd
 *   stdout: 单行 JSON { ok, case_library_path, case_library_sha256, signal_ids, case_ids,
 *                        scanned_signal_count, project_root, claude_md_path, read_failed, reason }
 *
 * 任意错误路径 → exit code = 1 + 失败 JSON；正常路径 → exit code = 0
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MAX_ANCESTOR_LAYERS = 8; // 安全上限，避免无限制向上
const REQUIRED_SECTION_HEADER = '## 8. 历史案例库入口';
const REQUIRED_ENTRIES_REGEX = /^[A-Z]{1,3}-(?:\d{3,}|[A-Z]+-\d+)$/; // C-001 / P-011 / R-Candidate 等

function normalizePath(p) {
  return path.resolve(p).replace(/[\\/]+/g, path.sep);
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readDirSafe(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return null; }
}

/**
 * 向上查找最近的 CLAUDE.md（必须含 "## 8. 历史案例库入口" 章节）。
 * 限定祖先搜索层数；找不到返回 null。
 */
function findClaudeMdWithCaseSection(projectRoot) {
  let dir = path.resolve(projectRoot);
  const visited = [];
  for (let i = 0; i <= MAX_ANCESTOR_LAYERS; i++) {
    const candidate = path.join(dir, 'CLAUDE.md');
    if (fileExists(candidate)) {
      const text = fs.readFileSync(candidate, 'utf-8');
      if (text.includes(REQUIRED_SECTION_HEADER)) {
        return { claude_md_path: candidate, project_root: dir };
      }
      // 找到 CLAUDE.md 但没第 8 节 → 停止向上（避免穿透到无关项目）
      visited.push(candidate);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // 已到文件系统根
    dir = parent;
  }
  return null;
}

/**
 * 从 CLAUDE.md 第 8 节提取案例库相对路径。
 * 解析"## 8. ..." 章节内容，匹配相对路径（不包含绝对路径前缀）；
 * 不允许 _archive / _v0.x 等归档路径出现在该节。
 */
function extractCaseLibraryPath(claudeMdText, claudeMdDir) {
  const lines = claudeMdText.split(/\r?\n/);
  let inSection = false;
  const collected = [];
  for (const line of lines) {
    if (line.startsWith(REQUIRED_SECTION_HEADER)) { inSection = true; continue; }
    if (inSection && /^^##\s/.test(line)) break; // 进入下一节
    if (inSection) collected.push(line);
  }
  const sectionBody = collected.join('\n');
  // 提取 Markdown 代码块中的路径 / 或独立行
  const pathCandidates = [];
  const codeRe = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = codeRe.exec(sectionBody)) !== null) {
    for (const line of m[1].split(/\r?\n/)) {
      if (line.trim() && !line.trim().startsWith('#')) pathCandidates.push(line.trim());
    }
  }
  // 也接受裸路径行（不强制代码块）
  for (const line of collected) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('>') && !t.startsWith('-') && !t.startsWith('*')) {
      // 仅取像相对路径的（不含 : / http）
      if (/^[A-Za-z0-9_./\-\\]+\.md$/.test(t)) pathCandidates.push(t);
    }
  }
  // 兜底：搜索 markdown 链接 / backtick 中的 .md 引用
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((m = linkRe.exec(sectionBody)) !== null) {
    if (m[2].endsWith('.md')) pathCandidates.push(m[2]);
  }
  // 兜底 2：单 backtick 中的 .md 引用（如 `AI审查/历史废标与扣分案例库.md`）
  const backtickRe = /`([^`]*\.md)`/g;
  while ((m = backtickRe.exec(sectionBody)) !== null) {
    pathCandidates.push(m[1]);
  }

  if (pathCandidates.length === 0) {
    return { ok: false, reason: 'CLAUDE.md 第 8 节未声明案例库相对路径' };
  }

  // 取第一个看起来是稳定入口（不带版本号、不在 _archive 内）的路径
  let pickedRel = null;
  for (const cand of pathCandidates) {
    const normalized = cand.replace(/\\/g, '/');
    if (/_archive\//i.test(normalized)) continue;
    if (/_v\d+(\.\d+)*\b/i.test(normalized)) continue;
    pickedRel = normalized;
    break;
  }
  if (!pickedRel) {
    return { ok: false, reason: 'CLAUDE.md 第 8 节只给出 _archive/ 或带版本号归档路径，禁止调用' };
  }
  const absPath = normalizePath(path.join(claudeMdDir, pickedRel));
  return { ok: true, relative_path: pickedRel, absolute_path: absPath };
}

/**
 * 解析案例库的"触发信号表"+"历史案例清单"两节。
 * v3.3.3 收口：按章节切片，不扫描全文。非索引正文中的 C-999 / Z-999 等
 * 任何编号都不能进入合法 ID 集合。
 */
function parseCaseLibrarySections(text) {
  const lines = text.split(/\r?\n/);
  let currentSection = null; // null | 'triggerSignal' | 'caseList' | 'other'
  const buckets = { triggerSignal: '', caseList: '' };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      const title = m[1].trim();
      // 容错匹配：忽略标点 + 空白
      const norm = title.replace(/[\s,:：、。]+/g, '');
      if (/触发信号表|信号表|触发信号/.test(norm)) currentSection = 'triggerSignal';
      else if (/历史案例清单|案例清单|案例索引/.test(norm)) currentSection = 'caseList';
      else currentSection = null; // 任何其他章节（含"案例详情""标签""事件描述"）都不收
      continue;
    }
    if (currentSection === 'triggerSignal') buckets.triggerSignal += line + '\n';
    else if (currentSection === 'caseList') buckets.caseList += line + '\n';
    // null 与 'other' 章节全部丢弃
  }
  return buckets;
}

/**
 * 在已切片的章节文本中提取案例 ID 集合。
 * v3.3.3 收口：只接受 C-XXX 和 P-XXX。R-XXX 是专业知识规则（见专业知识规则库.md），
 * 即使出现在案例库正文中（如作为关联引用），也不能作为案例 hit 的合法目标。
 */
function scanCaseIds(sectionText) {
  const idRegex = /\b([CP](?:-\d{3,}))\b/g;
  const seen = new Set();
  let m;
  while ((m = idRegex.exec(sectionText)) !== null) {
    seen.add(m[1]);
  }
  return [...seen];
}

function sha256OfFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function failResult(reason, projectRoot) {
  return {
    ok: false,
    read_failed: true,
    reason,
    project_root: projectRoot || null,
    claude_md_path: null,
    case_library_path: null,
    case_library_sha256: null,
    signal_ids: [],
    case_ids: [],
    scanned_signal_count: 0,
    scanned_case_count: 0,
  };
}

function main() {
  const arg = process.argv[2];
  const projectRoot = arg ? path.resolve(arg) : process.cwd();
  if (!fileExists(projectRoot) && !fs.existsSync(projectRoot)) {
    const r = failResult('project_root 不存在', null);
    console.log(JSON.stringify(r));
    process.exit(1);
  }
  if (!fs.statSync(projectRoot).isDirectory()) {
    const r = failResult('project_root 不是目录', null);
    console.log(JSON.stringify(r));
    process.exit(1);
  }

  const found = findClaudeMdWithCaseSection(projectRoot);
  if (!found) {
    const r = failResult(
      `未在 ${projectRoot} 向上 ${MAX_ANCESTOR_LAYERS} 层祖先中找到含 "${REQUIRED_SECTION_HEADER}" 的 CLAUDE.md`,
      projectRoot,
    );
    console.log(JSON.stringify(r));
    process.exit(1);
  }

  const claudeText = fs.readFileSync(found.claude_md_path, 'utf-8');
  const extracted = extractCaseLibraryPath(claudeText, path.dirname(found.claude_md_path));
  if (!extracted.ok) {
    const r = failResult(extracted.reason, projectRoot);
    r.claude_md_path = found.claude_md_path;
    console.log(JSON.stringify(r));
    process.exit(1);
  }

  if (!fileExists(extracted.absolute_path)) {
    const r = failResult(
      `案例库文件不存在：${extracted.absolute_path}`,
      projectRoot,
    );
    r.claude_md_path = found.claude_md_path;
    r.case_library_path = extracted.absolute_path;
    console.log(JSON.stringify(r));
    process.exit(1);
  }

  // 读取并解析案例库（仅读触发信号表 + 历史案例清单）
  let caseText;
  try {
    caseText = fs.readFileSync(extracted.absolute_path, 'utf-8');
  } catch (e) {
    // 失败路径也写一份访问日志（canary 用）
    appendAccessLog(projectRoot, [{
      path: extracted.absolute_path,
      ok: false,
      error: e.message,
      ts: new Date().toISOString(),
    }]);
    const r = failResult(`读取案例库失败：${e.message}`, projectRoot);
    r.claude_md_path = found.claude_md_path;
    r.case_library_path = extracted.absolute_path;
    console.log(JSON.stringify(r));
    process.exit(1);
  }
  const caseSha = sha256OfFile(extracted.absolute_path);

  // v3.3.3 收口：仅解析"触发信号表" + "历史案例清单"两节，不读全文扫描。
  // 非索引正文（含 C-999 等）必须不被纳入合法 ID 集合。
  const sections = parseCaseLibrarySections(caseText);
  const signalIds = scanCaseIds(sections.triggerSignal);
  const caseIds = scanCaseIds(sections.caseList);
  // 合并去重：signal_ids ∪ case_ids 作为合法 ID 集合
  const ids = [...new Set([...signalIds, ...caseIds])];

  // 写入访问日志（可观测 canary）
  appendAccessLog(projectRoot, [{
    path: extracted.absolute_path,
    ok: true,
    bytes: caseText.length,
    sha256: caseSha,
    ts: new Date().toISOString(),
    section_byte_len_trigger: sections.triggerSignal.length,
    section_byte_len_list: sections.caseList.length,
  }]);

  const result = {
    ok: true,
    read_failed: false,
    project_root: projectRoot,
    claude_md_path: found.claude_md_path,
    case_library_path: extracted.absolute_path,
    case_library_relative_path: extracted.relative_path,
    case_library_sha256: caseSha,
    signal_ids: ids,
    case_ids: ids,
    scanned_signal_count: ids.length,
    scanned_case_count: ids.length,
    reason: null,
  };
  console.log(JSON.stringify(result));
  process.exit(0);
}

/**
 * 写入可观测访问日志到 <projectRoot>/output/_work/archive_access_log.json
 * 每次调用追加一条记录（含路径、时间戳、字节数、SHA-256、是否在 _archive/）。
 * 调用方读取后断言：所有 files_read 都不在 _archive/。
 */
function appendAccessLog(projectRoot, entries) {
  try {
    const dir = path.join(projectRoot, 'output', '_work');
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'archive_access_log.json');
    let log = { entries: [] };
    if (fs.existsSync(logPath)) {
      try { log = JSON.parse(fs.readFileSync(logPath, 'utf-8')); } catch { /* ignore */ }
    }
    for (const e of entries) {
      log.entries.push({
        ...e,
        in_archive: /[\\/]_archive[\\/]/i.test(e.path) || /_v\d+(\.\d+)*\b/.test(e.path),
      });
    }
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  } catch (e) {
    // 日志写失败不影响主流程
  }
}

main();