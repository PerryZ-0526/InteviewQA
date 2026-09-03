# 谈谈你对Langfuse的了解

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← 无 | 无 →

## 面试直接答

**摘要：**Langfuse 是一个开源的 LLM/AI 应用工程平台，我主要把它理解为大模型应用的“可观测 + Prompt 管理 + 效果评估”平台，用来追踪一次 AI 请求内部发生了什么，并从质量、耗时和成本等维度持续优化应用。

传统 Web 系统出了问题，我们一般可以通过接口日志、APM 或链路追踪定位，但 LLM 应用的问题更复杂，因为模型输出具有非确定性，而且一个请求往往还包含 Prompt、模型调用、RAG 检索、工具调用、Agent 决策等多个步骤。Langfuse 最核心的能力就是把这些过程完整记录下来，让原来比较“黑盒”的大模型调用变得可观测。官方目前也把 Langfuse 定位为开源、可自托管的 AI Engineering Platform。

在可观测性方面，Langfuse 主要通过 Trace、Observation 和 Session 来组织数据。可以把一次用户请求理解成一个 Trace，比如用户问 AI“帮我分析这份合同”，内部可能先进行知识库检索，再调用模型，再调用某个工具，最后生成回答，这些具体步骤会作为 Observation 记录下来；如果是多轮聊天，还可以通过 Session 把多个 Trace 串起来。这样出现回答错误时，就能进一步判断到底是检索错了、Prompt 有问题、工具调用失败，还是模型本身生成有问题。

除了链路追踪，Langfuse 还会记录 LLM 特有的信息，比如模型名称、输入输出、Token 使用量、调用延迟和 Cost，因此既能做问题排查，也可以做成本和性能分析。例如发现某个 Agent 响应需要 10 秒，就可以通过 Trace 看究竟是向量检索耗时高，还是某一次模型调用耗时高；如果模型费用突然上涨，也可以按模型、用户、功能或 Prompt 版本进一步分析。

第二个重要能力是 Prompt Management。实际项目中如果 Prompt 全写死在代码里，每次调整 Prompt 都需要修改代码并重新发布。Langfuse 可以集中管理 Prompt，对 Prompt 做版本控制，通过 Label 管理不同环境，并且把某个 Prompt 版本和实际 Trace 关联起来。这样修改 Prompt 后，不仅方便发布和回滚，还可以比较不同版本的成本、延迟和效果。

第三个重要能力是 Evaluation，因为大模型返回结果不能简单通过 HTTP 200 判断“业务正确”。Langfuse 支持用户反馈、人工评分、代码规则、LLM-as-a-Judge 以及自定义评估，并且可以把典型案例沉淀成 Dataset，再通过 Experiment 比较不同 Prompt、模型或者代码版本的效果，从而形成“线上发现问题—沉淀数据集—离线实验—评估效果—重新发布”的持续优化闭环。

在接入方面，Langfuse 提供 Python 和 JavaScript/TypeScript SDK，并且现在基于 OpenTelemetry，也能和 OpenAI SDK、LangChain、LlamaIndex 等框架集成；同时它是开源并支持私有化部署的，所以对于数据比较敏感的企业也可以部署到自己的基础设施中。

所以如果让我总结，**Langfuse 本身并不是用来调用大模型的，而是围绕 LLM 应用提供可观测、Prompt 管理和效果评估能力，把模型调用从一个黑盒变成可以追踪、分析和持续优化的工程系统。**

## 详细解析

Langfuse 是一个开源的 AI Engineering Platform，主要解决 LLM 应用上线以后“发生了什么、为什么回答不好、花了多少钱、修改后有没有变好”等问题，核心能力可以归纳为 Observability、Prompt Management 和 Evaluation。

## 一、Langfuse 是解决什么问题的

理解 Langfuse，首先要理解大模型应用和传统后端应用最大的区别。

传统 Web 系统中，一个接口可能是：
```text
用户请求
   |
   v
Controller
   |
   v
Service
   |
   v
Database
   |
   v
返回结果
```

如果接口报 500，我们通过日志、SkyWalking、Jaeger、Prometheus 等工具，通常能够分析接口在哪一层出了问题。

