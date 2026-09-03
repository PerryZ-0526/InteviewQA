# ✅谈谈你对LangGraph中的subgraph的理解

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph搭建agent和直接使用claude-code+skill搭建agent相比的优势在哪？](LangGraph搭建agent和直接使用claude-code+skill搭建agent相比的优势在哪？) | [langGraph架构中，tool是作为一个函数，还是作为一个node？](007-langGraph架构中，tool是作为一个函数，还是作为一个node？.md) →

## 面试直接答

我对 LangGraph 中 Subgraph 的理解是，它本质上是一种`“图中图”的层次化编排机制`：一个 Subgraph 自己就是完整的 `StateGraph`，内部可以拥有自己的状态、节点、条件分支、循环、工具调用，甚至继续嵌套更深一级的子图；但放到父图中时，又可以整体作为一个节点被调用。因此，Subgraph 解决的并不只是“把代码拆开写”或者“复用几个节点”这么简单，而是在复杂 Agent 系统中建立清晰的`职责边界、状态边界和执行边界`。

> LangGraph 官方也把`多 Agent 系统`、`节点集合复用`以及`不同团队独立开发`作为 Subgraph 的典型使用场景。

### Subgraph 的第一个核心价值是`模块化与分层编排`，解决复杂 Agent 图不断膨胀的问题

一个简单 Agent 可能只有模型节点和工具节点，但业务复杂以后，很容易出现检索、画像、搜索、规划、审批、重试、结果校验等大量节点。如果全部堆在一张主图中，最终会形成一个非常庞大的状态机，主图既要关心全局任务，又要关心每个领域内部的执行细节，节点之间的依赖关系也会越来越复杂。

Subgraph <u style="text-decoration-color: #e63946">可以把一个完整的领域能力封装成独立子图</u>，例如把政策问答、搜索、画像、规划分别封装成不同 Domain Subgraph。父图只负责决定“当前应该调用谁、任务怎么流转、什么时候汇总结果”，而具体领域内部如何执行，则由对应 Subgraph 自己负责。

> 对父图来说，一个内部可能包含十几个节点的领域工作流，<u style="text-decoration-color: #e63946">最终只表现为一个可调用节点</u>。这样就形成了`“父图负责宏观编排，子图负责领域内部执行”`的层次化结构。

### Subgraph 的第二个核心价值是：它不是普通函数封装，而是保留了`完整的图执行语义`

普通函数节点通常只是接收 State、执行一段逻辑、返回 State 更新；而 Subgraph 自身仍然是一张完整的图，因此内部同样可以存在条件分支、循环、并行、暂停、恢复以及更深层的 Subgraph。

这意味着 Subgraph 封装的不是“一段代码”，而是一个完整的工作流。它<u style="text-decoration-color: #e63946">既可以是一段完全确定性的业务流程，也可以在内部运行一个 ReAct Agent</u>。例如 Search Subgraph 可以自己完成“搜索 → 读取网页 → 判断证据 → 继续搜索 → 结果验收”的循环，而父图不需要参与每一次工具调用。

> 因此，Subgraph 更准确的理解不是“子 Agent”，而是`可组合的子工作流`；
>
> 只不过在多 Agent 系统中，我们经常把一个 Domain Agent 的完整执行流程封装成一个 Subgraph。

### Subgraph 的第三个核心价值是`显式管理父子图 State`，形成<u style="text-decoration-color: #e63946">状态边界和上下文边界</u>

LangGraph 的核心是 State，因此设计 Subgraph 时，一个关键问题就是：`哪些状态应该由父图管理`，`哪些状态应该留在子图内部？`

LangGraph 中父图与 Subgraph 的状态交互通常有两种方式：

- 第一种是父图和子图具有`共享 State 字段`，此时可以直接把编译后的 Subgraph 注册成父图节点，由共享字段完成状态传递。
- 第二种是父图和子图使用不同的 `State Schema`，这时通常在父图中增加一个<u style="text-decoration-color: #e63946">包装节点</u>，显式完成 `ParentState → SubgraphState → ParentState` 的状态映射。

