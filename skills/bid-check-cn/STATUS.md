# bid-check-cn 状态页

> 维护者：Skill 维护者（每次发版或重大改动后更新）
> 读取时机：每次 Skill 调用前 / 每次修改 Skill 前 / 任何对 Skill 行为有疑问时
> 入口：[SKILL.md](SKILL.md) 顶部已强制链接

---

## 一、当前版本与发布状态

| 项 | 值 |
|---|---|
| 当前版本 | **v3.3.3** |
| 发布状态 | **受控试用**（第三方复审通过：核心修复符合 MVP；2026-09-05） |
| 上一个稳定版本 | v3.3.2（生产 Skill 主干） |
| 本版本相对上一版的核心变化 | 机械闸门 + 程序化测试集（39 条 RG 用例全部 PASS） |
| 正式生产 Skill 是否包含本版本变更 | **否**——所有改动在工作树，未提交 / 未推送到主干 |

### 配套机制

| 机制 | 路径 | 作用 |
|---|---|---|
| 路径发现 + 合法 ID 集合 + SHA-256 | `scripts/load_case_index.mjs` | 唯一允许读取外部案例库索引的程序入口；按章节切片，不读全文 |
| 报告前 preflight 校验 | `scripts/check_report_gate.mjs` | 9 项硬校验（含 draft 绑定 / read_failed 披露强制） |
| 唯一报告落盘入口 | `scripts/finalize_report.mjs` | 原子重命名 draft → final + 写 `run_registry.json`；禁止模型绕过 |
| 程序化测试 | `scripts/__tests__/rg-{load-case-index,check-report-gate,finalize-report}.mjs` | 39 条 case，全部 PASS |

---

## 二、历史入口

| 版本 | 文档 | 状态 |
|---|---|---|
| v3.3.2 | [SKILL.md](SKILL.md)（上一版本）| 生产主干基线 |
| v3.3.3 | [SKILL.md](SKILL.md)（当前版本） | 受控试用 |
| v3.2.0 | [HANDOFF-v3.2.0.md](HANDOFF-v3.2.0.md) | **历史快照**（不要再用作工作依据）|
| v3.1.0-rc | [HANDOFF-v3.1.0-rc.md](HANDOFF-v3.1.0-rc.md) | **历史快照** |

---

## 三、已知瑕疵（v3.3.3 MVP 范围）

### 3.1 已修复（第三方复审通过）

| 编号 | 描述 | 修复手段 | 回归测试 |
|---|---|---|---|
| P1-1 | read_failed 草稿替换早返绕过 | `verifyDraftBinding()` 统一收口到所有 status；read_failed 分支前移 | RG-FINAL-7/13/14 |
| P1-2 | 注释隐藏披露 `<!-- read_failed -->` 通过 | 剥离 HTML 注释 + 强制"未参考历史案例 + 失败原因 + 失败时间" 三段 | RG-CHECK-18 |
| P1-3 | 正文含 C-999 / R-XXX 进入合法 ID 集合 | `load_case_index` 按章节切片；`scanCaseIds` 过滤 R-XXX | RG-LOAD-7 |
| P1-4 | 子进程打印 PASS 但 exit(1) 被汇总器误判 | `run-all.mjs` 强制 `exit_code !== 0` → FAIL；零输出 → NOT_PROVEN | run-all.mjs 整体 |
| P2-1 | R-007 等关联规则被混入合法集合 | `scanCaseIds` 过滤 R-* | 同 P1-3 |

### 3.2 使用边界（不要求本轮加机制）

| 编号 | 描述 | 处理 |
|---|---|---|
| NB-1 | E-029 程序化观察器未实现 | SKILL.md Stage 1 启动约束仍为文字规定；真实运行中需配合 host 环境层 hook 才能验证 |
| NB-2 | 真实项目未重跑 v3.3.3 | MVP 试用窗口内需至少跑 1 个真实项目并由 第三方 三审才能宣布关闭问题 |
| NB-3 | T1-T10 是 v3.1.0-rc 链路测试，本轮未跑 | `node scripts/__tests__/run-all.mjs` 会一并跑；如果旧 PDF 链路已退役可逐步移除 |
| NB-4 | Skill frontmatter `compatibility` / `license` 字段缺失 | 不影响 MVP 功能；正式发版前补齐 |

### 3.3 文档与历史快照

| 编号 | 描述 | 处理 |
|---|---|---|
| DOC-1 | `runner.md` 仍引用不存在的 `evals/regression-cases.md` | **v3.3.3 已修**：改为 `evals/behavioral-evals.md`（v3.0.0 收口改名后的真实文件） |
| DOC-2 | HANDOFF-v3.1.0-rc.md / HANDOFF-v3.2.0.md 未标"历史快照" | **v3.3.3 已修**：顶部加 ⚠️ 历史快照 警告 |
| DOC-3 | "复审反馈"找不到原始文件 / 路径 | **登记为待恢复**——详见下方 |

---

## 四、待恢复 / 缺失文档清单

| 缺失项 | 已知信息 | 状态 |
|---|---|---|
| "复审反馈" | 在 复审报告中提及（v3.3.3 第二轮复审），但本 Skill 包内 + 用户项目目录（<WORKSPACE>\）下均未找到可读路径；2026-09-04 ~ 2026-09-05 范围 | **待恢复**——由 Skill 维护者决定：(a) 是否向 第三方 索要原文；或 (b) 主动丢弃（v3.3.3 第二轮复审已认可 MVP 结论，"5 项建议"是否仍有效需重新评估） |

---

## 五、验证证据

| 时点 | 内容 | 结果 |
|---|---|---|
| 2026-09-05 | `node scripts/__tests__/rg-load-case-index.mjs` | RG-LOAD 7/7 PASS |
| 2026-09-05 | `node scripts/__tests__/rg-check-report-gate.mjs` | RG-CHECK 18/18 PASS |
| 2026-09-05 | `node scripts/__tests__/rg-finalize-report.mjs` | RG-FINAL 14/14 PASS |
| 2026-09-05 | `node scripts/__tests__/run-all.mjs` | 13/13 PASS, exit=0 |
| 2026-09-05 | 第三方 第二次复审 | MVP 通过；不扩大代码修改；3 项文档小修（断链 / 状态页 / 历史快照） |

---

## 六、版本记录

| 版本 | 日期 | 更新 |
|---|---|---|
| v3.3.3 | 2026-09-05 | 新建 STATUS.md：建立状态页 + 文档小收尾（断链 / 历史快照 / 缺失登记）；第三方 第二次复审通过 MVP |