但是一个 RAG 或 Agent 应用可能变成：
```text
用户问题
   |
   v
Prompt 构造
   |
   v
Embedding
   |
   v
向量数据库检索
   |
   v
Rerank
   |
   v
LLM 推理
   |
   +------> Tool Call
   |          |
   |          v
   |        外部 API
   |          |
   <----------+
   |
   v
再次调用 LLM
   |
   v
最终答案
```

现在用户说一句：
```text
“这个 AI 回答错了。”
```

问题就来了。

到底是哪一步错了？

可能是知识库根本没有召回正确文档，也可能是召回正确但是 Rerank 排序有问题，还可能是 Prompt 没写好、模型选择不合适、上下文被截断，或者 Agent 调错了工具。

所以传统的“接口成功还是失败”已经不足以描述 LLM 系统的运行质量。

Langfuse解决的核心问题，就是把这条 AI 调用链完整记录下来，使开发人员能够看到每一步发生了什么。官方将它定位为一个开源 AI Engineering Platform，目前主要包含 Observability、Prompt Management、Evaluation、Metrics 等能力，并支持自托管。

## 二、核心能力一：Observability，可观测性

我认为 Langfuse 最重要、也是项目最先会使用的能力就是 Observability。

它的核心数据模型可以简单理解成：
```text
Session
│
├── Trace 1
│    │
│    ├── Observation
│    │      └── Retriever
│    │
│    ├── Observation
│    │      └── Generation
│    │
│    └── Observation
│           └── Tool
│
├── Trace 2
│    ├── Observation
│    └── Observation
│
└── Trace 3
```

其中 Observation 是最细粒度的一次操作，比如 LLM 调用、工具调用、知识库检索等；Trace 表示一次完整请求或者一次 Agent 执行；Session 则可以把多个 Trace 组织成一次完整的多轮会话。

假设用户问：
```text
“北京明天天气怎么样，
如果下雨提醒我带伞。”
```

一个 Agent 内部可能执行：
```text
Trace: 用户的一次请求
│
├── Retriever
│      查找用户所在地区
│
├── Generation
│      LLM 判断需要调用天气工具
│
├── Tool
│      weather_api("北京")
│
├── Generation
│      LLM 根据天气结果组织回答
│
└── Output
       最终回复
```

Langfuse 可以把这一整条链路展示出来。

官方当前的数据模型中 Observation 还可以细分为 `span`、`generation`、`agent`、`tool`、`chain`、`retriever`、`event` 等类型，所以对于复杂 Agent 来说，不只是看到“调用了一次模型”，而是能够还原整个执行过程。

这也是它和普通日志平台最大的区别之一。

普通日志可能是：
```text
INFO request success
INFO llm response success
```

但 Langfuse 更关注：
```text
谁发起了请求？

用了什么 Prompt？

调用了哪个模型？

输入是什么？

输出是什么？

检索到了什么？

调用了哪个 Tool？

每一步耗时多少？

用了多少 Token？

花了多少钱？

最终质量怎么样？
```

因此 Langfuse 更像是针对 LLM 应用做了一层专业化的 Distributed Tracing。

## 三、为什么 Trace 对 Agent 和 RAG 特别重要

比如一个 RAG 问答系统回答错误：
```text
用户：
公司的年假是多少天？

AI：
5 天。
```

但正确答案其实是 10 天。

如果只看到最终输入输出，我们只能知道：
```text
Question -> Wrong Answer
```

有 Langfuse Trace 之后，可以进一步看到：
```text
Question
   |
   v
Retriever
   |
   +--> 文档 A：年假 5 天（2022版）
   +--> 文档 B：年假 10 天（2026版）
   |
   v
Reranker
   |
   +--> 把旧文档排到了第一
   |
   v
LLM
   |
   v
回答：5 天
```

这样就可以判断：

**模型本身可能并没有错，真正的问题是 Retrieval/Rerank。**

这就是 LLM Observability 非常重要的价值。

## 四、Langfuse 还能监控 Token、Cost 和 Latency

对于生产环境来说，只判断“答案对不对”还不够，还需要关注成本和性能。

例如一次 Agent 请求：
```text
总耗时：8.2s
总费用：$0.12
```

看起来只能知道慢和贵。

