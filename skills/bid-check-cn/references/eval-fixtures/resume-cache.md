# E-027 resume-cache-hash

## 场景
- 第二次运行同一项目，输入文件（招标文件 / 投标文件）SHA-256 未变化
- 上一次运行的 `_work/` 已存在有效产物（recon.json / bid_text.txt / pages/）

## 期望行为
1. 计算输入 SHA-256，对比上一次 manifest 中的输入哈希；
2. 哈希一致 → 复用 `_work/bid.recon.json`、`_work/bid_text.txt`、已渲染页面；
3. 仅重新执行 Stage 2/3/4 中需要新视觉结果的步骤；
4. **不得**整体清空 `_work` 重建。

## 不允许行为
- 无视哈希差异整体删除 `_work`
- 跳过哈希校验直接复用（哈希变化时必须重跑）
- 复用过期产物但未记录 `cache_hit=true`

## 校验脚本
见 `scripts/py/__tests__/test_cache_hash.mjs`：
- 输入：相同 PDF + 已有 recon.json（哈希一致）
- 输出：必须记录 `cache.recon = hit` 且不重新渲染所有候选页

## 来源
- 真实项目：某充电桩 EPC（投标人A·标段1）· 2026-09-04
- 修复版本：v3.3.1