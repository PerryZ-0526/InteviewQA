# LangGraph 编排图-实时对话

## 方案变迁
```text
plan-and-execute范式
        ↓
plan-and-execute + ReAct子图
        ↓
ReAct范式 + tools
        ↓
将不同类型的任务，封装成独立的ReAct loop子图，每个子图中定制化prompt
```

> <span style="font-size: 12pt">我们最开始考虑过统一 ReAct Loop，让模型在所有 Tool 中自由选择，但<u style="text-decoration-color: rgb(230, 57, 70)">随着能力增加会出现工具空间过大、Prompt 规则互相干扰、终止条件不统一的问题</u>。所以后来更倾向于做</span><span style="font-size: 12pt; background-color: rgb(255, 243, 205)">分层 Agent</span><span style="font-size: 12pt">：先由轻量 Router 判断执行范式，再进入</span> `Policy`<span style="font-size: 12pt">、</span>`Search`<span style="font-size: 12pt">、</span>`Task`<span style="font-size: 12pt">、</span>`Planning` <span style="font-size: 12pt">等</span>`定制化 Domain subGraph`<span style="font-size: 12pt">。每个</span> `subGraph` <span style="font-size: 12pt">有自己的 Prompt、核心 Tool 集、状态和终止条件，同时保留必要的</span>`跨域工具`<span style="font-size: 12pt">。</span>
>
> <span style="font-size: 12pt">简单任务直接在单个</span> `subGraph` <span style="font-size: 12pt">中完成，</span><span style="font-size: 12pt; background-color: rgb(255, 243, 205)">复杂任务则编排多个领域 Agent</span><span style="font-size: 12pt">。这样本质上是</span><span style="font-size: 12pt; background-color: rgb(255, 243, 205)">用路由降低决策空间</span><span style="font-size: 12pt">，用专业化 Prompt 提高单任务执行质量。</span>

## `gen-4`方案
```text
User
 ↓
Execution Router
 ↓
 ├─ Policy ReAct
 ├─ Task ReAct
 ├─ Planning ReAct
 ├─ Search ReAct
 └─ General ReAct
```

这里每个 ReAct 不是简单换一个名字，而是拥有自己独立的：
```text
Prompt
Tool 集合
状态结构
停止条件
输出 Schema
错误处理策略
```

> 这通常会比一个“大杂烩 ReAct”执行质量更高

### 不要拆得太细，目前四类

比如没必要变成：
```
奖学金 ReAct
请假 ReAct
选课 ReAct
就业 ReAct
保研 ReAct
竞赛 ReAct
科研 ReAct
```

> 这样会导致大量重复 Prompt、重复代码和维护成本。

更合理的是按照`执行范式`拆，而不是按照业务名词拆。

#### 1. Knowledge ReAct
```text
政策文档、校内资源
Tools:
- policy_rag
- resource_rag
- 必要时 web_search / fetch
```

#### 2. Search ReAct
```
'''text''''
外部信息与学术资源检索
Tools:
- academic_search
- web_search
- fetch
```

#### 3. Task ReAct
```text
请假、业务办理、查询业务状态等
Tools:
- task tools
- policy_rag
- 必要的信息查询工具
```

#### 4. Planning ReAct
```text
学业规划、职业规划等复杂任务
Tools:
- student/profile
- policy_rag
- resource_rag
- academic_search
- web_search
```

再保留一个非常轻量的：
```
General
→ 普通聊天 / 无需 Tool 的直接回答
```

> tool的规划需要重新确定

## `gen-4`<span style="color: #7950f2">方案拆分原因</span>

### <span style="color: #7950f2">1. Tool Selection 会更稳定</span>

工具越来越多以后，模型每轮都要在很大的动作空间里选 Tool，很容易发生：
```
本该查校内政策 → 去 web_search
本该查校内资源 → 调 policy_rag
已经有页面内容 → 又 search 一遍
只需要问答 → 却开始调用 task tool
```

如果进入 `Policy ReAct` 后，只给它：
```
policy_rag
resource_rag
web_search
fetch
```

它的动作空间明显缩小，Tool Selection 会稳定很多。

### <span style="color: #7950f2">2. 可以写真正定制化的 Prompt</span>

比如 Policy ReAct 可以明确：

> 校内政策知识库是第一权威源；知识库没有足够证据时才允许联网；回答必须基于证据，不得凭模型记忆推断具体校规。

而 Planning ReAct 的提示词完全不一样：

> 优先收集用户目标、当前状态、约束条件；规划过程中允许查询政策、资源和外部信息；最终需要输出目标差距、优先级和阶段计划。

Task ReAct 又会强调：

