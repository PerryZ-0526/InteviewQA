# 为什么 agentic workflow 收敛成了 agent loop

## 题目

agentic workflow 是一个比较早的概念，为什么后来逐渐收敛为一个 agent loop？

## 标签

[Workflow](../../tags/Workflow.md) | [Agent](../../tags/Agent.md) | [LLM](../../tags/LLM.md)

## 题目导航

← [001-agentic-workflow的理解](001-agentic-workflow的理解) | [003-确定性workflow在agent时代还剩下什么位置](003-确定性workflow在agent时代还剩下什么位置) →

## 面试直接答

> agentic workflow 在 2024 年还是独立范式，到 2026 年已收敛为 agent loop 的内部行为：固定多步管线的边界僵化与错误累积，在模型工具调用可靠性快速提升后性价比反转；确定性编排没有消失，而是内化为 loop 里的套路、下沉为执行框架的基础设施。

先讲时间线，收敛不是一夜发生的。Andrew Ng 在 2024 年 3 月的 Sequoia 演讲里把 agentic workflow 定义为与零样本推理对立的迭代范式，他给出的 HumanEval 数据是那个时代的标志性结论：GPT-3.5 零样本正确率 48.1%，包进 workflow 后达到 95.1%，反超 GPT-4 零样本的 67.0%。这个数据的正确解读是「流程设计是独立于模型能力的杠杆」——但要注意杠杆的强度取决于模型有多弱：当时模型不会可靠地反思、不会稳定地调用工具，外部结构在补偿模型缺陷。2024 年 12 月 Anthropic 发表《Building effective agents》，把 workflow 定义为工程师拥有控制流图的预定义代码路径，agent 定义为模型运行时拥有图的动态决策，并给出「从最简单的方案开始」的工程哲学。这个二分本身就埋了收敛的种子：判断标准是「流程图能否在模型运行前画出来」，而这个答案随模型能力提升会持续偏向「不必」。

2025 年是转折点。Claude Code、Codex 这类单 agent loop 产品证明了另一条路径：一个 loop 加工具、子智能体与上下文管理，比多步 pipeline 产品展现出压倒性的任务完成率。为什么 workflow 会输，有四个工程层面的原因。边界僵化：固定分支只能覆盖设计时枚举过的输入，长尾输入会打穿管线，于是图越画越复杂，复杂度增长不解决根因。错误累积：上游步骤的偏差被下游放大，每个节点都是一次 prompt 调用的脆弱点，链越长可靠性越低。维护成本线性增长：需求每漂移一点，就要改图的拓扑，改动面随节点数扩张。修复代价高：pipeline 失败要改图、重发整个任务；loop 失败可以从 checkpoint 回退、从失败点重试，失败是局部的。

第三个原因是模型能力改变了性价比曲线。2024 年 workflow 的价值是用流程弥补模型弱；2025 到 2026 年，模型的工具调用可靠性、指令遵循和长程任务能力显著提升，loop 的自适应分支天然覆盖了 workflow 的固定分支，而 workflow 的确定性优势只在「图能提前画对」的场景成立。Ng 当年自己也强调 token 生成速度对迭代式工作流的影响可能超过模型能力本身——模型变强变快之后，同样的迭代轮次更快更便宜，workflow 的相对优势进一步缩水。与此同时，「agent 的失败模式更难推理」这个 workflow 阵营的理由也被对冲掉了：checkpoint 回退、每步验证工具、子任务上下文隔离，让 loop 的失败变得可定位、可恢复。

收敛的形态不是消灭，而是双层转移。第一层是内化：plan、execute、verify 这套固定套路不再是工程师画在 DAG 里的结构，而是模型在 loop 里自发的行为，控制流从「代码拥有」变成「模型拥有但受框架约束」。第二层是下沉：确定性编排退到基础设施层——评测管线、审批链、数据流水线、框架内的把关链，这些位置今天仍然是硬编码 workflow，比如 DeepSeek Harness 里 tools/pre-execute 到 post-execute 的三段把关流水线、Claude Code 的 hooks 链。框架层的同构证据是 LangGraph 的转型：它从 workflow 编排器重新定位为 agent runtime，图的抽象从业务流水线变成 agent 状态机。总结来说，收敛的本质是分工重划：模型接管了「任务怎么走」的决策，确定性代码接管了「执行必须守什么规矩」的约束，而 2024 年的 agentic workflow 范式试图让确定性代码同时干两件事，这是它退场的根本原因。

