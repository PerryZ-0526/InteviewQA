# ✅LangGraph搭建agent和直接使用claude code+skill搭建agent相比的优势在哪？

## 题目

 LangGraph搭建agent和直接使用claude code+skill、mcp、hook等机制来搭建agent相比的优势在哪？一段话回答我

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph-中的-send](LangGraph-中的-send) | 无 →

## 面试直接答

> 相比直接用 Claude Code + Skill + MCP + Hook 搭 Agent，LangGraph 的核心优势不是“能力更强”，而是**编排更显式、状态更可控，更适合生产级复杂 Agent**：
>
> - Claude Code 本质上更像一个成熟的 Agent Harness，Skill 提供领域知识与操作规范，MCP 扩展外部工具，Hook 在关键生命周期插入规则，很多任务编排仍由模型根据上下文动态决定，因此<u style="text-decoration-color: #e63946">开发快、灵活性高，但复杂流程容易变得隐式</u>；
> - LangGraph 则把 Agent 建模成`显式的“状态 + 节点 + 条件边”`，你可以明确规定什么时候调用哪个 Agent、什么条件下循环、失败后如何重试、在哪里人工审批，并且<u style="text-decoration-color: #e63946">天然支持状态持久化、断点恢复、子图、并行执行和可观测性</u>。
>
> 因此，如果做的是 Claude Code 这种通用智能助手，Harness 模式更自然；如果做的是教育、金融、企业流程这类`需要稳定流程、严格状态管理、可审计和可恢复的业务 Agent`，LangGraph 通常更有优势。

---

如果拿 LangGraph 搭 Agent，和直接使用 Claude Code 再叠加 Skill、MCP、Hook、Subagent 等机制相比，我认为 LangGraph 最大的优势不是“Agent 更聪明”，而是它提供了一个<u style="text-decoration-color: #e63946">更适合业务系统的显式编排和状态管理框架</u>。

### 第一个优势，显式编排与流程控制

Claude Code 本质上是一个成熟的 Agent Harness，模型处于中心位置，通过工具调用循环自主判断下一步做什么，Skill 提供领域知识和操作规范，MCP 扩展外部工具，Hook 插入确定性逻辑，Subagent 负责任务拆分和上下文隔离。这种模式开发效率很高，但随着业务复杂度增加，<u style="text-decoration-color: #e63946">很多流程控制会逐渐分散在模型决策、Prompt、Skill 和 Hook 中</u>，比如什么时候进入某个子任务、失败后是否重试、什么时候人工审批、什么时候结束任务等，<u style="text-decoration-color: #e63946">整体执行路径相对隐式</u>。

LangGraph 则把 Agent 显式建模成<u style="text-decoration-color: #e63946">“节点 + 条件边”的有状态的图结构</u>，可以直接规定哪些节点执行什么能力、满足什么条件后跳到哪里、哪些地方允许循环或并行、哪些操作必须经过人工确认。因此它特别适合复杂业务流程，可以把原本依赖模型临场判断的流程控制，转化为代码层面的确定性约束。

> 因此复杂业务中的循环、重试、分支、并行、人工审批、多 Agent 协作都比较容易控制。

### 第二个优势，统一状态管理与持久化恢复

LangGraph 有统一的 State，可以明确保存用户信息、任务计划、中间产物、工具结果、审批状态等数据，而不是主要依赖模型上下文传递；配合 checkpoint，可以做到`持久化`、`断点恢复`和`长任务续跑`。

> 比如 Agent 执行到第五步服务崩了，可以从已有状态继续，而不是重新让模型理解整个任务。

### 第三个优势，可观测性和可测试性

因为执行路径是显式图结构，所以可以知道任务究竟经过了哪些节点、为什么进入重规划、在哪个节点失败，也<u style="text-decoration-color: #e63946">可以针对单个节点做单元测试，甚至固定状态去复现一次错误</u>；而纯 Harness 模式下，模型每轮自主选择工具，行为更加动态，调试时往往需要从完整轨迹中分析模型为什么做出某个选择。

### 第四个优势，更容易集成到生产级后端系统

LangGraph 本质上是程序框架，你可以把它嵌入 FastAPI，与 Redis、Kafka、MySQL、RAG、权限系统等基础设施结合，自己控制模型供应商、并发策略、数据结构和部署方式；Claude Code 更接近一个完成度很高的通用 Agent 产品或运行时，<u style="text-decoration-color: #e63946">它的很多抽象已经替你决定好了</u>。

所以我的理解是：两者不是简单的替代关系。

- Claude Code 的优势是 Harness 完整、模型自主性强、开发一个 Agent 原型非常快；
- LangGraph 的优势则是当 Agent 从“一个会调用工具的智能助手”发展成`“一个需要长期运行、流程稳定、状态可恢复、行为可审计的业务系统”`时，你能够<u style="text-decoration-color: #e63946">把控制权从 Prompt 和模型判断重新拿回到程序架构中</u>。

