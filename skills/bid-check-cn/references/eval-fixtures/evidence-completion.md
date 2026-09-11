# E-026 evidence-completion-gate

## 场景
- 任意评分项准备判 0 分 / "未发现" / "不满足" 时

## 期望行为
1. Stage 2 末尾必须调用 `scripts/py/evidence_manifest.mjs` 生成 `_work/evidence_manifest.json`；
2. 报告生成前读取该 manifest；
3. 对每条 0 分结论，验证对应评分项 `status` ∈ {`complete`, `vision_blocked`}；
4. `status = incomplete` 时报告不得声称"已视觉核验未发现"，必须改为"⚠️ 未视觉核验 — 候选页未消费"。

## 不允许行为
- 没有 evidence_manifest.json 时生成报告
- manifest 状态 incomplete 但报告写"已视觉核验"
- 直接绕过 manifest 自检

## 校验脚本
见 `scripts/py/__tests__/test_evidence_gate.mjs`：
- 输入：模拟 manifest 中某项 status=incomplete + 报告片段含"已视觉核验"
- 输出：FAIL（脚本退出码非 0）

## 来源
- 真实项目：某充电桩 EPC（投标人A·标段1）· 2026-09-04
- 修复版本：v3.3.1