## 详细解析

> 公开信息核验日期：2026-08-16。时间线数据沿用题库 workflow/001 已核验的出处，LangGraph 1.0 信息基于 LangChain 官方博客与文档。

### 一、演化时间线


| 时间      | 事件                                          | 意义                          |
| ------- | ------------------------------------------- | --------------------------- |
| 2024-03 | Ng 发表 agentic workflow 四模式演讲                | 范式确立：流程设计是独立杠杆              |
| 2024-12 | Anthropic《Building effective agents》        | workflow 与 agent 二分，「从简开始」  |
| 2025    | Claude Code / Codex 主导 coding agent 市场      | 单 loop 产品力实证，pipeline 产品边缘化 |
| 2025-10 | LangGraph 1.0 GA，定位 durable agent framework | 框架层转型：编排器 → agent runtime   |
| 2026-08 | dsh、pi、Hermes 清一色 loop + harness 架构         | 收敛完成：loop 成为默认架构            |


### 二、workflow 失败模式与 loop 的对冲机制


| workflow 失败模式 | 表现                 | loop 的对应机制           |
| ------------- | ------------------ | -------------------- |
| 边界僵化          | 长尾输入打穿固定分支，图越画越复杂  | 模型运行时决策，分支自适应        |
| 错误累积          | 上游偏差下游放大，链越长越脆弱    | 每步可验证、失败点局部重试        |
| 维护成本线性增长      | 需求漂移要改拓扑，改动面随节点数扩张 | 改提示词与工具，不改控制流        |
| 修复代价高         | 失败要改图重发整个任务        | checkpoint 回退，从失败点续跑 |
| 决策权错配         | 确定性代码承担本应由模型做的决策   | 决策归模型，约束归框架          |


### 三、追问

**追问一：Ng 的 HumanEval 数据今天还成立吗？**

结论仍然成立但杠杆缩水了。那个数据是 2024 年模型能力的截面：GPT-3.5 零样本 48.1%，workflow 包一下 95.1%——提升来自模型当时缺反思和工具使用能力。今天的准确表述是「流程设计仍然独立于模型能力，但边际收益随模型能力提升递减」：模型越强，外部结构能补的缺口越小，反而它的固定分支开始成为瓶颈。面试里把「数据真」和「结论的适用条件已变」分开讲，比复述数字更显功力。

**追问二：「流程图能否提前画出来」这个判断标准为什么在 2025 年之后越来越偏向 agent？**

因为这个标准本身依赖模型能力，是被两头挤压的。模型变强后，可提前画图的任务集合里，剩下的要么是简单到单次调用就能解决的任务——按「从简开始」原则根本不该上 workflow；要么是复杂到分支无法枚举的任务——只有 agent 能接。中间地带被挤压，workflow 的自然领地就剩下了「必须确定性」的少数场景，而不是「可以确定性」的多数场景。

**追问三：agent loop 就没有错误累积吗？**

有，但对冲机制不同。loop 的错误累积主要发生在长程上下文里，工程对策是 checkpoint 快照、子智能体隔离上下文、每步的验证工具和 auto-compact；关键是失败是局部的——从失败点重试，不用重跑前面正确的部分。workflow 的失败是结构性的——图错了，每个节点都对结果也是错的，修复必须动图。这就是为什么同样的「会出错」，一个是可运维的，一个是难运维的。

**追问四：会不会再反转？什么场景 workflow 会回潮？**

会，但回潮的位置不是任务层。监管审计场景（金融、医疗）要求每一步决策可重放、可解释，模型自由决策不可接受；成本敏感场景要求 token 预算确定；组织治理场景要求流程对非技术角色可见可控。这些位置今天就在用 workflow，且会随 agent 落地加深而增加——但它们属于基础设施层 workflow，和 2024 年的任务层 workflow 不是一回事。详见本分类 003 题。

### 四、参考

- [Andrew Ng：Agentic Design Patterns（deeplearning.ai）](https://www.deeplearning.ai/the-batch/how-agents-can-improve-llm-performance/)
- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [LangChain 官方博客：LangGraph 1.0 GA](https://www.langchain.com/blog/langchain-langgraph-1dot0)
- [Anthropic 工程博客：How we built Claude Code](https://www.anthropic.com/engineering/building-claude-code)


<!-- created: 2026-08-16 03:18:05 -->
<!-- updated: 2026-08-17 01:59:27 -->
