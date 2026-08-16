# evaluator-optimizer 模式的工程实现

## 题目

谈谈 evaluator-optimizer 模式的工程实现：LLM-as-judge 的评测器设计、评分校准、收敛条件，以及评测器被攻破的风险。

## 标签

[Workflow](../../tags/Workflow.md) | [LLM](../../tags/LLM.md) | [效果评估](../../tags/效果评估.md)

## 题目导航

← [004-Anthropic五种workflow模式的工程化与演进](004-Anthropic五种workflow模式的工程化与演进.md) | 无 →

## 面试直接答

> evaluator-optimizer 是生成与评估分离的迭代模式，工程核心不在生成器而在评测器：LLM-as-judge 的可靠性靠结构化 rubric、去偏差校准与外部客观信号兜底，收敛靠显式终止条件与预算，而评测器本身是最大攻击面——它决定了这个模式的效果上限，也必须成为被防护的对象。

评测器设计有三种形态，按可信度排序。程序化 judge 最强：编译、单元测试、正则校验、数值断言，这些是确定性信号，没有模型不确定性。模型 judge 次之：用 LLM 按 rubric 评分或做成对比较，适用于主观维度——相关性、流畅度、风格。混合形态最常见：模型 judge 评主观分，程序化门做硬门槛，任何一票否决。设计模型 judge 有四个要点：rubric 必须可操作化，把「回答质量好」拆成「引用准确、无幻觉、覆盖问题的三个子问」；输出必须结构化，强制分数加理由的 JSON，方便统计与审计；judge 与 generator 必须隔离，不同模型或至少独立上下文，否则就是自评；关键评分要有参考锚点，给出黄金标准示例让 judge 对标。2026 年的一个可靠结论是：推理模型是更强的 judge，指令遵循更好、对抗鲁棒性更高，但仍带偏差，学术界的 PlanJudge 策略——先让 judge 生成显式评估计划再打分——能在保留准确率的同时缓解偏差。

评分校准针对的是 LLM-as-judge 的系统性偏差。位置偏差：成对比较中 judge 系统性偏好第一个候选；长度偏差：冗长回答拿高分；自增强偏差：judge 偏好与自身风格相似的生成；最隐蔽的是「随和偏差」（agreeableness bias）——2025 年一项大规模研究用 14 个前沿模型评判 366 个有 bug 的 Python 程序，judge 们识别正确输出的真阳率超过 96%，但揪出无效输出的真阴率低于 25%，也就是说 judge 倾向给一切东西盖章放行。校准手段分三层：协议层，成对比较双向各评一次、候选顺序随机化、用 Bradley-Terry 模型做位置修正；聚合层，多次采样取分布均值而不是贪心解码的单点，2025 年的工作证明分布校准聚合一致优于取模；锚定层，用少量人工标注（研究显示约 200 人时的五份标注集）回归拟合每个 judge 的真阳率与真阴率，把最大误差从 17.6% 压到 1.2%。持续监控同样必要——judge 的打分行为会随时间漂移。

收敛条件是工程护栏。必须显式设定：最大轮数防死循环、分数阈值定合格线、连续 N 轮无改进即停止、token 与墙钟预算兜底。最重要的纪律是客观门不可被平均分抵消——编译不过就是不过，单测挂了分数再高也不收敛，这条原则与 Hermes 自进化项目里「约束门独立于奖励」的设计完全一致。同时要警惕收敛方向错误：优化器可能在评测器上过拟合——generator 学会的不是把任务做好，而是讨好这个特定的 judge。

评测器被攻破的风险是这道题的高潮。最经典的机制是 Goodhart 定律：当一个指标成为优化目标，它就不再是好指标——generator 会学会长度灌水、堆砌 rubric 关键词、模仿参考锚点的表面特征。随和偏差则让 judge 变成橡皮图章，无效输出照样放行，上面的真阴率 25% 就是证据。防护措施四件：judge 与 generator 隔离，防止评测标准泄漏进生成上下文；客观信号优先，能程序化验证的维度不交给模型 judge；对评测器做红队，构造对抗样本检验 judge 的拒绝能力；保留独立测试集，反复在同一评测集上迭代本身就是污染——这几点与 hermes 分类 001 题讲的评测设计完全同构。演变到今天，evaluator-optimizer 一分为二：任务侧的迭代内化为 agent 的 test-driven loop——coding agent 跑测试、读失败、改代码，评测器换成了真实环境；基础设施侧，LLM-as-judge 成为 agent 轨迹评估的事实标准，评的不再是单个输出而是整个工具调用轨迹的合理性。总结来说，这个模式的本质从来不是「迭代」而是「评测」：谁能把 judge 校准得更可信，谁就拥有这个模式的上限。

## 详细解析

> 公开信息核验日期：2026-08-16。偏差数据与校准方法基于 2025-2026 年公开研究（NUS AICET 大规模偏差研究、EvalEval 2026、ICML 2026、PLOS ONE 2026），模式定义基于 Anthropic《Building effective agents》。

### 一、结构图

```text
            ┌────────────────────────────────────┐
            │  evaluator-optimizer 循环（显式收敛） │
            │                                    │
 generator ──→ draft ──→ judge 评估 ──→ 通过? ──→ 输出
    ↑                        │ 否                  │ 是
    └──── feedback 修订 ←────┘                     │
                                                  ▼
            ┌────────────────────────────────────┐
            │  评测器护栏（judge 之外的第二道防线）   │
            │  · 程序化门：编译/单测/断言（一票否决） │
            │  · 预算：max_rounds / token / 墙钟    │
            │  · 独立测试集（不参与迭代调参）         │
            └────────────────────────────────────┘
```

