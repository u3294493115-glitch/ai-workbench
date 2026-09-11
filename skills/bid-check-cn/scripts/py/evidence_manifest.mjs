// v3.3.1: 候选页 → 渲染 → 视觉调用 → 状态聚合 manifest
//
// 用途：Stage 2 末尾调用，生成 _work/evidence_manifest.json。
// 报告生成阶段读取该 manifest，对 status=incomplete 的评分项不得
// 声称"已视觉核验未发现"。
//
// 输入：
//   recon:        bid.recon.json 内容（含每页 is_visual_candidate）
//   renderedFiles: Map<pageNumber, filePath> — 已渲染页面
//   visionCalls:  Array<{page, status, result?, error?}> — 视觉调用记录
//                status 枚举：ok / rejected / timeout / low_confidence
//   scope:        Array<{scoring_item, candidate_pages:[]}>
//
// 输出：Array<EvidenceManifestItem>
//   EvidenceManifestItem = {
//     scoring_item, candidate_pages, rendered_pages,
//     vision_call_pages, vision_failures, status, evidence_summary
//   }
//   status 枚举：
//     complete       — 候选页全部成功完成视觉核验
//     partial        — 部分成功（剩余候选页未调用）
//     incomplete     — 候选页未渲染、未视觉调用
//     vision_blocked — 候选页已渲染但视觉调用全部/部分被拒或超时
//     no_candidates  — 评分项无候选页（可能不适用或文本型证据）

import fs from "node:fs";
import path from "node:path";

/**
 * @param {Object} params
 * @param {Object} params.recon
 * @param {Map<number,string>} params.renderedFiles
 * @param {Array<{page:number,status:string,result?:string,error?:string}>} params.visionCalls
 * @param {Array<{scoring_item:string,candidate_pages:number[]}>} params.scope
 * @returns {Array<Object>}
 */
export function buildManifest({ recon, renderedFiles, visionCalls, scope }) {
  const renderedSet = new Set(renderedFiles.keys());

  // 把 visionCalls 按页聚合（同一页可能多次调用）
  const visionByPage = new Map();
  for (const c of visionCalls) {
    if (!visionByPage.has(c.page)) visionByPage.set(c.page, []);
    visionByPage.get(c.page).push(c);
  }

  return scope.map((item) => {
    const candidates = item.candidate_pages || [];
    const rendered = candidates.filter((p) => renderedSet.has(p));

    // 收集该评分项所有候选页的视觉调用
    const allCalls = candidates.flatMap((p) => visionByPage.get(p) || []);
    const okCalls = allCalls.filter((c) => c.status === "ok");
    const failedCalls = allCalls.filter(
      (c) => c.status === "rejected" || c.status === "timeout"
    );
    const lowConfCalls = allCalls.filter((c) => c.status === "low_confidence");

    // v3.3.2 热修：按"唯一候选页"聚合，而不是按调用次数
    // okPages = 至少有一次 ok 调用的唯一页
    // failedPages = 至少有一次 rejected/timeout 的唯一页
    // lowConfPages = 至少有一次 low_confidence 的唯一页
    // unCalledCandidates = 候选列表中存在但没有任何调用的页
    const okPages = new Set(okCalls.map((c) => c.page));
    const failedPages = new Set(failedCalls.map((c) => c.page));
    const lowConfPages = new Set(lowConfCalls.map((c) => c.page));
    const calledPages = new Set(allCalls.map((c) => c.page));
    const unCalledCandidates = candidates.filter((p) => !calledPages.has(p));

    const status = computeStatus({
      candidatesCount: candidates.length,
      okPages,
      failedPages,
      lowConfPages,
      unCalledCandidates,
    });

    return {
      scoring_item: item.scoring_item,
      candidate_pages: candidates,
      rendered_pages: rendered,
      vision_call_pages: [...new Set(allCalls.map((c) => c.page))].sort(
        (a, b) => a - b
      ),
      vision_failures: failedCalls.map((f) => ({
        page: f.page,
        status: f.status,
        error: f.error || null,
      })),
      low_confidence_pages: lowConfCalls.map((c) => ({
        page: c.page,
        result: c.result || null,
      })),
      status,
      evidence_summary: buildSummaryText(item.scoring_item, status, {
        candidates: candidates.length,
        rendered: rendered.length,
        okPages: okPages.size,
        failedPages: failedPages.size,
        lowConfPages: lowConfPages.size,
        unCalled: unCalledCandidates.length,
      }),
    };
  });
}

/**
 * 状态计算（v3.3.2 热修）：
 *   - 判定"complete"必须基于唯一候选页集合：所有候选页均至少有一次 ok，
 *     且不存在未解决的 rejected/timeout/low_confidence。
 *   - 同页重复 ok 不能替代另一候选页。
 *   - 一页 rejected + 另一页未调用 → partial（不得 vision_blocked）。
 *   - 同页 ok + low_confidence 冲突 → partial。
 *
 * 状态枚举（不新增）：
 *   complete / partial / incomplete / vision_blocked / no_candidates
 */
