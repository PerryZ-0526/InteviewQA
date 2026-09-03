# 面试真题知识库

## 项目概述

一个面向技术面试准备的结构化知识库，涵盖 AI Agent、LLM 应用框架、数据存储、编程语言及计算机基础等方向。核心思路是将分散的面试知识点用 Markdown 文件系统化组织，支持分类浏览、标签检索、全文搜索和随机抽题练习。

每条题目包含六个标准章节——题目、标签、题目导航、面试直接答（可流畅口述）、详细解析（含追问预备）、以及个人作答记录，确保面试准备既有广度也有深度。

## 核心场景

- **系统性准备面试**：按技术领域分类浏览，从"能答"升级到"答得好"
- **碎片时间复习**：随机抽题 + 移动端离线阅读，通勤时刷几道
- **知识库共建**：通过 Claude Code CLI 辅助生成高质量解析，人工审核打磨后归档
- **项目设计沉淀**：project 目录存放架构设计文档，支持编辑、批注和目录导航

## 架构

```
InteviewQA/
├── categories/          ← 题库主体（分类 → 题目 .md）
│   ├── agent/           ← 例：Agent 相关真题
│   ├── redis/           ← 例：Redis 相关真题
│   └── ...
├── tags/                ← 标签文件，跨分类索引
├── project/             ← 项目设计文档（子目录 → .md）
├── groups/              ← 分组文档（「新建分组」创建的独立区块）
├── admin/               ← Next.js 管理后台（浏览/编辑/生成/批注）
├── mobile/              ← Capacitor 移动端 App
├── .claude/
│   ├── skills/          ← Claude Code skill 定义（interview-qa）
│   └── settings.local.json
├── CLAUDE.md            ← 知识库内容规范（文件结构、命名、章节要求）
├── README.md            ← 本文件
└── SETUP.md             ← 环境搭建与启动
```

### 数据层

所有内容以 Markdown 文件存储在磁盘上，无数据库依赖。分类目录和文档列表通过读取目录结构和 `00-index.md` 索引文件动态生成。时间元数据以 HTML 注释 `<!-- created: -->` 形式写在文件末尾。

### 管理后台（admin/）

基于 Next.js 14 的 SPA，核心功能：

- **题库浏览**：左侧边栏按分类 + 标签 + project 分组展示
- **文档编辑**：TipTap WYSIWYG 编辑器，支持自动保存、目录导航、文本批注
- **AI 生成**：调用 Claude Code CLI，结合 interview-qa skill 和 CLAUDE.md 规范自动生成题目并更新索引
- **扩展**：支持自定义章节、删除章节、恢复章节

### 移动端（mobile/）

基于 Capacitor 的纯静态 Web App，将题库打包为原生 APK。支持分类浏览、标签检索、全文搜索、离线访问。构建时将 `categories/`、`tags/`、`project/` 目录的静态快照打入安装包。

### 内容生成流水线

```
用户输入题目 → buildGeneratePrompt() → spawn('claude', ['-p', prompt])
  → Claude Code 加载 CLAUDE.md + interview-qa skill
  → 生成 # H1 + 六段式内容 + 标签 + 导航
  → 写入 categories/<分类>/<序号>-<标题>.md
  → 更新 00-index.md + tags/*.md + README.md + 前后题导航链接
```

## 内容规范

每道真题按 CLAUDE.md 定义的六个章节组织，由 interview-qa skill 注入质量约束：

- `## 题目` — 面试题目原文
- `## 标签` — 跨分类标签链接
- `## 题目导航` — 分类内前/后题链接
- `## 面试直接答` — 段落式口述版本，拒绝分点列表
- `## 详细解析` — 深入展开，含对比表格、代码示例、至少 3 个追问
- `## 我的作答` — 个人作答记录（仅在有内容时出现）

更多细节见 [CLAUDE.md](CLAUDE.md) 和 [.claude/skills/interview-qa/SKILL.md](.claude/skills/interview-qa/SKILL.md)。

## 分类

### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### 新增

- [${category}](categories/${category}/00-index.md)


### AI Agent / LLM 应用框架

- [Agent](categories/agent/00-index.md)
- [Claude Code](categories/claude-code/00-index.md)
- [DeepSeek Harness](categories/dsh/00-index.md)
- [Harness](categories/harness/00-index.md)
- [Hermes](categories/hermes/00-index.md)
- [MCP](categories/mcp/00-index.md)
- [Multi-Agent](categories/mutil-agent/00-index.md)
- [OpenClaw](categories/openclaw/00-index.md)
- [pi-agent](categories/pi-agent/00-index.md)
- [Skill](categories/skill/00-index.md)
- [Vibe Coding](categories/vibe-coding/00-index.md)
- [Workflow](categories/workflow/00-index.md)

### LLM 应用 / RAG

- [GraphRAG](categories/graphrag/00-index.md)
- [LangChain](categories/langchain/00-index.md)
- [LangGraph](categories/langgraph/00-index.md)
- [LLM Wiki](categories/llm-wiki/00-index.md)
- [RAG](categories/rag/00-index.md)

### 数据存储 / 中间件

- [Kafka](categories/kafka/00-index.md)
- [Milvus](categories/milvus/00-index.md)
- [MySQL](categories/mysql/00-index.md)
- [Redis](categories/redis/00-index.md)

### 编程语言 / 计算机基础

- [Python](categories/python/00-index.md)
- [操作系统](categories/os/00-index.md)
- [计算机网络](categories/compute-network/00-index.md)
- [进程/线程/协程](categories/process-thread-coroutine/00-index.md)

### 软件工程 / 面试通用

- [开发性问题（个人素养）](categories/behavioral/00-index.md)
- [设计范式](categories/design-patterns/00-index.md)
- [工程实践](categories/engineering-practice/00-index.md)

## 标签

- [AI辅助开发](tags/AI辅助开发.md)
- [Agent](tags/Agent.md)
- [C++](tags/C++.md)
- [Claude Code](tags/Claude Code.md)
- [DeepSeek Harness](tags/DeepSeek Harness.md)
- [Harness](tags/Harness.md)
- [Hermes](tags/Hermes.md)
- [HTTP](tags/HTTP.md)
- [Kafka](tags/Kafka.md)
- [LangGraph](tags/LangGraph.md)
- [LLM](tags/LLM.md)
- [MCP](tags/MCP.md)
- [Multi-Agent](tags/Multi-Agent.md)
- [MySQL](tags/MySQL.md)
- [OS](tags/OS.md)
- [pi-agent](tags/pi-agent.md)
- [Python](tags/Python.md)
- [Redis](tags/Redis.md)
- [Vibe Coding](tags/Vibe Coding.md)
- [Workflow](tags/Workflow.md)
- [上下文压缩](tags/上下文压缩.md)
- [代码实现](tags/代码实现.md)
- [代码审查](tags/代码审查.md)
- [代码质量](tags/代码质量.md)
- [内存管理](tags/内存管理.md)
- [工程实践](tags/工程实践.md)
- [成本优化](tags/成本优化.md)
- [效果评估](tags/效果评估.md)
- [数据结构](tags/数据结构.md)
- [消息队列](tags/消息队列.md)
- [并发](tags/并发.md)
- [知识管理](tags/知识管理.md)
- [缓存](tags/缓存.md)
- [记忆管理](tags/记忆管理.md)
- [设计模式](tags/设计模式.md)
- [面试考点](tags/面试考点.md)

## 项目文档

- [SETUP.md](SETUP.md) — 环境搭建与启动
- [CLAUDE.md](CLAUDE.md) — 知识库内容规范
- [admin/TODO.md](admin/TODO.md) — 开发待办