例如父图只维护用户问题、任务计划和各领域 Agent 的最终结果，而 RAG Subgraph 内部还可以保存检索词、候选文档、重排分数、重试次数等私有状态，执行结束后只向父图返回答案和证据。

> 这样父图看到的是标准化输入输出，而不是子图全部中间过程。
>
> 从软件工程角度看，这和模块封装非常类似：`父图关心接口，子图隐藏内部实现。`

这种状态边界同时也能够形成上下文边界。<u style="text-decoration-color: #e63946">不同 Domain Agent 没有必要读取彼此所有中间状态和消息历史</u>，只需要接收完成当前任务必要的信息，从而避免全局 State 和 LLM 上下文不断膨胀。

### Subgraph 的第四个核心价值是`可配置的持久化能力`，以及`由此带来的暂停、恢复和故障隔离能力`

Subgraph 可以继承 LangGraph 的 Checkpoint 机制，因此它并不是执行一次就消失的黑盒流程。根据场景不同，可以控制子图内部状态是否在调用之间保留。

整体上可以理解为三种情况：

- 1️⃣默认情况下，每次 Subgraph 调用之间的内部状态相互隔离，但单次执行仍然可以配合父图的持久化机制进行暂停和恢复；
- 2️⃣如果需要一个子 Agent 在<u style="text-decoration-color: #e63946">同一线程的多次调用之间保留历史状态</u>，可以启用线程级持久化；
- 3️⃣如果内部只是非常简单、执行成本很低的逻辑，也可以关闭持久化，使其接近普通函数调用。

持久化进一步带来了`恢复`能力。例如某个领域 Subgraph 已经完成前几步，在后续节点异常或者调用 `interrupt()` 等待人工审批时，可以基于已有的执行状态继续，而不必让整个父图从头开始执行。

> 因此，Subgraph 拆分的不只是代码模块，也是在把复杂任务拆成多个`能够独立维护执行状态的子状态机`。

### 从整体架构上看，Subgraph 最重要的设计思想是`局部自治、全局受控`

父图负责<u style="text-decoration-color: #e63946">全局目标、任务拆解、领域调度、结果聚合以及整个任务的退出条件</u>，而 Subgraph 负责<u style="text-decoration-color: #e63946">某一个领域内部如何完成任务</u>。

> 例如父图中的 Orchestrator 只需要判断“下一步应该调用 Search Agent”，并不需要参与 Search Agent 内部的每一次搜索和工具选择；Search Subgraph 可以自己运行 ReAct Loop，<u style="text-decoration-color: #e63946">并拥有自己的结果验收和退出机制</u>。
```text
Main Graph
负责全局编排与控制
        ↓
Domain Subgraph
负责领域内部执行与局部自治
```

这种设计既<u style="text-decoration-color: #e63946">保留了 Agent 在局部复杂任务上的自主能力</u>，又避免整个系统演变成一个完全由模型自由决策的巨大 Agent Loop。

---

所以如果让我在面试中总结，我会说：**LangGraph 的 Subgraph 本质上是把一个完整的状态化工作流封装成父图中的可组合节点。它的核心价值不仅是代码复用，更重要的是<u style="text-decoration-color: #e63946">通过层次化编排建立</u>**`职责边界`**，<u style="text-decoration-color: #e63946">通过独立 State 建立</u>**`状态和上下文边界`**，再结合 Checkpoint 获得持久化、暂停和恢复能力。最终形成一种“父图负责全局控制、子图负责局部自治”的复杂 Agent 架构。**

## 详细解析

LangGraph 里的 Subgraph 可以理解为一种`“图中图”`机制。它本身是一个完整的 `StateGraph`，可以拥有自己的 State Schema、节点、条件边、循环、工具调用以及内部控制逻辑，但当它被嵌入更高层的父图以后，又可以整体表现为父图中的一个节点。因此从抽象层级来看，Subgraph 并不是普通意义上的函数封装，而是把一个完整的工作流封装成另一个工作流中的可组合组件。

