# Agentic Workflow 的理解

## 题目

谈谈你对 agentic workflow 的理解

## 标签

[Agent](../../tags/Agent.md) | [LLM](../../tags/LLM.md) | [Workflow](../../tags/Workflow.md)

## 题目导航

← 无 | [002-为什么agentic workflow收敛成了agent loop](002-为什么agentic workflow收敛成了agent loop) →

## 面试直接答

> Agentic workflow 是把「单次零样本推理」改造成`「多轮迭代执行流程」`的智能体设计范式，核心机制是让模型在循环中反思、调用工具、规划与协作，用更多 token 和延迟换取任务成功率；其应用边界清晰——复杂、开放、可验证的任务收益最大，简单确定性任务反而被引入不必要的成本和延迟。

Andrew Ng 在 2024 年 3 月 Sequoia 的演讲中给出了最经典的定义对比：非 agentic 的工作流是零样本提示，让模型一次性生成答案，就像要求一个人不按退格键一口气写完一篇文章；agentic workflow 则是迭代式的——先列大纲、搜索资料、写初稿、阅读并批评自己的初稿、修订、重复。他的团队在 HumanEval 上的数据是这个论点最有力的支撑：GPT-3.5 零样本正确率只有 48.1%，GPT-4 零样本 67.0%，而把 GPT-3.5 包进 agentic workflow 之后正确率达到 95.1%，反超了零样本的 GPT-4。这引出一个重要的工程判断：工作流设计是独立于模型能力的杠杆，用当时的 GPT-4 搭建 agentic workflow，可以提前获得接近下一代模型水平的产出。

Ng 归纳了 agentic workflow 的四种设计模式。Reflection 反思模式让模型检查并批评自己的输出然后修订，批评者可以是同一个模型，也可以生成与批评分离，批评依据最好是单元测试、检索校验等外部客观信号而非模型的主观判断。Tool use 工具使用模式让模型自主决定调用外部函数——网页搜索、代码执行、日历与邮件操作，把能力边界从文本生成扩展到对环境施加影响。Planning 规划模式让模型把复杂任务分解成有序步骤逐步执行，执行受阻时重新规划。Multi-agent collaboration 多智能体协作模式让多个模型实例扮演不同角色配合工作，ChatDev 用 CEO、CTO、程序员、测试员构建了一家虚拟软件公司，AutoGen 论文的消融实验表明多智能体配置优于单智能体。

工程落地上，Anthropic 的《Building effective agents》给出了更精细的框架：workflow 是预定义的代码路径，控制流图由工程师拥有；agent 则是模型在运行时动态决定自己的步骤和工具调用，图由模型拥有。五种 workflow 模式——prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer——覆盖了绝大多数可以预先拆解的任务。文章的核心哲学是从最简单的方案开始：能单次调用解决的就不上链，能在模型运行前画出流程图的就用 workflow，只有步骤无法提前预测时才上 agent。判断标准可以浓缩为一句话：如果流程图可以在模型运行之前画出来，就用 workflow；如果流程图取决于模型运行时发现了什么，才需要 agent。

实现层面，agentic workflow 的底层是一个执行-观察循环：模型产出思考与动作，工具执行动作，观察结果回灌上下文，循环直到满足终止条件。LangGraph 把这条循环显式建模成图——节点是 LLM 调用或工具执行，条件边根据状态决定下一步走向，最简的 ReAct 循环就是 assistant 节点与 tools 节点之间的条件回路。工程护栏与循环本身同样重要：递归上限防止死循环，checkpoint 支持中断恢复与时间旅行调试，human-in-the-loop 断点卡住高风险动作，这些机制把模型的自由决策约束在可控预算之内。

必须同时讲清代价。agentic workflow 的每一轮迭代都是 token 与延迟的支出，长链条还会出现错误累积——前面步骤的偏差被后续步骤放大，Anthropic 也指出 agent 的失败模式比 workflow 更难推理。Ng 特别强调 token 生成速度对迭代式工作流的影响可能超过模型本身的能力提升，因为反思模式下模型要反复生成、阅读并修改大量文本。工程上常见的对冲手段是模型分级路由：便宜快速的模型做反思、路由与分类，强模型只用于关键生成步骤，再配合逐步验证、评估器把关与成本预算。