> 执行前检查必需参数；涉及写操作必须确认；不得根据猜测补全日期、对象、金额等关键字段。

如果全塞进一个 System Prompt，就会变成：
```
如果是政策问题……
如果是规划问题……
如果是 Task……
如果是搜索……
如果……
```

Prompt 很快膨胀，而且大量规则在当前任务中根本无关，会增加模型判断负担。

### <span style="color: #7950f2">3. 不同任务本来就应该有不同的终止条件</span>

政策问答：
```
证据足够
→ Answer
```

搜索任务：
```text
找到足够相关来源
→ Fetch
→ 综合
→ Answer
```

业务办理：
```text
参数完整
→ 风险检查
→ 用户确认
→ Execute
→ 验证结果
→ End
```

规划任务：
```text
信息收集
→ Gap Analysis
→ 形成 Plan
→ 检查约束
→ Answer
```

所以它们虽然都是 ReAct，但实际上是不同状态机。

## 架构设计

> ### ⚠️：gen-4.2 并非 gen-4.1 的迭<span style="font-size: 1em">代升级版本</span>

### 1. `gen-4.1`
```text
                         START
                           ↓
                   Context Builder
                           ↓
                     Orchestrator
                           ↓
       ┌───────────┬───────┼────────────┐
       │           │       │            │
       ↓           ↓       ↓            ↓
   Knowledge     Search   Task       Advisory
    ReAct        ReAct    ReAct       ReAct
       │           │       │            │
       └───────────┴───┬───┴────────────┘
                       ↓
                   Orchestrator
                       ↓
                ┌──────┴──────┐
                ↓             ↓
              Finish       Continue
                ↓             │
              Answer          └──→ Domain ReAct
```

放到 `LangGraph` 里，我建议你把 Orchestrator 理解成一个`“父图”`，而 Knowledge / Search / Task / Advisory 这些领域 ReAct 都做成独立的`“子图”`。

- `Orchestrator` 负责“拆什么任务、任务之间什么依赖、交给哪个领域 Agent、什么时候继续/重规划”；
- 具体 Tool 怎么调用，由各`领域 ReAct` 自己决定。

> Orchestrator 可以通过 `Command` 路由到单个 Agent，也可以通过 `Send` 动态派发多个 Agent，<u style="text-decoration-color: rgb(230, 57, 70)">通过</u>`共享 State` <u style="text-decoration-color: rgb(230, 57, 70)">汇总结果</u>。LangGraph 当前就是提供这些机制来实现<u style="text-decoration-color: rgb(230, 57, 70)">动态控制流</u>和 <u style="text-decoration-color: rgb(230, 57, 70)">worker fan-out</u>。

---

`gen-4.1`的优点是非常灵活。

Orchestrator 可以根据前一个 Agent 的实际执行结果，动态决定下一步调用谁。例如用户问“我能不能保研，如果不行应该找什么工作”，第一次可能先调用 Knowledge 获取学校政策，再根据结果调用 Advisory；如果发现用户信息不足，还能临时调用其他能力。因此 <u style="text-decoration-color: rgb(230, 57, 70)">gen-4.1 对于**任务路径无法提前确定、执行过程中不断产生新信息的开放式长任务**是有意义的</u>。它实际上把 Orchestrator 当成了整个系统的高层 ReAct Agent，每执行一步都重新观察环境，然后决定下一步动作。

但问题也恰恰出现在这里：你下面的四个 Domain Agent 本身已经是 ReAct。如果 Search ReAct 内部已经负责“搜索 → 阅读 → 判断证据够不够 → 不够继续搜索 → 验收退出”，那么它完成之后，外层 Orchestrator 再进行一次“这个结果够不够、还要不要继续”的判断，就容易形成**双层验收机制**。比如 Search Agent 自己判断搜索结果已经充分并退出，Orchestrator 拿到结果以后又觉得“不太够”，再次调用 Search；Search 又重新进入自己的 Loop。这不仅增加 LLM 调用次数和延迟，<u style="text-decoration-color: rgb(230, 57, 70)">还可能导致职责边界模糊：到底谁负责判断 Search 任务是否完成？Domain Agent 还是 Orchestrator？</u>

更麻烦的是，<span style="background-color: rgb(255, 243, 205)">大循环会让系统行为越来越难预测</span>。假设：
```
Orchestrator
   ↓
Knowledge
   ↓
Orchestrator
   ↓
Search
   ↓
Orchestrator
   ↓
Knowledge
   ↓
Orchestrator
```

理论上这是灵活，工程上却意味着你还要额外设计 `max_iterations`、重复任务检测、循环退出、状态污染控制、上下文压缩等机制，否则很容易出现 Agent Ping-Pong。

