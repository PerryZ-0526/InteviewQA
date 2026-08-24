# ✅LangGraph 从 workflow 编排器到 agent runtime 的转型

## 题目

LangGraph 最初是 workflow 编排框架，后来转型为 agent runtime，谈谈这次转型，以及状态、checkpoint、人机协作这些抽象为什么留了下来。

## 标签

[LangGraph](../../tags/LangGraph.md) | [Agent](../../tags/Agent.md) | [LLM](../../tags/LLM.md)

## 题目导航

← 无 | [langGraph中的command](langGraph中的command) →

## 面试直接答

> LangGraph 的转型是「agentic workflow 收敛为 agent loop」在框架层的同构证据：它从 2024 年初的 workflow 编排库，重新定位为 2025 年 10 月 1.0 的 `agent runtime`——图的抽象从业务流水线变成 `agent 状态机`，而状态、checkpoint 与 human-in-the-loop 这三个为 workflow 设计的机制，恰恰是 agent loop 工程化最需要的运行时能力。

先讲出身。LangGraph 是 LangChain 公司在 2024 年 1 月发布的库，核心抽象是 `StateGraph`：节点是 LLM 调用或工具执行，边是状态转移，条件边根据状态决定下一步走向，底层用 Pregel/BSP 超步模型执行 —— 每个超步内节点并行执行，超步之间同步状态。当时的卖点是「把 workflow 画成图」：prompt chaining、routing、orchestrator-workers 这些 Anthropic 枚举的模式都能显式建模，checkpoint 支持`时间旅行调试`，interrupt 支持人工审批。这些机制在「编排」名义下被设计出来，但它们的真实身份是持久执行的基础设施。

转型的信号出现在 2025 年LangChain 推出 createAgent 高层 API，直接构建在 LangGraph 之上；2025 年 9 月 2 日 LangGraph 1.0 发布 alpha，10 月 22 日官方宣布 GA，发布说明的第一句话就是「a stability-focused release for the agent runtime」，并披露 Uber、LinkedIn、Klarna 等生产用户。1.0 的 API 变化最能说明转型方向：create\_react\_agent 预构建被弃用、推荐 LangChain 的 create\_agent 承接，langgraph.prebuilt 也从主包拆分为独立包——预构建的「workflow 模板」退场，把主舞台留给 agent 运行时。同时 1.0 保持图 API 与执行模型不变、无破坏性变更，说明<u style="text-decoration-color: rgb(230, 57, 70)">转型是定位与默认路径的迁移，不是架构重写</u>。

为什么留下来的是状态、checkpoint、人机协作这三样？因为它们恰好是 `agent loop 的工程化缺失项`。

1. loop 需要`单一事实源`：State 加 thread\_id 让并发节点、跨轮次记忆和恢复都有统一落点。
2. loop 需要`持久执行`：每个 super-step 自动 checkpoint 到 SQLite、Postgres 或 Redis，进程崩溃、pod 驱逐、部署重启后从精确的工具调用边界恢复——这正是无状态 LLM 调用最缺的能力，1.0 之前团队要自己手写或在 Celery、Temporal 上补。
3. loop 需要`人工介入`：interrupt() 在工具调用边界暂停，等审批后 Command(resume=...) 从断点续跑，可以挂起数天再恢复。

> 这三样在 workflow 时代是「编排业务流水线」的辅助功能，<span style="background-color: rgb(255, 243, 205)">在 agent 时代变成了「让不可靠的模型循环变得可运维」的核心价值——抽象没变，服务对象变了</span>。

放进更大的图景看，这是同一个收敛叙事的三层证据之一：

- 产品层，Claude Code、Codex 用单 loop 取代多步 pipeline；
- 框架层，LangGraph 从编排器转型 agent runtime；
- 架构层，DeepSeek Harness 的 agent loop 本身就是可替换插件。

三者的共同结构都是「确定性骨架包住模型自由决策」——LangGraph 用显式图加 checkpoint，dsh 用插件树加仅追加事件日志，Claude Code 用 harness 加文件快照，抽象不同，职责相同。

