# 回归测试执行流程（v3.0.0 新增）

> **目的**：每次 Skill 修改前先跑一遍行为级 Eval（见 `evals/behavioral-evals.md` 的 E-001 ~ E-029）+ 程序化测试集（T1~T10 + RG-LOAD-1~7 / RG-CHECK-1~18 / RG-FINAL-1~14 共 39 条；编排见下方"运行方式"），确保"修一个问题不制造另一个问题"。
>
> 注历史条目（v3.0.0 之前）：原 `evals/regression-cases.md` 已在 v3.0.0 收口时改名为 `evals/behavioral-evals.md`；静态规则检查文档见 `evals/static-rule-check.md`。

---

## 执行时机

- 任何 Skill 核心文件修改前（SKILL.md / references/*.md / evals/*.md）
- 版本升版前
- 用户报告"上次结果不对"时

---

## 执行流程

#### Step 1：准备测试场景

为每条 E-XXX 测试用例准备一个**最小化的虚构场景**：

```
示例：E-001 高等级不得误判

虚构招标文件片段：
"投标人拟派驻的项目经理须取得二级及以上机电工程专业注册建造师执业证书"

虚构投标文件片段：
P10 项目经理资格证书：编号 XXXX，姓名 XXX，专业：机电工程，级别：一级，证书名称"中华人民共和国一级建造师职业资格证书"

期望 AI 行为：
1. 等级（A-12.1）：✅ 一级 ≥ 二级
2. 证书性质（A-12.3）：⚠️ / ❌ "职业资格证书" ≠ "注册执业证书"
3. 不得因为 A-12.3 不符合就连带判定 A-12.1 等级也不符合
```

#### Step 2：加载 Skill 后运行场景

按 `SKILL.md` 的 Step 0 / Step 0.5 / Stage 1 / Stage 2 流程执行虚构场景。

#### Step 3：核对期望 vs 实际

| E-XXX | 期望行为 | 实际行为 | 通过？ |
|---|---|---|---|
| E-001 | 等级独立判 ✅，证书性质独立判 ❌ | ... | ✅ / ❌ |
| ... | ... | ... | ... |

#### Step 4：失败用例修复

如果某条 E-XXX 未通过：
1. 定位 Skill 中导致失败的具体条款
2. 修复该条款
3. 重跑该条 + 全部 10 条
4. 直到全部通过

#### Step 5：记录到测试报告

在每次 Skill 修改后，输出"回归测试报告"：

```
【回归测试报告 v3.0.0】
执行日期：YYYY-MM-DD
执行人：AI / 用户
Skill 版本：v3.0.0

| 用例 | 通过/失败 | 备注 |
|---|---|---|
| E-001 高等级不得误判 | ✅ / ❌ | ... |
| E-002 未读到图片不得判缺失 | ✅ / ❌ | ... |
| ... | ... | ... |

总计：X / 10 通过

如有失败：
- E-XXX：失败原因 + 修复方案
```

---

## 测试场景构造原则

- 场景必须**最小化**——仅测试目标条款，不引入其他干扰
- 场景必须**真实**——基于实战教训反向构造（不臆造）
- 场景必须**可重复**——任何人在任何时候执行结果一致
- 场景**不依赖真实项目**——避免泄露客户信息

---

## 与投标人E实战教训的对应

| 实战教训 | 对应测试用例 |
|---|---|
| 一级建造师职业资格 ≠ 注册执业证 | E-001 / E-004 |
| 信用截图未盖公章（AI 直接判致命） | E-002 / E-008 / E-011 |
| 业绩一览表"无" vs 自评"5 个以上" | E-005 |
| 项目经理姓名"曹力峰" vs "曹利峰" | E-005 |
| P22 证书只看封面就下结论 | E-006 |
| （AI 自动生成未授权 P-XXX 编号） | E-007 |
| 招标 14 项被重构成 22 项 | E-009 |
| 未完成搜索就甩给人工 | E-010 / E-017 |
| 过程文件污染 input/ 与项目根目录 | E-012 |
| 最终报告未落盘 | E-013 |
| 审查表总分/项数被擅自重做 | E-014 |
| Stage 2 未完成就先给 B-02 分数 | E-015 |
| 从电子证书例外条款派生"签名日期"否决 | E-009 + E-016 |
| **v3.0.2 新增**：范围闸门失效（必核/建议/人工确认仍出现签章） | E-011（加强） |
| **v3.0.2 新增**：frozen 是本轮临时生成 + Stage 2 一边审核一边造尺子 | E-014（加强） |
| **v3.0.2 新增**：渲染图进 output/_pages/ 而非 output/_work/pages/ | E-012（加强） |
| **v3.0.2 新增**：input/_extracted.docx 等历史残留处理 | E-012（加强） |
| **v3.0.2 新增**：联合体"未搜到 = 不存在" | E-017（新增） |
| **v3.0.2 新增**：上轮 10/10 PASS 自相矛盾 | E-018（新增） |
| **v3.0.2 新增**：6,733,120 元等 AI 创造审核条件 | E-008（加强） |

---

## T1-T10 行为测试（v3.1.0-rc 新增）

> **目的**：v3.1.0-rc 新增的 3 个能力（页面廉价侦察 / 候选渲染 / 资料复用）必须有**真实执行测试**验证。区别于 E-001~E-018 的 prompt-based。

### T1~T10 + RG-* 列表（程序化 fixture + Node 自动化）

| ID | 描述 | 关键期望 |
|---|---|---|
| **T1** | 纯文字页 | `pdf_page_recon.mjs` 不标记为 visual_candidate |
| **T2** | 纯图片证书页（无 native text） | 标记为 visual_candidate，reason = scanned_cert_page |
| **T3** | 文字 + 大面积证书图 | 标记为 visual_candidate，reason = text_plus_major_image |
| **T4** | 普通文字 + 小 logo / 图标 | 不标记为 visual_candidate |
| **T5** | 已知资质库 HIGH 字段精确命中 | `read_qualification_library.mjs` 返回 tier=HIGH |
| **T6** | 资质库有证书 + 当前 bid PDF 没找到 | `❌ 完成针对性搜索仍未找到`（task spec 4.1） |
| **T7** | OCR 待复核 LOW tier 资料 | 不得直接支撑 PASS，仅作辅助候选 |
| **T8** | 跨页证书（2-3 页） | 邻页正确传播（任务书第九节 + E-006） |
| **T9** | OCR 结果与已人工复核资料冲突 | 输出 CONFLICT，不静默覆盖 |
| **T10** | 默认工作流 | 不全文渲染（候选页数 << 总页数） |
| **RG-LOAD-1~7** | load_case_index 路径发现 | CLAUDE.md 第 8 节 → 案例库绝对路径 + 合法 ID 集合 + SHA-256；归档路径 / 缺失库 / 无第 8 节均返回 read_failed；归档 canary 写入 `_work/archive_access_log.json` 且 files_read 全部不在 _archive/；正文含伪造 C-999 不进入合法集合 |
| **RG-CHECK-1~18** | check_report_gate preflight | run_id / mtime / 时间顺序 / status 合法性 / failure_reason / scanned_ids 覆盖度 / hit_ids ⊆ 合法集合 / SHA-256 一致性 / draft 绑定 / read_failed 完整披露（剥离 HTML 注释） |
| **RG-FINAL-1~14** | finalize_report 机械闸门 | 缺 Gate / run_id 不匹配 / 未来 completed_at / C-999 非法编号 / final 已存在 / read_failed 完整 / mtime 太早 / draft 替换 / draft 篡改 / draft 不含披露等 14 类 |

### 运行方式

```bash
# 单个 T
node scripts/__tests__/T1-text-page-not-candidate.mjs

# 全部 T1-T10
node scripts/__tests__/run-all.mjs
# 输出 X/10 PASS，以及 Markdown 报告到 output/_work/test-runs/
```

### fixture 策略

- 每个 T 单独一个合成 PDF（`scripts/__tests__/fixtures/T<n>-*.pdf`），由 `node scripts/__tests__/fixtures/_build.mjs` 程序化生成
- **绝不含**真实客户信息；不进 git 真实数据，仅 fixture 程序
- 已人工复核字段直接写在 `scripts/__tests__/fixtures/library_mini.md` 里（与正式 `合作单位资质库v2` 平行但不修改它）

### 三态证据等级（v3.0.2 R5）

| T 状态 | 评级 |
|---|---|
| fixture + Node 真实运行 + 产物与期望一致 + 无自相矛盾 | **PASS** |
| fixture + Node 真实运行 + 产物与期望不符 | **FAIL** |
| 仅文档存在 / 仅 fixture 存在 / 仅 prompt-based 期望 | **NOT PROVEN** |

---

## 版本记录

| 版本 | 日期 | 更新内容 |
|---|---|---|
| v3.0.0 | 2026-08-26 | 首发：5 步流程 + 场景构造原则 + 与投标人E实战对应表 |
| v3.0.1 | 2026-08-27 | 该项目实战对应表扩展（E-012 ~ E-016） |
| **v3.0.2** | **2026-08-27** | **二次回归实战对应表扩展：① 加强 E-008（禁止 AI 创造审核条件）+ E-011（必核/建议/人工确认 3 处全报告零出现）+ E-012（_work/pages/ 收口 + 残留清单）+ E-014（frozen 必须先于 Stage 2 存在 + 同源约束）；② 新增 E-017（穷尽搜索 6 类前置）+ E-018（PASS/FAIL/NOT PROVEN 三态证据等级）** |
| **v3.1.0-rc** | **2026-09-02** | **新增 T1-T10 行为级真实执行测试（区别于 E-001~E-018 的 prompt-based）；覆盖 v3.1.0-rc 新增的 3 个能力（侦察 / 候选渲染 / 资料复用）** |
| **v3.3.3** | **2026-09-04** | **第三方 审计 FAIL 收口（两轮）：① 第一轮新增 RG-LOAD-1~6 / RG-CHECK-1~15 / RG-FINAL-1~10 共 31 条程序化测试；② 第二轮扩到 RG-LOAD-1~7 / RG-CHECK-1~18 / RG-FINAL-1~14 共 39 条（新增 RG-LOAD-7 正文含 C-999；RG-CHECK-16 draft 绑定；RG-CHECK-17 failure_at 非 ISO8601；RG-CHECK-18 read_failed 剥离 HTML 注释检查；；RG-FINAL-11/12 draft 替换 / 篡改；RG-FINAL-13/14 read_failed 强制披露）；③ 区分 prompt eval（E-024~E-029 仅证明模型复述规则）vs side-effect test（在隔离 tmpdir 验证文件创建 / 时间顺序 / 路径 / 阻断）；④ archive canary 用可观测日志（`_work/archive_access_log.json`）+ canary token 字符串验证；⑤ E-024~E-029 fixture 文件改用 RG-024~RG-029 前缀以消除与人工报告编号的命名冲突；⑥ load_case_index 章节切片 + R-XXX 过滤；⑦ run-all 强制 exit code + 零输出 NOT_PROVEN** |