# 我的AI工作台

这个仓库用于保存我的AI学习资料、提示词模板和练习项目。

## 主要内容

- AI提示词
- 工作流程模板
- AI编程练习
- 学习笔记

## 注意事项

不上传公司机密、客户资料、账号密码和API Key。

---

## skills/

按 AI 工具分类组织的可加载 Skill/技能 集合。

### skills/bid-check-cn — 投标文件合规检查

- **版本**：v3.3.3（2026-09）
- **能力**：审核范围声明闸门、5 态证据搜索、4 层知识分层、决策导向报告、候选经验隔离、硬写入闸门、机械闸门 Report Gate
- **输入**：招标文件 + 投标文件成稿 + 投标截止日期 + 审核范围声明
- **输出**：合规检查报告（决策导向 8 模块）

详细：[skills/bid-check-cn/SKILL.md](./skills/bid-check-cn/SKILL.md)

### 安装方法

#### WorkBuddy（腾讯 AI 编码助手）

```bash
git clone https://github.com/u3294493115-glitch/ai-workbench.git
cp -r ai-workbench/skills/bid-check-cn ~/.workbuddy/skills/bid-check-cn
```

Windows PowerShell：

```powershell
git clone https://github.com/u3294493115-glitch/ai-workbench.git
Copy-Item -Recurse ai-workbench\skills\bid-check-cn $env:USERPROFILE\.workbuddy\skills\bid-check-cn
```

重启 WorkBuddy，对话框输入 `/skills` 即可看到 `bid-check-cn` 已加载。

#### Claude Code / Codex

```bash
git clone https://github.com/u3294493115-glitch/ai-workbench.git
cp -r ai-workbench/skills/bid-check-cn ~/.claude/skills/bid-check-cn
```

### 重要前提

`bid-check-cn` Skill 设计上**强依赖**项目级历史案例库 `<your_project>/AI审查/历史废标与扣分案例库.md`。本仓库不包含任何真实案例库。详见 Skill 内 `references/案例库调用规范.md`。

### 隐私声明

`skills/bid-check-cn/` 已脱敏处理：移除真实项目名、公司名、用户路径、内部复审代号、案例库 canary token。如发现残留敏感信息，请开 issue 告知。