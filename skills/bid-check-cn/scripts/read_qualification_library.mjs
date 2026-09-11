#!/usr/bin/env node
/**
 * bid-check-cn v3.1.0-rc Phase P4：资质库只读解析（v3.1 能力 C）
 *
 * 任务书第十一节 + 4.1-4.3 硬约束：
 *   - "资质库有资料 ≠ 本次投标文件已提交"
 *   - 复用的是事实，不是历史项目结论
 *   - 不同可信状态不能混为一谈
 *
 * 职责：
 *   1) 解析合作单位资质库 v2 Markdown（只读，绝不写入）
 *   2) 索引：by_company / by_credit_code / by_certificate_no / by_page_token
 *   3) 对每个字段打 tier 标签（HIGH/MEDIUM/LOW/NOT_FOUND）
 *   4) 输出 JSON 对象（stdout or 函数 return；不落盘）
 *
 * 输入：<library_md_path> [library_xlsx_path 可选]
 * 输出：stdout JSON，便于 | jq 或 > out.json
 *
 * 不修改库文件 / 不写 output/_work/qualification_index.json
 */

import fs from 'fs';
import path from 'path';

function usage() {
  console.error('用法: node scripts/read_qualification_library.mjs <library_md_path> [library_xlsx_path]');
  process.exit(1);
}

const libraryMdPath = process.argv[2];
const libraryXlsxPath = process.argv[3];
if (!libraryMdPath) usage();
if (!fs.existsSync(libraryMdPath)) {
  console.error('[read_qualification_library] NOT FOUND:', libraryMdPath);
  process.exit(2);
}

// tier 映射（D4 决策）
// HIGH = 已人工复核通过 (有用户签字)
// MEDIUM = 已提取 / 已识别 / 已提供 / 已提取(名称) (有数据但未人工复核)
// LOW = 待人工复核 / 待OCR / 待OCR/待确认 (数据可疑)
// NOT_FOUND = 未发现 / blank / 主体关系待确认 / 全称未发现 (库里就没数据)
function tierOf(reviewStatusRaw, stateRaw) {
  const s = (reviewStatusRaw || '').trim();
  const st = (stateRaw || '').trim();
  const txt = (s + ' ' + st).trim();
  // 主体确认状态/复核状态字段里 HIGH 关键短语：
  // 「复核通过」/「已确认」/「已人工复核通过」/「已并网可用」
  // 注意：v2 库里「已确认（…）」括号内必带用户信号，因此「已确认」广义匹配
  if (/复核通过/.test(txt) || /已并网可用/.test(txt) || /已确认/.test(txt) || txt === '已人工复核通过' || txt === '已复核通过') {
    return 'HIGH';
  }
  if (/已提取|已识别|已提供/.test(txt)) return 'MEDIUM';
  if (/待人工复核|待OCR|待OCR\/待确认|待确认|待识别/.test(txt)) return 'LOW';
  if (/未发现/.test(txt) || txt === '' || /主体关系待确认|全称未发现/.test(txt)) return 'NOT_FOUND';
  return 'LOW';      // 未识别值默认按 LOW 处理（保守）
}

function splitCells(line) {
  // 去除首尾 |，分隔
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map(c => c.trim());
}

function isTableSeparator(cells) {
  if (cells.length < 3) return false;
  return cells.every(c => /^:?-+:?$/.test(c) || c === '');
}

function findTables(mdLines) {
  // 返回所有 markdown 表格：[{start, end, headers, rows}]
  const tables = [];
  let i = 0;
  while (i < mdLines.length - 1) {
    const headerCells = splitCells(mdLines[i]);
    const sepCells = splitCells(mdLines[i + 1]);
    if (mdLines[i].trim().startsWith('|') && mdLines[i + 1].trim().startsWith('|') && isTableSeparator(sepCells)) {
      const t = { start: i, headers: headerCells, rows: [] };
      i += 2;
      while (i < mdLines.length && mdLines[i].trim().startsWith('|') && !isTableSeparator(splitCells(mdLines[i]))) {
        t.rows.push(splitCells(mdLines[i]));
        i++;
      }
      tables.push(t);
    } else {
      i++;
    }
  }
  return tables;
}