> 官方给出的典型使用场景主要包括：`构建多 Agent 系统`、`复用一组相关节点`以及`让不同团队分别开发复杂系统中的不同部分`。

### Subgraph 的第一个核心价值是`模块化与分层编排`，解决复杂 Agent 图不断膨胀的问题

如果没有 Subgraph，一个复杂 Agent 系统很容易把所有能力都堆在同一张 StateGraph 中，例如规划、RAG、画像查询、Web Search、任务办理、人工审批、重试、结果校验等全部成为主图节点。

随着能力增加，主图可能逐渐变成：
```text
START
  ↓
Planner
  ↓
Intent / Router
  ├── RAG Retrieve
  │      ↓
  │   Rerank
  │      ↓
  │   Evidence Check
  │      └── Retry
  │
  ├── Search
  │      ↓
  │   Read Page
  │      ↓
  │   Evidence Check
  │
  ├── Profile
  │      ↓
  │   Profile Update
  │
  └── Planning
         ↓
      Reviewer
```

这时主图实际上同时承担了两个层次的职责：一方面负责整个用户任务如何执行，另一方面又负责 RAG、搜索、画像等领域内部每一步怎么执行。<u style="text-decoration-color: #e63946">系统规模继续扩大以后，节点数量、条件边数量以及 State 字段都会迅速增加</u>。

Subgraph 的作用就是<span style="background-color: #fff3cd">把第二层逻辑封装起来</span>，例如：
```text
Main Graph
    ↓
Orchestrator
    ├── Policy Subgraph
    ├── Profile Subgraph
    ├── Search Subgraph
    └── Planning Subgraph
```

其中 Policy Subgraph 内部仍然可以非常复杂：
```text
接收领域任务
    ↓
理解问题
    ↓
生成检索 Query
    ↓
向量检索
    ↓
重排
    ↓
证据充分？
 ├── 否 → Query Rewrite → 再检索
 └── 是
       ↓
    生成结果
```

但是这些细节已经被封装在 Policy Subgraph 内部。父图只需要知道：
```text
输入：policy_task
输出：policy_result
```

于是主图负责的是：

> “这个任务应该交给谁？”

而子图负责的是：

> “这个领域任务具体应该怎么做？”

这就是 Subgraph 所带来的`层次化编排`。

它同时也带来了`职责边界`。Policy 团队可以维护 Policy Subgraph，Search 团队维护 Search Subgraph，只要<u style="text-decoration-color: #e63946">父子图之间约定好输入输出接口</u>，内部节点如何调整并不会直接影响整个主图。

### Subgraph 的第二个核心价值是：它不是普通函数封装，而是保留了`完整的图执行语义`

一个普通 LangGraph Node 本质上通常只是：
```python
def node(state):
    ...
    return state_update
```

它完成一次函数执行以后就返回控制权。

而 Subgraph 自身仍然是一张 Graph，因此内部可以拥有：
```text
顺序执行
条件路由
循环
并行
interrupt
恢复
再次嵌套 Subgraph
```

例如一个 Search Subgraph 完全可以是：
```text
Search Query
     ↓
搜索网页
     ↓
读取内容
     ↓
Judge
 ┌───┴────┐
证据不足   证据充分
 ↓          ↓
改写 Query  Answer
 ↓
重新搜索
```

这意味着父图虽然只调用了一次 Search Subgraph，但这个 Subgraph 内部可能已经进行了多轮模型推理和工具调用。

LangGraph 甚至允许：
```text
Parent Graph
     ↓
Child Graph
     ↓
Grandchild Graph
```

这样的多层嵌套。因此 Subgraph 代表的是一个真正具有执行语义的`子工作流`，而不只是为了把代码移动到另一个文件里。

这一点在理解多 Agent 架构时尤其重要：`Subgraph 并不等于 Agent。`

