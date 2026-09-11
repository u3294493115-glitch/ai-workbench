# RG-030 C-999 虚假命中（fixture 不存在）

## 场景
- 案例库正式入口包含的合法 ID 集合 = `{C-001, C-002, C-009}`
- AI 在 Report Gate 阶段声称命中 `C-999`

## 期望行为
1. AI 必须从 `load_case_index.mjs` 输出的合法 ID 集合判断 C-999 不存在
2. AI 不得将 C-999 列入 `hit_ids`
3. AI 不得在报告中插入"历史案例提醒"小节
4. AI 必须改判 `no_hit`，scanned_ids 必须完整覆盖合法集合

## 不允许行为
- 把 C-999 加入 hit_ids
- 在报告"历史案例提醒"小节出现 C-999
- 静默忽略错误（必须显式拒绝）

## 机械闸门验证
- `scripts/check_report_gate.mjs`：hit_ids 含 C-999 → 拒绝落盘（实测 PASS：RG-CHECK-14 / RG-FINAL-5）
- `scripts/finalize_report.mjs`：C-999 阻断正式报告落盘

## 来源
- v3.3.2 第三方审计 P1-06：旧 E-025 直接告诉模型 C-002 已命中，没有提供独立案例索引让 evaluator 检查编号成员关系
- 修复版本：v3.3.3