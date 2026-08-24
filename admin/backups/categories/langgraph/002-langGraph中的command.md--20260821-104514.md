# langGraph中的command

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [LangGraph从workflow编排器到agent runtime的转型](LangGraph从workflow编排器到agent runtime的转型) | [LangGraph 构建多智能体系统的核心范式](LangGraph 构建多智能体系统的核心范式) →

## 



## 根据LLM推理结果来动态决定goto目标

> 完美的应用场景！这是 LangGraph 中 `Command` 最核心的用法——**让 LLM 自己决定下一步去哪儿**，通常结合\*\*工具调用（Tool Calling）**或**结构化输出（Structured Output）\*\*来实现。

下面我给你写一个**“智能客服路由”**的完整代码例子。在这个例子里，<u style="text-decoration-color: rgb(230, 57, 70)">LLM 会读取用户的问题，然后动态决定是把问题发给“退货组”、“技术组”还是“人工客服”</u>。

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

如果 LLM 没有返回工具调用（例如用户说“今天天气真好”），上面代码的 `else` 分支会默认路由到 `human_node`（人工）。你也可以更激进一点，在 `router_node` 里加入**重试逻辑**或**修正提示词**，确保它永远输出有效的结构化指令。<!-- created: 2026-08-20 17:58:57 -->
<!-- updated: 2026-08-21 10:43:48 -->
