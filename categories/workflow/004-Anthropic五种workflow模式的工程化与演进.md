# Anthropic 五种 workflow 模式的工程化与演进

## 题目

Anthropic 提出过五种 workflow 模式（prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer），逐个谈谈它们的工程实现，以及它们在 agent 时代的演变。

## 标签

[Workflow](../../tags/Workflow.md) | [Agent](../../tags/Agent.md) | [LLM](../../tags/LLM.md)

## 题目导航

← [003-确定性workflow在agent时代还剩下什么位置](003-确定性workflow在agent时代还剩下什么位置.md) | [005-evaluator-optimizer模式的工程实现](005-evaluator-optimizer模式的工程实现.md) →

## 面试直接答

> 五种模式是 Anthropic 2024 年 12 月《Building effective agents》给出的确定性编排工具箱，共同前提是「控制流图能在模型运行前画出来」，每种模式都只有 10 到 15 行代码的量级；到 2026 年它们没有消失而是分化——简单模式内化为模型行为或单次调用，复杂模式演化为 agent 的基础设施，答题框架应是「原始定义 → 失败模式 → 今天在哪」。

先讲最直白的两个。prompt chaining 是线性管道，一次调用的输出作为下一次的输入，典型例子是文档生成——大纲、正文、审校串成三步，步骤之间可以加程序化闸门，比如正文长度不合格就拦下。它的失败模式是错误累积：上游偏差被下游放大，链越长可靠性越低；成本结构是步数乘以单次调用成本，延迟是各步之和。它今天的处境最有代表性：模型能力提升后，多数「大纲到成文」的链条用单次调用就能完成，chaining 退到了必须有中间人工检查点或步骤间输入输出契约严格的场景，也就是数据流水线——RAG 预处理里的切分、清洗、嵌入、入库。routing 是分类器分流，先让一个 LLM 判断输入类别，再交给对应下游处理器，适合类别差异大的场景，比如客服工单分流到账单、技术、退款三个专员。它的失败模式是分类错误导致全链路走错，且分类器本身也是一次 token 支出；它今天的演变最精彩——从「业务路由」演化为「模型路由」：用便宜快速的模型做分类与反思，强模型只处理关键生成，这正是现在成本优化的主线（详见 agent 分类的成本题），同时 agent 内部模型自主选择工具路径，本质就是 routing 的内化。

parallelization 有两种形态。sectioning 是把任务切片并行处理再聚合，比如同时开三个子任务查资料；voting 是同一个提示跑多次取多数或综合，用于需要多视角判断的高风险决策。失败模式集中在聚合环节：聚合器成为单点瓶颈，voting 在模型错误高度相关时「多数」也是错的——同一个模型对同一问题的错误倾向相似，多数票不提供独立证据。成本上是 N 倍调用换墙钟时间，token 总量不减反增。它今天的演变是成为框架内置能力：DeepSeek Harness 的事件系统有 parallel 分发模式，pi 的工具执行默认并行、结果按完成顺序回传，模型在一个 loop 里同时发起多个独立工具调用就是 sectioning 的自然形态；voting 则内化为多数采样与自一致性——推理模型多次采样取一致答案。

orchestrator-workers 是编排者动态分解任务、派发给 worker、汇总结果，但编排者不无限循环，控制流图仍然固定。它的失败模式是编排者单点：分解粒度失衡（太细则派发开销大，太粗则 worker 完不成）、汇总时丢信息。它今天的演变最彻底——worker 从「一次性 LLM 调用」升级为「完整子 agent」：Claude Code 的子智能体用隔离上下文完成子任务只回传结论，Hermes 的子代理并行工作流，dsh 的 subagent 插件，都是这个模式在 agent 时代的形态。区别在于今天的编排者可以是主 agent 的模型决策，而 2024 年的编排者必须是工程师画的固定循环。

evaluator-optimizer 是生成-评估迭代，一个 LLM 生成、另一个评估，迭代到评估通过，评估标准越客观越有效——代码任务用单测和编译结果，写作任务用审稿标准。失败模式是评测器本身不可靠：评测器被生成器讨好、评估标准漂移、迭代不收敛；成本是生成加评估乘以轮数，是最贵的模式。它今天的演变一分为二：任务侧的迭代内化为 agent 的 test-driven loop——coding agent 跑测试、看失败、改代码的循环就是它；基础设施侧的 LLM-as-judge 沉淀为评测管线，成为 agent 轨迹评估的事实标准。这道题我单独展开讲，见本分类 005 题。

总结来说，五种模式的共同命运是「模式过时、机制留存」：chaining 和 routing 内化为模型行为与模型分级路由，parallelization 成为框架的并行工具执行，orchestrator-workers 演化为子智能体委派，evaluator-optimizer 分裂为 test-driven loop 与评测基础设施。面试里逐模式讲「原始定义、失败模式、今天在哪」三段，既展示了概念功底，又接上了本分类 002 题的收敛叙事。

## 详细解析