随着 Domain Agent 数量增加，外层循环的状态空间也会迅速扩大。换句话说，gen-4.1 在获得动态性的同时，也把很多本来已经封装到 Subgraph 内部的复杂度又重新暴露给了父图。

### 2. `gen-4.2`

> Orchestrator 仅进行一次编排
```
START
  ↓
Context Builder
  ↓
Orchestrator
  │
  │  一次性完成：
  │  - 判断需要哪些领域能力
  │  - 拆解复杂任务
  │  - 建立任务依赖
  │  - 派发任务
  ↓
┌─────────┬─────────┬─────────┬─────────┐
│         │         │         │
Knowledge Search    Task     Advisory
 ReAct     ReAct    ReAct      ReAct
│         │         │          │
└─────────┴─────────┴──────────┘
              ↓
        Result Aggregator
              ↓
         Answer Generator
              ↓
             END
```

而 gen-4.2 的职责划分更加清晰。Orchestrator 首次拿到用户任务以后，不负责一步一步“走着看”，而是先产生一个`结构化任务计划`，例如用户说：

> 我想保研，帮我规划未来半年。

Orchestrator 可以一次生成：
```
T1 Knowledge：
查询保研政策、时间节点、资格要求

T2 Advisory：
结合用户背景评估当前差距
依赖：T1

T3 Search：
查找近期夏令营/预推免信息
依赖：T1

T4 Advisory：
综合 T1/T2/T3 制定半年计划
依赖：T1,T2,T3
```

这时候真正执行的是一个**任务 DAG**：
```
                  T1 Knowledge
                 /            \
                ↓              ↓
        T2 Advisory        T3 Search
                \              /
                 ↓            ↓
                  T4 Advisory
                       ↓
                 Result Aggregator
                       ↓
                 Answer Generator
```

<u style="text-decoration-color: #e63946">这样 Orchestrator 的职责就变成了真正意义上的“编排”：**拆任务、定义依赖、选择 Domain、定义预期输出**</u>；至于每一个任务内部到底调用几次 Tool、什么时候重试、什么情况下退出，都由对应 Domain ReAct 自己解决。

我认为这和 Subgraph 的设计也更加一致。父图应该关注：
```
任务级控制
跨领域依赖
Domain 路由
结果汇总
```

子图关注：
```
领域内部推理
工具选择
局部重试
局部验收
退出条件
```

因此 gen-4.2 实际上形成了非常明确的两级控制边界：
```
Orchestrator
解决：
“要完成哪些任务？”

Domain ReAct
解决：
“这个任务怎么完成？”
```

而 gen-4.1 容易变成：
```
Orchestrator：
这个任务怎么完成下一步？

Domain ReAct：
这个任务怎么完成下一步？
```

两层都在进行类似的动态决策，所以才会显得冗余。

不过，我不建议把 gen-4.2 做成绝对意义上的“一次编排之后 Orchestrator 永远不再出现”。因为一次规划无法保证永远正确。例如 Knowledge Agent 返回：
```
缺少用户 GPA，无法判断保研资格
```

或者 Search Agent 返回：
```
未找到可靠信息
```

这时如果直接进入 Answer Generator，可能只能输出一个残缺结果。

### 3、`gen-4.3`

> 在 Aggregator 后加一个**轻量级全局验收节点**：正常路径只规划一次，只有<u style="text-decoration-color: #e63946">计划真正失败或者出现信息缺口时</u>，才触发一次有限的 Replan。
```
START
  ↓
Context Builder
  ↓
Orchestrator
  ↓
Task DAG
  ↓
Domain ReAct Subgraphs
  ↓
Result Aggregator
  ↓
Global Validator
  ├── Pass → Answer Generator
  │
  └── Fail → Replanner
              ↓
          补充执行一次
              ↓
        Result Aggregator
              ↓
        Answer Generator
```
```
正常情况：
Plan → Execute → Aggregate → Answer

异常情况：
Plan → Execute → Validate
                  ↓ fail
                Replan
                  ↓
              Execute Patch
                  ↓
                Answer
```

这实际上更接近生产系统的设计思想：`正常路径确定化，异常路径智能化`**。**

这会更符合你现在“Orchestrator + 四个 Domain ReAct Subgraph”的架构，因为 \*\*Domain ReAct 已经负责局部自治，<u style="text-decoration-color: rgb(230, 57, 70)">父层就没有必要再用一个高频大循环重复干预</u>；父层真正应该保留的是跨领域任务规划、依赖管理和异常情况下的全局纠偏。\*\*这也是我认为 gen-4.2 相比 gen-4.1 最实质的架构进步。



<!-- created: 2026-08-11 16:54:54 -->
<!-- updated: 2026-08-28 09:48:00 -->