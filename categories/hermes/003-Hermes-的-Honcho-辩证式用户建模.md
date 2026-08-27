# Hermes 的 Honcho 辩证式用户建模

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [Hermes的自主技能创建与改进](Hermes的自主技能创建与改进) | [Hermes 的程序化工具调用](Hermes 的程序化工具调用) →

## 面试直接答

我对 Hermes 里 Honcho 的理解是，它并不是传统意义上的“长期记忆库”，而是一套更偏用户建模的机制。普通 Memory 解决的是“用户过去说过什么、哪些事实值得长期保存”，而 Honcho 进一步解决的是“基于长期交互，我对这个用户形成了什么持续性的理解”。从源码链路来看，Hermes 会把用户和 Agent 分别建模成两个 Peer，也就是 User Peer 和 AI Peer，其中 User Peer 可以跨 Session 保持稳定，因此不同会话里的交互可以持续积累到同一个用户模型中。每轮对话结束后，Hermes 的 MemoryManager 会通过 `sync_turn()` 把 user message 和 assistant response 同步到 Honcho Session，所以它观察的并不是单边的用户输入，而是完整的互动过程，包括 Agent 怎么回答、用户是否纠正、后续行为是否验证了之前的判断。这样做的意义在于，有些偏好用户并不会直接说出来，比如用户连续多次要求“回答不要太长”，Honcho 就可以从多轮交互中形成“这个用户更偏好高信息密度、简洁的技术解释”这样的长期 Representation，而不是只保存某一句原话。再往上一层，Honcho 会把这些信息组织成不同层次，包括原始消息、Session Summary、Peer Card、Representation 和 Conclusions。Peer Card 更接近稳定事实，例如用户的长期偏好或背景信息；Representation 更像动态画像，是系统根据长期行为形成的综合理解；Conclusions 则是从历史证据中推导出的结论。Hermes 真正比较有特点的地方是它还接入了 Honcho 的 Dialectic，也就是辩证式推理机制。这里的“辩证”不是简单做一次历史摘要，而是由 Honcho 后端的 LLM 围绕某个关于用户的问题进行多轮审视，例如先形成一个判断，再检查这个判断有没有遗漏、有没有相反证据，最后对冲突信息进行综合。因此它不是简单的“历史消息检索 → TopK → 塞回上下文”，而更接近“基于长期证据维护一个持续更新的用户假设”。当然，这种推理成本比较高，所以 Hermes 在工程上把它拆成两层，第一层是比较便宜的 Base Context，通过 `peer.context()` 获取 summary、representation、peer card 等内容，可以比较频繁地刷新；第二层才是通过 `peer.chat()` 做 Dialectic Reasoning，而且由 `dialecticCadence` 控制触发频率，并不会每轮都额外调用一次 LLM。下一轮用户请求到来时，Hermes 会通过 `get_prefetch_context()` 获取与当前问题相关的 Session Summary、User Representation、Peer Card 等信息，并把当前 query 作为检索条件，避免把整个用户画像无脑塞进 Prompt。例如用户这次问的是 Agent 面试题，那么真正有用的可能只是“偏好简洁回答、重视源码细节、答案要适合面试表达”，而不是所有历史信息。除此之外，Agent 还可以主动调用 `honcho_profile`、`honcho_search`、`honcho_context`、`honcho_reasoning` 和 `honcho_conclude`，其中 `honcho_conclude` 可以直接把明确事实沉淀进去，而 `honcho_reasoning` 则用于需要更深层用户理解的场景。所以我认为 Honcho 和普通 Memory 最大的区别在于，Memory 更偏事实存储和召回，回答的是“用户以前说过什么”；Honcho 更偏持续的用户模型，回答的是“结合长期互动，这个用户通常是什么偏好、为什么会这样、当前问题下哪些长期信息最相关”。它本质上是在 Agent 外面再维护一个动态的 User Model，让跨会话个性化不再只依赖简单的记忆检索。

## 详细解析

根据当前 Hermes 源码，Honcho 这套东西可以理解成：**把“历史对话”持续加工成一个动态用户模型，再在每次新对话前把与当前问题相关的部分取回来。** 它不是简单的“记住一句话”。