例如下面这个 Subgraph：
```text
读取数据库
    ↓
规则计算
    ↓
risk > threshold?
 ├─ Yes → 风险处理
 └─ No  → 正常返回
```

完全可以没有任何 LLM，但它仍然是一个合法的 Subgraph。

当然，也可以在 Subgraph 内部放置 ReAct Agent：
```text
Search Subgraph
      ↓
 Search Agent
      ↓
Reason → Tool
  ↑       ↓
  └───────┘
      ↓
   Validator
```

这时候 Subgraph 相当于一个 Domain Agent 的完整运行容器。所以更准确地说：

> `Subgraph 是 Workflow 抽象，而 Domain Agent 可以被封装在 Subgraph 中。`

### Subgraph 的第三个核心价值是`显式管理父子图 State`，形成状态边界和上下文边界

LangGraph 的核心抽象之一就是 State，因此设计 Subgraph 时必须明确：

> 哪些信息属于整个任务的全局状态，哪些信息只属于某一个领域内部？

父图和子图的 State 交互主要有两种方式。

第一种是`共享 State 字段`。

例如父图：
```python
class ParentState(TypedDict):
    task: str
    result: str
```

子图：
```python
class ChildState(TypedDict):
    task: str
    result: str
    documents: list
```

二者虽然 State Schema 不完全相同，但共同拥有：
```text
task
result
```

此时编译完成的 Subgraph 可以直接注册到父图：
```python
parent_graph.add_node(
    "rag_agent",
    compiled_rag_subgraph
)
```

状态流转可以理解为：
```text
ParentState
   ↓
共享 task
   ↓
RAG Subgraph
   ↓
内部：
documents
query
score
...
   ↓
更新 result
   ↓
ParentState
```

父图只关心共享字段，而 `documents` 等字段属于子图自己的内部状态。

第二种情况是`父子图使用不同的 State Schema`。

例如父图：
```python
class ParentState(TypedDict):
    task: str
    agent_result: str
```

而 RAG Subgraph：
```python
class RAGState(TypedDict):
    query: str
    documents: list
    rerank_scores: list
    answer: str
```

这里没有天然能够直接对应的状态字段，因此通常需要在父图中增加一个包装节点：
```python
def call_rag(state: ParentState):

    rag_input = {
        "query": state["task"]
    }

    rag_output = rag_subgraph.invoke(rag_input)

    return {
        "agent_result": rag_output["answer"]
    }
```

整个过程实际上就是：
```text
ParentState

task
 ↓
状态映射
 ↓
query
 ↓
RAG Subgraph
 ↓
answer
 ↓
状态映射
 ↓
agent_result

ParentState
```

官方对应的两种形式，可以概括为：

> `直接将 Subgraph 作为节点`

以及

> `在父图节点函数中调用 Subgraph`。

前者更简单，适合父子图存在统一状态接口的场景；后者隔离程度更高，适合不同 Domain Agent 拥有`独立内部状态模型`的场景。

例如多 Agent 系统完全可以设计成：
```text
Global State
    ↓
task
constraints
user_context
    ↓
Domain Subgraph
    ↓
Private State
query
documents
tool_results
retry_count
...
    ↓
result
evidence
    ↓
Global State
```

RAG Agent 搜索了几次、有多少候选文档、每个文档的 rerank score 是多少，都属于 RAG Subgraph 的内部实现，Orchestrator 没有必要知道。

因此，Subgraph 建立的不只是`状态边界`，还可以进一步形成`上下文边界`。

需要注意的是，这里的状态和 LLM Context 并不是完全相同的概念。<u style="text-decoration-color: #e63946">State 中可以存放很多结构化业务数据，而真正发送给模型的只是其中一部分</u>。但是通过限制 Subgraph 能够读取哪些 State，以及只把必要的 `messages`、documents、task 等字段传进去，就可以间接控制每个 Domain Agent 实际看到的上下文。

