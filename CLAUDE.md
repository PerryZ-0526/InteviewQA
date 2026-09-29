# 面试真题知识库 - 组织规范

## 项目目标

以结构化方式组织面试真题，每个 markdown 文件存放一道真题及其解析，支持按目录分类和按标签检索。

## 目录结构

```
InteviewQA/
├── README.md                  ← 顶层索引（所有分类和标签概览）
├── categories/                ← 所有分类目录
│   ├── agent/
│   │   ├── 00-index.md
│   │   ├── 001-xxx.md
│   │   └── ...
│   ├── rag/
│   │   ├── 00-index.md
│   │   ├── 001-xxx.md
│   │   └── ...
│   └── ...（其余分类）
├── tags/                      ← 标签文件目录
│   ├── JVM.md
│   ├── 并发.md
│   └── ...
└── CLAUDE.md
```

### 规则

- 所有分类目录统一放在 `categories/` 下，目录名使用**英文 + 连字符**命名（如 `claude-code`、`design-patterns`、`process-thread-coroutine`）。
- 每个分类目录下，必须有一个 `00-index.md`，列出该目录下所有真题的索引。
- 根目录下的 `README.md` 作为顶层索引，列出所有大分类和所有标签。
- 标签文件统一放在顶层 `tags/` 目录下，每个标签一个 `.md` 文件。
- 标签文件命名不加序号前缀，直接使用标签名（如 `JVM.md`、`并发.md`）。

## 真题文件命名规范

- 所有真题文件必须以 `001-`、`002-`、`003-` 这样的三位数字序号开头。
- 序号后紧跟简短描述，用连字符分隔，如 `001-Java内存模型.md`。
- 每个文件只存放一道真题。

## 真题文件内部结构（从上到下）

每个真题 `.md` 文件必须按以下顺序组织：

### 1. YAML frontmatter

标题、标签和时间统一存入文件开头的 YAML frontmatter，不得再用正文标题或 HTML 注释承载：

```yaml
---
schema: interviewqa/v2
kind: question
body_schema: interviewqa/sections-v1
title: 题目标题
tags:
  - JVM
  - 并发
created: 2026-08-03 14:30:00
updated: 2026-08-03 14:30:00
---
```

- `schema` 固定为 `interviewqa/v2`。
- 真题的 `kind` 固定为 `question`；项目或分组文档使用 `document`。
- 真题的 `body_schema` 固定为 `interviewqa/sections-v1`。
- `title` 是文档标题的唯一来源，正文不再重复写文档标题 H1。
- `tags` 是标签名数组，不写标签文件链接。
- 修改文件时只更新 `updated`，`created` 保持不变。
- 未识别的 frontmatter 字段必须原样保留。

### 2. 题目

使用成对标记包裹题目内容：

```markdown
<!-- interviewqa:section question -->
题目内容
<!-- interviewqa:end -->
```

题目导航不写入文档。应用按 `00-index.md` 顺序派生上一题和下一题，索引缺项时回退到三位序号文件名顺序。正文中的 H1-H6 只表示内容层级，不得用于识别编辑器章节。

### 3. 面试可直接答的版本

使用 `<!-- interviewqa:section answer -->` 与 `<!-- interviewqa:end -->` 包裹。

**核心要求**：
- 必须是**段落式**的行文，**严禁使用分点、列表、序号**。
- **多段落组织**：每个逻辑转折处另起一段。例如「首先」「其次」「第三」「第一层」「第二步」「架构层面」「另一方面」「总结来说」这类过渡词引入的内容应各自成段，让文本有呼吸感，便于面试时自然停顿和切换话题。
- 不能泛泛而谈，要讲得**全面、深入**，覆盖该知识点的核心概念、关键机制、常见问题和实践建议。
- **篇幅要求**：**根据题目难度在500-1000内浮动**，允许适当超出预算，概念解释类可稍短，多维度对比/开放讨论类应更长。
- **开头概述**：正文第一段必须是 100-200 字间的精炼概述，一句话点明核心结论 + 关键机制 + 应用边界。要求**精炼、专业、偏技术、偏硬核**——直接给出技术判断，不要铺垫、不要客套、不要"面试官您好"式的开场。**格式：整段被“>"包裹**
- 语言自然流畅，适合口头表达，避免过于书面化的长句。

### 4. 详细解析（可选生成）

使用 `<!-- interviewqa:section analysis -->` 与 `<!-- interviewqa:end -->` 包裹。

默认生成；用户明确选择不生成时可省略或保留 `(暂无)` 占位。

**核心要求**：
- 深入展开，可以包含原理分析、源码解读、底层机制、对比分析、面试追问等。
- 可以使用图表、代码片段、对比表格等任何有助于理解的形式。
- 篇幅不限，以讲透彻为准。

### 4.5 自定义章节

只有编辑器显式创建的自定义章节才使用 custom marker：

```markdown
<!-- interviewqa:section custom {"id":"custom-稳定标识","title":"章节标题"} -->
章节内容
<!-- interviewqa:end -->
```

普通 H1-H6 必须保留在当前章节内部，不能自动转换为自定义章节。

### 5. 撰写依据要求（有理有据）

题目文档的撰写**必须有理有据**，不能凭印象或经验臆断。**AI 在生成内容时有意识地自主查阅一手资料**，而不是仅凭训练数据中的记忆：

- **官方技术博客与文档**：Claude Code / Codex / Claude / OpenAI / Google 官方技术博客、官方技术文档、发布说明（release notes）。
- **框架技术文档**：LangChain / LangGraph / AgentScope / AutoGen 等框架的官方文档、设计文档。
- **开源项目源码与文档**：Hermes agent / OpenClaw 等高 stars 开源项目的源码、README、架构文档；高 stars skills 的实现源码与说明文档。

## 标签文件格式

```markdown
# 标签名

## 相关题目

- [001-Java内存模型](../categories/java/001-Java内存模型.md)
- [003-垃圾回收机制](../categories/java/003-垃圾回收机制.md)
- ...
```

按分类分组列出所有打上该标签的真题链接。

## 00-index.md 格式（分类索引）

```markdown
# 分类显示名 - 题目索引

## 题目列表

- [001-xxx](001-xxx.md) - 简短说明
- [002-xxx](002-xxx.md) - 简短说明
- ...
```

## README.md 格式（顶层索引）

```markdown
# 面试真题知识库

## 分类

### AI Agent / LLM 应用框架
- [Agent](categories/agent/00-index.md)
- ...

### 数据存储
- [Redis](categories/redis/00-index.md)
- ...

## 标签
- [JVM](tags/JVM.md)
- ...
```

## 新增真题的流程

1. 确定真题所属分类目录（如 `categories/java/`）。
2. 查看该目录下 `00-index.md`，确认当前最大序号，新文件序号为该数字 +1。
3. 在分类目录下创建真题文件，按 v2 frontmatter 与正文规范填写。
4. 更新该分类的 `00-index.md`，追加新题目条目。
5. 为每个标签检查 `tags/` 下是否存在对应文件，不存在则新建；在标签文件中追加题目链接。
6. 更新 `README.md`（如果新增了分类或标签）。

> **重要**：当用户在本终端直接提出新增面试题的要求时，Claude Code（你）应利用自身原生分析能力，严格按照本 CLAUDE.md 规范**直接撰写**题目文件，而**不是调用** `POST /api/generate` 接口。`/api/generate` 仅供前端管理后台使用。