这个概念自身的演化也值得讲。agentic workflow 在 2024 年是独立范式，到 2026 年已收敛为 agent loop 的内部行为：Claude Code、Codex 用「单 loop 加工具、子智能体与上下文管理」在任务完成率上碾压了多步 pipeline 产品，2026 年各家开源框架——DeepSeek Harness、pi、Hermes——清一色是 loop 架构。收敛的形态不是消灭而是双层转移：内化，plan、execute、verify 这套固定套路变成模型在 loop 里自发的行为，不再需要工程师画 DAG 固化；下沉，确定性编排退到基础设施层——评测管线、审批链、数据流水线、框架内的把关链，比如 DeepSeek Harness 里 tools 的三段把关流水线、Claude Code 的 hooks 链，本质都是硬编码 workflow。LangGraph 从 workflow 编排器转型为 agent runtime 是框架层的同构证据。理解了这一层，「流程图能否提前画出来」这个判断标准就获得了新含义：它不再回答「何时用 workflow」，而是回答「何时把套路显式化、何时把确定性约束下沉为框架代码」。完整的收敛因果分析见本分类 002 题，确定性 workflow 的存活位置见 003 题。

总结来说，agentic workflow 的本质是用结构化迭代放大单次推理的能力，反思、工具、规划、协作是四种基本杠杆，workflow 与 agent 的边界取决于控制流图的归属。回答时能讲出 Ng 的效果数据、Anthropic 的工程分类、成本与失败模式的清醒认识，还能说清这个概念 2024 到 2026 年的收敛去向，就真正超出了背定义的层次。

## 详细解析

### 一、概念起源：从「零样本」到「迭代」

**Agentic workflow** 一词由 Andrew Ng 在 2024 年 3 月 Sequoia AI Ascent 的演讲「What's next for AI agentic workflows」中推向主流，随后他在 DeepLearning.AI 的 The Batch 通讯《How Agents Can Improve LLM Performance》中系统阐述了这一概念。

核心对比是两种使用 LLM 的方式：

- **非 agentic 工作流（zero-shot prompting）**：一次调用，模型直接产出最终答案。Ng 的比喻是「要求一个人不按退格键一口气写完一篇文章」——没有草稿、没有修改、没有回看。
- **Agentic workflow**：多次调用组成迭代过程——列大纲、查资料、写初稿、自我批评、修订、重复，更接近人类真实的工作方式。

Ng 团队在 HumanEval 基准上的数据是这一概念最有说服力的论据：


| 配置                         | HumanEval 正确率 |
| -------------------------- | ------------- |
| GPT-3.5 + 零样本提示            | 48.1%         |
| GPT-4 + 零样本提示              | 67.0%         |
| GPT-3.5 + agentic workflow | 95.1%         |


结论：**工作流设计本身是独立于模型能力的杠杆**。把次一档的模型放进好的迭代流程，可以反超高一档模型的零样本表现；把当时的 GPT-4 放进 agentic workflow，可以提前获得接近 GPT-5 水平的产出。

### 二、Ng 的四大设计模式

agentic workflow 的四种基本杠杆：
```
                 ┌──────────────────────────────────────┐
                 │            Agentic 执行循环            │
                 │   思考 → 行动 → 观察 → 反思 → 重规划     │
                 └──────────────────┬───────────────────┘
                                    │ 四种放大杠杆
        ┌──────────────┬────────────┼────────────┬──────────────┐
        ▼              ▼            ▼            ▼
   Reflection      Tool Use     Planning    Multi-Agent
   生成→批评→修订   自主调用工具   分解→执行→重规划  角色分工协作
```

**Reflection（反思）**：模型检查并批评自己的输出，然后修订。实现上有三种层次——同一模型自评、两个模型分工（一个生成一个批评）、以及引入外部反馈（单元测试结果、参考实现、检索校验）作为批评依据。对代码类任务，让 agent 跑测试并用失败信息驱动修订，比让模型「再想想哪里不对」有效得多，因为批评依据是客观的。

