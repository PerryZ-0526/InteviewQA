# langGraph 中的 command

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph从workflow编排器到agent runtime的转型](LangGraph从workflow编排器到agent runtime的转型) | [LangGraph 构建多智能体系统的核心范式](LangGraph 构建多智能体系统的核心范式) →

## 详细解析

## **什么是 Command**

Command 是 LangGraph 中的一个特殊返回类型，当一个节点函数返回 Command 时，它不仅能更新图的状态，还能直接指定下一步要执行哪个节点。它将“状态更新”和“流程控制”整合到同一个返回值中。
```
from langgraph.types import Command

def my_node(state: State) -> Command:
    return Command(
        goto="next_node",      # 指定下一个要执行的节点
        update={"key": value}  # 更新状态
    )
```

## **为什么需要 Command**

在传统的 LangGraph 架构中，图由**节点**和**边**构成。节点处理状态，边（尤其是条件边）负责路由控制。这种方式的局限性在于：

- 当逻辑非常动态时，无法预先穷举所有可能的跳转路径
- 节点自身想做路由决策，却要依赖外部的边函数
- 多智能体系统中需要频繁进行“交接”（handoff）
- 人机交互、中断恢复等场景需要灵活的流程控制

Command 的引入打破了“节点处理逻辑、边处理路由”的固定分工，让节点自己决定下一步走向。

## **Command 的核心参数**

根据官方 API 文档，Command 接受以下参数：


| **参数**   | **类型**                           | **说明**                                        |
| :-------- | :-------------------------------- | :--------------------------------------------- |
| `goto`   | `str` | `Sequence[str]` | `Send` | 指定下一步要执行的节点名称，可以是一个节点或多个节点                    |
| `update` | `Any`                            | 要应用到图状态的更新内容                                  |
| `resume` | `Any`                            | 用于恢复中断执行的恢复值，与 `interrupt()` 配合使用             |
| `graph`  | `str | None`                     | 指定命令发送到哪个图，`None` 表示当前图，`Command.PARENT` 表示父图 |


## **Command 的主要使用场景**

### **1. 多智能体交接（Handoff）**

Command 最典型的应用场景是**多智能体系统中的任务交接**。当一个智能体完成工作后，它可以通过 Command 直接将控制权移交给另一个专业智能体。

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
def agent_node(state: State) -> Command:
    if need_expert_help(state):
        return Command(
            goto="expert_agent",
            update={"messages": state["messages"] + [new_message]}
        )
    return Command(goto="END")
```

### **2. 动态路由与状态更新同步进行**

当节点既需要更新状态又需要决定路由时，Command 是最佳选择。条件边只能路由，不能同时更新状态；而 Command 将两者合二为一。

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
```
def classify_node(state: State) -> Command:
    if "天气" in state["user_input"]:
        return Command(
            goto="search_node",
            update={"query": state["user_input"]}  # 同时更新状态
        )
    return {"final_answer": "无法处理此问题"}
```

### **3. 中断与恢复（Human-in-the-Loop）**

Command 的 `resume` 参数可以与 `interrupt()` 配合，实现人机交互场景：

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
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

### **4. 嵌套图导航**

Command 支持在嵌套图（父图与子图）之间导航，通过 `graph` 参数指定目标图。
```
return Command(
    goto="subgraph_node",
    graph=Command.PARENT,  # 跳转到父图的节点
    update={"data": value}
)
```

## **Command vs 条件边（Conditional Edge）**


| **维度**    | **条件边**    | **Command**  |
| :--------- | :---------- | :------------ |
| **定义位置**  | 在图构建时外部定义  | 在节点内部返回      |
| **状态更新**  | 不更新状态      | 同时更新状态       |
| **动态性**   | 路由函数根据状态判断 | 节点自身决定去向     |
| **嵌套图支持** | 不支持        | 支持跨图跳转       |
| **适用场景**  | 静态、可预知的分支  | 动态、复杂的多智能体交互 |


简单来说：**如果需要同时更新状态和路由到不同节点，使用 Command。**

## **完整示例**

以下是一个完整的问答机器人示例，展示了 Command 的典型用法：

<span style="color: rgb(15, 17, 21); font-size: 12px">python</span>
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

## **注意事项**

1. **类型提示**：可以在节点函数上使用类型提示，让图知道可能的跳转目标，便于可视化
2. **无边图（Edgeless Graph）**：使用 Command 后，节点之间不再需要预先定义边，实现了“无边”的灵活图结构
3. **与 Send 的区别**：`Send` 用于并行执行（如 Map-Reduce），而 `Command` 用于顺序控制流


## 根据LLM推理结果来动态决定goto目标

> 完美的应用场景！这是 LangGraph 中 `Command` 最核心的用法——**让 LLM 自己决定下一步去哪儿**，通常结合\*\*工具调用（Tool Calling）**或**结构化输出（Structured Output）\*\*来实现。

下面我给你写一个\*\*“智能客服路由”\*\*的完整代码例子。在这个例子里，<u style="text-decoration-color: rgb(230, 57, 70)">LLM 会读取用户的问题，然后动态决定是把问题发给“退货组”、“技术组”还是“人工客服”</u>。

### **1. 核心思路**

我们不给 LLM 普通的文本回复权限，而是**强制要求它必须调用一个叫** `route_to_department` **的工具**。LangGraph 捕获到这个工具调用请求后，直接解析参数，并通过 `Command` 路由到对应的节点。

### **2. 完整代码示例**
```
from typing import Literal
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.types import Command
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import AIMessage, ToolMessage