面试里如果让我一句话概括，我会说：**Claude Code 更擅长把 Agent 本身做强，而 LangGraph 更擅长把<u style="text-decoration-color: #e63946">复杂 Agent 系统管住</u>。**

## 详细解析

更详细地看，LangGraph 和“Claude Code + Skill + MCP + Hook + Subagent”其实不是同一层级的东西。Claude Code 更像一个已经封装好的 Agent Harness：它把模型、工具调用循环、上下文管理、子智能体、权限、扩展机制等都替你搭好了；LangGraph 则更像一个 Agent 工作流运行时，你自己决定状态是什么、节点是什么、节点之间怎么跳转。因此二者真正的区别不是“谁能做更多事情”，而是：**Claude Code 更强调把自主决策权交给模型，LangGraph 更强调<u style="text-decoration-color: #e63946">开发者对 Agent 执行过程拥有结构化控制权</u>。**

### 1. 最核心的区别：隐式编排和显式编排

假设现在有一个任务：

> 用户要求分析自己的培养方案，然后根据已修课程判断毕业风险，如果存在风险，再查询相关政策，最后给出建议。

如果用 Claude Code 的思路，你可能会准备几个 Skill：
```text
培养方案 Skill
课程分析 Skill
政策查询 Skill
建议生成 Skill
```

再通过 MCP 暴露：
```text
get_student_profile
query_course
search_policy
```

然后 Claude 得到用户问题以后，模型自己决定：
```text
先调用哪个 Skill？
是否读取画像？
需不需要搜政策？
搜完政策下一步是什么？
什么时候任务算完成？
```

整个系统本质还是：
```text
用户
 ↓
Claude
 ↓
思考 → 调工具 → 得结果 → 再思考 → 调工具
 ↑_________________________________|
```

也就是典型的 `Agent Loop`。

Claude Code 的 Skill、MCP、Subagent 实际上都是在<u style="text-decoration-color: #e63946">增强这个循环</u>。Skill 给模型“怎么做”的知识；MCP 给模型“能做什么”的工具；Subagent 让模型把某些任务委派给独立上下文；Hook 则在生命周期中的确定位置加入程序逻辑。

Claude Code 官方现在甚至允许 Hook 执行命令、HTTP 请求、MCP 工具、单轮模型判断，以及实验性的 Agent Hook，所以它的确定性控制能力已经比早期强很多。([Claude](https://code.claude.com/docs/en/hooks?utm_source=chatgpt.com "Hooks reference - Claude Code Docs"))

而 LangGraph 的基本思想不一样。你会把流程直接写成：
```text
START
  ↓
读取学生信息
  ↓
分析课程
  ↓
判断毕业风险
  ├── 无风险 → Answer
  │
  └── 有风险
        ↓
      查询政策
        ↓
      生成建议
        ↓
       Answer
```

换句话说：

> Claude Code 是“模型决定流程”。

而 LangGraph 更容易做到：

> 程序决定大框架，模型负责框架内部需要智能判断的部分。

这也是 LangGraph 最大的工程优势。

---

### 2. LangGraph 真正强的不是“画图”，而是 State

很多人介绍 LangGraph 时会说：

> 节点 + 条件边。

但这只是表面。

LangGraph 更重要的东西其实是：
```text
State
```

例如可以定义：
```python
class AgentState:
    user_query
    user_profile
    plan
    retrieved_docs
    tool_results
    risk_level
    current_step
    retry_count
    final_answer
```

于是整个 Agent 不再只是：
```text
messages = [...]
```

而变成一个真正的`业务状态机`。

每个节点实际上都可以理解成：
```text
State_t
   ↓
Node
   ↓
State_t+1
```

例如：
```text
course_analysis

输入：
student_profile
course_records

输出：
risk_level
missing_courses
```

下一个节点不需要重新让模型阅读几万 Token 的对话去猜：

> “刚才到底发生了什么？”

它可以直接读取：
```python
state["risk_level"]
```

这点对于复杂 Agent 非常重要。

因为真实业务系统里面其实有两种东西：
```text
对话上下文
≠
业务状态
```

例如：
```text
用户说了什么              → 对话上下文
当前任务执行到第几步        → 业务状态
审批是否通过               → 业务状态
工具执行是否成功            → 业务状态
已经查询了哪些数据          → 业务状态
最终生成了哪些产物          → 业务状态
```

这些东西如果全部塞进 LLM Messages 里面，系统规模一大就会非常难维护。

---

### 3. LangGraph 的第二个核心优势：持久化和恢复

这是它和普通 ReAct Harness 拉开差距的地方。

LangGraph 可以通过 Checkpointer 在图执行过程中保存状态。官方文档明确说明，它会在执行步骤保存 Graph State 的快照，因此能够支持人工介入、记忆、历史状态回放以及故障恢复。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/persistence?utm_source=chatgpt.com "Persistence - Docs by LangChain"))

