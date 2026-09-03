# langGraph架构中，tool是作为一个函数，还是作为一个node？

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph中的subgraph](LangGraph中的subgraph) | 无 →

## 面试直接答

(暂无)

## 详细解析

在 **LangGraph** 里，这两个说法其实都对，但它们指的是不同层级：

**Tool 本身通常是一个“可调用函数 / callable”**；而在 **Graph 的执行结构里，Tool 往往通过** `ToolNode` **被包装成一个 Node 来执行**。官方文档目前也是这种设计：agent 可以接收普通 Python callable / LangChain Tool，而手写 `StateGraph` 时常见写法是 `builder.add_node("tools", ToolNode(tools))`。([LangChain AI](https://langchain-ai.github.io/langgraph/how-tos/react-agent-structured-output/?utm_source=chatgpt.com "Agents - Docs by LangChain"))

比如你定义一个 tool：
```python
from langchain_core.tools import tool

@tool
def get_weather(city: str):
    return f"{city} is sunny"
```

这里：
```text
get_weather
    ↓
   Tool
```

它本质上是一个**能力函数**，有名字、参数 schema、description，以及实际执行逻辑。LLM 可以决定：
```text
我要调用 get_weather(city="Tokyo")
```

但到了 LangGraph 的图结构层：
```python
from langgraph.prebuilt import ToolNode

tools = [get_weather]

graph.add_node("tools", ToolNode(tools))
```

此时结构是：
```text
          ┌─────────────┐
          │  LLM Node   │
          └──────┬──────┘
                 │
          tool_calls?
            yes  │
                 ▼
          ┌─────────────┐
          │  ToolNode   │  ← Graph Node
          │             │
          │ get_weather │  ← Tool / function
          │ search      │
          │ calculator  │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │  LLM Node   │
          └─────────────┘
```

所以最准确的理解是：


| 概念           | 是什么                         | 例子                        |
| ------------ | --------------------------- | ------------------------- |
| **Tool**     | 一个可以被模型调用的能力/function       | `get_weather(city)`       |
| **ToolNode** | LangGraph 中负责执行 Tool 的 Node | `ToolNode([get_weather])` |
| **Node**     | Graph 的一个计算步骤               | `agent_node`、`tools_node` |
| **Edge**     | 决定 Node 之间怎么流转              | `agent → tools → agent`   |


尤其要注意：**不是“一把 Tool = 一个 Node”**。

一个 `ToolNode` 完全可以管理很多 tools：
```python
tools = [
    search_web,
    get_weather,
    query_database,
    send_email,
    calculator
]

tool_node = ToolNode(tools)
```

图里仍然可能只有一个：
```text
[agent]
   |
   v
[tools]
```

但 `[tools]` 内部根据 LLM 的 `tool_call.name` 去找到对应函数执行：
```text
tool_call.name == "search_web"
        ↓
执行 search_web(...)

tool_call.name == "calculator"
        ↓
执行 calculator(...)
```

这也是我比较推荐你建立的心智模型：
```text
Node = 工作流步骤
Tool = 某个步骤里可以调用的具体能力
```

比如一个更完整的 LangGraph：
```text
START
  │
  ▼
┌──────────┐
│ planner  │  Node
└────┬─────┘
     ▼
┌──────────┐
│  agent   │  Node
└────┬─────┘
     │ tool call
     ▼
┌──────────┐
│  tools   │  ToolNode
│ ──────── │
│ search() │  Tool
│ sql()    │  Tool
│ email()  │  Tool
└────┬─────┘
     │
     ▼
┌──────────┐
│  agent   │
└──────────┘
```

还有一个容易混淆的地方：**普通函数本身也可以直接作为 Node**：
```python
def my_node(state):
    ...
    return {"foo": "bar"}

graph.add_node("my_node", my_node)
```

所以从 Python 代码看：
```text
Tool 可以是 function
Node 也可以是 function
```

但**语义不一样**：
```text
Node function
    = Graph 调度器决定什么时候执行

Tool function
    = 通常由 LLM 发出 tool_call 决定调用哪个
```

一句话记住：

> **LangGraph 中，Tool 是能力；Node 是流程。Tool 通常是函数，多个 Tool 通常由** `ToolNode` **这个 Node 统一承载和执行。**

如果你正在自己实现 Agent，我还会进一步区分 `LLM Node → ToolNode → LLM Node` **这套循环到底是怎么靠** `AIMessage.tool_calls` **和** `ToolMessage` **串起来的**——理解这一层以后，LangGraph 的 tool calling 架构基本就通了。

<!-- created: 2026-08-31 19:15:50 -->
<!-- updated: 2026-08-31 19:16:02 -->
