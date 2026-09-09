# Langfuse-Evalution

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [Langfuse-prompt-management](Langfuse-prompt-management) | 无 →

## 面试直接答

Langfuse 的 Evaluation 我一般不会理解成简单的“给大模型答案打分”，而是把它看成围绕 Agent 全生命周期的一套质量评测体系。它最核心的对象其实是 Score，一次用户请求形成一个 Trace，内部的模型调用、RAG 检索、Tool Call、Planner 等形成 Observation，评测结果最终都<u style="text-decoration-color: rgb(230, 57, 70)">以 Score 的形式挂到 Trace、Observation、Session 或 DatasetRun 上</u>。Score 可以是数值、布尔值或者类别，因此既可以表示正确率、相关性，也可以表示工具是否选择正确、任务是否完成。对于现在的 Langfuse v4，线上自动评测已经更加偏向 Observation 级，而不是过去直接给整个 Trace 做 Judge。([Langfuse](https://langfuse.com/docs/evaluation/scores/overview?utm_source=chatgpt.com "LLM Evaluation Scores - Langfuse"))

> [[003-Evalution#详细解析#附-解析：”Score 可以挂到 Trace、Observation、Session 或 DatasetRun 上“]]

### 在开发阶段，我主要使用 Dataset 和 Experiment 做`离线回归测试`

首先把典型请求和线上出现过的 bad case 沉淀成 Dataset，每条数据除了 input 和 expected\_output，还可以在 metadata 中保存期望调用的 Tool、禁止调用的 Tool、任务类型等信息。然后通过 `dataset.run_experiment()` 把同一批测试数据重新跑过整个 Agent。每一个 DatasetItem 都会执行一次 task，也就是实际调用一次 LangGraph Agent，再通过 evaluator 对最终输出和执行轨迹进行评分。比如我可以检查最终回答是否满足要求，也可以比较实际 Tool Call 和 expected\_tools 是否一致；最后再通过 run evaluator 算整个测试集的 task success rate、tool accuracy 等指标。这样修改模型、Prompt、RAG 或 Orchestrator 后，就可以直接比较两个 DatasetRun，而不是靠人工感觉判断哪个版本更好。([Langfuse](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk?utm_source=chatgpt.com "Experiments via SDK - Langfuse"))

### 评测方法上，我会区分确定性评测和语义评测

JSON 是否合法、工具有没有调用错、参数字段是否完整这类问题直接用代码判断，不应该浪费一次 LLM 调用；而 groundedness、helpfulness、回答是否真正解决问题这种很难通过规则判断的指标，则使用 LLM-as-a-Judge。

Langfuse 可以给 Judge 配置 <u style="text-decoration-color: rgb(230, 57, 70)">Prompt、模型和评分标准</u>，并把 Observation 的 input、output、metadata 或 Experiment 的 expected output 映射给 Judge，最终产生 Score 和评分理由。生产环境下又不需要把所有请求都送 Judge，而是通过 Rule 指定环境、Observation 名称以及采样比例，例如只抽取 production 中 10% 的 `answer_generator` 做 groundedness 评测，从而控制评测成本。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge?utm_source=chatgpt.com "LLM-as-a-Judge - Langfuse"))

### 对于 Agent，我认为 Langfuse Evaluation 最大的价值是可以从最终结果继续向内部轨迹下钻

我通常会设计三层指标：最终层看 task success、correctness、groundedness；轨迹层看工具选择、必要工具召回、错误工具调用、冗余调用和重规划次数；单节点层再分别检查 Retriever、Planner、Tool 和 Answer Generator。这样当最终回答错误时，不只是知道“Agent 失败了”，还能够定位到底是检索没召回、Orchestrator 路由错了、Tool 参数错了，还是最后生成阶段产生了幻觉。

最后，我会把生产 Trace 中的失败案例持续加入 Dataset，结合 Annotation Queue 让人工专家形成可信标签，再<u style="text-decoration-color: rgb(230, 57, 70)">用这些标签校准 LLM Judge</u>，逐渐建立稳定的 Regression Set。然后把 Experiment 接入 CI/CD，例如规定 task success 不得低于 90%、tool accuracy 不得低于 95%，低于阈值直接通过 `RegressionError` 阻止 PR 合并。这样 Langfuse 就不只是一个观察 Agent Trace 的日志平台，而是形成了“线上发现问题—人工标注—沉淀 Dataset—离线 Experiment—自动 Evaluation—CI 回归门禁”的完整 Agent 质量闭环。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues?utm_source=chatgpt.com "Annotation Queues - Langfuse"))

