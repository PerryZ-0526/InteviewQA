# LangGraph 编排图-实时对话

## 方案变迁
```
plan-and-execute范式
        ↓
plan-and-execute + ReAct子图
        ↓
ReAct范式 + tools
        ↓
将不同类型的任务，封装成独立的ReAct loop子图，每个子图中定制化prompt
```

> <span style="font-size: 12pt">我们最开始考虑过统一 ReAct，让模型在所有 Tool 中自由选择，但随着能力增加会出现工具空间过大、Prompt 规则互相干扰、终止条件不统一的问题。所以后来更倾向于做</span><span style="font-size: 12pt; background-color: rgb(255, 243, 205)">分层 Agent</span><span style="font-size: 12pt">：先由轻量 Router 判断执行范式，再进入</span> `Policy`<span style="font-size: 12pt">、</span>`Search`<span style="font-size: 12pt">、</span>`Task`<span style="font-size: 12pt">、</span>`Planning` <span style="font-size: 12pt">等</span>`定制化 ReAct`<span style="font-size: 12pt">。每个 ReAct 有自己的 Prompt、核心 Tool 集、状态和终止条件，同时保留必要的</span>`跨域工具`<span style="font-size: 12pt">。简单任务直接在单个 ReAct 中完成，</span><span style="font-size: 12pt; background-color: rgb(255, 243, 205)">复杂任务则编排多个领域 Agent</span><span style="font-size: 12pt">。这样本质上是</span><span style="font-size: 12pt; background-color: rgb(255, 243, 205)">用路由降低决策空间</span><span style="font-size: 12pt">，用专业化 Prompt 提高单任务执行质量。</span>

## `gen-4`方案
```
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
```
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
```
政策文档、校内资源
Tools:
- policy_rag
- resource_rag
- 必要时 web_search / fetch
```

#### 2. Search ReAct
```
外部信息与学术资源检索
Tools:
- academic_search
- web_search
- fetch
```

#### 3. Task ReAct
```
请假、业务办理、查询业务状态等
Tools:
- task tools
- policy_rag
- 必要的信息查询工具
```

#### 4. Planning ReAct
```
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
```
找到足够相关来源
→ Fetch
→ 综合
→ Answer
```

业务办理：
```
参数完整
→ 风险检查
→ 用户确认
→ Execute
→ 验证结果
→ End
```

规划任务：
```
信息收集
→ Gap Analysis
→ 形成 Plan
→ 检查约束
→ Answer
```

所以它们虽然都是 ReAct，但实际上是不同状态机。

## 架构设计

### 1. `gen-4.1`
```
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

> Orchestrator 可以通过 `Command` 路由到单个 Agent，也可以通过 `Send` 动态派发多个 Agent，<u style="text-decoration-color: rgb(230, 57, 70)">通过</u>`共享 State` <u style="text-decoration-color: rgb(230, 57, 70)">汇总结果</u>。
>
> LangGraph 当前就是提供这些机制来实现动态控制流和 worker fan-out。

#### Orchestrator 第一步：先生成“任务计划”，不是生成最终答案

例如：我想要保研，帮我制定一下未来半年的规划

### 2. `gen-4.2`
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



<!-- created: 2026-08-11 16:54:54 -->
<!-- updated: 2026-08-21 17:38:21 -->