例如一个流程：
```text
A → B → C → D → E
```

执行到：
```text
A ✓
B ✓
C ✓
D × 服务挂了
```

如果系统具有持久状态，那么重新启动以后可以知道：
```text
当前 checkpoint = C
```

再继续执行：
```text
D → E
```

而不是：
```text
重新从 A 开始。
```

甚至如果某个并行步骤已经成功，LangGraph 可以保存已经完成的写入，恢复时不用把成功节点全部重新执行。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/persistence?utm_source=chatgpt.com "Persistence - Docs by LangChain"))

这对真正的业务 Agent 非常关键。

例如：
```text
查数据库
↓
调用第三方 API
↓
创建订单
↓
等待人工审批
↓
发送请求
```

这显然不能因为模型调用失败一次就：
```text
全部重新执行。
```

否则甚至可能出现：
```text
订单创建两次
支付两次
消息发送两次
```

所以复杂 Agent 最终一定会遇到：
```text
持久化
幂等
恢复
重试
审批
```

这些传统分布式系统问题。

LangGraph 本质上是在 Agent 层提前提供了一部分这种运行时能力。

---

### 4. Human-in-the-loop 是非常典型的 LangGraph 场景

假设 Agent 要执行：
```text
修改培养计划
提交申请
发送邮件
修改数据库
```

流程可能要求：
```text
Agent 生成操作
    ↓
暂停
    ↓
用户审批
    ↓
继续执行
```

LangGraph 的思路很自然：
```text
prepare_action
      ↓
 interrupt()
      ↓
 Human
      ↓
 resume
      ↓
execute_action
```

因为 checkpoint 已经保存，所以用户可能几个小时以后审批，Graph 仍然可以从原来的状态继续。官方文档也明确把 Checkpointer 和 Interrupt 作为人工介入和恢复执行的基础。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/use-subgraphs?utm_source=chatgpt.com "Subgraphs - Docs by LangChain"))

Claude Code 当然也有 Permission、Hook 等机制。

例如：
```text
PreToolUse
PermissionRequest
PostToolUse
Stop
TaskCompleted
```

