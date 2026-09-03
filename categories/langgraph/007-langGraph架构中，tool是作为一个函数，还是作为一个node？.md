# langGraph架构中，tool是作为一个函数，还是作为一个node？-draft

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph中的subgraph](LangGraph中的subgraph) | 无 →

## 面试直接答

(暂无)

## 详细解析

可以，但要把“实现形式”和“架构角色”分开看。\*\*最准确的结论是：Tool 本质上不是 Node；Tool 通常是一个可调用的函数/对象。但在 LangGraph 的工程设计里，你既可以把 Tool 作为独立函数交给统一的 `ToolNode` 执行，也可以专门做一个 Node，在这个 Node 内部执行某个 Tool。\*\*所以从“架构角色”上说，Tool ≠ Node；从“工作流组织方式”上说，一个 Tool 完全可以被一个独立 Node 包装和执行。官方当前文档也是把 `ToolNode` 定义为“执行 tools 的预构建 node”，而普通 Node 本身通常就是 Python 函数。([Docs by LangChain](https://docs.langchain.com/oss/python/langchain/tools?utm_source=chatgpt.com "Tools - Docs by LangChain"))

最常见、也是最标准的方式是：**Tool 作为独立函数存在，多个 Tool 放进一个 Tool 注册表，由一个** `ToolNode` **统一执行。**
```python
@tool
def search(query: str):
    ...

@tool
def calculator(expression: str):
    ...

@tool
def weather(city: str):
    ...

tools = [
    search,
    calculator,
    weather
]
```

然后：
```python
llm_with_tools = llm.bind_tools(tools)

tool_node = ToolNode(tools)
```

整个架构就是：
```text
                    tools 注册表
                 ┌──────────────┐
                 │ search       │
                 │ calculator   │
                 │ weather      │
                 └──────┬───────┘
                        │
              ┌─────────┴─────────┐
              ↓                   ↓
        bind_tools(tools)    ToolNode(tools)
              ↓                   ↓
          LLM Node          真正执行 Tool
              │                   ↑
              │ tool_calls        │
              └───────────────────┘
```

这里三个 Tool 都**不是 Graph Node**。Graph 可能实际上只有：
```text
START
  ↓
LLM Node
  ↓
ToolNode
  ↓
LLM Node
  ↓
END
```

`ToolNode` 内部管理：
```text
search()
calculator()
weather()
```

这也是官方文档给出的典型模式：`ToolNode([search, calculator])` 本身作为一个 node 被 `builder.add_node("tools", tool_node)` 加进图里。([Docs by LangChain](https://docs.langchain.com/oss/python/langchain/tools?utm_source=chatgpt.com "Tools - Docs by LangChain"))

但是，你也完全可以采用另一种架构：**给某个 Tool 单独做一个 Node。**

例如你不想使用统一的 `ToolNode`：
```python
def search_node(state):
    query = state["query"]
    result = search.invoke({"query": query})

    return {
        "search_result": result
    }

graph.add_node("search", search_node)
```

这时候：
```text
search
```

这个名字对应的是 Graph Node，而 Node 内部调用：
```text
search Tool
```

架构变成：
```text
LLM Node
   ↓
Search Node
   │
   └── search() Tool
   ↓
Analysis Node
   ↓
END
```

所以这里千万不要理解成：
```text
search Tool = Search Node
```

严格来说应该是：
```text
Search Node
    ↓
执行
    ↓
search Tool
```

当然，你甚至可以不使用 `@tool`，直接让 Node 调普通 Python 函数：
```python
def search_web(query):
    return ...

def search_node(state):
    result = search_web(state["query"])
    return {"result": result}
```

这在 LangGraph 完全合法，因为 LangGraph 本身是工作流编排框架，Node 可以是普通 Python 函数。官方 Graph API 当前也明确说明 Node 通常就是同步或异步 Python 函数，通过 `add_node()` 注册进 Graph。([Docs by LangChain](https://docs.langchain.com/oss/python/langgraph/graph-api?utm_source=chatgpt.com "Graph API overview - Docs by LangChain"))

因此，两种设计真正的区别可以这样理解：


| 设计                     | 谁决定调用                            | 是否属于 Graph 拓扑           | 适合什么                    |
| ---------------------- | -------------------------------- | ----------------------- | ----------------------- |
| **Tool 作为独立函数**        | 通常由 LLM 的 `tool_call` 决定         | Tool 本身不是 Node          | Agent 自主选择工具            |
| **ToolNode + 多个 Tool** | LLM 选择具体 Tool，Graph 路由到 ToolNode | ToolNode 是 Node，Tool 不是 | 最典型的 Agent Tool Calling |
| **专门做一个 Tool Node**    | Graph 的 Edge / 条件 Edge 决定        | 是 Graph Node            | 希望精确控制业务流程              |
| **普通函数 Node**          | Graph 决定                         | 是 Node                  | 不需要让 LLM 自主调用           |


这背后其实是一个非常重要的设计区别。

假设你有三个能力：
```text
search
database
calculator
```

如果把它们作为 **Tools**：
```text
                 LLM Node
                    │
              我要用哪个？
                    │
                    ↓
                 ToolNode
              /      |      \
         search   database  calculator
```

那么重点是：

> **LLM 决定“调用哪个能力”。**

而如果把它们设计成三个独立 Node：
```text
LLM Node
   ↓
Search Node
   ↓
Database Node
   ↓
Calculator Node
```

那么重点变成：

> **Graph 决定“下一步执行哪个流程”。**

这就是二者最本质的区别：
```text
Tool
=
LLM 可选择的“能力”

Node
=
Graph 可调度的“步骤”
```

例如用户说：

> “查一下苹果公司的营收，然后计算同比增长率。”

Tool 模式可能是：
```text
User
 ↓
LLM
 ↓
tool_call: search()
 ↓
ToolNode
 ↓
search()
 ↓
LLM
 ↓
tool_call: calculator()
 ↓
ToolNode
 ↓
calculator()
 ↓
LLM
 ↓
Answer
```

这里 LLM 自己决定下一步用哪个工具。

而 Node 模式可能是你事先规定好的：
```text
User
 ↓
ExtractCompany Node
 ↓
SearchFinancialData Node
 ↓
CalculateGrowth Node
 ↓
GenerateAnswer Node
```

这里并不是 LLM 在自由选择工具，而是 **Graph 的拓扑结构已经规定了工作流**。

所以你现在可以把最终结论记成：

> **LangGraph 中 Tool 本质上通常是一个带名称、描述和参数 Schema 的 callable/function，它本身不等于 Node。最常见的方式是多个 Tool 作为独立函数注册到一个** `ToolNode` **中，由 LLM 通过** `tool_calls` **选择具体 Tool；如果业务需要，也可以为某个 Tool 单独设计一个 Node，由 Graph 的 Edge 来控制它何时执行。前者是“LLM 选择能力”，后者是“Graph 调度流程”。**

再浓缩成一句最好记的：

**Tool 是“能做什么”，Node 是“什么时候做、流程走到哪里”。**

这句话基本可以作为你以后判断“这里应该设计成 Tool 还是 Node”的标准。


<!-- created: 2026-08-31 19:15:50 -->
<!-- updated: 2026-09-02 16:39:04 -->