**Tool use（工具使用）**：模型自主决定何时调用外部函数——网页搜索、代码执行、日历邮件操作。它把模型的能力边界从文本生成扩展到对环境施加影响。Ng 指出工具使用的早期工作很多来自计算机视觉领域：多模态模型成熟前，视觉任务只能靠模型生成函数调用来操纵图像。当前的工具调用正在被 MCP 这类协议标准化。

**Planning（规划）**：模型把复杂任务分解为有序步骤，逐步执行，遇阻时重新规划。典型例子是「生成指定姿势的图片 → 图片转文字 → 文字转语音」这类多阶段流水线由模型自主编排。

**Multi-agent collaboration（多智能体协作）**：多个模型实例扮演不同角色配合。ChatDev 让 LLM 分别扮演 CEO、CTO、程序员、测试员，组成虚拟软件公司；AutoGen 论文的消融实验显示多智能体配置优于单智能体。Ng 在 The Batch 第 245 期中解释其有效性：多智能体让模型「一次只专注一件事」，避免解析超长上下文，同时符合人类熟悉的角色分工实践。协作的终止条件与共享记忆是工程难点，可参考 [002-多agent讨论如何终止](../mutil-agent/002-%E5%A4%9Aagent%E8%AE%A8%E8%AE%BA%E5%A6%82%E4%BD%95%E7%BB%88%E6%AD%A2.md) 与 [001-多agent系统如何实现共享记忆](../mutil-agent/001-%E5%A4%9Aagent%E7%B3%BB%E7%BB%9F%E5%A6%82%E4%BD%95%E5%AE%9E%E7%8E%B0%E5%85%B1%E4%BA%AB%E8%AE%B0%E5%BF%86.md)。

### 三、Anthropic 的工程化框架：workflow 与 agent 的分界

Anthropic 2024 年 12 月的《Building effective agents》给出了工程落地视角的精确区分：

- **Workflow**：LLM 和工具通过**预定义的代码路径**编排——控制流图由工程师拥有。
- **Agent**：LLM 在运行时**动态决定自己的步骤和工具调用**——图由模型拥有。


| 维度    | Workflow   | Agent     |
| ----- | ---------- | --------- |
| 控制流   | 预定义代码路径    | 模型运行时动态决策 |
| 图的拥有者 | 工程师        | 模型        |
| 步骤数   | 有界、可预测     | 开放，需显式上限  |
| 成本与延迟 | 可预估        | 波动大       |
| 调试与审计 | 易，图可读可审    | 难，错误会累积   |
| 适用场景  | 步骤可枚举、合规敏感 | 开放探索型任务   |


文章的核心哲学是 **start simple**：直接 API 调用能解决就不用链；能在模型运行前画出流程图就用 workflow；只有步骤无法提前预测时才用 agent。一个实用的判断测试：**如果流程图能在 LLM 运行之前画出来，用 workflow；如果流程图取决于 LLM 运行时发现了什么，才需要 agent。**

生产系统几乎都是混合体：外层用确定性路由与审批（workflow 式），内层让 agent 在受限域内自主决策。Claude Code 这类 coding agent 整体是 agent——模型动态决定读哪个文件、跑什么命令——但内部嵌入了权限白名单、沙箱、预算等确定性护栏（参见 [007-agent沙箱的理解与实现](../agent/007-agent%E6%B2%99%E7%AE%B1%E7%9A%84%E7%90%86%E8%A7%A3%E4%B8%8E%E5%AE%9E%E7%8E%B0.md)）。

### 四、五种 workflow 模式及与 Ng 模式的映射

Anthropic 枚举的五种 workflow 模式都建立在 **augmented LLM** 之上——即接入了检索、工具与记忆的单个 LLM：