边界也要讲清楚。第一，图的抽象没有过时——它只是从「业务流程图」变成`「agent 状态机」`，Pregel 超步执行的确定性并发仍是优点。第二，1.0 的稳定性承诺（无破坏性变更、checkpoint 后端生产就绪）说明 durable execution 已经是被验证的真需求，不是叙事。第三，LangGraph 的图式显性控制与 Claude Code 式的隐藏循环代表两种哲学：前者<span style="background-color: rgb(255, 243, 205)">把循环暴露给开发者挂护栏</span>，后者把循环藏进产品靠 hooks 拦截，选型时要分清自己需要的是「可编程的运行时」还是「开箱即用的产品」。

## 详细解析

> 公开信息核验日期：2026-08-16。版本日期经 GitHub 发布标签核验（1.0.0a2 = 2025-09-02，1.0.0 = 2025-10-17，1.2.0 = 2026-05-12，最新 1.2.11）；API 迁移、checkpoint 后端、durability 模式、interrupt 语义与生产用户案例均基于官方文档（releases/langgraph-v1、checkpointers、interrupts、pregel、case-studies）。

### 一、转型时间线


| 时间         | 事件                                  | 定位                                                |
| ---------- | ----------------------------------- | ------------------------------------------------- |
| 2024-01    | LangGraph 发布                        | workflow 编排库（StateGraph、checkpointer）             |
| 2024-2025  | 生产采用（Uber、LinkedIn、Klarna 等官方披露）    | 编排 + 持久执行能力被验证                                    |
| 2025-09-02 | LangGraph 1.0 alpha（1.0.0a2 发布）     | 定位转向 agent runtime                                |
| 2025-10-22 | 官方宣布 1.0 GA（1.0.0 发布于 10-17）        | 「stability-focused release for the agent runtime」 |
| 2026-05-12 | LangGraph 1.2（截至 2026-08 最新 1.2.11） | checkpoint 生产后端持续迭代（Postgres/Redis）               |


### 二、1.0 的关键 API 迁移


| 变化                                                | 含义                                               |
| ------------------------------------------------- | ------------------------------------------------ |
| `create_react_agent` 弃用                           | 预构建 workflow 模板退场，改由 LangChain `create_agent` 承接 |
| `langgraph.prebuilt` 拆分为独立 `langgraph-prebuilt` 包 | 预构建件不再是主包主线                                      |
| StateGraph + 图 API 与执行模型完整保留                      | 转型是定位迁移，不是架构重写                                   |
| checkpoint 后端（SQLite/Postgres/Redis）生产就绪          | durable execution 成为核心卖点                         |
| human-in-the-loop 持续一等公民能力                        | interrupt / Command(resume) 语义文档化完善              |


### 三、留存的三个抽象及对应职责
```text
State（单一事实源）
  ├─ 节点间传递：超步同步的状态对象
  ├─ thread_id：会话级持久化单元，支持分支与审计
  └─ 跨轮次记忆的落点

Checkpoint（持久执行）
  ├─ 每个 super-step 自动落盘
  ├─ 崩溃 / pod 驱逐 / 部署重启后从精确边界恢复
  └─ 时间旅行：从任意历史 checkpoint 重放

Human-in-the-loop（人工介入）
  ├─ interrupt() 在工具调用边界暂停
  ├─ Command(resume=...) 从断点恢复，可挂起数天
  └─ 审批、修改、拒绝三类人工动作
```

### 四、最小示例：带 interrupt 的 agent 图
```python
from langgraph.graph import StateGraph, START, MessagesState
from langgraph.types import interrupt, Command

def risky_tool_node(state):
    # 执行前暂停，请求人工批准；批准后从断点继续
    decision = interrupt({"question": "allow deployment?", "plan": state["messages"][-1]})
    if not decision.get("approved"):
        return {"aborted": True}
    return deploy(state)

builder = StateGraph(MessagesState)
builder.add_node("risky_tool", risky_tool_node)
builder.add_edge(START, "risky_tool")
graph = builder.compile(checkpointer=checkpointer)

# 第一次调用会在 interrupt 处挂起；人工决策后：
# graph.invoke(Command(resume={"approved": True}), config)
```

