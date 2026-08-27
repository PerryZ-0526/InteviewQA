# langGraph 中的 command

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph从workflow编排器到agent runtime的转型](LangGraph从workflow编排器到agent runtime的转型) | [LangGraph 构建多智能体系统的核心范式](LangGraph 构建多智能体系统的核心范式) →

## 详细解析

### 1. 什么是 Command

Command 是 LangGraph 中的一个特殊返回类型，当一个节点函数返回 Command 时，它不仅能更新图的状态，还能直接指定下一步要执行哪个节点。它将“状态更新”和“流程控制”整合到同一个返回值中。
```
from langgraph.types import Command

def my_node(state: State) -> Command:
    return Command(
        goto="next_node",      # 指定下一个要执行的节点
        update={"key": value}  # 更新状态
    )
```

### 2. 为什么需要 Command

在传统的 LangGraph 架构中，图由**节点**和**边**构成。节点处理状态，边（尤其是条件边）负责路由控制。这种方式的局限性在于：

- 当逻辑非常动态时，无法预先穷举所有可能的跳转路径
- 节点自身想做路由决策，却要依赖外部的边函数
- 多智能体系统中需要频繁进行“交接”（handoff）
- 人机交互、中断恢复等场景需要灵活的流程控制

Command 的引入打破了“节点处理逻辑、边处理路由”的固定分工，让节点自己决定下一步走向。

### 3. Command 的核心参数

根据官方 API 文档，Command 接受以下参数：


| **参数**   | **类型** | **说明**                            |
| :-------- | :------ | :--------------------------------- |
| `goto`   | `str`  | `Sequence[str]`                   |
| `update` | `Any`  | 要应用到图状态的更新内容                      |
| `resume` | `Any`  | 用于恢复中断执行的恢复值，与 `interrupt()` 配合使用 |
| `graph`  | \`str  | None\`                            |


---

### 4. Command 的主要使用场景

#### 1. 多智能体交接（Handoff）

Command 最典型的应用场景是**多智能体系统中的任务交接**。当一个智能体完成工作后，它可以通过 Command 直接将控制权移交给另一个专业智能体。
```
def agent_node(state: State) -> Command:
    if need_expert_help(state):
        return Command(
            goto="expert_agent",
            update={"messages": state["messages"] + [new_message]}
        )
    return Command(goto="END")
```

#### 2. 动态路由与状态更新同步进行

当节点既需要更新状态又需要决定路由时，Command 是最佳选择。条件边只能路由，不能同时更新状态；而 Command 将两者合二为一。
```
def classify_node(state: State) -> Command:
    if "天气" in state["user_input"]:
        return Command(
            goto="search_node",
            update={"query": state["user_input"]}  # 同时更新状态
        )
    return {"final_answer": "无法处理此问题"}
```

#### 3. 中断与恢复（Human-in-the-Loop）

Command 的 `resume` 参数可以与 `interrupt()` 配合，实现人机交互场景：
```
# 在节点中暂停，等待人类输入
def approval_node(state: State):
    approved = interrupt({"question": "是否批准此操作？"})
    if approved:
        return Command(goto="execute_node")
    return Command(goto="END")

# 外部恢复执行
app.invoke(Command(resume=True), config=config)
```

#### 4. 嵌套图导航

Command 支持在嵌套图（父图与子图）之间导航，通过 `graph` 参数指定目标图。
```
return Command(
    goto="subgraph_node",
    graph=Command.PARENT,  # 跳转到父图的节点
    update={"data": value}
)
```

---

### 5. Command vs 条件边（Conditional Edge）


| **维度**    | **条件边**    | **Command**  |
| :--------- | :---------- | :------------ |
| **定义位置**  | 在图构建时外部定义  | 在节点内部返回      |
| **状态更新**  | 不更新状态      | 同时更新状态       |
| **动态性**   | 路由函数根据状态判断 | 节点自身决定去向     |
| **嵌套图支持** | 不支持        | 支持跨图跳转       |
| **适用场景**  | 静态、可预知的分支  | 动态、复杂的多智能体交互 |


简单来说：**如果需要同时更新状态和路由到不同节点，使用 Command。**

---

### 6. 完整示例

以下是一个完整的问答机器人示例，展示了 Command 的典型用法：
```
from typing import TypedDict
from langgraph.types import Command