# 1. 定义工具：这个工具不实际执行，只作为LLM的输出“开关”
@tool
def route_to_department(
    department: Literal["returns", "tech_support", "human_agent"]
) -> str:
    """
    根据用户的问题，将用户路由到最合适的部门。
    """
    return f"Routing to {department}"

# 2. 绑定工具到模型
llm = ChatOpenAI(model="gpt-4o-mini")
llm_with_tools = llm.bind_tools([route_to_department])

# 3. 定义图状态 (继承MessagesState，包含messages列表)
class State(MessagesState):
    pass

# 4. 定义节点函数：路由器
def router_node(state: State) -> Command[Literal["returns_node", "tech_node", "human_node"]]:
    """
    这个节点的任务：让LLM推理并调用工具，根据工具调用结果动态路由。
    """
    # 调用LLM
    response: AIMessage = llm_with_tools.invoke(state["messages"])
    
    # 检查LLM是否调用了我们的工具
    if response.tool_calls:
        # 提取第一个工具调用
        tool_call = response.tool_calls[0]
        # 解析参数，获取LLM推理出的部门名称
        department = tool_call["args"]["department"]
        
        # 映射到具体的图节点名称
        route_map = {
            "returns": "returns_node",
            "tech_support": "tech_node",
            "human_agent": "human_node"
        }
        goto_target = route_map[department]
        
        # 关键：返回Command，更新状态（追加AI的回复），并强制跳转到目标节点
        return Command(
            update={
                "messages": [response]  # 将AI的回复（含工具调用）追加到历史
            },
            goto=goto_target
        )
    else:
        # 如果LLM没调用工具（比如用户瞎聊），默认丢给人工
        return Command(
            update={"messages": [response]},
            goto="human_node"
        )

# 5. 定义下游处理节点（模拟不同部门的回复逻辑）
def returns_node(state: State) -> Command[Literal["__end__"]]:
    # 获取用户最后的问题
    user_question = state["messages"][-1].content
    # 模拟处理
    result = f"【退货部门】已收到您的退货请求：'{user_question}'，请提供订单号。"
    return Command(update={"messages": [AIMessage(content=result)]}, goto=END)

def tech_node(state: State) -> Command[Literal["__end__"]]:
    user_question = state["messages"][-1].content
    result = f"【技术部门】正在排查您的技术问题：'{user_question}'，请稍候。"
    return Command(update={"messages": [AIMessage(content=result)]}, goto=END)

def human_node(state: State) -> Command[Literal["__end__"]]:
    user_question = state["messages"][-1].content
    result = f"【人工客服】为您转接人工中，您的问题：'{user_question}' 已记录。"
    return Command(update={"messages": [AIMessage(content=result)]}, goto=END)

# 6. 构建工作流
builder = StateGraph(State)

# 添加所有节点
builder.add_node("router", router_node)
builder.add_node("returns_node", returns_node)
builder.add_node("tech_node", tech_node)
builder.add_node("human_node", human_node)

# 入口指向路由节点
builder.add_edge(START, "router")

# 注意：这里不需要 add_conditional_edges！
# 因为路由完全由 router_node 返回的 Command 来决定。
# 编译器会自动捕获 Command 中的 goto 指向。

# 编译
graph = builder.compile()

# 7. 测试运行
if __name__ == "__main__":
    # 测试场景1：退货
    print("=== 测试退货 ===")
    inputs = {"messages": [("user", "我想退掉昨天买的那个红色书包")]}
    for chunk in graph.stream(inputs, stream_mode="values"):
        if "messages" in chunk:
            print(chunk["messages"][-1].content)
            print("-" * 20)

    print("\n=== 测试技术支持 ===")
    inputs = {"messages": [("user", "App点击登录按钮闪退怎么办？")]}
    for chunk in graph.stream(inputs, stream_mode="values"):
        if "messages" in chunk:
            print(chunk["messages"][-1].content)
            print("-" * 20)
```

### **3. 这段代码的精妙之处（为什么是动态的？）**

- **路由逻辑藏在数据里**：你不在代码里写 `if "退货" in query` 这种硬编码，而是把判断权完全交给 LLM。
- `bind_tools` **强制约束**：因为 LLM 必须选择 `department` 的具体值（`returns` / `tech_support` / `human_agent`），所以 `goto` 目标是**由 LLM 输出的具体文本字符串转化而来**的。
- **极简的图定义**：你注意到没有？整张图**只定义了入口边 (**`START -> router`**)**，完全没有 `add_conditional_edges`。所有的分支逻辑都封装在 `router_node` 内部通过 `Command` 释放出来，非常干净。

### **4. 进阶小技巧：如果 LLM 不听话怎么办？**
<!-- created: 2026-08-20 17:58:57 -->
<!-- updated: 2026-08-21 15:25:09 -->