通过 Trace 可以继续拆：
```text
Embedding        100ms

Retriever        200ms

LLM Call 1       1.2s
                 $0.01

Tool Call        400ms

LLM Call 2       6.1s
                 $0.11
```

于是马上可以看到：
```text
瓶颈 = 第二次 LLM Call
成本主要来源 = 第二次 LLM Call
```

Langfuse 可以记录 generation 的模型、Token Usage、Cost 和 Latency，并进一步按照模型、用户、Session、功能、Prompt 版本等维度进行分析。

所以它不仅是 Debug 工具，也是 LLM 应用的成本监控工具。

## 五、核心能力二：Prompt Management

第二个非常重要的模块是 Prompt Management。

最简单的大模型项目里，我们经常这么写：
```text
代码：

prompt = """
你是一个专业客服，
请根据下面资料回答用户问题……
"""
```

这种方式开发初期没有问题，但上线以后会遇到麻烦。

比如产品经理发现回答效果不好，只想把：
```text
“请简洁回答”
```

修改成：
```text
“请控制在100字以内，并优先引用知识库内容”
```

如果 Prompt 写死在代码中，通常意味着：
```text
修改代码
   ↓
提交 Git
   ↓
Code Review
   ↓
CI/CD
   ↓
重新部署
```

但实际上业务人员只是改了一段文字。

Langfuse Prompt Management 的思路就是把：
```text
Prompt
```

从：
```text
应用代码
```

中解耦出来，集中管理。

于是可以变成：
```text
Application
     |
     | 获取 Prompt
     v
Langfuse Prompt Management
     |
     ├── Version 1
     ├── Version 2
     └── Version 3
```

Langfuse 支持 Prompt 版本管理、Label、Playground，并且 SDK 会对 Prompt 进行客户端缓存，以降低从平台获取 Prompt 对业务请求的影响。

更重要的是：
```text
Prompt Version
      |
      v
    Trace
      |
      v
Cost / Latency / Score
```

它可以把 Prompt 版本和真实 Trace 关联起来。这样我们可以进一步分析：
```text
Prompt V1
正确率 82%
平均成本 $0.03

Prompt V2
正确率 91%
平均成本 $0.035
```

于是 Prompt 优化就从：
```text
“我感觉新版好一点”
```

变成：
```text
“从线上数据看，
V2 的质量提高了多少，
成本增加了多少。”
```

这就是工程化的 Prompt 管理。

## 六、核心能力三：Evaluation

Langfuse 另一个很关键的能力是 Evaluation。

传统接口一般容易判断成功与否：
```text
HTTP 200 -> 请求成功

HTTP 500 -> 请求失败
```

但是 LLM 返回：
```text
HTTP 200
```

并不意味着答案正确。

比如：
```text
用户：1 + 1 等于多少？

模型：3
```

请求完全成功，但是业务结果显然失败。

因此大模型系统需要额外建立：
```text
Evaluation
```

来评估输出质量。

Langfuse 当前支持人工标注、用户反馈、代码 Evaluator、LLM-as-a-Judge 以及自定义 Evaluation Pipeline 等评估方式。

例如客服机器人可以让另一个 LLM 判断：
```text
是否回答了用户的问题？
是否引用了正确知识？
是否存在幻觉？
表达是否符合客服规范？
```

然后生成 Score：
```text
Correctness = 0.9
Relevance   = 0.95
Tone        = 0.8
```

这样我们就能把“感觉回答不错”转化成可以长期监控的指标。

## 七、Dataset 和 Experiment 为什么重要

Evaluation 再往下，就会进入 Dataset 和 Experiment。

假设线上经常发现一些典型问题：
```text
Case 1：退款政策
Case 2：会员价格
Case 3：海外配送
Case 4：发票问题
```

可以把这些案例沉淀成 Dataset：
```text
Production Trace
       |
       | 筛选典型问题
       v
     Dataset
       |
       v
     Experiment
```

然后准备新的：
```text
Prompt V2
```

在同一批 Dataset 上重新跑：
```text
Dataset
   |
   ├── Prompt V1 + GPT-X
   |
   └── Prompt V2 + GPT-X
```

最后通过 Evaluator 比较：
```text
V1 Score = 0.78

V2 Score = 0.91
```