class State(TypedDict, total=False):
    user_input: str
    query: str
    search_result: str
    final_answer: str

def input_node(state: State) -> Command:
    return Command(
        goto="classify_node",
        update={"user_input": state["user_input"]}
    )

def classify_node(state: State) -> Command:
    if "天气" in state["user_input"]:
        return Command(
            goto="search_node",
            update={"query": state["user_input"]}
        )
    return {"final_answer": "无法处理此问题"}

def search_node(state: State) -> Command:
    result = f"搜索到：{state['query']} → 今天晴天，28℃"
    return Command(
        goto="answer_node",
        update={"search_result": result}
    )

def answer_node(state: State):
    return {"final_answer": f"根据结果：{state['search_result']}"}
```

---

### 7. 注意事项

1. **类型提示**：可以在节点函数上使用类型提示，让图知道可能的跳转目标，便于可视化
2. **无边图（Edgeless Graph）**：使用 Command 后，节点之间不再需要预先定义边，实现了“无边”的灵活图结构
3. **与 Send 的区别**：`Send` 用于并行执行（如 Map-Reduce），而 `Command` 用于顺序控制流


## 根据LLM推理结果来动态决定goto目标

在 LangGraph 中，利用 LLM 的推理结果动态决定 `goto` 目标，本质上是**将自然语言理解转化为图的结构化跳转指令**。核心流程是：**构造 Prompt -&gt; LLM 输出结构化数据（或工具调用）-&gt; 节点解析数据 -&gt; 映射为具体的节点名称 -&gt; 返回 Command**。

LangGraph 官方非常推荐这种做法，并专门提供了 `Command` 与结构化输出（Structured Output）或工具调用（Tool Calling）结合的最佳实践。

下面我通过**“多意图客服路由系统”**来彻底拆解这个机制。

### **核心机制拆解**

1. **LLM 推理（输出层）**：你不需要让 LLM 直接输出节点名（如 `"goto: node_a"`），因为这不够稳定。正确的做法是让 LLM 输出**语义意图**（如 `"refund"`, `"tech"`）或**调用特定的路由工具**。
2. **映射层（Mapping）**：在代码中维护一个字典（`Dict[str, str]`），将 LLM 输出的逻辑意图映射为图节点实际注册的名称（函数名）。
3. **控制层（Command）**：节点函数拿到映射后的目标名，直接放入 `Command(goto=...)` 中，瞬间完成动态路由。

---

### **实战示例：智能客服路由机器人**

假设我们有一个客服系统，用户输入问题后，需要动态路由到 **“退款处理专员”**、**“技术支持专员”** 或 **“闲聊回复器”**。

#### **1. 定义输出结构（Pydantic 模型）**

我们强制 LLM 输出固定的意图类别，这是动态路由的“推理结果”。

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
from typing import Literal
from pydantic import BaseModel
from langgraph.graph import StateGraph, MessagesState
from langgraph.types import Command
from langchain_openai import ChatOpenAI

# 定义LLM必须输出的结构化格式
class RouteIntent(BaseModel):
    intent: Literal["refund", "technical", "general"]  # 推理结果限定在这三者
    reasoning: str  # 让LLM顺便解释下推理依据，增加准确性
```

#### **2. 构建“路由节点”（核心逻辑）**

在这个节点中，我们调用 LLM，获得推理结果，然后解析并返回 `Command`。

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
# 初始化模型，并绑定结构化输出
llm = ChatOpenAI(model="gpt-4o").with_structured_output(RouteIntent)

# 定义图的状态（这里复用内置的消息状态）
class State(MessagesState):
    pass  # 或者添加自定义字段，这里暂不需要

def dynamic_router_node(state: State) -> Command:
    # 1. 让LLM进行推理（分析用户最后一句话）
    response: RouteIntent = llm.invoke(state["messages"])
    
    # 2. 动态映射表：将LLM推理出的意图，映射为图中实际的节点名称
    intent_to_node = {
        "refund": "refund_expert",    # 退款专家节点
        "technical": "tech_support",  # 技术支持节点
        "general": "chat_replier"     # 通用聊天节点
    }
    
    target_node = intent_to_node[response.intent]
    
    # 3. 返回Command：跳转到目标节点，并把推理理由存入状态供后续节点使用
    print(f"🤖 LLM推理结果: {response.reasoning} -> 跳转至 {target_node}")
    return Command(
        goto=target_node,
        update={"current_intent": response.intent}  # 将推理结果更新到状态中
    )