1. **Prompt chaining**：一次调用的输出作为下一次的输入，适合可线性拆解的任务，步骤之间可加程序化闸门。
2. **Routing**：分类器 LLM 决定把输入交给哪个下游处理器，适合类别差异大的场景（账单、技术支持、退款）。
3. **Parallelization**：并发执行多个 LLM 调用再聚合，两种形态——sectioning（任务分片）和 voting（同一提示跑多次取多数/综合）。
4. **Orchestrator-workers**：编排者动态分解任务、派发给 worker、汇总结果，但编排者不无限循环。
5. **Evaluator-optimizer**：一个 LLM 生成、另一个评估，迭代到评估通过——本质是 Self-Refine 的泛化，评估标准越客观（编译通过、引用校验）越有效。

与 Ng 四模式的对应关系：


| Ng 模式       | Anthropic 对应                                | 核心机制           |
| ----------- | ------------------------------------------- | -------------- |
| Reflection  | Evaluator-Optimizer                         | 生成-评估循环，客观标准把关 |
| Tool Use    | augmented LLM 的基础能力                         | 检索 / 工具 / 记忆接入 |
| Planning    | Orchestrator-Workers                        | 动态分解-派发-汇总     |
| Multi-Agent | 由以上模式组合实现                                   | 角色分工与协作        |
| —（无对应）      | Prompt Chaining / Routing / Parallelization | 确定性组合件，无需模型决策  |


值得注意的是 Anthropic 建议这些模式各约 10–15 行代码即可实现，只有需要持久状态（LangGraph）、actor 并发（AutoGen）或角色模板（CrewAI）时才引入框架。

### 五、工程实现：LangGraph 的 ReAct 循环

agentic workflow 在工程上落地为显式的图结构。LangGraph 把循环建模为**节点、边与共享状态**：
```
START ──▶ assistant ──有 tool_calls──▶ tools
              ▲                          │
              └────────── 观察回灌 ────────┘
              │
          无 tool_calls
              │
              ▼
             END
```

对应的最小实现（LangGraph 官方文档中的标准 ReAct 模式）：
```python
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.prebuilt import ToolNode, tools_condition

builder = StateGraph(MessagesState)
builder.add_node("assistant", assistant)          # LLM + 绑定工具
builder.add_node("tools", ToolNode(tools))        # 工具执行节点
builder.add_edge(START, "assistant")
builder.add_conditional_edges("assistant", tools_condition)  # 有 tool_calls → tools，否则 → END
builder.add_edge("tools", "assistant")            # 观察结果回灌，形成循环
graph = builder.compile()
```

这条循环的本质是 ReAct（Reason → Act → Observe）：模型推理出下一步动作，工具执行，观察结果回灌状态，直到模型不再发起工具调用。图结构的意义在于**把循环显式化**——LangChain 旧式 agent 把循环逻辑藏在框架内部，LangGraph 则让开发者可以直接在循环上挂接护栏：

- **递归上限（recursion limit）**：限制最大 super-step 数，超出抛 `GraphRecursionError`，防止死循环。
- **Checkpoint**：状态持久化到 Postgres/Redis 等后端，支持崩溃恢复、长任务续跑与时间旅行调试。
- **Human-in-the-loop**：`interrupt()` 断点暂停执行等待审批，`Command(resume=...)` 恢复。
- **监督者模式**：多智能体场景下每个 agent 是一个节点或子图，监督者节点根据状态返回 `Command(goto=...)` 路由到 worker 并汇总。

反思模式的伪代码同样简单：
```python
draft = model.generate(task)
for _ in range(max_rounds):
    critique = critic.review(draft, evidence)   # evidence: 单测结果、检索校验
    if critique.no_issues:
        break
    draft = model.revise(draft, critique)
```

### 六、代价、失败模式与防护

agentic workflow 不是免费的午餐，面试中主动讲清代价是加分项：