这比所有 Agent 共用：
```text
一个巨大 messages
+
一个巨大 Global State
```

更加清晰。

从软件工程角度看，本质就是：

> `父图只依赖接口，而不依赖 Subgraph 的内部实现。`

### Subgraph 的第四个核心价值是`可配置的持久化，以及由此带来的暂停、恢复和故障隔离能力`

Subgraph 仍然属于 LangGraph 的执行体系，因此可以结合 Checkpoint 保存执行状态。

这里主要可以理解为三种持久化模式。

第一种是默认的`按调用隔离`，即：
```python
checkpointer=None
```

这种情况下，每次调用 Subgraph 时，不会自动继承上一次调用留下的内部状态，因此：
```text
第一次调用 Search Subgraph
        ↓
内部状态 A

第二次调用 Search Subgraph
        ↓
新的内部状态 B
```

A 和 B 相互独立。

但这并不意味着单次调用没有持久化能力。当父图配置了 Checkpointer 时，子图在当前调用中的执行状态仍然可以进入整个 Graph 的持久化执行体系，因此依然能够支持 Interrupt 和恢复。

> 这种模式非常适合大多数 Domain Agent，<u style="text-decoration-color: #e63946">因为每次任务本来就应该相互独立</u>。

第二种是`按线程持久化`：
```python
checkpointer=True
```

这种情况下，<u style="text-decoration-color: #e63946">同一个 thread 下多次调用 Subgraph 时，可以继续使用之前保存的内部状态</u>。

例如：
```text
Research Agent 第一次调用
 ↓
搜索论文 A、B、C
 ↓
保存 Research State

之后再次调用
 ↓
继续基于之前的信息研究
```

此时这个 Subgraph 就不再只是“一次任务执行器”，而更接近一个`具有持续会话状态的子 Agent`。

但这种方式也带来了<span style="background-color: #fff3cd">额外的并发约束</span>。如果同一个带线程级持久状态的 Subgraph 被并行调用，就需要特别谨慎处理多个执行对同一个 checkpoint namespace 的访问，因此它更适合需要连续上下文、但调用关系比较明确的子 Agent。

第三种是`完全无状态`：
```python
checkpointer=False
```

这种情况下 Subgraph 不保存执行 checkpoint，也无法依赖已有执行状态进行恢复，更接近一个普通函数式工作流。

所以选择哪一种，本质上是在回答两个问题：

> `当前这次执行是否需要恢复？`

以及：

> `下一次调用是否应该记住上一次调用的内部状态？`

例如：

> 1. 每次查询政策都应该独立执行，可以使用默认的调用级隔离；
> 2. Research Agent 需要<u style="text-decoration-color: #e63946">持续积累研究过程</u>，可以考虑线程级持久化；
> 3. 简单、无副作用、执行成本很低的内部计算，可以考虑无状态执行。

持久化进一步带来的一个关键能力就是`故障恢复和人工介入`。

例如：
```text
Orchestrator
    ↓
RAG Subgraph
    ↓
Query Rewrite
    ↓
Retrieve
    ↓
Rerank
    ↓
Evidence Check
    ↓
Answer
```

如果执行到后半部分发生异常，在具备相应 Checkpoint 的情况下，可以基于已经记录的执行状态恢复，而不必重新执行整个父图的所有前置流程。

同样，Subgraph 内部也可以：
```python
interrupt(...)
```

暂停执行，例如等待用户批准某项操作；之后再通过恢复命令继续原来的执行过程。

因此 Subgraph 与持久化结合之后，真正形成的是：
```text
Main Graph
拥有全局任务生命周期

Domain Subgraph
拥有领域内部执行生命周期
```

这也是为什么持久化和“故障隔离”最好放在同一个部分理解，而不需要拆成两个彼此重复的优势。

### 从整体架构上看，Subgraph 最重要的设计思想是`局部自治、全局受控`

如果把前面几个机制放到一起，Subgraph 最终解决的是复杂 Agent 系统中的`分层控制问题`。