```

#### **3. 定义具体的业务节点（接收处理）**

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
def refund_expert(state: State):
    # 模拟处理退款
    return {"messages": [{"role": "assistant", "content": "退款专员：请提供您的订单号，马上为您办理。"}]}

def tech_support(state: State):
    return {"messages": [{"role": "assistant", "content": "技术支持：请重启设备，若不行请查看后台日志。"}]}

def chat_replier(state: State):
    return {"messages": [{"role": "assistant", "content": "闲聊回复：今天天气不错，有什么可以帮您的吗？"}]}
```

#### **4. 构建图并运行**

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
from langgraph.graph import END

# 构建图
builder = StateGraph(State)
builder.add_node("router", dynamic_router_node)
builder.add_node("refund_expert", refund_expert)
builder.add_node("tech_support", tech_support)
builder.add_node("chat_replier", chat_replier)

# 设置入口
builder.set_entry_point("router")

# 无需添加任何条件边！因为路由完全由节点内部的 Command 驱动
graph = builder.compile()

# 测试 1：涉及退款
result = graph.invoke({"messages": [{"role": "user", "content": "我刚买的商品坏了，我要退货退钱！"}]})
print(result["messages"][-1]["content"]) 
# 输出：退款专员：请提供您的订单号，马上为您办理。

# 测试 2：涉及技术
result = graph.invoke({"messages": [{"role": "user", "content": "电脑蓝屏了，报错代码0x000"}]})
# 输出：技术支持：请重启设备...
```

---

### **进阶技巧：利用 Tool Calling 直接输出节点名**

如果你的 Agent 节点非常多（比如 20+ 个），维护 `intent_to_node` 映射表会变得麻烦。此时，你可以让 LLM **直接通过工具调用（Tool Call）来决定目标**。

把每一个节点变成一个“工具”（Tool），工具名称就是节点名，工具描述就是该节点的职责。LLM 推理时如果选择了某个工具，你的代码直接提取 `tool_call["name"]` 作为 `goto` 目标。

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
# 假设节点名叫做 "finance_agent" 和 "it_agent"
tools = [
    {"type": "function", "function": {"name": "finance_agent", "description": "处理财务、退款、账单问题"}},
    {"type": "function", "function": {"name": "it_agent", "description": "处理网络、服务器、电脑蓝屏问题"}}
]

def llm_router(state):
    llm_with_tools = ChatOpenAI(model="gpt-4o").bind_tools(tools)
    response = llm_with_tools.invoke(state["messages"])
    
    # 如果LLM调用了工具，直接取出工具名作为goto目标，无需映射表！
    if response.tool_calls:
        target = response.tool_calls[0]["name"]  # 直接得到 "finance_agent"
        return Command(goto=target)
    return Command(goto="fallback_node")
```

---

### **关键注意事项**

1. **防止无限循环**：如果你的 LLM 推理结果又回到了当前节点，务必设置 `goto` 去往其他节点或 `END`，否则图会死循环。
2. **错误兜底（Fallback）**：LLM 可能会输出意料之外的字符串。在映射时建议加上 `try...except` 或 `.get(intent, "default_node")` 来防止程序崩溃。
3. **状态与路由分离**：记住，`Command` 的 `update` 只是更新状态，`goto` 控制流向。两者互不干扰，你可以只跳转不更新数据，也可以只更新数据不跳转（留在本节点）。
4. **可视化支持**：在节点函数上使用类型注解 `-> Command[Literal["node_a", "node_b"]]`，LangGraph 的可视化工具能自动识别出这些动态跳转的目标，画出完整的流程图。

通过这种方式，你的 LangGraph 工作流不再是僵硬的“决策树”，而变成了一个能真正“理解”语义并灵活调度的**自主路由系统（Autonomous Routing System）**。<!-- created: 2026-08-20 17:58:57 -->
<!-- updated: 2026-08-21 15:34:02 -->