### 二、三种 judge 形态对比

| 形态 | 信号类型 | 可信度 | 适用维度 | 失败模式 |
|---|---|---|---|---|
| 程序化 judge | 确定性 | 最高 | 正确性、格式、约束 | 覆盖不到的语义错误 |
| 模型 judge | 概率性 | 中，依赖校准 | 相关性、流畅度、风格 | 位置/长度/自增强/随和偏差 |
| 混合 judge | 分层 | 高 | 主观分 + 客观门 | 门与分的设计耦合不当 |

### 三、已知偏差与对策

| 偏差 | 表现 | 对策 |
|---|---|---|
| 位置偏差 | 成对比较偏好第一个候选 | 双向交换各评一次；顺序随机化；Bradley-Terry 位置修正 |
| 长度偏差 | 冗长回答高分 | rubric 显式惩罚冗余；长度归一化 |
| 自增强偏差 | 偏好与自身风格相似的输出 | judge 与 generator 用不同模型；锚点示例多样化 |
| 随和偏差 | 无效输出也放行（TNR < 25%） | 少数否决策略（≥4/14 judge 异议即判无效）；回归校准真阳/真阴率 |
| 时间漂移 | 打分行为随时间变化 | 固定锚点集周期重测；监控与人工一致性 |

### 四、最小实现示意

```python
def evaluator_optimizer(task, max_rounds=5, budget_tokens=50_000):
    draft = generator.generate(task)
    for round_no in range(max_rounds):
        verdict = judge.evaluate(draft, rubric, anchors)   # 结构化输出：分数+理由
        if verdict["score"] >= PASS_THRESHOLD and hard_gates(draft):  # 客观门一票否决
            return draft
        if round_no > 1 and verdict["score"] <= best_score:
            break                                            # 连续无改进停止
        draft = generator.revise(draft, verdict["critique"])
    raise BudgetExceeded("未收敛：转人工或降级处理")
```

注意两个工程细节：judge 返回结构化结果而不是自由文本，收敛判断才可编程；连续无改进停止防止在评测器的噪声里空转。

### 五、面试追问

**追问一：为什么说评测器决定了这个模式的上限？**

因为优化器的梯度全部来自评测器的信号。judge 把「任务做好」映射成分数，如果映射失真——漏判错误（随和偏差）或偏好表面特征（长度偏差）——generator 优化的就是失真的目标，迭代越久离真实任务越远。程序化 judge 失真最小，所以上限最高；纯模型 judge 的失真需要用校准修正，校准质量直接成为上限。这也是为什么「评测器被攻破」的防护优先级高于「生成器调优」：先证明 judge 可信，再谈优化。

**追问二：位置偏差具体怎么消除？**

成对比较中把 (A, B) 和 (B, A) 各评一次，若两次结论一致才计分，不一致则该样本丢弃或人工裁决——这是协议层的直接消除。统计层用 Bradley-Terry 模型把「位置」作为协变量拟合，从胜率中剥离位置效应。工程层最简单的是随机化顺序并保证样本量，让偏差在聚合中对称抵消。注意位置偏差不是固定常数，它随 judge 模型和任务类型变化，所以任何新 judge 上线前都要做一次偏差审计。

**追问三：收敛条件设不好会有什么后果？**

两个方向的失败。太松——阈值过低或轮数过多——generator 在评测器的噪声里空转，token 烧完没有质量提升，且过度迭代让 generator 在 judge 的弱点上过拟合。太紧——阈值过高或预算过小——真实可用的输出被拒，整体任务成功率下降。正确的做法是收敛条件与业务损失挂钩：低风险任务（文案润色）连续无改进就接受当前稿，高风险任务（代码上线）宁可不收敛转人工，而不是机械地跑满轮数。收敛判断还应记录「为何停止」，这个元数据本身就是评测数据。

**追问四：底层模型升级后，judge 要不要跟着换？**

要分开决策。judge 换新模型的收益是判别力更强，代价是评分分布整体漂移——新旧 judge 的分数不可直接比较，历史数据、阈值、校准系数全部失效。正确流程是：固定锚点集上跑新旧 judge 的平行评估，做一致性校验与分数映射，必要时重新拟合校准参数，确认可比后再切换；切换期间新旧并行、新分数只做观察不参与门禁。这条纪律同样适用于 generator 升级——评测体系是版本化的，不是「换个模型就跑」。

### 六、参考

- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Zheng et al.：Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena（2023）](https://arxiv.org/abs/2306.05685)
- [NUS AICET：LLM-as-a-Judge 大规模偏差研究（arXiv:2510.11822，2025）](https://arxiv.org/abs/2510.11822)
- [Huang et al.：Reasoning Model Is Superior LLM-Judge, Yet Suffers from Biases（EvalEval，ACL 2026）](https://aclanthology.org/2026.evaleval-1.13/)
- [Wiese：Human-anchored longitudinal comparison with a bias-calibrated LLM-as-judge（PLOS ONE，2026）](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0339920)

<!-- created: 2026-08-16 04:09:07 -->
<!-- updated: 2026-08-16 04:09:07 -->