外层 Main Graph 可以负责：
```text
全局任务目标
任务拆解
Domain 路由
跨领域依赖
结果聚合
最终退出条件
```

而 Domain Subgraph 负责：
```text
领域内部规划
工具选择
内部循环
结果验证
局部重试
领域退出条件
```

例如：
```text
               Main Graph
                    ↓
              Orchestrator
              /     |      \
             /      |       \
       RAG Subgraph |    Search Subgraph
                    |
              Profile Subgraph
```

Orchestrator 判断：

> “现在需要搜索领域的信息。”

之后只需要把任务交给 Search Subgraph。

Search Subgraph 内部则可以：
```text
Receive Task
     ↓
Search Agent
     ↓
搜索
 ↓
读取
 ↓
判断证据
 ├── 不够 → 继续搜索
 └── 足够 → 返回结果
```

Orchestrator 没有必要参与 Search Agent 内部每一次工具调用，也不需要重复检查它的每一个局部步骤。

因此这非常适合：
```text
Orchestrator
        +
多个 Domain ReAct Subgraph
```

这样的多 Agent 架构。

外层 Orchestrator 解决的是：

> “应该由哪个领域来完成？”

领域 Subgraph 解决的是：

> “这个领域内部具体怎么完成？”

<u style="text-decoration-color: #e63946">每个 Subgraph 都拥有自己的内部 Loop、验收条件和退出机制</u>，父图只负责跨领域层面的调度与<u style="text-decoration-color: #e63946">最终任务完成判断</u>。

最终形成：
```text
        Main Graph
        全局受控
            ↓
   ┌────────┼────────┐
   ↓        ↓        ↓
Subgraph Subgraph Subgraph
局部自治  局部自治  局部自治
```

所以从架构设计角度看，我认为 Subgraph 最重要的意义不是“把大图拆成小图”，而是**把复杂 Agent 系统拆成多个职责明确、状态边界清晰、能够独立运行和恢复的领域状态机，再由父图进行更高层次的统一编排。**

如果面试时压缩成一句话，可以概括为：

> **LangGraph 的 Subgraph 本质上是一种层次化工作流抽象：它把完整的状态化工作流封装成父图中的可组合节点，通过分层编排解决复杂度，通过独立 State 建立状态和上下文边界，再通过 Checkpoint 支持暂停、恢复和生命周期管理，最终实现“父图全局控制、子图局部自治”的复杂 Agent 架构。**


## 谈谈langGraph中的subgraph和claude code中的subagent的异同

LangGraph 的 Subgraph 和 Claude Code 的 Subagent 表面上都在解决“把复杂任务拆给独立模块执行”的问题，因此都能用于多 Agent 架构，但二者其实不在同一个抽象层级上。最核心的区别可以先概括为一句话：Subgraph 是一个“可组合的状态化工作流”，Subagent 是一个`“拥有独立上下文的智能体实例”`。

> 前者强调流程、状态和执行控制，后者强调`任务委派`、上下文隔离和智能体自主性。

### 先说相同点

- 第一，两者都在解决复杂系统的模块化问题。LangGraph 可以把一个完整子流程封装成 Subgraph，再作为父图中的一个节点使用；Claude Code 则可以把代码审查、搜索、测试等职责封装成不同 Subagent，由主 Agent 根据任务进行委派。LangGraph 官方也明确把 Subgraph 的典型用途之一定义为构建多 Agent 系统，并允许不同子图独立开发，只需要约定输入输出接口。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/use-subgraphs "Subgraphs - Docs by LangChain")) Claude Code 的 Subagent 同样强调专业化，每个 Subagent 可以配置自己的系统提示词、模型、工具和权限，在独立上下文里完成任务，然后将结果返回主会话。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 
- 第二，两者都可以形成`层级结构`。LangGraph 可以出现 Parent Graph → Child Graph → Grandchild Graph 的多层嵌套；Claude Code 的 Subagent 现在也可以继续派生 Subagent，因此都能够构建<u style="text-decoration-color: #e63946">树状或者层级式任务分解结构</u>。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/use-subgraphs "Subgraphs - Docs by LangChain")) 
- 第三，两者都可以做一定程度的隔离，比如让某个领域模块只访问特定工具、只处理特定任务，从而降低整个系统的耦合度。

