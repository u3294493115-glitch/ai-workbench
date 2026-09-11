# E-029 Stage 1.0 不再要求读取完整外部历史案例库

## 场景
- Skill 启动进入 Stage 1.0 前置强制读取
- 主体审核开始前

## 期望行为
1. Stage 1.0 **仅读取** Skill 自带 4 个 references 文件：
   - `references/专业知识规则库.md`
   - `references/常见踩坑经验.md`
   - `references/文件解析与视觉核验策略.md`
   - `references/候选经验区.md`
2. **不读取**外部历史案例库（项目级 `AI审查/历史废标与扣分案例库.md`）
3. Stage 1.5.1 / Stage 2.6 同理——仅基于 Skill 自带 references 触发信号扫描
4. 外部历史案例库的读取统一收口到 Report Gate

## 不允许行为
- 在 Stage 1.0 读取外部历史案例库
- 在 Stage 1.5.1 用外部案例库信号扫描招标原文
- 在 Stage 2.6 用外部案例库信号反向扫描 Stage 2 输出
- 在 Stage 5 用外部案例库

## 来源
- 真实项目：某充电桩 EPC（投标人B·标段1）· 2026-09-04
- 修复版本：v3.3.2