- **成本放大**：每轮迭代都是完整的一次或多次 LLM 调用，token 消耗相比零样本放大数倍到数十倍。缓解手段见 [001-如何降低agent的运营成本](../agent/001-%E5%A6%82%E4%BD%95%E9%99%8D%E4%BD%8Eagent%E7%9A%84%E8%BF%90%E8%90%A5%E6%88%90%E6%9C%AC.md) 与 [002-降低llm调用成本最有效的手段](../agent/002-%E9%99%8D%E4%BD%8Ellm%E8%B0%83%E7%94%A8%E6%88%90%E6%9C%AC%E6%9C%80%E6%9C%89%E6%95%88%E7%9A%84%E6%89%8B%E6%AE%B5.md)：prompt 缓存、上下文压缩、模型分级路由——便宜快速的模型做反思、路由与分类，强模型只用于关键生成步骤。
- **错误累积（compound errors）**：长链条中前面步骤的偏差被后续步骤放大。Anthropic 明确指出这是 agent 相对 workflow 的核心劣势：失败模式更难推理。防护手段是每步用客观标准验证（单测、编译、检索校验），以及 evaluator 与 generator 分离。
- **死循环与上下文膨胀**：模型反复走同一条失败路径、上下文越滚越大，详见 [006-agent长时间循环的注意事项](../agent/006-agent%E9%95%BF%E6%97%B6%E9%97%B4%E5%BE%AA%E7%8E%AF%E7%9A%84%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A1%B9.md)。
- **延迟**：迭代次数 × 单次生成时间。Ng 特别强调 token 生成速度对迭代式工作流的影响可能超过模型能力提升——反思模式下模型要反复生成、阅读、修改大量文本，慢生成直接拉长迭代周期。
- **评估困难**：与单点 benchmark 不同，agentic workflow 的路径多样性导致同一任务可走不同路径成功，评估需固定任务集多次采样并报告均值与方差，同时跟踪平均轮数、token 消耗与墙钟时间，详见 [003-agent效果的定义](../agent/003-agent%E6%95%88%E6%9E%9C%E7%9A%84%E5%AE%9A%E4%B9%89.md)。

### 七、概念演化：从独立范式收敛为 agent loop

2024 年的「独立范式」到 2026 年已经式微，收敛的因果链值得完整梳理：


| 时间      | 事件                                          | 意义                           |
| ------- | ------------------------------------------- | ---------------------------- |
| 2024-03 | Ng 发表 agentic workflow 四模式演讲                | 范式确立：流程设计是独立于模型能力的杠杆         |
| 2024-12 | Anthropic《Building effective agents》        | workflow 与 agent 二分，提出「从简开始」 |
| 2025    | Claude Code / Codex 主导 coding agent 市场      | 单 loop 产品力实证，pipeline 产品边缘化  |
| 2025-10 | LangGraph 1.0 GA，定位 durable agent framework | 框架层转型：编排器 → agent runtime    |
| 2026-08 | dsh、pi、Hermes 均为 loop + harness 架构          | 收敛完成：loop 成为默认架构             |


workflow 输掉任务编排层的四个工程原因：**边界僵化**——固定分支只覆盖设计时枚举过的输入，长尾输入打穿管线，图越画越复杂；**错误累积**——上游偏差被下游放大，每个节点都是一次 prompt 调用的脆弱点；**维护成本线性增长**——需求漂移要改图拓扑，改动面随节点数扩张；**修复代价高**——pipeline 失败要改图重发整个任务，loop 失败可以从 checkpoint 回退、从失败点重试。

收敛的形态是双层转移。**内化**：plan、execute、verify 成为模型在 loop 里的自发行为，控制流从「代码拥有」变成「模型拥有但受框架约束」。**下沉**：确定性编排退到基础设施层——评测管线、审批链、数据流水线、框架把关链。dsh 的 tools/pre-execute → execute → post-execute 三段流水线、Claude Code 的 hooks 链都是硬编码 workflow，只是不再面向任务本身而面向执行框架。LangGraph 的转型是框架层同构证据：图的抽象从业务流水线变成 agent 状态机，状态、checkpoint 与 human-in-the-loop 这些为 workflow 设计的机制，恰恰成为 agent loop 工程化的运行时能力。