### 但真正的差异首先在于<u style="text-decoration-color: #e63946">抽象对象不同</u>

LangGraph 的 Subgraph 本质还是 Graph，也就是说它不一定是 Agent。一个 Subgraph 完全可以没有 LLM，只包含数据库查询、规则判断、条件分支和确定性程序。例如：
```text
Risk Subgraph
   ↓
读取数据
   ↓
规则计算
   ↓
risk > threshold?
   ├─ 是 → 风险处理
   └─ 否 → 返回结果
```

这仍然是一个合法的 Subgraph。Claude Code 的 Subagent 则天然是一个 AI Agent，它有自己的上下文窗口、系统提示词和工具调用能力，本质上还是模型驱动的 Agent Loop。官方定义中就明确指出，每个 Subagent 在自己的上下文窗口中运行，并拥有自己的系统提示词、工具访问和独立权限。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 所以从概念上说：
```text
Subgraph = Workflow 抽象
Subagent = Agent 抽象
```

这是两者最根本的区别。

### 第二个差异是状态和上下文的组织方式不同

LangGraph 的核心是 State。父图和子图之间可以显式规定哪些状态字段共享，哪些属于子图私有。如果状态 Schema 相同或者存在共享字段，可以直接把编译后的 Subgraph 当作节点加入父图；如果状态结构不同，则可以通过包装节点显式完成父状态 → 子状态 → 父状态的转换。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/use-subgraphs "Subgraphs - Docs by LangChain")) 因此你可以非常明确地规定：
```text
Global State
    ↓
task
user_id
constraints
    ↓
RAG Subgraph

内部状态：
query
documents
rerank_score
retry_count

最后只返回：
answer
evidence
```

父图甚至完全不需要知道子图里面进行了几次检索。

Claude Code 的核心则不是结构化 State，而是`上下文窗口隔离`。主 Agent 把一个任务描述交给 Subagent，Subagent 在自己的上下文里读文件、调用工具、搜索代码，然后把总结或结果返回主 Agent。<u style="text-decoration-color: #e63946">这样最大的价值是避免大量日志、文件内容和搜索结果污染主上下文</u>。Claude 官方明确<span style="background-color: #fff3cd">推荐把会产生大量一次性中间信息的任务交给 Subagent</span>，因为这些内容留在独立上下文里，只将最终结果返回主会话。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 所以这里可以简单理解为：
```text
LangGraph：
隔离的是“状态空间”。

Claude Code：
隔离的是“模型上下文”。
```

### 第三个区别是调用和调度机制不同

在 LangGraph 中，Subgraph 通常由程序定义的边或者条件边触发。例如：
```text
Orchestrator
   ↓
risk == policy
   ↓
Policy Subgraph
```

路径是显式的，你在代码层面能够看到谁可以调用谁、什么时候进入、什么时候退出。

Claude Code 中则更常见的是<u style="text-decoration-color: #e63946">模型自主委派</u>。主 Agent 根据 Subagent 的 description 判断是否应该把任务交给某个 Subagent，也可以由用户显式指定。官方文档直接说明，当 Claude 遇到与某个 Subagent 描述匹配的任务时，会将任务委派给该 Subagent。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 因而它更接近：
```text
Main Agent
   ↓
LLM 判断
   ↓
“这个问题应该交给 code-reviewer”
   ↓
Subagent
```

> 一个是**程序路由**为主，一个是**模型路由**为主。

### 第四个很重要的区别是<u style="text-decoration-color: #e63946">生命周期和持久化能力</u>

