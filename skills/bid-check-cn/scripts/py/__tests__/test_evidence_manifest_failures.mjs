// v3.3.1: 视觉失败状态聚合测试
// 复现本次 P58/P59 真实场景：部分页 OK + 部分页 rejected

import {buildManifest} from "../evidence_manifest.mjs";
import assert from "node:assert/strict";

// --- 测试 1: P58 被 视觉 API 1026 拒绝 + P59 OK → 应标 partial/vision_blocked ---
{
  const calls = [
    {page: 58, status: "rejected", error: "1026 prompt sensitive"},
    {page: 59, status: "ok", result: "建造师执业资格证书"},
  ];
  const rendered = new Map([
    [58, "p-58.png"],
    [59, "p-59.png"],
  ]);
  const scope = [{scoring_item: "A-05", candidate_pages: [58, 59]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "A-05");

  // 部分成功部分失败 → vision_blocked 或 partial
  assert.ok(
    m.status === "vision_blocked" || m.status === "partial",
    `部分视觉被拒应判 vision_blocked/partial，实际 ${m.status}`
  );
  assert.equal(m.vision_failures.length, 1, "1 条失败记录");
  assert.equal(m.vision_failures[0].page, 58);
  assert.equal(m.vision_failures[0].status, "rejected");
  assert.equal(m.vision_failures[0].error, "1026 prompt sensitive");
  console.log("PASS test_vision_rejected_marks_partial");
}

// --- 测试 2: 全部视觉被拒（重试耗尽）→ vision_blocked ---
{
  const calls = [
    {page: 58, status: "rejected", error: "1026"},
    {page: 58, status: "rejected", error: "1026 (after desensitized retry)"},
    {page: 59, status: "rejected", error: "1026"},
    {page: 59, status: "timeout"},
  ];
  const rendered = new Map([
    [58, "p-58.png"],
    [59, "p-59.png"],
  ]);
  const scope = [{scoring_item: "A-05", candidate_pages: [58, 59]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "A-05");

  assert.equal(m.status, "vision_blocked", "全部失败应判 vision_blocked");
  assert.equal(m.vision_failures.length, 4, "重试计入 4 条失败记录");
  assert.match(m.evidence_summary, /重试耗尽/);
  console.log("PASS test_all_rejected_vision_blocked");
}

// --- 测试 3: 视觉调用超时 → 计入 vision_failures ---
{
  const calls = [
    {page: 58, status: "timeout", error: "request timeout 300s"},
    {page: 59, status: "ok"},
  ];
  const rendered = new Map([[58, "p-58.png"], [59, "p-59.png"]]);
  const scope = [{scoring_item: "A-05", candidate_pages: [58, 59]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "A-05");

  assert.equal(m.vision_failures.length, 1, "timeout 计入 vision_failures");
  assert.equal(m.vision_failures[0].status, "timeout");
  console.log("PASS test_timeout_records_failure");
}

// --- 测试 4: low_confidence 与失败分别记录 ---
{
  const calls = [
    {page: 48, status: "ok", result: "2023-12-09"},
    {page: 48, status: "low_confidence", result: "2025-12-09 (handwritten, uncertain)"},
  ];
  const rendered = new Map([[48, "p-48.png"]]);
  const scope = [{scoring_item: "B-01", candidate_pages: [48]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "B-01");

  // 第一次 OK + 第二次 low_confidence → 整体视为待人工（未 fully confirmed）
  // 当前实现里 ok_count=1 = candidates → complete（保守）
  // 但 low_confidence 必须能被查询出来
  assert.equal(m.low_confidence_pages.length, 1, "low_confidence 单独记录");
  assert.equal(m.low_confidence_pages[0].page, 48);
  console.log("PASS test_low_confidence_tracked");
}

// --- v3.3.2 hotfix: 三个反例测试 — 状态误判回归保护 ---

// --- 反例 A: P58 未调用，P59 两次 ok → 不得 complete ---
{
  const calls = [
    {page: 59, status: "ok", result: "建造师执业资格证书"},
    {page: 59, status: "ok", result: "建造师执业资格证书（重复调用）"},
  ];
  const rendered = new Map();
  const scope = [{scoring_item: "A-05", candidate_pages: [58, 59]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "A-05");

  assert.equal(
    m.status,
    "partial",
    `反例 A: P58 未调用 + P59 两次 ok 应判 partial，实际=${m.status}`
  );
  assert.notEqual(m.status, "complete", "反例 A 禁止 complete");
  console.log("PASS regression_A");
}

// --- 反例 B: P58 rejected，P59 未调用 → 不得 vision_blocked / complete ---
{
  const calls = [{page: 58, status: "rejected", error: "1026 prompt sensitive"}];
  const rendered = new Map();
  const scope = [{scoring_item: "A-05", candidate_pages: [58, 59]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "A-05");

  assert.equal(
    m.status,
    "partial",
    `反例 B: P58 rejected + P59 未调用 应判 partial，实际=${m.status}`
  );
  assert.notEqual(m.status, "vision_blocked", "反例 B 禁止 vision_blocked");
  assert.notEqual(m.status, "complete", "反例 B 禁止 complete");
  console.log("PASS regression_B");
}

// --- 反例 C: 同一页 ok + low_confidence 冲突 → 不得 complete ---
{
  const calls = [
    {page: 48, status: "ok", result: "2023-12-09"},
    {page: 48, status: "low_confidence", result: "2025-12-09 (handwritten, uncertain)"},
  ];
  const rendered = new Map([[48, "p-48.png"]]);
  const scope = [{scoring_item: "B-01", candidate_pages: [48]}];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "B-01");

  assert.equal(
    m.status,
    "partial",
    `反例 C: 同页 ok + low_confidence 冲突 应判 partial，实际=${m.status}`
  );
  assert.notEqual(m.status, "complete", "反例 C 禁止 complete");
  console.log("PASS regression_C");
}

console.log("ALL FAILURE TESTS PASS");