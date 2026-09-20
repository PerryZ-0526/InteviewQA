# Langfuse-prompt management

## 题目

(在此填写题目)

## 标签

暂无

## 题目导航

← [谈谈你对Langfuse的了解](001-谈谈你对Langfuse的了解.md) | [Evalution](003-Evalution.md) →

## 面试直接答

下面这版适合面试直接回答，控制在 1000 字左右，重点放在“工业级 Prompt 管理”而不是功能罗列。

Langfuse 的 Prompt Management，我不会把它理解成一个简单的 Prompt 编辑器，而会把它当成 Agent 系统里的 Prompt Registry 和发布控制面。它解决的核心问题不是“Prompt 放在哪里”，而是 Prompt 怎么版本化、怎么发布、怎么灰度、怎么回滚，以及线上一次请求到底用了哪个 Prompt 版本。因为在工业环境里，Prompt 本质上已经是影响模型行为的一类生产配置，它的修改风险其实和代码变更比较接近。

具体使用上，我一般不会把 Prompt 写死在代码里，而是按 Agent 或节点拆到 Langfuse，例如 Orchestrator、Policy Agent、Reviewer、Answer Generator 分别维护自己的 Prompt。每次修改都会生成一个不可变的新版本，比如 v17、v18、v19，而真正决定哪个版本上线的是 Label。比如 latest 只是最新开发版本，staging 指向测试版本，canary 指向灰度版本，production 指向当前正式版本。线上服务永远通过 production 读取，而不会直接使用 latest，否则有人刚改了一版 Prompt，就可能未经评测直接影响生产流量。

Prompt 本身除了文本模板，还可以绑定 config，例如 model、temperature、max\_tokens、结构化输出 Schema，甚至部分 Tool 配置。这样一次 Prompt Version 实际上对应的是一套完整的行为配置。不过我不会完全信任 Langfuse 里的配置，应用层还是要用 Pydantic 或其他 Schema 做类型校验和安全限制，比如 max\_iterations 不能因为配置错误变成几百次，模型、Token 上限也要有白名单和边界。

运行时也不能让每个请求都同步访问 Langfuse，否则 Prompt 管理平台就会进入核心调用链，影响延迟和可用性。Langfuse SDK 本身有本地缓存，我通常会给生产 Prompt 配一个合适的 TTL，并在服务启动阶段预热核心 Prompt。对于非常关键的系统，还会保留本地 fallback，这样 Langfuse 临时不可用时，Agent 仍然可以用上一版缓存或者兜底 Prompt 继续服务。工程上我通常还会再封装一层 PromptRegistry，业务代码不直接到处调用 get\_prompt，这样缓存、fallback、环境 Label、日志和灰度逻辑都可以统一管理。

另外一个非常关键的点是 Prompt Version 必须和 Trace 绑定。也就是说，某次 Orchestrator 调用用了哪个 Prompt Version，要随着 Generation 一起记录进 Langfuse。这样线上如果 task success 从 94% 掉到 86%，我就可以直接比较是不是某个 Prompt 从 v17 升到 v18 后造成的，同时看对应版本的成本、延迟、工具选择准确率和 groundedness，而不是只能看到模型输出错了，却不知道到底是哪次 Prompt 修改引起的。

Prompt 发布流程上，我会把它做得比较接近代码发布。比如先创建 v18，然后用固定 Dataset 跑离线 Experiment，检查 task success、tool accuracy、groundedness、unsafe tool rate 等指标；通过之后打 staging Label，在测试环境跑完整链路；再把一小部分用户稳定分桶到 canary，比较 v17 和 v18 的线上指标。确认没有回退以后，再把 production 从 v17 切到 v18。这里流量分桶通常由业务服务或者网关完成，Langfuse 主要负责 Prompt 版本管理、Trace 记录和效果分析。

如果上线后发现问题，Prompt Management 的优势就很明显。因为 production 本质上只是一个指向具体版本的 Label，所以回滚不需要重新改代码、构建镜像和部署，只要把 production 从 v18 切回 v17，随着本地缓存刷新，线上就会逐步恢复。对于正式环境，我还会把 production Label 设置成受保护状态，普通 Prompt 编辑人员可以创建版本和修改 staging，但不能直接改 production，真正发布要经过 CI 评测和负责人审批。