> 公开信息核验日期：2026-08-16。模式定义基于 Anthropic《Building effective agents》；演变部分基于本分类 002/003 题已核验的各框架机制（dsh 事件系统、pi 工具执行、Claude Code 子智能体）。

### 一、五模式总览与 2026 位置

| 模式 | 原始定位 | 失败模式 | 成本结构 | 2026 演化位置 |
|---|---|---|---|---|
| prompt chaining | 线性管道，可加闸门 | 错误累积、单点卡死 | 步数 × 调用 | 数据流水线（RAG 预处理、ETL） |
| routing | 分类器分流 | 分类错误全链路错 | 分类 + 下游 | 模型分级路由；工具选择的内化 |
| parallelization | sectioning 分片 / voting 投票 | 聚合单点；错误相关时多数无效 | N 倍 token 换墙钟 | 框架并行工具执行；多数采样自一致性 |
| orchestrator-workers | 固定编排者动态派发 | 编排者单点、粒度失衡 | 1 + N | 子智能体委派（CC subagents、dsh subagent） |
| evaluator-optimizer | 生成-评估迭代 | 评测器不可靠、不收敛 | (生成+评估) × 轮数 | test-driven loop + LLM-as-judge 评测管线 |

### 二、最小实现示意（LangGraph 风格）

```python
# routing：分类器决定下游路径
def route(state):
    return state["category"]   # 返回下游节点名

builder.add_conditional_edges("classifier", route, {
    "billing": "billing_agent",
    "tech": "tech_agent",
    "refund": "refund_agent",
})

# evaluator-optimizer：生成-评估迭代（显式收敛条件）
for _ in range(max_rounds):
    draft = model.generate(task)
    verdict = judge.evaluate(draft, rubric)   # judge 与 generator 隔离
    if verdict.passed:
        break
    draft = model.revise(draft, verdict.feedback)
```

两个细节：条件边把「路由决策」固化在代码里——这正是 workflow 的定义性特征；迭代循环必须有 max_rounds——没有显式收敛条件的 evaluator loop 就是死循环隐患。

### 三、面试追问

**追问一：什么时候用 routing 而不是 chaining？**

判断标准是任务之间的依赖关系与类别差异。同一输入的所有步骤按固定顺序都要执行，用 chaining——步骤之间有数据依赖，任何分流都会丢信息。输入之间类别差异大、不同类别需要完全不同的处理路径，用 routing——把差异大的任务混在一条链上，每一步都要兼容所有类别，提示词和闸门复杂度爆炸。实际工程中两者常嵌套：先 routing 分流，每个分支内部再用 chaining 走各自的线性步骤。反面教材是把「风格略有差异但步骤相同」的任务拆成多个路由分支，白付分类成本还引入分类错误的失败面。

**追问二：orchestrator-workers 和 Multi-Agent 系统（多智能体协作）的边界在哪？**

控制流图的归属。orchestrator-workers 的编排者是固定循环，分解逻辑可以交给 LLM，但「派发、收集、汇总」的骨架是工程师画的——Anthropic 特意强调编排者不无限循环。Multi-Agent 系统是多个具备自主性的 agent 交互，谁给谁派活、什么时候终止、如何共享记忆都是运行时行为，边界开放得多，失败模式也复杂得多（共享记忆与终止条件，见 mutil-agent 分类的题目）。今天的子智能体委派介于两者之间：主 agent 的派发决策是模型做的，但每个子代理的隔离上下文和生命周期是框架管的——workflow 骨架在，决策权让渡给了模型。

**追问三：voting 在什么情况下会失效？**

错误相关性高的时候。voting 的有效性前提是各票之间提供独立证据——如果同一个模型对同一类问题的错误倾向高度相关（比如都倾向于某一种幻觉模式），多数票只是同一个错误被复制了 N 次。工程对策有两个方向：跨模型投票（不同厂商的模型错误模式差异更大，票更独立）；或者放弃「多数」改看「一致度」——一致性低本身就是一个信号，提示该问题超出模型可靠范围，应当转人工或降级处理，而不是硬取多数。

**追问四：五种模式都被内化或演化之后，显式 workflow 还剩下什么？**

剩下的是 003 题讲的基础设施层四件套：评测管线、审批与合规链、数据流水线、框架内把关链。判断标准也从「流程图能否提前画出」更新为「三问」——是否需要审计重放、分支是否可枚举、失败是否可容忍。一个务实的视角：今天写一个显式 workflow，往往不是因为它能完成任务，而是因为它能证明任务是怎么完成的——确定性、可审计、可复现的价值在 agent 时代反而升值了。

### 四、参考

- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Claude Code 子智能体文档](https://code.claude.com/docs/en/sub-agents)
- [DeepSeek Harness 架构文档（事件分发模式）](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md)
- [pi-agent-core 包文档（工具执行模式）](https://www.npmjs.com/package/@earendil-works/pi-agent-core)

<!-- created: 2026-08-16 04:09:07 -->
<!-- updated: 2026-08-16 04:09:07 -->
