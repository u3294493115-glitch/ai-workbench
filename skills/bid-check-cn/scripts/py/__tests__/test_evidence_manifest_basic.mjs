// v3.3.1: evidence_manifest.mjs 基础行为测试
// 验证空 scope / 完整渲染两种状态下 buildManifest 的输出

import { buildManifest } from "../evidence_manifest.mjs";
import assert from "node:assert/strict";

// --- 测试 1: 候选页未渲染、未视觉调用 → status=incomplete ---
{
  const recon = {
    pages: [
      { page: 54, is_visual_candidate: true, image_count: 1, max_image_frac: 0.62 },
      { page: 55, is_visual_candidate: true, image_count: 1, max_image_frac: 0.64 },
    ],
  };
  const renderedFiles = new Map(); // 空
  const visionCalls = []; // 空
  const scope = [{ scoring_item: "B-03", candidate_pages: [54, 55] }];

  const manifest = buildManifest({ recon, renderedFiles, visionCalls, scope });
  const b03 = manifest.find((m) => m.scoring_item === "B-03");

  assert.equal(b03.status, "incomplete", "无渲染无视觉应判 incomplete");
  assert.deepEqual(b03.candidate_pages, [54, 55]);
  assert.equal(b03.rendered_pages.length, 0);
  assert.equal(b03.vision_call_pages.length, 0);
  assert.equal(b03.vision_failures.length, 0);
  assert.ok(
    b03.evidence_summary.includes("未渲染"),
    `evidence_summary 应包含 '未渲染'，实际: ${b03.evidence_summary}`
  );
  assert.ok(
    b03.evidence_summary.includes("报告不得声称已视觉核验"),
    `evidence_summary 应包含 报告门禁文案，实际: ${b03.evidence_summary}`
  );
  console.log("PASS test_empty_scope");
}

// --- 测试 2: 候选页全部渲染 + 视觉成功 → status=complete ---
{
  const recon2 = {
    pages: [
      { page: 58, is_visual_candidate: true, image_count: 1, max_image_frac: 0.7 },
      { page: 59, is_visual_candidate: true, image_count: 1, max_image_frac: 0.65 },
    ],
  };
  const rendered2 = new Map([
    [58, "p-58.png"],
    [59, "p-59.png"],
  ]);
  const calls2 = [
    { page: 58, status: "ok", result: "建造师注册证书" },
    { page: 59, status: "ok", result: "建造师执业资格证书" },
  ];
  const scope2 = [{ scoring_item: "A-05", candidate_pages: [58, 59] }];

  const m2 = buildManifest({
    recon: recon2,
    renderedFiles: rendered2,
    visionCalls: calls2,
    scope: scope2,
  }).find((x) => x.scoring_item === "A-05");

  assert.equal(m2.status, "complete", "完整核验应判 complete");
  assert.equal(m2.vision_call_pages.length, 2);
  assert.equal(m2.vision_failures.length, 0);
  assert.ok(
    m2.evidence_summary.includes("全部完成"),
    `evidence_summary 应包含 '全部完成'，实际: ${m2.evidence_summary}`
  );
  console.log("PASS test_complete_render");
}

// --- 测试 3: 候选页无 → status=no_candidates ---
{
  const m3 = buildManifest({
    recon: {},
    renderedFiles: new Map(),
    visionCalls: [],
    scope: [{ scoring_item: "X-99", candidate_pages: [] }],
  }).find((x) => x.scoring_item === "X-99");

  assert.equal(m3.status, "no_candidates", "无候选页应判 no_candidates");
  console.log("PASS test_no_candidates");
}

// --- 测试 4: 部分视觉成功 + 部分视觉失败 → status=partial ---
{
  const calls = [
    { page: 58, status: "ok" },
    { page: 59, status: "rejected", error: "1026 prompt sensitive" },
  ];
  const rendered = new Map([
    [58, "p-58.png"],
    [59, "p-59.png"],
  ]);
  const scope = [{ scoring_item: "A-05", candidate_pages: [58, 59] }];

  const m = buildManifest({
    recon: {},
    renderedFiles: rendered,
    visionCalls: calls,
    scope,
  }).find((x) => x.scoring_item === "A-05");

  // 部分成功部分失败 → vision_blocked（重试已耗尽的语义）
  // 但 partial 是失败后未尝试重试的情况
  // 简化: 有失败且视觉调用数 < 候选数 → partial
  assert.ok(
    m.status === "partial" || m.status === "vision_blocked",
    `部分失败应判 partial/vision_blocked，实际 ${m.status}`
  );
  assert.equal(m.vision_failures.length, 1);
  console.log("PASS test_partial");
}

console.log("ALL BASIC TESTS PASS");