## 详细解析

截至 2026 年 9 月，Langfuse 的 Evaluation 已经比较完整。理解它时不要把它等同于“几个评测指标”，它更像一套围绕 LLM/Agent 的评测基础设施：

`Tracing → Score → Dataset → Experiment → Evaluator → Regression Gate`

也就是：先把 Agent 的真实执行过程记录下来，再对执行结果打分；从真实失败案例中构造测试集；修改 Prompt、模型、RAG、Agent 编排之后重新跑测试集；比较不同实验；最终<u style="text-decoration-color: rgb(230, 57, 70)">把关键指标放进 CI/CD，防止效果回退</u>。Langfuse 同时支持线上生产流量评测和上线前离线评测。([Langfuse](https://langfuse.com/docs/evaluation/overview?utm_source=chatgpt.com "Evaluation of LLM Applications - Langfuse"))

---

### 一、先把 Langfuse Evaluation 的几个核心对象搞清楚

Langfuse 中真正统一整个 Evaluation 系统的对象其实是 `Score`。

一次用户请求通常形成一个 Trace，内部的 Planner、LLM 调用、Retriever、Tool Call 等形成多个 Observation。如果是多轮对话，还可以通过 Session 串起来。无论这个评分来自人工、代码、用户点赞还是另一个 LLM，最后都会变成：
```text
Trace / Observation / Session / DatasetRun
                    ↓
                  Score
```

例如：
```text
用户：帮我查询培养方案中的毕业学分要求

Trace
├── orchestrator
├── policy_agent
│   ├── llm
│   ├── rag_retrieval
│   └── rerank
└── answer_generator
```

你完全可以形成这样的评分：
```text
Trace:
    task_success = 1

rag_retrieval:
    context_relevance = 0.91

policy_agent:
    tool_selection_correct = true

answer_generator:
    groundedness = 0.94
    helpfulness = 0.87
```

这也是为什么 Agent Evaluation 不能只看最终答案。Langfuse 官方现在也明确区分最终结果评测、轨迹评测和单步决策评测。([Langfuse](https://langfuse.com/guides/cookbook/example_pydantic_ai_mcp_agent_evaluation?utm_source=chatgpt.com "Agent Evaluation - How to Evaluate LLM Agents (Metrics, Strategies & Examples) - Langfuse"))

Score 目前主要有四种类型：
```text
NUMERIC
0.0 ~ 1.0
例如 relevance=0.87

BOOLEAN
0 / 1
例如 correct_tool=true

CATEGORICAL
correct / partially_correct / incorrect

TEXT
人工审阅意见、问题描述
```

Score 可以<u style="text-decoration-color: rgb(230, 57, 70)">挂</u>到 Trace、Observation、Session 或 DatasetRun 上。([Langfuse](https://langfuse.com/docs/evaluation/scores/overview?utm_source=chatgpt.com "LLM Evaluation Scores - Langfuse"))

### 附-解析：”Score 可以<u style="text-decoration-color: rgb(230, 57, 70)">挂</u>到 Trace、Observation、Session 或 DatasetRun 上“

> 这句话的意思是：Langfuse 的 `Score` 不只是评价“最终回答好不好”，而是可以<u style="text-decoration-color: #e63946">根据你想评测的粒度，挂在不同层级的对象</u>上。一个 Score 每次只关联其中一个对象。([Langfuse](https://langfuse.com/docs/evaluation/scores/data-model?utm_source=chatgpt.com "Data Model - Langfuse"))
>
> 比如用户问一次“帮我查一下研究生毕业学分要求”，这一整次请求对应一个 `Trace`。如果你给这个 Trace 挂一个 `task_success=1`，表示你评价的是“这一次端到端任务整体是否成功”。这是最常见的用法。([Langfuse](https://langfuse.com/docs/evaluation/scores/overview?utm_source=chatgpt.com "LLM Evaluation Scores - Langfuse"))
>
> 但一个 Trace 内部通常还有很多步骤，也就是 `Observation`，例如：
>
> ```text
> Trace：用户一次请求
> │
> ├── Observation：Orchestrator 决策
> ├── Observation：RAG 检索
> ├── Observation：Tool Call
> └── Observation：最终 LLM 生成
> ```
>
> 这时候<u style="text-decoration-color: #e63946">可以分别给某个 Observation 打分</u>。例如：
>
> - 给 RAG 检索挂：context\_relevance = 0.91；表示“这一次检索结果质量怎么样”；
> - 给 Orchestrator 挂：tool\_selection\_correct = true；表示“这一节点有没有选择正确的工具”；
> - 给最终生成节点挂：groundedness = 0.87；表示“最终答案是否忠于检索证据”。
>
> 所以 `Observation-level Score` 主要用于定位 Agent 内部到底哪个环节出了问题。([Langfuse](https://langfuse.com/docs/evaluation/scores/data-model?utm_source=chatgpt.com "Data Model - Langfuse"))
>
> ---
>
> `Session` 则更高一层，它通常包含多次 Trace。例如用户和 Agent 连续聊了十轮：
>
> ```text
> Session：一次完整会话
>
> Trace 1：我想申请博士
> Trace 2：结合我的科研经历分析一下
> Trace 3：哪些导师比较适合我
> Trace 4：那我现在应该补什么能力
> ...
> ```
>
> 你可能发现每一轮单独看都不错，但整场对话存在“反复问已经知道的信息”、“前后建议矛盾”、“忘记用户之前提供的信息”等问题。此时就可以给整个 Session 挂：
>
> ```text
> conversation_quality = 0.82
> ```
>
> 或者：
>
> ```text
> goal_completion = true
> ```
>
> 也就是说 Session Score 评价的是`跨多轮交互的整体质量`，而不是某一次问答。Langfuse 官方也把 Session Score 定义为用于跨多次交互的综合评测。([Langfuse](https://langfuse.com/docs/evaluation/scores/data-model?utm_source=chatgpt.com "Data Model - Langfuse"))
>
> ---
>
> 最后是 `DatasetRun`。它主要用于离线 Experiment。比如你的回归 Dataset 有 200 个测试 case：
>
> ```text
> Dataset：edu-agent-regression
>
> 200 个测试问题
>        ↓
> 使用 Agent v2 全部跑一次
>        ↓
> DatasetRun：agent-v2-experiment
> ```
>
> 每条 case 都可以有自己的：
>
> ```text
> task_success
> tool_accuracy
> groundedness
> ```
>
> 但是你最后还想评价“Agent v2 整体怎么样”，就可以在整个 DatasetRun 上挂：
>
> ```text
> average_task_success = 0.93
> average_tool_accuracy = 0.96
> ```
>
> 这个 Score 表示的是“一整轮实验的总体性能”，而不是某一个请求。Langfuse 官方把这一层用于 Dataset Run 的整体性能评分。([Langfuse](https://langfuse.com/docs/evaluation/scores/data-model?utm_source=chatgpt.com "Data Model - Langfuse"))
>
> 所以可以简单记成：
>
> ```text
> Observation
> 评价一个步骤
> 例如：RAG 召回得对不对
>
> Trace
> 评价一次完整请求
> 例如：这次任务有没有完成
>
> Session
> 评价一次多轮会话
> 例如：整个对话是否连贯、目标是否完成
>
> DatasetRun
> 评价一整轮离线实验
> 例如：Agent v2 在 200 个测试 case 上整体表现如何
> ```
>
> 对于多 Agent 系统尤其重要，因为同一个质量问题可以在不同层级观察。比如最终 `Trace task_success=0`，你继续往下看可能发现是 `RAG Observation relevance=0.2`，而不是 Orchestrator 出错；或者单轮 Trace 都成功，但整个 Session 的 `consistency=0.5`，说明问题出在跨轮记忆。也就是说，Score 挂在哪一层，本质上是在回答一个问题：**“你现在到底是在评价一个执行步骤、一次完整任务、一整段对话，还是一整轮实验？”**

这里还有一个当前版本非常重要的变化：Langfuse v4 正在转向以 Observation 为中心的在线评测。旧的 trace-level evaluator 已经被弃用，Langfuse Cloud 的旧 Trace Evaluator 计划在 2026 年 11 月 16 日停止产生新的评测结果，因此现在新系统最好直接设计成 Observation-level evaluator。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge?utm_source=chatgpt.com "LLM-as-a-Judge - Langfuse"))

---

### 二、Langfuse 实际上有哪几种 Evaluation

我建议你把它理解成四条路线，而不是把所有 Evaluation 混在一起。

第一种是确定性代码评测。例如 JSON 是否合法、工具有没有调用错、参数是否合法、答案是否包含某字段、是否超过最大工具调用次数。这类问题不要调用 LLM，直接代码判断。

第二种是 LLM-as-a-Judge，例如答案是否真正回答问题、回答是否基于检索材料、是否存在幻觉、规划是否合理。这些无法通过简单规则判断，就让另一个 LLM 根据评分标准进行判断。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge?utm_source=chatgpt.com "LLM-as-a-Judge - Langfuse"))

第三种是人工 Evaluation，例如教师、业务专家、产品人员对实际 Trace 评分。Langfuse 提供 Annotation Queue，可以把一批 Trace、Observation 或 Session 分配给人工审核。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues?utm_source=chatgpt.com "Annotation Queues - Langfuse"))

第四种是外部 Evaluation。比如你已经自己实现了 RAGAS、DeepEval、业务规则评分或者用户点赞系统，可以直接：
```python
langfuse.create_score(...)
```

把结果写回 Langfuse，而不要求评测逻辑一定运行在 Langfuse 内部。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk?utm_source=chatgpt.com "Scores via API/SDK - Langfuse"))

---

### 三、最重要的：Dataset + Experiment 离线评测

这基本是面试里最值得讲的部分。

假设你现在修改自己的教育 Agent：
```text
版本 A：
Orchestrator + 4 个领域 ReAct

版本 B：
修改了 Orchestrator Prompt
```

你不能拿几个问题手测然后说“感觉 B 好一点”。

应该建立一个 Dataset：
```text
Dataset
├── case001：政策查询
├── case002：学业规划
├── case003：政策 + 用户画像
├── case004：需要调用多个 Agent
├── case005：无须工具
├── ...
└── case200：历史线上 bad case
```

DatasetItem 通常包括：
```json
{
  "input": {},
  "expected_output": {},
  "metadata": {}
}
```

其中 `metadata` 非常有价值。对 Agent 来说，除了参考答案，还可以记录：
```json
{
  "expected_tools": ["policy_search"],
  "forbidden_tools": ["profile_write"],
  "task_type": "policy_qa",
  "difficulty": "medium"
}
```

官方当前 Python SDK 是 v4，基础配置可以这样写。([Langfuse](https://langfuse.com/docs/evaluation/get-started/offline?utm_source=chatgpt.com "Evaluate with Datasets - Langfuse"))
```bash
pip install langfuse

export LANGFUSE_PUBLIC_KEY="pk-lf-xxx"
export LANGFUSE_SECRET_KEY="sk-lf-xxx"
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
```

创建一个真正适合 Agent 的测试集：
```python
from langfuse import get_client

langfuse = get_client()

DATASET_NAME = "edu-agent-regression"

langfuse.create_dataset(
    name=DATASET_NAME,
    description="教育 Agent 核心能力回归测试集"
)

cases = [
    {
        "id": "policy-001",
        "input": {
            "query": "研究生毕业最低需要多少学分？"
        },
        "expected_output": {
            "must_contain": ["学分"]
        },
        "metadata": {
            "expected_tools": ["policy_search"],
            "forbidden_tools": ["profile_write"],
            "task_type": "policy_qa"
        }
    },

    {
        "id": "profile-001",
        "input": {
            "query": "结合我的情况推荐适合的科研方向"
        },
        "expected_output": {},
        "metadata": {
            "expected_tools": ["profile_read"],
            "task_type": "personalized_recommendation"
        }
    }
]

for case in cases:
    langfuse.create_dataset_item(
        dataset_name=DATASET_NAME,
        **case
    )
```

Langfuse 官方支持通过 SDK 创建 DatasetItem，也支持把生产环境失败的 Trace 直接转成 DatasetItem，这一点实际工程里特别重要，因为测试集应该逐渐由真实 bad case 驱动，而不是全部靠开发人员凭空编题。([Langfuse](https://langfuse.com/docs/evaluation/experiments/datasets?trk=public_post_comment-text&utm_source=chatgpt.com "Datasets - Langfuse"))

---

### 四、真正运行一次 Agent Experiment

假设你的 LangGraph Agent 是：
```python
graph.invoke(...)
```

那么可以直接把整个 Agent 当成 Langfuse Experiment 的 `task`。

例如：
```python
from langfuse import get_client, Evaluation

from app.agent import graph

langfuse = get_client()


def run_agent(*, item, **kwargs):
    """每个 DatasetItem 都会执行一次完整 Agent"""

    query = item.input["query"]

    result = graph.invoke({
        "messages": [
            {
                "role": "user",
                "content": query
            }
        ]
    })

    messages = result["messages"]

    final_answer = messages[-1].content

    # 提取 Agent 实际调用过哪些工具
    tool_calls = []

    for message in messages:
        calls = getattr(message, "tool_calls", None)

        if calls:
            for call in calls:
                tool_calls.append(call["name"])

    return {
        "answer": final_answer,
        "tool_calls": tool_calls
    }
```

这时不要只评最终答案，还可以同时评 Agent 行为。

比如第一层：答案是否出现硬性要求的信息。
```python
def answer_rule_evaluator(
    *,
    output,
    expected_output,
    **kwargs
):
    required = expected_output.get("must_contain", [])

    answer = output["answer"]

    passed = all(
        keyword in answer
        for keyword in required
    )

    return Evaluation(
        name="answer_rule",
        value=1.0 if passed else 0.0,
        comment="关键内容检查"
    )
```

第二层：工具选择是否正确。
```python
def tool_selection_evaluator(
    *,
    output,
    metadata,
    **kwargs
):
    actual_tools = set(output["tool_calls"])

    expected_tools = set(
        metadata.get("expected_tools", [])
    )

    forbidden_tools = set(
        metadata.get("forbidden_tools", [])
    )

    required_ok = expected_tools.issubset(actual_tools)

    forbidden_ok = not (
        actual_tools & forbidden_tools
    )

    passed = required_ok and forbidden_ok

    return Evaluation(
        name="tool_selection_correct",
        value=1.0 if passed else 0.0,
        comment=f"actual={sorted(actual_tools)}"
    )
```

这就是一个非常典型的 Agent trajectory evaluation。

最终答案可能是正确的，但它可能：
```text
本来应该：
policy_search → answer

实际：
web_search → profile_read → policy_search → answer
```

结果虽然对了，但是执行轨迹明显有问题。

对于 Agent，Langfuse Evaluation 的价值往往就在这里。

---

### 五、还可以对整个 Experiment 打分

前面的 Evaluator 是：
```text
一个 DatasetItem → 一个 Score
```

Langfuse 还支持 `run_evaluators`：
```text
整个 DatasetRun → 一个 Score
```

例如算工具选择正确率：
```python
def average_tool_accuracy(
    *,
    item_results,
    **kwargs
):
    values = [
        evaluation.value
        for item in item_results
        for evaluation in item.evaluations
        if evaluation.name == "tool_selection_correct"
    ]

    avg = (
        sum(values) / len(values)
        if values
        else 0.0
    )

    return Evaluation(
        name="avg_tool_accuracy",
        value=avg,
        comment=f"工具选择正确率：{avg:.2%}"
    )
```

然后真正跑 Experiment：
```python
dataset = langfuse.get_dataset(
    "edu-agent-regression"
)

result = dataset.run_experiment(
    name="orchestrator-v2",
    description="修改 Orchestrator planning prompt",

    task=run_agent,

    evaluators=[
        answer_rule_evaluator,
        tool_selection_evaluator
    ],

    run_evaluators=[
        average_tool_accuracy
    ],

    max_concurrency=5,

    metadata={
        "model": "qwen-plus",
        "agent_version": "v2",
        "prompt_version": "orchestrator-v7"
    }
)

print(result.format())
```

SDK 的 Experiment Runner 会负责并发执行、自动 tracing、单条评测、Run-level 聚合以及错误隔离。如果使用的是 Langfuse 托管 Dataset，还会自动生成 DatasetRun，从而可以直接在 Langfuse 页面比较不同实验。([Langfuse](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk?utm_source=chatgpt.com "Experiments via SDK - Langfuse"))

于是可以有：
```text
                 v1       v2
task_success     82%      89%
tool_correct     88%      96%
groundedness     0.84     0.91
avg_latency      4.2s     5.6s
avg_cost         $0.014   $0.019
```

这时候你才能说：

> v2 效果提高了，但延迟增长约 33%，需要判断是否值得上线。

这才是 Evaluation 真正用于工程决策的方式。

---

### 六、LLM-as-a-Judge 怎么实际配置

很多指标无法用程序判断。

例如：
```text
回答是否真正解决用户问题？

回答是否忠于检索材料？

规划是否合理？

有没有引用了材料中不存在的事实？
```

就适合使用 LLM-as-a-Judge。

Langfuse 当前的配置流程是：
```text
Evaluators
    ↓
New evaluator
    ↓
LLM-as-a-Judge
```

然后配置 Judge Model。

例如建立：
```text
groundedness
```

System Prompt 可以直接这么写：
```text
你是一个严格的回答事实一致性评审器。

你的任务是判断回答中的事实是否能够由给定参考材料支持。

只评价事实一致性，不评价语言风格。

评分规则：

1.0：所有重要事实均能从参考材料得到支持。
0.75：核心结论正确，仅存在少量无关扩展。
0.5：部分事实有依据，部分事实无法得到支持。
0.25：存在明显未经材料支持的重要结论。
0.0：主要结论与参考材料冲突或基本没有依据。
```

User Prompt：
```text
用户问题：

{{input}}

参考材料：

{{context}}

Agent 回答：

{{output}}

请根据评分规则评价回答的事实一致性。
```

然后在 Langfuse 中进行变量映射：
```text
{{input}}
→ Observation Input

{{output}}
→ Observation Output

{{context}}
→ Observation Metadata.context
```

如果是 Experiment，则还可以：
```text
{{reference}}
→ Expected Output
```

Score 类型设成：
```text
NUMERIC
0 ~ 1
```

Langfuse 会让 Judge 产生：
```text
score = 0.87

reasoning =
回答的核心政策信息可以由提供材料支持，
但最后关于申请截止时间的描述没有依据。
```

其中 score 写入 Score，解释通常作为 reasoning/comment 保留下来。当前 Langfuse 的 Judge 支持 Numeric、Categorical、Boolean 三类结构化结果。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge?utm_source=chatgpt.com "LLM-as-a-Judge - Langfuse"))

---

### 七、生产环境 Evaluation 和 Experiment 不一样

离线是：
```text
Dataset
→ Agent
→ Evaluator
→ Experiment
```

线上则变成：
```text
真实用户请求
→ Trace / Observation
→ Rule
→ Evaluator
→ Score
→ Dashboard / Alert
```

当前 Langfuse 的设计里：
```text
Evaluator
负责：
“怎么算分”

Rule
负责：
“给谁算分”
```

例如：
```text
Evaluator:
groundedness-v3

Rule:
environment = production
observation.name = answer_generator
sampling = 10%
```

意思就是：

> production 环境中 `answer_generator` 的请求，抽样 10% 做 groundedness Judge。

Langfuse 在 2026 年 8 月刚进一步强化了这个 Evaluator + Rule 模型，可以复用同一个 evaluator，在不同过滤条件和抽样规则下运行。([Langfuse](https://langfuse.com/changelog/2026-08-22-reusable-evaluators-and-rules?utm_source=chatgpt.com "Set up production evaluations with ease - Langfuse"))

这比：
```text
所有 Trace 全部拿 GPT-5 Judge
```

合理得多，因为 LLM Judge 本身也要钱。

---

### 八、Code Evaluator 和 SDK Evaluator 一定要分清

这是现在 Langfuse 很容易问到的一个细节。

刚才我们写：
```python
dataset.run_experiment(
    evaluators=[
        tool_selection_evaluator
    ]
)
```

这个 Python 函数运行在：
```text
你的 Python 进程
```

因此可以自由使用自己的库、数据库甚至外部服务。

而 Langfuse 页面：
```text
Evaluators
→ Code Evaluator
```

创建的代码，则是在 Langfuse 托管环境中运行。

比如检查 Agent 有没有调用危险 Tool：
```python
def evaluate(ctx: EvaluationContext) -> EvaluationResult:

    forbidden_tools = {
        "delete_user",
        "drop_database",
        "raw_sql_execute"
    }

    called_tools = {
        tool.name
        for tool in ctx.observation.tool_calls
    }

    dangerous = bool(
        called_tools & forbidden_tools
    )

    return EvaluationResult(
        scores=[
            Score(
                name="safe_tool_usage",
                value=not dangerous,
                data_type="BOOLEAN",
                comment=(
                    f"called_tools={sorted(called_tools)}"
                )
            )
        ]
    )
```

Langfuse Code Evaluator 可以直接读取：
```python
ctx.observation.input
ctx.observation.output
ctx.observation.metadata
ctx.observation.tool_calls

ctx.experiment.item_expected_output
ctx.experiment.item_metadata
```

所以它尤其适合：
```text
JSON Schema
Tool 参数
Tool 是否选对
字段完整性
Regex
业务约束
```

但当前托管 Code Evaluator 有明确限制：只有 Python/TypeScript 标准库，没有第三方依赖，没有网络出口，单次执行时间不超过 2 秒。如果需要 RAGAS、数据库查询或者复杂模型调用，应该在自己的程序里完成，然后通过 SDK 把 Score 写回 Langfuse。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/code-evaluators "Code evaluators - Langfuse"))

---

### 九、外部系统直接写 Score

例如前端有：
```text
👍   👎
```

用户点击 👍：
```python
from langfuse import get_client

langfuse = get_client()

langfuse.create_score(
    trace_id=trace_id,
    name="user_feedback",
    value=1,
    data_type="BOOLEAN",
    comment="用户点赞"
)
```

点击 👎：
```python
langfuse.create_score(
    trace_id=trace_id,
    name="user_feedback",
    value=0,
    data_type="BOOLEAN",
    comment="用户点踩"
)
```

或者你自己的 RAG 评测服务算出来：
```python
groundedness = 0.91

langfuse.create_score(
    trace_id=trace_id,
    observation_id=answer_observation_id,
    name="groundedness",
    value=groundedness,
    data_type="NUMERIC"
)
```

还可以在当前 Trace 上直接打：
```python
langfuse.score_current_trace(
    name="task_success",
    value=1,
    data_type="BOOLEAN"
)
```

或者只针对当前 Observation：
```python
langfuse.score_current_span(
    name="retrieval_quality",
    value=0.87,
    data_type="NUMERIC"
)
```

这些都是当前 Python SDK 支持的接口。([Langfuse Python SDK](https://python.reference.langfuse.com/langfuse?utm_source=chatgpt.com "langfuse API documentation"))

---

### 十、人工 Evaluation 不是可有可无

LLM Judge 不能直接当 Ground Truth。

更正规的闭环应该是：
```text
生产 Trace
      ↓
抽样人工 Annotation
      ↓
形成高质量标签
      ↓
校准 LLM Judge
      ↓
LLM Judge 扩大评测规模
      ↓
发现 bad case
      ↓
加入 Dataset
      ↓
Regression Experiment
```

Langfuse 的 Annotation Queue 正好解决这个问题。

例如建立：
```text
Queue:
政策问答人工审核

Score Config:
correctness:
    correct
    partially_correct
    incorrect

grounded:
    true
    false

tool_selection:
    correct
    incorrect
```

然后让领域专家审核。

Langfuse 官方也明确建议用人工 Annotation 去对齐和校准 LLM-as-a-Judge，而不是默认 Judge 本身就正确。([Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues?utm_source=chatgpt.com "Annotation Queues - Langfuse"))

---

### 十一、对于你这种 LangGraph 多 Agent，我会怎么设计 Evaluation

你的系统如果是：
```text
Context Builder
      ↓
Orchestrator
      ↓
多个领域 ReAct
      ↓
Answer
```

我不会只设计：
```text
answer_correctness
```

而会形成三层。

第一层是最终任务层：
```text
task_success
answer_correctness
groundedness
personalization_quality
```

回答有没有解决用户问题，这是最终 KPI。

第二层是轨迹层：
```text
tool_selection_accuracy

required_tool_recall

forbidden_tool_rate

redundant_tool_call_count

replan_count

trajectory_success
```

例如：
```text
expected:
profile_read
→ policy_search
→ answer

actual:
web_search
→ profile_read
→ policy_search
→ profile_read
→ answer
```

虽然结果正确，但轨迹质量不能给满分。

第三层是单节点层：
```text
retrieval_relevance
rerank_quality
planner_correctness
tool_argument_correctness
answer_groundedness
```

这些分别挂到对应 Observation 上。

所以：
```text
最终答案错
```

你能继续定位：
```text
是 RAG 没召回？
还是 Orchestrator 选错 Agent？
还是 Tool 参数错？
还是信息都对，但 Answer Generator 幻觉？
```

这才是 Langfuse 对 Agent 项目真正有价值的地方。

---

### 十二、最终一定要进入 CI/CD

Evaluation 如果永远只是 Dashboard，其工程价值其实有限。

真正成熟的流程应该：
```text
开发者修改 Prompt / Agent / Model
            ↓
          提 PR
            ↓
Langfuse Dataset Regression Test
            ↓
      跑 100~500 个 case
            ↓
task_success >= 90%
tool_accuracy >= 95%
groundedness >= 0.85
            ↓
          Pass
            ↓
          Merge
```

Langfuse 当前已经提供官方 Experiment GitHub Action，并支持通过 `RegressionError` 阻止 CI。([Langfuse](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd "Experiments in CI/CD - Langfuse"))

例如：
```python
from langfuse import RegressionError

THRESHOLD = 0.90

result = context.run_experiment(
    name="agent-pr-gate",
    task=run_agent,
    evaluators=[
        tool_selection_evaluator
    ],
    run_evaluators=[
        average_tool_accuracy
    ]
)

score = next(
    e.value
    for e in result.run_evaluations
    if e.name == "avg_tool_accuracy"
)

if score < THRESHOLD:
    raise RegressionError(
        result=result,
        metric="avg_tool_accuracy",
        value=score,
        threshold=THRESHOLD
    )
```

这样 Langfuse 就从：
```text
Tracing 看日志工具
```

真正变成：
```text
Agent 质量基础设施
```

<!-- created: 2026-09-07 13:41:36 -->
<!-- updated: 2026-09-07 15:56:36 -->