最后，我会把 Langfuse 的 Prompt Management 和 Evaluation 连起来，而不是单独使用。生产 Trace 中发现的 bad case 会沉淀进 Dataset，Prompt 修改后自动跑 Regression Set，只有关键指标满足阈值才能进入 production。再结合 Webhook 和 CI/CD，就可以形成“Prompt 修改—版本生成—离线评测—staging—灰度—production—线上监控—异常回滚”的完整链路。所以工业级使用 Langfuse Prompt Management，本质上是在建立一套 Prompt 的版本治理、发布治理和质量治理体系，而不是简单地把 Prompt 从代码文件搬到一个网页后台。

## 详细解析

工业级使用 Langfuse 的 `Prompt Management`，核心不是“把 system prompt 从代码里搬到 Langfuse”，而是建立一套真正的 Prompt 发布系统：
```text
Prompt 开发
   ↓
版本化
   ↓
离线 Evaluation
   ↓
staging
   ↓
canary / A-B
   ↓
production
   ↓
Tracing + Evaluation
   ↓
异常回滚
```

Langfuse 本身提供版本、Label、缓存、Trace 关联、Experiment、Webhook、权限控制等基础能力，而你自己的应用和 CI/CD 负责把这些能力组织成工程流程。([Langfuse](https://langfuse.com/docs/prompt-management/data-model?utm_source=chatgpt.com "Prompt Management Concepts - Langfuse"))

### 1. 首先明确：Prompt Management 到底管理什么

实际 Agent 中，Prompt 不应该写成：
```python
SYSTEM_PROMPT = """
你是教育智能体……
...
"""
```

然后每次修改 Prompt 都重新发版。

而应该：
```text
代码
负责：
LangGraph 图结构
Tool 实现
状态管理
权限控制
业务逻辑

Langfuse
负责：
Prompt Template
Prompt Version
模型参数
部分 Tool 配置
结构化输出 Schema
Prompt 发布状态
```

Langfuse 的一个 Prompt 实际可以看成：
```text
Prompt =
{
    prompt,
    version,
    labels,
    config,
    tags,
    commit_message
}
```

其中 `config` 是工业场景很容易被忽略的一点。它是一个跟着 Prompt 一起版本化的任意 JSON，可以存 model、temperature、max\_tokens、response schema、tools、tool\_choice 等。([Langfuse](https://langfuse.com/docs/prompt-management/features/config?utm_source=chatgpt.com "Config - Langfuse"))

例如你的 Orchestrator 可以存成：
```python
from langfuse import get_client

langfuse = get_client()

langfuse.create_prompt(
    name="edu-agent/orchestrator",
    type="chat",
    prompt=[
        {
            "role": "system",
            "content": """
你是教育智能体系统中的任务编排器。

当前用户画像：
{{profile}}

当前可用专家：
{{available_agents}}

请根据用户请求决定下一步调用哪个专家。
"""
        }
    ],
    config={
        "model": "qwen-plus",
        "temperature": 0.1,
        "max_tokens": 1200,
        "max_iterations": 4
    },
    labels=["staging"],
    tags=["orchestrator", "edu-agent"],
    commit_message="增加跨领域任务判断规则"
)
```

这时候 Prompt 和它依赖的模型参数是一个完整的“行为版本”。

例如：
```text
Orchestrator v17
prompt         → v17
model          → qwen-plus
temperature    → 0.1
max_iterations → 4
```

以后出现问题，你能真正回答：

> 当时线上用的到底是哪套 Agent 行为配置？

而不是只知道“代码版本是 commit abc123”。

---

### 2. 工业环境绝对不要直接使用 `latest`

Langfuse 每保存一次 Prompt，就会产生一个不可变的新版本：
```text
v14
v15
v16
v17
```

其中：
```text
latest
```

永远指向最新创建版本。

而 Label 是一个可以移动的指针：
```text
staging     → v17
production  → v15
canary      → v16
```

Langfuse 官方的版本管理也是这个设计：Version 保存不可变历史，Label 用于部署。没有显式指定 label/version 时，SDK 默认取 `production`。([Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control?utm_source=chatgpt.com "Version Control - Langfuse"))

所以生产环境最忌讳：
```python
prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label="latest"
)
```

因为产品经理刚修改了一句话：
```text
v18 created
latest → v18
```

你的线上服务可能直接开始使用一个完全没有评测过的版本。

生产应该显式：
```python
prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label="production"
)
```

测试环境：
```python
prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label="staging"
)
```

甚至整个服务根据环境统一决定：
```python
PROMPT_LABEL = os.getenv(
    "PROMPT_LABEL",
    "production"
)

prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label=PROMPT_LABEL
)
```

这样：
```text
dev       → latest
staging   → staging
production→ production
```

代码完全不用变化。

---

### 3. 真正的生产发布过程不是“保存 Prompt → production”

工业系统应该至少有：
```text
开发版本
v18
 │
 │ 创建
 ▼
latest
 │
 │ Dataset Experiment
 ▼
staging
 │
 │ Evaluation 通过
 ▼
canary
 │
 │ 小流量验证
 ▼
production
```

例如当前：
```text
production → v17
```

产品或 Prompt 工程师创建：
```text
v18
```

此时：
```text
latest     → v18
production → v17
```

先拿 Langfuse Dataset 跑 v18。

例如固定 500 个回归 case：
```text
task_success      >= 0.92
tool_accuracy     >= 0.96
groundedness      >= 0.90
unsafe_tool_rate  == 0
```

Langfuse 的 Prompt Experiment 可以直接使用 Dataset 比较不同 Prompt Version 和模型，并使用 Judge 或代码评测器自动打分。([Langfuse](https://langfuse.com/docs/evaluation/experiments/experiments-via-ui?utm_source=chatgpt.com "Experiments via UI - Langfuse"))

通过以后才：
```text
staging → v18
```

在 staging 环境做完整 Agent 测试。

最后才把：
```text
production
```

从：
```text
v17
```

移动到：
```text
v18
```

这才叫 Prompt Deployment。

---

### 4. Production Label 应该被保护

这一步非常工业化。

如果所有 Langfuse 项目成员都能点击：
```text
Add label → production
```

那么 Prompt Management 实际绕开了整个生产发布体系。

Langfuse 支持 Protected Prompt Labels，例如把：
```text
production
```

设为 protected。

此后普通 member/viewer 不能修改这个 Label，只有 Admin/Owner 才能把 production 从一个版本移动到另一个版本。([Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control?utm_source=chatgpt.com "Version Control - Langfuse"))

于是组织结构可以变成：
```text
Prompt Engineer / 产品
        │
        ├── 创建 v21
        ├── latest
        └── staging

CI
        │
        └── Evaluation

Tech Lead / Admin
        │
        └── production → v21
```

而不是任何人修改 Prompt 就直接影响生产。

Langfuse 当前并没有完整的“GitHub PR 式多级审批工作流”，工业场景通常是 Protected Label + CI Evaluation + Webhook + 企业审批流程自己组合。([Langfuse](https://langfuse.com/resources/engineering/prompt-cicd?utm_source=chatgpt.com "Prompt CI/CD: version, gate, and roll out prompts like code - Langfuse"))

---

### 5. 线上请求不能每次同步访问 Langfuse

这个问题面试很容易追问：

> 那你把 Prompt 放 Langfuse，每个请求是不是多一次网络请求？

不是。

Langfuse SDK 有本地 Prompt Cache，当前默认 TTL 是 60 秒。Cache 命中直接从本进程内存返回；TTL 到期后可以先继续返回旧 Prompt，同时后台重新验证。服务端本身还存在 Redis 等缓存层。([Langfuse](https://langfuse.com/docs/prompt-management/features/caching?utm_source=chatgpt.com "Caching - Langfuse"))

例如：
```python
prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label="production",
    cache_ttl_seconds=300
)
```

意味着服务实例通常最多每 5 分钟刷新一次 Prompt。

所以请求链路实际上是：
```text
Request
  ↓
Process Local Cache
  ↓
Prompt
```

而不是：
```text
Request
  ↓
Langfuse HTTP
  ↓
Prompt
```

这很重要，因为 Prompt 管理平台不能变成线上请求的强依赖。

---

### 6. 更严格的系统还要做启动预热 + Fallback

例如 Kubernetes 新 Pod 刚启动：
```text
Local Cache = 空
```

这时恰好 Langfuse 网络不可用：
```text
get_prompt()
      ↓
失败
```

所以关键系统可以进一步设计：
```text
Pod Startup
   ↓
预加载关键 Prompt
   ↓
成功
   ↓
Ready
```

例如：
```python
CRITICAL_PROMPTS = [
    "edu-agent/orchestrator",
    "edu-agent/policy-agent",
    "edu-agent/profile-agent",
    "edu-agent/answer-generator"
]

def warmup_prompts():
    for name in CRITICAL_PROMPTS:
        langfuse.get_prompt(
            name,
            label="production",
            cache_ttl_seconds=300
        )
```

Kubernetes readiness 前调用它：
```python
warmup_prompts()
```

如果拿不到关键 Prompt，可以让 Pod 不进入 Ready。

另外 Langfuse 也支持 fallback：当本地没有可用缓存，同时远程获取失败时使用本地兜底模板。([Langfuse](https://langfuse.com/docs/prompt-management/features/guaranteed-availability?utm_source=chatgpt.com "Guaranteed Availability - Langfuse"))
```python
prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label="production",
    cache_ttl_seconds=300,
    fallback="""
你是教育咨询智能体。
根据用户请求选择合适的处理方式。
{{user_query}}
"""
)
```

于是可用性变成：
```text
SDK Cache
   ↓ miss
Langfuse
   ↓ failure
Fallback
```

这才是线上服务应该考虑的问题。

---

### 7. 我更推荐封装一个 PromptRegistry，而不是业务代码到处 `get_prompt()`

Demo 经常是：
```python
prompt = langfuse.get_prompt(...)
```

散落在几十个 Agent Node 中。

工业项目最好统一封装：
```python
import os
from langfuse import get_client

class PromptRegistry:

    def __init__(self):
        self.client = get_client()
        self.label = os.getenv(
            "PROMPT_LABEL",
            "production"
        )

        self.fallbacks = {
            "edu-agent/orchestrator":
                "你是任务编排器。用户请求：{{query}}",

            "edu-agent/answer-generator":
                "根据提供的信息回答：{{query}}"
        }

    def get(self, name: str):
        return self.client.get_prompt(
            name,
            label=self.label,
            cache_ttl_seconds=300,
            fallback=self.fallbacks.get(name)
        )


prompt_registry = PromptRegistry()
```

业务层：
```python
prompt = prompt_registry.get(
    "edu-agent/orchestrator"
)

messages = prompt.compile(
    profile=profile_context,
    available_agents=agent_description
)
```

这样以后你想：
```text
修改缓存 TTL
增加日志
Fallback 告警
按租户取 Prompt
灰度发布
降级
```

只修改 Registry。

---

### 8. Prompt 的 Config 必须做类型校验

不要直接：
```python
temperature = prompt.config["temperature"]
```

然后就传给模型。

因为 Prompt 编辑人员可能把：
```json
{
  "temperature": "abc"
}
```

写进去。

工业系统应该：
```python
from pydantic import BaseModel, Field


class OrchestratorConfig(BaseModel):
    model: str
    temperature: float = Field(
        ge=0,
        le=2
    )
    max_tokens: int = Field(
        ge=1,
        le=8192
    )
    max_iterations: int = Field(
        ge=1,
        le=10
    )


prompt = prompt_registry.get(
    "edu-agent/orchestrator"
)

cfg = OrchestratorConfig.model_validate(
    prompt.config
)
```

然后：
```python
result = llm.invoke(
    messages=prompt.compile(...),
    model=cfg.model,
    temperature=cfg.temperature,
    max_tokens=cfg.max_tokens
)
```

所以 Langfuse Config 可以动态管理行为，但：

> Langfuse 负责配置版本化，应用仍然必须负责配置校验和安全边界。

例如 `max_iterations` 不能让 Prompt 编辑人员填 1000。

---

### 9. 一定要把 Prompt Version 和 Trace 绑定

这是 Prompt Management 和普通配置中心最大的区别之一。

假设线上突然发现：
```text
9 月 7 日 14:10
task_success 从 94% ↓ 86%
```

如果只保存 Trace：
```text
model=qwen-plus
input=...
output=...
```

其实还不够。

你必须知道：
```text
这次 Generation 使用：
orchestrator v18
```

Langfuse 支持直接把 Prompt 对象绑定到 Generation。这样可以按照 Prompt Version 查看质量、延迟、Token、成本和 Evaluation 指标。([Langfuse](https://langfuse.com/docs/prompt-management/features/link-to-traces?utm_source=chatgpt.com "Link to Traces - Langfuse"))

例如：
```python
from langfuse import get_client

langfuse = get_client()

prompt = prompt_registry.get(
    "edu-agent/orchestrator"
)

messages = prompt.compile(
    profile=profile,
    available_agents=agents
)

with langfuse.start_as_current_observation(
    as_type="generation",
    name="orchestrator",
    model=prompt.config["model"],
    prompt=prompt,
    input=messages
) as generation:

    response = llm.invoke(messages)

    generation.update(
        output=response
    )
```

Langfuse 里以后就能得到：
```text
orchestrator

Prompt:
edu-agent/orchestrator
version: 18

Input:
...

Output:
...

Latency:
1.42s

Cost:
...

Scores:
planner_correctness = 0.91
```

于是可以直接分析：
```text
             v17      v18

success      94.1%    95.3%
latency      1.3s     1.4s
cost         0.012    0.013
tool_acc     91.8%    96.2%
```

这才真正形成 Prompt Optimization。

---

### 10. A/B 和 Canary 不应该由 Langfuse“自动分流”

Langfuse可以管理：
```text
production → v17
canary     → v18
```

但 90/10 的流量划分最好由你的应用或网关负责，Langfuse负责记录和分析。官方 A/B Testing 也是这种模式。([Langfuse](https://langfuse.com/docs/prompt-management/features/a-b-testing?utm_source=chatgpt.com "A/B Testing - Langfuse"))

例如不要简单随机每次请求：
```python
random.random()
```

实际生产更建议按用户稳定分桶：
```python
def choose_prompt_label(user_id: str):
    bucket = hash(user_id) % 100

    if bucket < 10:
        return "canary"

    return "production"
```

然后：
```python
label = choose_prompt_label(user_id)

prompt = langfuse.get_prompt(
    "edu-agent/orchestrator",
    label=label,
    cache_ttl_seconds=300
)
```

于是同一个用户持续进入同一个版本：
```text
90%
production → v17

10%
canary → v18
```

Langfuse 再根据 Trace 与 Prompt Version 的关联比较：
```text
task_success
user_feedback
latency
cost
tool_accuracy
```

如果 v18 明显更好：
```text
production → v18
```

如果明显变差：
```text
canary 下线
```

---

### 11. 回滚应该只是移动一个 Label

假设：
```text
production → v18
```

上线十分钟后发现：
```text
tool_error_rate
2% → 17%
```

传统 Prompt 写死在代码里的系统：
```text
git revert
↓
build
↓
image
↓
deploy
↓
rolling restart
```

Prompt Management：
```text
production
v18 → v17
```

即可。

例如 SDK：
```python
langfuse.update_prompt(
    name="edu-agent/orchestrator",
    version=17,
    new_labels=["production"]
)
```

Langfuse SDK 的 Prompt Cache 默认存在 TTL，因此正在运行的实例会随着缓存刷新逐渐拿到回滚后的版本；默认 TTL 为 60 秒，可以根据故障恢复要求调整。([Langfuse Python SDK](https://python.reference.langfuse.com/langfuse?utm_source=chatgpt.com "langfuse API documentation"))

所以 Prompt Rollback 和代码 Rollback 被彻底解耦。

---

### 12. Webhook + CI/CD 才能把它真正工业化

当：
```text
new Prompt version created
```

Langfuse 可以发送 Webhook。

Webhook 可以监听 Prompt version 的：
```text
created
updated
deleted
```

并带上 version、labels、config、commit message 等信息，而且支持 HMAC 签名。([Langfuse](https://langfuse.com/docs/prompt-management/features/webhooks-slack-integrations?utm_source=chatgpt.com "Webhooks - Langfuse"))

于是可以形成：
```text
Prompt v22 created
        ↓
Langfuse Webhook
        ↓
GitHub Actions / Jenkins
        ↓
Regression Dataset
        ↓
Experiment
        ↓
Evaluation Gate
        ↓
通过
        ↓
通知 Approver
        ↓
production → v22
```

假设 CI 规定：
```python
assert task_success >= 0.92
assert tool_accuracy >= 0.95
assert groundedness >= 0.90
assert unsafe_tool_rate == 0
```

任何一个失败：
```text
v22 不允许进入 production
```

这样 Prompt 修改才真正具有和代码发布类似的质量门禁。

---

### 13. 对你的 LangGraph 多 Agent，我会这样拆 Prompt

不要搞一个：
```text
edu-agent-prompt
```

几千行。

而应该按照“可独立演化、可独立评测”的 Agent/Node 拆。

例如：
```text
edu-agent/orchestrator

edu-agent/policy-agent/system

edu-agent/profile-agent/system

edu-agent/search-agent/system

edu-agent/planner/system

edu-agent/reviewer/system

edu-agent/answer-generator/system
```

比如：
```text
orchestrator v21
policy-agent v13
profile-agent v8
answer-generator v17
```

那么 Trace 一看就知道：
```text
Trace #abc

Orchestrator
  prompt v21

Policy Agent
  prompt v13

Answer Generator
  prompt v17
```

如果出现问题：
```text
Planner correctness ↓
```

你只需要研究：
```text
orchestrator v20 vs v21
```

而不是整个 Agent Prompt 一起回滚。

Langfuse 的 Prompt 名称本身也支持类似 `folder/subfolder/prompt-name` 的层级命名。([Langfuse Python SDK](https://python.reference.langfuse.com/langfuse/api/prompt_version/client?utm_source=chatgpt.com "langfuse.api.prompt_version.client API documentation"))

---

### 14. 一个非常重要的边界：不要把所有上下文都存到 Prompt Management

比如：
```text
用户画像
对话历史
RAG Documents
当前 LangGraph State
工具返回结果
```

这些都不应该成为 Langfuse Prompt Version 的组成部分。

正确结构是：
```text
Langfuse Prompt

你是一名教育规划专家。

用户画像：
{{profile}}

相关政策：
{{policy_context}}

当前任务：
{{query}}
```

然后：
```python
prompt.compile(
    profile=current_profile,
    policy_context=retrieved_docs,
    query=user_query
)
```

也就是说：
```text
Langfuse
存稳定模板

Runtime
注入动态上下文
```

否则每一个用户、每一次 RAG 检索都产生 Prompt Version，版本系统直接失去意义。

---

### 15. 工业级的完整链路

最终我会把系统做成这样
```text
                 Langfuse Prompt Registry
                         │
              ┌──────────┴──────────┐
              │                     │
        immutable versions        labels
              │                     │
        v17 v18 v19       staging/canary/production
                                    │
                                    ▼
                        PromptRegistry Service
                                    │
                       local SDK cache + fallback
                                    │
                                    ▼
                             LangGraph Agent
                                    │
              ┌─────────────────────┼────────────────────┐
              ▼                     ▼                    ▼
         Orchestrator          Policy Agent        Answer Agent
         prompt v19            prompt v11          prompt v15
              │                     │                    │
              └─────────────────────┼────────────────────┘
                                    ▼
                              Langfuse Trace
                                    │
                     Prompt Version + Metrics
                                    │
                                    ▼
                               Evaluation
                                    │
                         Dataset / Bad Cases
                                    │
                                    ▼
                              Regression Test
```

所以面试里我会把 Langfuse Prompt Management 总结成这样：

> Langfuse 的 Prompt Management 在工业环境中本质上不是一个 Prompt 编辑器，而应该作为 Agent 的 Prompt Registry 和发布控制面。Prompt 本身按照 Agent 或节点拆分，每次修改产生不可变版本，通过 staging、canary、production 等 Label 控制部署，生产代码永远读取 production 而不是 latest；Prompt 和模型参数、输出 Schema 等行为配置可以一起版本化，但应用层仍需要做类型和安全校验。运行时通过 SDK 本地缓存获取 Prompt，避免 Langfuse 成为请求链路上的同步强依赖，关键服务还可以增加启动预热和 fallback。每次模型调用必须把实际 Prompt Version 与 Langfuse Generation 绑定，这样线上质量、成本、延迟和 Evaluation Score 才能追溯到具体 Prompt Version。Prompt 修改后先通过 Dataset 做离线回归，再进入 staging 和 canary，最后由受保护的 production Label 完成正式发布；出现异常时只需要把 production 指针切回旧版本即可快速回滚。再结合 Webhook、CI/CD、Protected Label 和线上 Evaluation，最终形成“版本创建—离线评测—审批—灰度—生产监控—快速回滚”的完整 Prompt 工程体系，而不是简单地把 Prompt 从代码里搬到 Langfuse。([Langfuse](https://langfuse.com/docs/prompt-management/features/prompt-version-control?utm_source=chatgpt.com "Version Control - Langfuse"))

<!-- created: 2026-09-07 14:37:51 -->
<!-- updated: 2026-09-07 14:40:31 -->