### 五、面试追问

**追问一：Pregel/BSP 超步模型对 LLM 节点意味着什么？**

两个确定性收益。

1. 并发语义确定：<u style="text-decoration-color: rgb(230, 57, 70)">同一超步内无数据依赖的节点并行执行</u>，`超步边界`同步状态，避免了基于事件循环的框架里「谁先跑完谁先写状态」的竞态。
2. 失败边界清晰：checkpoint 以超步为单位，<u style="text-decoration-color: rgb(230, 57, 70)">恢复点精确到「上一步已提交、本步未开始」，不会出现半执行的节点状态</u>。

代价是模型延迟的方差被超步同步放大——最慢节点决定超步时长，这在高延迟 LLM 调用下是真实成本，也是评估图拓扑时要考虑的因素。

**追问二：每个超步都 checkpoint，性能与成本怎么权衡？**

官方文档给了三种耐久性模式（durability modes）来平衡：sync 模式同步写完每个 checkpoint 再继续下一步，持久性最高但每次落盘都在关键路径上；async 模式在下一步执行时异步持久化，性能好但进程崩溃时有小概率丢失最后几个 checkpoint；exit 模式只在图执行退出时统一持久化，长图性能最好，但无法从执行中途的系统故障恢复。存储后端按规模选型：内存后端零成本但进程退出即丢，SQLite 适合实验与本地工作流，Postgres 与 Redis 适合生产并发。还有一个常被忽略的成本：checkpoint 里存的是状态（状态里有什么就存什么），合规场景要做落盘数据的脱敏与保留策略，持久执行的代价不只是存储账单。

**追问三：interrupt() 与 Claude Code 的 hooks、dsh 的 agent/turn-stopping 有什么异同？**

同：都是确定性骨架对模型自由决策的干预点，模型不可绕过，且都发生在执行边界。异：interrupt 是同步阻塞语义——执行暂停、等待人工、恢复续跑，天然支持数天级挂起；hooks 是拦截语义——校验、改写或拒绝，快速返回，不支持长时间挂起；dsh 的 agent/turn-stopping 是轮次级终止语义——决定这一轮何时停止，粒度更粗。选型含义：审批流用 interrupt，团队策略校验用 hooks，轮次控制用 dsh 式事件。三者可以组合：同一框架里不同确定性责任用不同机制。

**追问四：图 API 在 1.0 完全保留，是否说明 workflow 用户仍是主体？**

不能这么推。保留图 API 是因为它是状态机抽象的正确形式——agent 的循环、分支、并行同样需要图来表达，LangGraph 只是把图的语义从「业务流水线」重新解释为「agent 状态机」。1.0 真正的主体信号在另一边：预构建 workflow 模板被弃用、高层 API 收敛到 createAgent、官方叙事全面转向 durable agent。换句话说，图留下了，画图的理由变了——这正是 workflow 收敛叙事在框架层的精确投影。

### 六、参考

- [LangGraph v1 官方发布说明（docs.langchain.com）](https://docs.langchain.com/oss/releases/langgraph-v1)
- [LangGraph Checkpointers 文档（durability 模式与后端选型）](https://docs.langchain.com/oss/langgraph/checkpointers)
- [LangGraph Interrupts 文档（Command(resume) 语义）](https://docs.langchain.com/oss/langgraph/interrupts)
- [LangGraph Pregel 文档（BSP 执行模型）](https://docs.langchain.com/oss/langgraph/pregel)
- [LangGraph Case Studies（Uber / LinkedIn / Klarna 等生产案例）](https://docs.langchain.com/oss/langgraph/case-studies)
- [LangChain 官方博客：LangGraph 1.0 GA](https://www.langchain.com/blog/langchain-langgraph-1dot0)
- [LangChain 官方博客：1.0 alpha 发布](https://www.langchain.com/blog/langchain-langchain-1-0-alpha-releases)
- [LangGraph GitHub 仓库](https://github.com/langchain-ai/langgraph)


<!-- created: 2026-08-16 03:21:11 -->
<!-- updated: 2026-08-21 15:30:32 -->
