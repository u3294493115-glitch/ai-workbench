# Skill 交接说明：bid-check-cn v3.1.0-rc

> 撰写日期：2026-09-02
> 撰写目的：让下一 Claude 窗口一打开就知道当前状态、做了什么、下一任务是什么

> ⚠️ **历史快照**（v3.3.3 标记）：本文档对应 v3.1.0-rc 版本，已被 v3.2.0 / v3.3.2 / v3.3.3 取代。
> 当前活动版本见 [STATUS.md](STATUS.md) 第一章与 [SKILL.md](SKILL.md) 顶部。
> **不要**把本文档作为新工作的依据；如需追溯，仅作历史参考。

---

## 一、版本状态

| 项 | 状态 |
|---|---|
| **当前稳定生产基线** | **v3.0.2** （tag at `914b182`，未改） |
| **当前候选版本** | **v3.1.0-rc** （tag at `c67091c` in `release/v3.1-image-recon`） |
| **当前分支** | `release/v3.1-image-recon` |
| **当前 HEAD** | `c67091c` |
| **正式 `v3.1.0` release tag** | **不存在**（用户明确指示不打，避免扩大 MVP 验证范围） |

新窗口直接调用 `bid-check-cn v3.1.0-rc`。如发现新窗口被默认 `bid-check-cn`（无版本号），应改为明确加载本 Skill。

---

## 二、本轮新增能力

3 个能力都是 **v3.1.0-rc 新增**，v3.0.2 流程不变（在 Step 0 推荐路径增加，不替代）。

### 能力 A：全页廉价侦察
- 脚本：`scripts/pdf_page_recon.mjs <pdf_path> [out_dir]`
- 输出：`<out_dir>/<pdf>.recon.json`
- 4 类 Case 判定：A 文字页 / B 纯扫描证书页 / C 文字+大面积证书图 / D 普通 Logo
- 跨页传播：候选 N → 仅当 N+1.image_count ≥ 2 时标记 N+1

### 能力 B：视觉候选 manifest 构建
- 脚本：`scripts/build_visual_manifest.mjs <pdf_path> <out_dir> [--dpi 150]`
- 输出：`<out_dir>/<pdf>.visual_candidates.json` + `<out_dir>/pages/<pdf_basename>/pNNN.png`
- 严格复用既有 `render_pdf_pages.mjs`（**零修改**）

### 能力 C：资质库 v2 只读解析
- 脚本：`scripts/read_qualification_library.mjs <library_md_path>`
- 输出（stdout JSON）：by_company / by_credit_code / by_certificate_no / by_page_token
- 4 档 tier：**HIGH** / **MEDIUM** / **LOW** / **NOT_FOUND**
- **不写库**、不落 `output/_work/qualification_index.json`

---

## 三、相关 references

`references/页面侦察与视觉候选筛选策略.md` — v3.1.0-rc 新增配套文档（~180 行），含 4 类 Case 阈值、跨页传播逻辑、资质库 tier 映射、已否决路线（hash 复用 / perceptual hash / RAG / embedding）。

---

## 四、T1-T10 行为测试

**状态**：10 / 10 PASS

```bash
node scripts/__tests__/run-all.mjs
# → "T1-T10: 10 PASS / 0 FAIL / 0 NOT_PROVEN (total 10)"
# → 报告：output/_work/test-runs/T-report-<date>.md
```

| ID | 验证什么 | 关键期望 |
|---|---|---|
| T1 | 纯文字页 | 不进候选 |
| T2 | 纯扫描证书页 | 进候选（scanned_cert_page） |
| T3 | 文字+大面积图 | 进候选（text_plus_major_image） |
| T4 | 小 logo + 文字 | 不进候选 |
| T5 | HIGH 字段精确命中 | tier=HIGH |
| T6 | 资质库有 ≠ PDF 已提交 | ❌_NOT_PROVIDED |
| T7 | LOW tier 不支撑 PASS | tier=LOW/MEDIUM |
| T8 | 跨页证书传播 N+1 | cross_page_from_<N> |
| T9 | OCR vs HIGH 冲突进 CONFLICT | 不得静默 PASS |
| T10 | 默认不全渲染 | 候选 < 总页 |

E-001~E-018（prompt-based）本轮**未回放**——需要 Claude API key + 真实 Agent 加载 Skill 后跑。

---

## 五、该项目真实 smoke test

**状态**：9 / 9 关键页命中（3 标段 × P17 / P116 / P117）