都能够挂 Hook，而且 Hook 可以对操作进行阻断或者验证。([Claude](https://code.claude.com/docs/en/hooks?utm_source=chatgpt.com "Hooks reference - Claude Code Docs"))

所以不能简单说：

> Claude Code 无法做确定性流程。

这是不准确的。

更准确的说法是：

> Claude Code 的 Hook 非常适合给 Agent Loop 增加“护栏和生命周期逻辑”；LangGraph 更适合直接把整个业务流程本身建模成可暂停、可恢复的状态机。

区别在层级。

---

### 5. 多 Agent 方面，两边实际上各有优势

Claude Code 的 Subagent 设计非常优秀。

官方对 Subagent 的定位就是：

> 一个拥有独立上下文的隔离工作者。

主 Agent 可以让 Subagent 去读取几十个文件、搜索代码、分析问题，最后只把结果返回主上下文，因此不会污染主 Agent 的上下文。Skill 甚至还可以直接运行在 fork 出来的隔离上下文中。([Claude](https://code.claude.com/docs/en/features-overview?utm_source=chatgpt.com "Extend Claude Code - Claude Code Docs"))

所以 Claude Code 很自然地形成：
```text
Main Agent
 ├─ Explore Agent
 ├─ Code Review Agent
 ├─ Test Agent
 └─ Research Agent
```

这种结构最大的优点就是：

**动态。**

模型自己判断：
```text
现在是否需要 Subagent？
需要几个？
分别干什么？
```

LangGraph 的 Subgraph 则更偏工程化。

例如：
```text
             Orchestrator
          /       |       \
         /        |        \
    RAG Agent  Profile   Search Agent
         \        |        /
          \       |       /
             Reviewer
```

你可以明确规定：
```text
谁能调用谁
输入字段是什么
输出字段是什么
哪些状态共享
哪些状态隔离
什么时候并行
什么时候汇合
```

而且 LangGraph 的 Subgraph 还能明确选择：
```text
每次调用独立状态
跨调用持久状态
完全无状态
```

官方甚至专门区分了这些不同的 Subgraph persistence 模式。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/use-subgraphs?utm_source=chatgpt.com "Subgraphs - Docs by LangChain"))

因此两种多 Agent 哲学非常不同：
```text
Claude Code
模型驱动的动态协作

LangGraph
程序约束下的结构化协作
```

如果任务高度开放：
```text
“帮我完成这个大型代码仓库需求。”
```

Claude Code 的方式通常更自然。

如果任务是：
```text
Agent A → Agent B
   ↓
Agent C
   ↓
Reviewer
   ↓
失败 → Replanner
```

LangGraph 更容易控制。

---

### 6. LangGraph 更容易做“局部智能，整体确定”

这是我认为面试里最值得讲的一句话。

一个生产级 Agent 最理想的情况往往不是：
```text
所有东西都交给 LLM。
```

也不是：
```text
所有东西全部写死。
```

而是：
```text
确定性的地方 → 程序控制
不确定性的地方 → LLM 判断
```

比如：
```text
START
 ↓
鉴权                  ← 程序
 ↓
读取用户数据            ← 程序
 ↓
判断任务应该怎么解决      ← LLM
 ↓
调用某个 Domain Agent    ← LLM / 图路由
 ↓
验证工具结果             ← 程序
 ↓
结果是否合格？
 ├─ 是 → Answer
 └─ 否 → Replan         ← LLM
```

这样 LLM 负责它擅长的：
```text
理解
推理
规划
生成
语义判断
```

程序负责它擅长的：
```text
权限
状态
流程
事务
重试
超时
一致性
```

这实际上比“纯 Agent 自治”更加符合生产系统的工程逻辑。

---

### 7. 但不能因此认为 LangGraph 一定优于 Claude Code

如果让我现在做一个：
```text
代码 Agent
科研 Agent
通用办公 Agent
个人助手
```

我未必优先选择 LangGraph。

因为 Claude Code 已经替你解决了大量 Harness 工程问题。

比如：
```text
工具调用循环
上下文管理
Skill 加载
MCP
Subagent
Hook
权限
会话管理
工具执行
```

Claude Code 的 Skill 现在本身也支持按需加载，并且可以配合 Subagent、Hook 和 MCP；官方对这些机制的定位已经非常明确：Skill 管知识和工作流，MCP 管外部能力，Subagent 管上下文隔离，Hook 管必须确定触发的行为。([Claude](https://code.claude.com/docs/en/features-overview?utm_source=chatgpt.com "Extend Claude Code - Claude Code Docs"))

所以如果你的 Agent 本质是：
```text
User
 ↓
一个很强的通用 Agent
 ↓
几十个 Tools
```

为了“架构漂亮”强行上 LangGraph，反而可能变成：
```text
START
 ↓
Agent Node
 ↓
Tool Node
 ↑    ↓
 └────┘
```

最后你会发现：

> 自己用 LangGraph 手搓了一遍 Claude Code 已经帮你做好的 Agent Loop。

这时候 LangGraph 的价值并不大。

---

### 8. 真正的选型边界

我会把它理解成这样：


| 场景               | 更合适                 |
| ---------------- | ------------------- |
| Coding Agent     | Claude Code         |
| 通用个人 Agent       | Claude Code/Harness |
| 开放式任务            | Claude Code/Harness |
| 快速 Agent 原型      | Claude Code/Harness |
| 固定业务流程           | LangGraph           |
| 多阶段审批            | LangGraph           |
| 长时间任务            | LangGraph           |
| 强状态管理            | LangGraph           |
| 多 Agent 固定协作拓扑   | LangGraph           |
| 要求可恢复、可审计        | LangGraph           |
| 金融、教育、企业流程 Agent | 更偏 LangGraph        |


不过实际工程里还有第三种答案：
```text
LangGraph
   ↓
负责宏观 Workflow / State

Agent Node
   ↓
内部运行 ReAct / Claude 式 Harness
   ↓
Skill + MCP + Tools
```

也就是说完全可以：
```text
外层 LangGraph
        ↓
负责：
状态
路由
恢复
审批
业务流程

内层 Agent Harness
        ↓
负责：
推理
工具选择
自主探索
动态规划
```

这往往比二选一更合理。

---

最后把整个问题压缩成一个面试层面的理解：

> **Claude Code 代表的是 Agent-centric 的设计：给模型工具、Skill、MCP、Subagent 和 Hook，让模型在一个强大的 Harness 中自主完成任务；LangGraph 代表的是 Workflow-centric 的设计：先用 State、Node、Edge 和 Checkpoint 定义系统允许的执行结构，再把 LLM 放进需要智能判断的节点。因此 Claude Code 的优势是自主性和开箱即用，LangGraph 的优势则是复杂业务下的状态管理、流程控制、持久化恢复和可审计性。真正生产级的复杂 Agent，往往不是二选一，而是外层用类似 LangGraph 的工作流控制系统，内层节点再运行 Claude Code 风格的 Agent Loop。**

你可以用一个判断题检验是否理解：**如果一个系统只是“模型不断选择工具直到完成任务”，你认为它最缺 LangGraph 的哪项能力——工具扩展能力，还是显式业务状态与执行控制？**

<!-- created: 2026-08-25 15:50:31 -->
<!-- updated: 2026-08-25 16:21:02 -->
