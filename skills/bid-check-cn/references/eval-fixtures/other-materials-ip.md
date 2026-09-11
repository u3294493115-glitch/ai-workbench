# E-025 other-materials-ip-pages

## 场景
- 招标文件 B-03：2021/1/1 至今获得实用新型专利证书或软件著作权登记证书（仅限充电桩、电力类），一项 5 分，最多 15 分；需提供证书扫描件
- 投标文件目录显示章节："（六）其它投标人认为需要提交和说明的文件和/或资料" → "1．工程研发能力"（页码 54-55）

## recon 输出
- P54: `is_visual_candidate=true`, `image_count=1`, `max_image_frac=0.62`
- P55: `is_visual_candidate=true`, `image_count=1`, `max_image_frac=0.64`

## 期望行为
1. P54、P55 必须全部进入渲染 + 视觉调用；
2. evidence_manifest.json 中 B-03 `status` 必须是 `complete` 或 `vision_blocked`，**不能**是 `incomplete`；
3. 报告 B-03 章节基于真实视觉结果给出分数，不能写"视觉核验未发现"——除非 status 为 `vision_blocked` 且附重试记录；
4. 章节别名"（六）其它投标人认为需要提交和说明的文件和/或资料"必须映射到 B-03 / B-04 / B-05 等相关评分项。

## 不允许行为
- 跳过 P54、P55 视觉调用
- 报告写"未发现"但 manifest 状态为 `incomplete`
- 把章节"工程研发能力"误归到无关评分项

## 来源
- 真实项目：某充电桩 EPC（投标人A·标段1）· 2026-09-04
- 修复版本：v3.3.1