LangGraph 对 Subgraph 的持久化设计非常明确，目前主要有三种模式：默认的按调用持久化，每次调用之间隔离，但单次调用内部支持 checkpoint、interrupt 和恢复；按线程持久化，同一个 thread 多次调用时可以继续保留子图状态；以及完全无状态模式。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/use-subgraphs "Subgraphs - Docs by LangChain")) 也就是说它本质上是在管理“工作流执行状态”。

Claude Code 的 Subagent <u style="text-decoration-color: #e63946">默认也是每次调用创建新的实例</u>，不过现在<u style="text-decoration-color: #e63946">可以根据 Agent ID 恢复已经执行过的 Subagent</u>，恢复后会保留之前完整的会话历史和工具调用上下文。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 

此外，Claude Code 还<u style="text-decoration-color: #e63946">支持给 Subagent 配置独立的持久 Memory</u>，例如项目级或用户级记忆，<u style="text-decoration-color: #e63946">让它跨会话积累代码模式、架构信息等知识</u>。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 

> 但这里要区分两个概念：Claude Code 的这种 Memory 更偏“Agent 知识记忆”，LangGraph Checkpoint 更偏“Workflow 执行状态持久化”。两者解决的问题并不完全一样。

### 第五个区别是自主性不同

Subgraph 的自主性取决于你里面怎么写。它可以是完全确定性的流程，也可以内部包含一个 ReAct Agent：
```text
Subgraph
   ↓
Agent
 ↙   ↖
Tool ←
```

因此 LangGraph 的思想更像：

> 外层结构确定，内部局部自治。

而 Claude Code 的 Subagent 本身就是自主 Agent，例如一个 Research Subagent 可以自己决定先搜索什么、读哪些文件、是否继续调用工具，直到认为任务完成。Claude Code 甚至支持并行启动多个 Subagent，各自独立调查，然后由主 Agent 综合结果。([Claude](https://code.claude.com/docs/en/sub-agents "Create custom subagents - Claude Code Docs")) 所以 Claude Code 的 Subagent 更适合开放式任务，而 LangGraph Subgraph 更适合你需要明确控制执行路径的场景。

因此，在实际架构中，我不会简单把两者当成一一对应关系。例如一种比较典型的 LangGraph 多 Agent 系统可能是：
```text
Main Graph
    ↓
Orchestrator
    ├── RAG Subgraph
    ├── Search Subgraph
    ├── Profile Subgraph
    └── Planning Subgraph
```

但每一个 Subgraph 内部实际上又可能运行一个类似 Claude Code Subagent 的智能体：
```text
Search Subgraph

输入 task
   ↓
Search Agent
   ↓
思考 → Tool → 思考 → Tool
   ↑__________________|
   ↓
验收
   ↓
返回 result
```

这样看就会发现，**Subgraph 更像是装 Agent 的**`“运行容器和流程边界”`**，Subagent 更像容器里面真正执行任务的智能工作者。**

---

如果用于面试，我会这样总结：LangGraph 的 Subgraph 和 Claude Code 的 Subagent 都能实现<u style="text-decoration-color: #e63946">任务拆分、模块隔离、并行执行和层级式多 Agent</u>，但二者设计哲学不同。

- Subgraph 是 Workflow-centric，它<span style="background-color: #fff3cd">关注 State、节点、执行路径、持久化和恢复</span>；
- Subagent 是 Agent-centric，它关<span style="background-color: #fff3cd">注独立上下文、专用 Prompt、工具权限和自主任务执行</span>。
- Subgraph 强调“这个任务按照什么流程运行”，Subagent 强调“这个任务交给谁自主完成”。

因此在生产级多 Agent 系统中，<u style="text-decoration-color: #e63946">两者其实可以组合</u>：外层用类似 LangGraph Subgraph 的结构做确定性的任务编排、状态管理和恢复，内层再使用 Subagent 式的 Agent Loop 完成需要探索和推理的复杂子任务。

<!-- created: 2026-08-25 17:13:18 -->
<!-- updated: 2026-08-26 14:28:48 -->