Langfuse 的 Experiment 可以比较不同 Prompt、模型或者代码版本，并结合 Dataset 和 Evaluator 检查修改是否真正提高效果。

于是就形成一个非常重要的 AI Engineering 闭环：
```text
                 Production
                     |
                     v
                  Tracing
                     |
                发现 Bad Case
                     |
                     v
                  Dataset
                     |
                     v
                  Experiment
                 /          \
          Prompt V1       Prompt V2
                 \          /
                     v
                  Evaluate
                     |
                     v
                选择更优版本
                     |
                     v
                  Deploy
                     |
                     +----------+
                                |
                                v
                           Production
```

我认为这其实是理解 Langfuse 最核心的一张图。

它并不是简单地：
```text
“记录一下 LLM 日志”
```

而是在帮助团队建立：
```text
观测
 ↓
发现问题
 ↓
沉淀测试数据
 ↓
修改 Prompt / Model / Code
 ↓
实验
 ↓
评估
 ↓
重新上线
 ↓
继续观测
```

这样的持续优化体系。Langfuse 官方现在也把这一过程描述成线上 tracing/monitoring 与线下 dataset、experiment、evaluation 相结合的 AI Engineering lifecycle。

## 八、它和传统 APM 有什么区别

如果面试官继续追问“那 Langfuse 和 SkyWalking、Jaeger 有什么区别”，可以从关注对象解释。

传统 APM 更关注：
```text
HTTP 请求耗时
数据库耗时
RPC 调用
CPU / Memory
异常堆栈
服务之间的调用关系
```

Langfuse 更关注：
```text
Prompt
Model
Input / Output
Generation
Retrieval
Tool Call
Token
Cost
Latency
Evaluation Score
Prompt Version
```

两者其实不是完全替代关系。

例如生产环境可以同时存在：
```text
                 一个 AI 请求
                      |
          +-----------+-----------+
          |                       |
          v                       v
     OpenTelemetry            Langfuse
          |                       |
          v                       v
 Datadog / Jaeger       LLM Observability
                         Prompt / Cost / Eval
```

而 Langfuse 当前本身也建立在 OpenTelemetry 之上，因此可以与现有的 OpenTelemetry 生态结合，并不一定需要形成完全独立的监控孤岛。

## 九、部署和接入方式

Langfuse 是开源项目，可以使用官方 Cloud，也可以进行 Self-host。

如果企业比较关注：
```text
Prompt 数据
用户输入
模型输出
企业知识库内容
```

不希望这些 Trace 数据进入第三方 SaaS，就可以部署到自己的 VPC 或内部网络。

当前 Langfuse 自托管架构中会使用 PostgreSQL 处理事务类数据，ClickHouse 主要存储 Trace、Observation 和 Score 等分析数据，同时使用 Redis/Valkey 和对象存储等组件。

接入方面，Langfuse 提供 Python 和 JavaScript/TypeScript SDK，并支持 OpenTelemetry，同时与 OpenAI SDK、LangChain、LlamaIndex 等常见 LLM 技术栈集成，因此现有 Agent 或 RAG 项目通常不需要自己重新设计整套 Trace 系统。

## 十、面试最后怎么收口

如果面试官问我“你怎么理解 Langfuse”，我最终会把它总结为：

Langfuse 不是大模型，也不是负责调用大模型的框架，它更像是面向 LLM 应用的一套工程基础设施。它首先通过 Trace、Observation 和 Session 把 RAG、Agent、模型调用以及 Tool Call 的完整执行链路记录下来，实现 LLM Observability；然后通过 Prompt Management 管理 Prompt 的版本和发布；再利用 Evaluation、Dataset 和 Experiment 对不同 Prompt、模型以及代码版本进行量化评估。

因此它真正解决的问题是：**让大模型应用从一个不可解释的黑盒，变成一个能够观测、定位问题、控制成本、衡量质量并持续迭代的工程系统。**

如果再压缩成一句话，我会说：

**传统 APM 主要告诉我们“系统有没有正常运行”，而 Langfuse 更进一步帮助我们回答“LLM 为什么这么回答、这次回答质量怎么样、花了多少钱，以及下一版到底有没有变得更好”。**

<!-- created: 2026-09-03 14:58:11 -->
<!-- updated: 2026-09-03 15:01:16 -->