function computeStatus(n) {
  if (n.candidatesCount === 0) return "no_candidates";

  // 条件：所有候选页均至少一次 ok + 无任何失败/低置信冲突
  const allCoveredByOk = n.okPages.size === n.candidatesCount;
  const noFailures =
    n.failedPages.size === 0 && n.lowConfPages.size === 0;

  if (allCoveredByOk && noFailures) return "complete";

  const hasFailures =
    n.failedPages.size > 0 || n.lowConfPages.size > 0;

  // vision_blocked：所有候选页都已尝试，且全部失败（无 ok 也无未调用）
  if (
    hasFailures &&
    n.unCalledCandidates.length === 0 &&
    n.okPages.size === 0
  ) {
    return "vision_blocked";
  }

  // incomplete：候选页存在，但完全没有任何调用
  if (
    n.okPages.size === 0 &&
    n.failedPages.size === 0 &&
    n.lowConfPages.size === 0
  ) {
    return "incomplete";
  }

  // 兜底：未调用候选页 / 部分失败 / 低置信冲突 → partial
  return "partial";
}

function buildSummaryText(id, status, n) {
  switch (status) {
    case "complete":
      return `${id}: 候选 ${n.candidates} 页全部完成视觉核验`;
    case "partial":
      return `${id}: 候选 ${n.candidates} 页中 ${n.okPages} 页有 OK / ${n.failedPages} 页有失败 / ${n.lowConfPages} 页有低置信冲突 / ${n.unCalled} 页未调用；尚未闭环`;
    case "incomplete":
      return `${id}: 候选 ${n.candidates} 页未渲染、未视觉调用；报告不得声称已视觉核验`;
    case "vision_blocked":
      return `${id}: 候选 ${n.candidates} 页中 ${n.failedPages} 页视觉被拒（重试耗尽），${n.rendered} 页已渲染；需人工核验`;
    case "no_candidates":
      return `${id}: 无候选页（评分项可能不适用或文本型证据）`;
    default:
      return `${id}: 状态 ${status}`;
  }
}

// =========================================================================
// CLI 入口 — Stage 2 末尾调用
// 用法：node evidence_manifest.mjs <work_dir>
// =========================================================================

function parseScope(frozenPath) {
  if (!fs.existsSync(frozenPath)) return [];
  const text = fs.readFileSync(frozenPath, "utf8");
  const items = [];
  // 兼容 [PXX-PXX] / [PXX-PXX, PYY-PYY] / 单页 PXX
  const re = /(B-\d{2}|A-\d{2})[^[]*?\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text))) {
    const id = m[1];
    const rangeText = m[2];
    const pages = [];
    for (const part of rangeText.split(",")) {
      const tr = part.match(/P(\d+)\s*[-–]\s*P(\d+)/);
      if (tr) {
        const a = Number(tr[1]);
        const b = Number(tr[2]);
        for (let p = a; p <= b; p++) pages.push(p);
      } else {
        const single = part.match(/P(\d+)/);
        if (single) pages.push(Number(single[1]));
      }
    }
    if (pages.length > 0) items.push({ scoring_item: id, candidate_pages: pages });
  }
  return items;
}

function collectRenderedFiles(pagesDir) {
  const map = new Map();
  if (!fs.existsSync(pagesDir)) return map;
  for (const sub of fs.readdirSync(pagesDir)) {
    const d = path.join(pagesDir, sub);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      const m = f.match(/^p-(\d+)\.png$/);
      if (m) map.set(Number(m[1]), path.join(d, f));
    }
  }
  return map;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const workDir = process.argv[2] || "./_work";
  const reconPath = path.join(workDir, "bid.recon.json");
  if (!fs.existsSync(reconPath)) {
    console.error(`[evidence_manifest] 缺少 ${reconPath}`);
    process.exit(1);
  }
  const recon = JSON.parse(fs.readFileSync(reconPath, "utf8"));
  const renderedFiles = collectRenderedFiles(path.join(workDir, "pages"));

  const vcPath = path.join(workDir, "vision_calls.json");
  const visionCalls = fs.existsSync(vcPath)
    ? JSON.parse(fs.readFileSync(vcPath, "utf8"))
    : [];

  const scope = parseScope(path.join(workDir, "frozen_checklist.md"));

  const manifest = buildManifest({ recon, renderedFiles, visionCalls, scope });
  const out = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    items: manifest,
  };
  const outPath = path.join(workDir, "evidence_manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `[evidence_manifest] wrote ${manifest.length} items to ${outPath}`
  );

  // 退出码：若存在 incomplete 状态则警告（但不强制失败）
  const incomplete = manifest.filter((m) => m.status === "incomplete");
  if (incomplete.length > 0) {
    console.warn(
      `[evidence_manifest] WARN: ${incomplete.length} scoring items have incomplete status: ${incomplete
        .map((m) => m.scoring_item)
        .join(", ")}`
    );
  }
}