完整链路大致是：
```text
用户/Agent 对话
      ↓
每轮结束后同步 user + assistant 消息
      ↓
Honcho Session
      ↓
User Peer + AI Peer 持续观察对话
      ↓
形成
├─ 原始历史消息
├─ Peer Card：稳定事实
├─ Representation：对用户的动态画像
├─ Conclusions：推导出的长期结论
└─ Session Summary：当前会话摘要
      ↓
下一轮用户提问
      ↓
Hermes 向 Honcho 取相关画像
      +
周期性触发 Dialectic 推理
      ↓
注入当前 LLM 上下文
      ↓
Hermes 根据“对这个人的长期理解”回答
```

### 1. 首先，它把“人”和“Agent”建模成两个 Peer

初始化 Honcho session 时，Hermes 会创建：
```text
User Peer       → 用户
AI Peer         → 当前 Hermes profile
```

而且 User Peer 是可以跨 session 保持稳定的。例如你的 Telegram、CLI 等身份可以映射到同一个 `peerName`，因此不同会话里的交互最终积累到同一个用户模型里。不同 Hermes profile 又可以拥有不同 `aiPeer`，所以“编程助手怎么看你”和“个人助手怎么看你”可以不同。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/plugins/memory/honcho/session.py?utm_source=chatgpt.com "hermes-agent/plugins/memory/honcho/session.py at main · NousResearch/hermes-agent · GitHub"))

这就是它能做到**跨会话用户画像**的基础。

### 2. 每轮对话都会成为 Honcho 的观察材料

每轮完成之后，Hermes 的 MemoryManager 会调用 memory provider 的 `sync_turn()`。

Honcho 内部把：
```text
user message
assistant response
```

先放进 `HonchoSession.messages`，再按照 `writeFrequency` 写入 Honcho。默认：
```text
saveMessages = true
writeFrequency = async
```

也就是默认后台异步写，不阻塞主 Agent。也可以配置每轮同步、每 N 轮或者 session 结束统一写。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/plugins/memory/honcho/session.py?utm_source=chatgpt.com "hermes-agent/plugins/memory/honcho/session.py at main · NousResearch/hermes-agent · GitHub"))

所以 Honcho 看到的不是单纯“用户说了什么”，还包括**Agent 怎么回复、用户后来如何反应**。

这对用户建模很重要。例如：
```text
Agent：给出 2000 字解释
用户：太长了，精炼一点

Agent：下一次给 5 句话
用户：这样就可以
```

相比只记：

> 用户说“喜欢简短回答”

Honcho 可以从连续交互中推断出：

> 用户倾向简洁、技术密度高的解释，并会主动纠正过度展开的回复。

后者就是所谓的 `representation / conclusion` 层面。

### 3. “观察”是可配置的

源码通过 `SessionPeerConfig` 给两个 Peer 分别设置：
```text
observe_me
observe_others
```

默认 `directional` 模式下基本是双向观察：
```text
User Peer：观察自己 + 对方
AI Peer：  观察自己 + 对方
```

因此 AI Peer 不只是看用户说过什么，而是可以基于**完整互动关系**形成“我对这个用户的理解”。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/plugins/memory/honcho/session.py?utm_source=chatgpt.com "hermes-agent/plugins/memory/honcho/session.py at main · NousResearch/hermes-agent · GitHub"))

这也是“辩证式”比普通 KV memory 多的一层。

### 4. 真正的“辩证推理”由 Honcho 后端 LLM 完成

Hermes 本身并没有在 Python 代码里实现一套“人格分析算法”。

它实际调用的是：
```python
ai_peer.chat(
    query,
    target=user_peer_id,
    reasoning_level=...
)
```

也就是：

> 让 AI Peer 基于它长期观察到的 User Peer 信息，回答一个关于用户的问题。

例如 Hermes 可以问：
```text
“这个用户通常希望怎样接收技术解释？”
```

Honcho 后端会综合历史消息、已有 representation、conclusions 等进行推理，然后给 Hermes 一个综合结论。源码把这个封装成 `dialectic_query()`。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/plugins/memory/honcho/session.py "hermes-agent/plugins/memory/honcho/session.py at main · NousResearch/hermes-agent · GitHub"))

因此这里一定要注意边界：

**Hermes 负责什么时候调用、问什么、结果怎么注入；真正的用户模型推理是在 Honcho 后端完成的。**

### 5. 为什么叫“辩证式”