| 标段 | PDF 总页 | 候选 | 渲染 | PNG 字节 |
|---|---|---|---|---|
| 标段1.pdf | 259 | 146 | 146 | 119.28 MB |
| 标段2.pdf | 268 | 154 | 154 | 126.05 MB |
| 标段3.pdf | 268 | 149 | 149 | 124.17 MB |
| 合计 | 795 | 449 | 449 | **369.5 MB** |

vs v3.0.2 baseline：
- 总 PNG 数：581 → 449（**-22.7%**）
- 总 PNG 字节：~411 MB → 369.5 MB（**-10.1%**）

**Smoke 数据**保留在本地 `output/_work/smoke/lc{1,2,3}/`（已 gitignore，不入 git）。

详细对比表：`output/_work/smoke/smoke-report-2026-09-02.md`

---

## 六、Backlog（用户已确认，后续再处理）

1. **跨标段重复资质页去重**
   - 当前该项目 3 标段大量资质重复出现
   - 效率优化，不阻塞 MVP
   - **约束**：必须保留每标段独立"材料确实存在"的证据链

2. **视觉候选比例仍偏高**（56%）
   - 标段 1 PDF 是「每页有嵌入图 + native text」的扫面文档，是固有特性
   - **当前不优化**

3. **pdftoppm vs pdfjs 页数统计差异**（648 vs 795）
   - pdfjs 把 form xObject 容器 / 命名目标页也算成 page
   - 当前不阻塞

4. **Hash 精确匹配 0/4 命中率**
   - 当前**不采用**
   - 后续如需要再扩大样本到 5-10 对

5. **RELEASE 报告 P 段其他真实剩余问题继续保留**（详见 `output/_work/RELEASE-v3.1.0-rc.md`）

---

## 七、未提交改动检查

最后命令：`git status`
```
On branch release/v3.1-image-recon
Untracked files: (use "git add..." to include in what will be committed)
        output/

nothing added to commit but untracked files present
```
- `output/` 是 gitignored 的本地工作区（smoke / experiments / test-runs / 库索引）
- **没有遗留的正式代码改动**未提交

---

## 八、下一真实任务（不是继续开发）

**下一窗口应直接调用当前 `bid-check-cn v3.1.0-rc`，审核新真实投标文件。**

**下一审核对象**：**投标人A的投标文件**
- 已知：资质库 v2 里有 #9 投标人A（全称未发现，主体关系待确认；OCR 资料 LOW/NOT_FOUND tier）
- 期待：v3.1.0-rc 真实审核暴露的新问题，再按真实问题驱动决定是否继续迭代

如果新审核暴露新 bug：
- 不擅自扩展功能
- 不擅自扩大样本实验
- 把新观察加到 `references/候选经验区.md`（AI 自动捕获，非正式规则）
- 等用户决定是否升级

---

## 九、关键文件路径速查

| 项 | 路径 |
|---|---|
| Skill 文档 | `SKILL.md` |
| 新能力文档 | `references/页面侦察与视觉候选筛选策略.md` |
| 3 个能力脚本 | `scripts/pdf_page_recon.mjs`, `scripts/build_visual_manifest.mjs`, `scripts/read_qualification_library.mjs` |
| 实验脚本 | `scripts/hash_match_experiment.mjs` |
| T1-T10 行为测试 | `scripts/__tests__/T{1..10}-*.mjs` + `run-all.mjs` + `helpers.mjs` |
| 合成 fixture | `scripts/__tests__/fixtures/T{1..10}-*.pdf` + `library_mini.md` |
| 本 release 详细回报 | `output/_work/RELEASE-v3.1.0-rc.md`（不入 git） |
| Smoke test 数据 | `output/_work/smoke/lc{1,2,3}/`（不入 git） |
| 实验数据 | `output/_work/experiments/`（不入 git） |
| T1-T10 报告 | `output/_work/test-runs/T-report-2026-09-02.md` |

---

## 十、硬约束提醒

1. **v3.0.2 tag 不可改**：dc8a0cdfb74f6582d3d6d3eab3886e352bfe930d 永远指 914b182
2. **既有 scripts/*.mjs（render_pdf_pages / extract_pdf_images / extract_doc_text）零修改**
3. **资质库 v2 文件零修改**
4. **E-001~E-018 / behavioral-evals.md / evals.json / static-rule-check.md 零修改**
5. **references/专业知识规则库.md / 案例库调用规范.md / 候选经验区.md 等只读区零修改**
6. **input/ 只读**；渲染图统一进 `output/_work/pages/`
7. **新能力不替代 v3.0.2 流程**，仅在 Step 0 推荐路径增加
