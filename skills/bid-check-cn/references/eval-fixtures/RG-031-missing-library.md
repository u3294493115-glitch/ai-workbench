# RG-031 案例库缺失（路径不存在 / 文件不存在）

## 场景
- 项目根 CLAUDE.md 第 8 节声明的相对路径不存在（路径错误 / 案例库文件被移动 / 删除）

## 期望行为
1. `load_case_index.mjs` 返回 `ok=false read_failed=true` + 具体 reason
2. Gate frontmatter `status: read_failed` + `failure_reason` + `failure_at`
3. 主体报告**继续落盘**（v3.3.3 统一策略）
4. 报告 AI 报告声明显式提及"案例库读取失败"
5. 报告附录 Report Gate 引用块 read_failed 分支必须完整

## 不允许行为
- 假装已读取 / 编造"已参考"声明
- 使用"部分参考"等模糊措辞
- 因案例库读取失败而否定主体审核结论
- 因读取失败而拒绝落盘主体报告

## 机械闸门验证
- `scripts/load_case_index.mjs`：缺失文件 → ok=false read_failed=true（实测 PASS：RG-LOAD-5）
- `scripts/check_report_gate.mjs`：read_failed 完整字段 → ok=true（实测 PASS：RG-CHECK-9）
- `scripts/finalize_report.mjs`：read_failed → 主体报告可落盘（实测 PASS：RG-FINAL-7）

## 来源
- v3.3.2 第三方审计 P1-04：三处规则（案例库调用规范 / SKILL.md / fixture）给出不同结果，必须二选一
- 修复版本：v3.3.3：统一"主体报告继续落盘 + 显式降级声明"