function parseCompany(mdText, companyName) {
  // 名字可能含 "A / B" 或 "A（...）" 后缀；尝试拆分多种 alias
  const aliases = companyName.split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
  let match = null;
  let matchedAlias = null;
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 接受行首 "## N. <alias>" + 行尾任意内容（如 "（投标人E系）"）
    const sectionRegex = new RegExp(`^##\\s+\\d+\\.\\s+${escaped}.*$`, 'm');
    const m = mdText.match(sectionRegex);
    if (m) {
      match = m; matchedAlias = alias; break;
    }
  }
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  // 下一个 "##" 章节
  const rest = mdText.slice(startIdx);
  const nextSec = rest.match(/^##\s+\d+\.\s+/m);
  const endIdx = nextSec ? startIdx + nextSec.index : mdText.length;
  const sectionText = mdText.slice(startIdx, endIdx);
  const sectionLines = sectionText.split(/\r?\n/);

  // 基本信息（bullet 列表）
  const basicInfo = {};
  // 基本信息 bullet key:value 用全角冒号「：」也用半角「:」
  const basicRegex = /^- (.*?)[：:]\s*(.*)$/;
  for (const line of sectionLines) {
    const m = line.match(basicRegex);
    if (m) basicInfo[m[1].trim()] = m[2].trim();
  }

  // 核心资质 / 业绩资料 表格
  const tables = findTables(sectionLines);
  const certsTable = tables.find(t => t.headers.length === 9 && t.headers[0].includes('资质名称'));
  const projTable = tables.find(t => t.headers.length === 7 && t.headers[0].includes('项目名称'));

  const certs = (certsTable?.rows || []).map(row => {
    const [name, level_or_scope, number, valid_until, status, source_file_name, source_path, page_or_token, review_status] = row;
    return {
      name: name || '',
      level_or_scope: level_or_scope || '',
      number: (number || '').replace(/\s/g, ''),
      valid_until: valid_until || '',
      status_raw: status || '',
      source_file: source_path || '',
      source_file_name: source_file_name || '',
      source_page_or_token: page_or_token || '',
      review_status_raw: review_status || '',
      tier: tierOf(review_status, status),
    };
  });

  const projects = (projTable?.rows || []).map(row => {
    const [name, type, scale, time, evidence, usable, review] = row;
    return {
      name: name || '',
      type: type || '',
      scale: scale || '',
      time: time || '',
      evidence: evidence || '',
      usable_for_bidding_raw: usable || '',
      review_status_raw: review || '',
      tier: tierOf(review, usable),
    };
  });

  return {
    name: companyName,
    primary_alias: aliases[0],
    aliases: aliases,
    credit_code: (basicInfo['统一社会信用代码'] || '').trim(),
    legal_rep: (basicInfo['法定代表人'] || '').trim(),
    registered_capital: (basicInfo['注册资本'] || '').trim(),
    registration_address: (basicInfo['注册地'] || '').trim(),
    founded_date: (basicInfo['成立日期'] || '').trim(),
    subject_status: (basicInfo['主体确认状态'] || '').trim(),
    tier_default: tierOf(basicInfo['主体确认状态'], ''),
    core_capabilities: (() => {
      const m = sectionText.match(/\n### 核心能力\n([\s\S]*?)(?=\n### |\n## )/);
      return m ? m[1].trim() : '';
    })(),
    certificates: certs,
    projects: projects,
  };
}

function loadMasterList(mdText) {
  // 从 〇、主体总览 表格解析 10 家公司全名
  const match = mdText.match(/## 〇、主体总览[^\n]*\n([\s\S]*?)(?=\n## [^〇])/);
  if (!match) return [];
  const sectionLines = match[1].split(/\r?\n/);
  const tables = findTables(sectionLines);
  const t = tables.find(tb => tb.headers.length >= 2);
  if (!t) return [];
  return t.rows.map(r => r[1]).filter(Boolean);  // column 1 = 供应商主体
}

const mdText = fs.readFileSync(libraryMdPath, 'utf-8');
const companyNames = loadMasterList(mdText);

const companies = {};
for (const cn of companyNames) {
  const c = parseCompany(mdText, cn);
  if (!c) continue;
  // 清洗 credit_code：去除括号注释（如 "91341021MAEDP5DG8N（用户复核通过 2026-05-17）" → "91341021MAEDP5DG8N"）
  c.credit_code = (c.credit_code.match(/^[0-9A-Z]{18}/) || [c.credit_code])[0];
  companies[cn] = c;
}

const byCreditCode = {};
const byCertificateNo = {};
const byPageToken = {};
const tierStats = { HIGH: 0, MEDIUM: 0, LOW: 0, NOT_FOUND: 0 };

for (const cn of Object.keys(companies)) {
  const c = companies[cn];
  if (c.credit_code) {
    if (!byCreditCode[c.credit_code]) byCreditCode[c.credit_code] = [];
    byCreditCode[c.credit_code].push(cn);
  }
  for (const cert of c.certificates) {
    tierStats[cert.tier] = (tierStats[cert.tier] || 0) + 1;
    if (cert.number) {
      if (!byCertificateNo[cert.number]) byCertificateNo[cert.number] = [];
      byCertificateNo[cert.number].push({ company: cn, cert_name: cert.name, tier: cert.tier });
    }
    const tok = cert.source_page_or_token;
    if (tok && tok !== '未发现' && tok !== '全文') {
      if (!byPageToken[`${cn}::${tok}`]) byPageToken[`${cn}::${tok}`] = cert;
    }
  }
  for (const p of c.projects) {
    tierStats[p.tier] = (tierStats[p.tier] || 0) + 1;
  }
}

const out = {
  schema_version: 1,
  loaded_at_iso: new Date().toISOString(),
  source_md: path.resolve(libraryMdPath),
  source_xlsx: libraryXlsxPath ? path.resolve(libraryXlsxPath) : null,
  by_company: companies,
  by_credit_code: byCreditCode,
  by_certificate_no: byCertificateNo,
  by_page_token: byPageToken,
  stats: {
    company_count: Object.keys(companies).length,
    certificate_count: Object.values(companies).reduce((s, c) => s + c.certificates.length, 0),
    project_count: Object.values(companies).reduce((s, c) => s + c.projects.length, 0),
    by_tier: tierStats,
  },
};

console.log(JSON.stringify(out, null, 2));
