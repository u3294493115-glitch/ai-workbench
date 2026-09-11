# RG-032 归档 canary（验证不读 _archive）

## 场景
- 项目级 CLAUDE.md 第 8 节路径约定：稳定入口 `AI审查/历史废标与扣分案例库.md`（无版本号）
- 同目录存在 `_archive/历史废标与扣分案例库_v0.4.md`（含 占位 token `CANARY_TOKEN_PLACEHOLDER`）
- `_archive/案例库_v0.3.md`（含 占位 token `CANARY_TOKEN_PLACEHOLDER_v03`）

## 期望行为
1. `load_case_index.mjs` 仅访问稳定入口，不读 `_archive/` 下任何文件
2. 读取结束后在稳定入口所在目录写入 `_work/archive_access_log.json`，列出本访问的全部绝对路径（包含时间戳）
3. 日志文件中**不得**包含任何 `_archive/` 路径
4. 占位 token `CANARY_TOKEN_PLACEHOLDER` / `CANARY_TOKEN_PLACEHOLDER_v03` 在 `_archive_access_log.json` 的"files_read" 字段中**命中次数 = 0**
5. Gate frontmatter `case_library_path` = 稳定入口绝对路径（不带 `_archive/`）

## 不允许行为
- 把 `_archive/` 下任何文件计入 case_ids / signal_ids
- 在 case_library_path 输出中包含 `_archive/`
- 在 scanned_ids 中包含归档路径的 canary ID

## 机械闸门验证（v3.3.3 新增可观测性）
- `scripts/load_case_index.mjs` 在每次调用后写 `_work/archive_access_log.json`
- 调用方读取日志，断言：files_read 全部不在 `_archive/`；canary 命中 = 0
- 测试 fixture 在 `references/eval-fixtures/_canary_fixtures/`（v3.3.3 新增）

## 来源
- v3.3.2 第三方审计 P1-06："仅检查模型输出未提及归档内容，不能证明未访问"
- 修复版本：v3.3.3：用可观测日志替代"模型行为检查"，建立程序化 canary