判断标准的演化同样值得注意：「流程图能否提前画出来」被模型能力两头挤压——可提前画图的任务里，简单的用单次调用就够，复杂的图根本画不全，workflow 的自然领地只剩「必须确定性」的少数场景。完整的收敛因果见 [002-为什么agentic workflow收敛成了agent loop](002-%E4%B8%BA%E4%BB%80%E4%B9%88agentic%20workflow%E6%94%B6%E6%95%9B%E6%88%90%E4%BA%86agent%20loop.md)，确定性 workflow 的存活位置见 [003-确定性workflow在agent时代还剩下什么位置](003-%E7%A1%AE%E5%AE%9A%E6%80%A7workflow%E5%9C%A8agent%E6%97%B6%E4%BB%A3%E8%BF%98%E5%89%A9%E4%B8%8B%E4%BB%80%E4%B9%88%E4%BD%8D%E7%BD%AE.md)。

### 八、面试追问

**追问 1：推理模型（长思维链）出现后，agentic workflow 是否过时了？**

没有，二者正交。推理模型解决的是「单次调用内的推理深度」——在产出最终答案前展开更长的内部推理；agentic workflow 解决的是「与环境的多轮交互」——工具调用、外部反馈与状态更新。工具执行必然发生在模型外部，观察结果必须回灌，这是内部思维链无法替代的。真实关系是协同：推理模型让循环内每一步的决策质量更高，Reflection 的部分能力被内化，但 Planning 与 Tool use 仍需循环结构。此外，外部反思能引入单测结果、检索校验等模型自身不具备的客观信号，这是内部反思做不到的。

**追问 2：Claude Code 属于 workflow 还是 agent？生产系统中二者互斥吗？**

Claude Code 属于 agent——模型在运行时动态决定读哪个文件、执行什么命令、何时停止。但它内部嵌入了大量确定性护栏：权限白名单、沙箱、预算上限，这些都是 workflow 式的确定性控制。生产系统几乎都是混合体：外层用确定性路由与人工审批，内层让 agent 在受限域内自主决策。所以「workflow vs agent」是设计光谱的两个端点，工程实践是在两者之间为每个环节选择正确的抽象层次。

**追问 3：迭代轮数越多效果越好吗？**

不是。多轮迭代收益递减，且每一步都可能引入新错误，错误在长链条中累积放大。防护手段：每步用客观标准验证；evaluator-optimizer 让评估独立于生成；设置递归上限与成本预算；对同一条失败路径做失败指纹去重，避免反复重试同一错误；对步骤可枚举的任务直接用 workflow 而非开放循环。判断标准是边际收益：如果再加一轮迭代的成功率提升不抵其成本与延迟，就应该停止。

**追问 4：为什么 token 生成速度对 agentic workflow 可能比模型质量还重要？**

迭代式工作流的 token 消耗被放大数倍：生成、自我阅读批评、再生成。在 token 价格与延迟固定的前提下，生成速度直接决定迭代周期的长度与成本上限。Ng 的论点是：模型能力提升一倍但生成慢一倍，迭代式工作流的性价比可能反而下降；快速便宜的模型配合好工作流，可以逼近甚至超过慢速强模型。工程推论是模型分级路由——把便宜快速的模型用于反思、路由、分类，强模型只用于关键生成步骤，这正是成本与质量的帕累托优化。

**追问 5：怎么评估一个 agentic workflow 改动的收益？**

按 [003-agent效果的定义](../agent/003-agent%E6%95%88%E6%9E%9C%E7%9A%84%E5%AE%9A%E4%B9%89.md) 的三维框架：端到端任务成功率、执行质量、成本效率。与单点 benchmark 不同，agentic workflow 评估要处理路径多样性——固定任务集上多次采样，报告均值与方差；同时跟踪平均轮数、token 消耗与墙钟时间，因为同样的成功率背后成本可能差一个数量级。A/B 对比的基线必须是「同一模型 + 零样本提示」，而不是换一个模型，否则无法归因于工作流设计本身。

### 参考链接

- [How Agents Can Improve LLM Performance - The Batch, Andrew Ng](https://www.deeplearning.ai/the-batch/how-agents-can-improve-llm-performance/)
- [Building effective agents - Anthropic](https://www.anthropic.com/engineering/building-effective-agents)
- [LangGraph Documentation - LangChain](https://langchain-ai.github.io/langgraph/)


<!-- created: 2026-08-16 01:19:28 -->
<!-- updated: 2026-08-16 03:41:49 -->