因为它不是一次 LLM 总结完就结束，而可以设置：
```text
dialecticDepth = 1~3
```

官方现在描述的多轮逻辑大致是：
```text
第 0 轮：
形成当前判断

第 1 轮：
自我审计
→ 前面的判断有没有遗漏？
→ 有没有新的历史证据？

第 2 轮：
调和
→ 前几轮是否矛盾？
→ 综合出最终结论
```

并且有 cold start / warm start 区别：
```text
冷启动：
“关于这个用户，我总体知道什么？”

热启动：
“结合当前这次对话，现在最相关的用户信息是什么？”
```

所以它强调的是：

**观察 → 假设 → 再审视 → 处理矛盾 → 综合结论。**

而不是普通 RAG 的：
```text
query → topK 历史消息
```

([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/honcho.md?utm_source=chatgpt.com "hermes-agent/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/honcho.md at main · NousResearch/hermes-agent · GitHub"))

### 6. 但不会每一轮都跑昂贵的辩证 LLM

这是源码里比较工程化的一点。

Honcho 分成两层：
```text
Layer 1：Base Context
peer.context()
→ summary
→ representation
→ peer card

Layer 2：Dialectic Supplement
peer.chat()
→ LLM 深层推理结果
```

第一层便宜，可以频繁刷新；第二层贵，所以有：
```text
contextCadence
dialecticCadence
```

当前默认 `dialecticCadence = 2`，即大致每两轮才跑一次辩证推理；还会跳过特别短的 trivial prompt。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/honcho.md?utm_source=chatgpt.com "hermes-agent/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/honcho.md at main · NousResearch/hermes-agent · GitHub"))

这跟你前面说的 memory nudge 思想其实类似：**不是所有轮次都值得花一次额外 LLM。**

### 7. 下一轮到底给 Hermes 注入什么

源码 `get_prefetch_context()` 会拉：
```text
Session Summary
User Representation
User Peer Card
AI Self-Representation
AI Identity Card
```

而且当前用户消息会作为 `search_query`，让 Honcho 优先取**和当前话题相关的结论**，而不是把整个画像全塞进上下文。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/plugins/memory/honcho/session.py "hermes-agent/plugins/memory/honcho/session.py at main · NousResearch/hermes-agent · GitHub"))

例如用户突然问：

> “帮我准备 Agent 面试题。”

Honcho 没必要把“用户喜欢什么操作系统”拿回来，而可能返回：
```text
用户偏好：
- 回答简洁
- 偏技术细节
- 面试答案不能过长
- 经常讨论 Agent 架构
```

然后 Hermes 再根据这些信息回答。

### 8. Honcho 有 5 个工具，Agent 也可以主动查询

除了自动注入，还可以主动调用：

- `honcho_profile`：直接读 Peer Card，不跑 LLM；
- `honcho_search`：搜历史原文；
- `honcho_context`：拿当前完整画像快照；
- `honcho_reasoning`：让 Honcho LLM 做一次深层综合推理；
- `honcho_conclude`：显式写入一个长期事实。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-honcho.md?utm_source=chatgpt.com "hermes-agent/website/docs/user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-honcho.md at main · NousResearch/hermes-agent · GitHub"))

例如用户明确说：

> “以后回答我尽量精炼。”

就不一定要等 Honcho 自己推断，可以直接：
```text
honcho_conclude(
    "User prefers concise technical explanations."
)
```

这是**显式事实**；而 Representation 更偏向**从长期行为里推断出来的模型**。

---

所以你文档里这句话：

> “Honcho 辩证式用户建模：跨会话构建对用户的长期理解。”

更精确地展开就是：

> **Hermes 持续把用户与 Agent 的双向交互同步给 Honcho；Honcho 以稳定的 User Peer 为中心积累跨会话消息、事实和用户表示，并周期性通过 LLM 对这些证据进行多轮审视和综合；Hermes 在每轮推理前再根据当前问题检索相关的用户表示、画像卡片和辩证结论，注入当前上下文。**

它和普通长期记忆最核心的区别就是：

**普通 Memory 更偏“用户说过什么”；Honcho 进一步尝试回答“根据长期交互，这个用户是怎样的人、通常想要什么”。**

<!-- created: 2026-08-24 10:28:44 -->
<!-- updated: 2026-08-24 17:10:51 -->
