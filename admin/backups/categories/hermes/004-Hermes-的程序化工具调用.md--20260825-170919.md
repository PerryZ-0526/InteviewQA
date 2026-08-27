# ✅Hermes 的程序化工具调用

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [Hermes-的-Honcho-辩证式用户建模](Hermes-的-Honcho-辩证式用户建模) | 无 →

## 面试直接答

我理解 Hermes 的 Programmatic Tool Calling，本质上是在解决传统 ReAct Agent 的一个效率问题：很多多工具任务中，真正需要 LLM 做判断的只有开始的任务规划和最后的结果总结，中间大量步骤其实只是循环、过滤、排序、重试、批量抓取这类确定性控制流。如果这些步骤也全部走“LLM 推理一次—调用 Tool—Tool Result 回填上下文—LLM 再推理”的模式，不仅模型调用次数多，而且<u style="text-decoration-color: rgb(230, 57, 70)">大量中间结果会不断占用上下文</u>。

所以 Hermes 在 `execute_code` 里提供了一种<u style="text-decoration-color: rgb(230, 57, 70)">代码化的工具编排方式</u>：模型先一次性生成 Python 脚本，把整个多步流程表达成程序，然后由 Python 负责执行循环、条件判断和数据处理，最终只把整理后的结果返回给模型。

### 它的实现不是简单让 Python 直接访问各种外部服务，而是做了一层 RPC 工具代理

Hermes 会根据当前会话允许使用的工具动态生成 `hermes_tools.py`，例如 Python 里可以调用 `web_search()`、`web_extract()`、`read_file()` 等函数，但这些函数本身只是 RPC Stub。脚本调用它们以后，请求通过 Unix Domain Socket，Windows 下则通过本地 TCP，传回 Hermes 主进程，再由主进程原来的 Tool Dispatcher 真正执行工具。因此 Python 的角色只是“工作流编排器”，真正的工具权限、认证信息和执行逻辑仍然掌握在 Hermes 主进程里。这样也避免了直接把 API Key、Token 等敏感信息暴露给模型生成的脚本，同时还能继续复用原有的工具白名单和权限控制。

### 这个设计最大的收益是上下文和调用成本

> 比如我要搜索 50 个网页、逐个抓取正文、筛选其中符合条件的内容。传统 ReAct 可能需要模型反复参与几十次，每个网页正文都可能进入上下文；而 Programmatic Tool Calling 下，<u style="text-decoration-color: rgb(230, 57, 70)">50 次抓取的结果只在 Python 进程内部流转，Python 自己完成过滤和聚合，最后</u> `print` <u style="text-decoration-color: rgb(230, 57, 70)">出 5 条最终结果给 LLM</u>。

严格来说不是“完全零上下文成本”，因为生成脚本和最终输出仍然需要 Token，但中间几十次 Tool Result 基本不进入 LLM 上下文。因此它实际上是`把控制流从 LLM 的 Token Space 下沉到了 Python Runtime`：LLM 负责决定“怎么做”，Python 负责稳定地执行“做很多次”。

### 我认为这里还需要和子 Agent 区分

子 Agent 是把任务交给另一个拥有独立上下文和 LLM Loop 的 Agent，它仍然需要模型持续推理，适合需要判断、探索和复杂分析的任务；`execute_code` 中间<u style="text-decoration-color: rgb(230, 57, 70)">没有新的 LLM 推理，更适合机械化、确定性的流水线</u>。

> 所以 Hermes 比较合理的做法是先用 `execute_code` <u style="text-decoration-color: rgb(230, 57, 70)">完成批量收集、清洗和统计</u>，再把<u style="text-decoration-color: rgb(230, 57, 70)">真正需要认知判断的部分交给主 Agent 或子 Agent</u>。

### 与 dsh 的 code mode 的异同

从方法论上说，我不会把 Hermes 这套机制和 DeepSeek Harness 的 Code Mode 看成两种本质不同的方法，它们属于同一种 `Code-Mediated Tool Use` 思路：都让 LLM 生成代码去组合工具，从而<u style="text-decoration-color: rgb(230, 57, 70)">减少中间模型往返和上下文膨胀</u>。

区别主要在工程抽象上，Hermes 是在原有 Tool 系统里增加一个特殊的 `execute_code` 工具，而 dsh 更进一步把 Code Mode 做成 ToolRuntime 的一种<u style="text-decoration-color: rgb(230, 57, 70)">一等呈现模式</u>。

> 所以所谓“一等呈现模式”主要说的是`架构地位`：Code Mode 不是一个特殊工具，而是和 Native Tool Calling 平级的工具呈现协议；但从最终解决的问题和运行机制来看，它和 Hermes Programmatic Tool Calling 依然属于同一种思路，没有方法论上的本质差异。

---

对我来说，Hermes 这部分最核心的一句话就是：**不要让 LLM 充当低效的流程解释器，而是<u style="text-decoration-color: rgb(230, 57, 70)">让 LLM 写流程，让程序跑流程</u>。**

## 详细解析

根据 Hermes 当前源码，这句话的核心不是“Python 能调用工具”，而是：

> **把原本需要 LLM 连续参与的多轮 ReAct 工具链，改写成一次** `execute_code` **调用，让 Python 在子进程里自己完成循环、分支、过滤和多次工具调用，最后只把压缩后的结果返回给 LLM。**

源码入口主要在 `tools/code_execution_tool.py`。当前实现很清楚地把它叫做 Programmatic Tool Calling。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py?utm_source=chatgpt.com "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

### 1. 为什么需要它

普通 Agent 调工具的过程通常是：
```text
LLM
 ↓
web_search
 ↓
搜索结果进入上下文
 ↓
LLM 再推理
 ↓
web_extract
 ↓
网页全文进入上下文
 ↓
LLM 再筛选
 ↓
web_extract
 ↓
……
 ↓
最终回答
```

问题是每一步都要重新经过 LLM。

假设搜索 20 个网页：
```text
搜索结果
+ 20 次网页正文
+ 每轮 tool result
+ 每轮 assistant reasoning
```

都会<u style="text-decoration-color: #e63946">不断撑大上下文</u>。

Hermes 的思路是：如果中间步骤主要是**机械处理，而不是需要模型判断**，那就没必要让 LLM 每一步都参与。

改成：
```text
LLM
 ↓
生成一段 Python
 ↓
execute_code
 ↓
Python 内部：
    搜索
    循环
    抓网页
    过滤
    排序
    去重
    聚合
 ↓
print(最终结果)
 ↓
LLM
```

> 官方工具描述甚至直接提示模型：当预计有 **3 次以上工具调用，并且中间存在处理逻辑、循环、条件分支或批量过滤**时优先考虑 `execute_code`。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py?utm_source=chatgpt.com "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

---

### 2. 第一步：LLM 生成 Python 脚本

比如用户说：

> 搜 10 篇关于 Agent Memory 的文章，只保留 2026 年的，提取正文，再找出提到长期记忆的文章。

普通 ReAct 可能十几轮工具调用。

Hermes 可以让模型一次生成：
```python
from hermes_tools import web_search, web_extract

results = web_search("Agent memory 2026", limit=10)

selected = []

for item in results["data"]["web"]:
    if "2026" not in item.get("description", ""):
        continue

    page = web_extract([item["url"]])

    text = str(page)

    if "long-term memory" in text.lower():
        selected.append({
            "title": item["title"],
            "url": item["url"]
        })

print(selected)
```

注意这里的：
```python
from hermes_tools import web_search, web_extract
```

不是普通 Python 包。

`hermes_tools.py` 是 **Hermes 每次执行** `execute_code` **时<u style="text-decoration-color: #e63946">临时生成的 RPC Stub 模块</u>**。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

---

### 3. 第二步：Hermes 动态生成 `hermes_tools.py`

源码里的：
```python
generate_hermes_tools_module(...)
```

会<u style="text-decoration-color: #e63946">根据当前 Session 允许使用的工具，动态生成函数</u>。

例如最终生成出来的逻辑类似：
```python
def web_search(...):
    return _call("web_search", args)

def read_file(...):
    return _call("read_file", args)
```

它自己并不真正执行搜索。

它只是 RPC 客户端代理：
```text
Python 中的 web_search()
        ↓
hermes_tools._call()
        ↓
RPC
        ↓
Hermes 主进程
        ↓
真正 web_search tool
```

源码当前明确限制了 sandbox 里可代理的 7 个工具：
```text
web_search
web_extract
read_file
write_file
search_files
patch
terminal
```

而且实际暴露的是：
```text
当前 Session 已启用工具
        ∩
SANDBOX_ALLOWED_TOOLS
```

所以 `execute_code` 并不能随意获得 Hermes 所有工具。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

---

### 4. 第三步：为什么还需要 RPC，而不是 Python 直接调用工具

这是整个设计最关键的地方。

假如 `web_search` 需要 Nous Portal 的凭证，最粗暴的方案是：
```text
把 API Key
↓
塞进 Python 子进程
↓
Python 自己调 Web API
```

Hermes 没这么做。

而是：
```text
Python 子进程
没有真正的 web_search 实现
也不需要拿到 API Key
          ↓
       RPC 请求
          ↓
Hermes 主进程
          ↓
原来的 tool dispatcher
          ↓
真正执行工具
```

因此**<u style="text-decoration-color: #e63946">工具能力仍然属于 Hermes 主进程，Python 只是编排者</u>**。

当前源码还会清理子进程环境变量，特别过滤包含：
```text
KEY
TOKEN
SECRET
PASSWORD
CREDENTIAL
AUTH
...
```

这类敏感变量，避免把主 Agent 的认证信息直接传给模型生成的 Python。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

---

### 5. 本地执行时，RPC 的完整链路

本地模式大致是：
```text
AIAgent
   │
   │ tool call:
   │ execute_code(code="...")
   ↓
code_execution_tool.py
   │
   ├─ 生成临时目录
   │
   ├─ 写入 script.py
   │
   ├─ 生成 hermes_tools.py
   │
   ├─ 创建 RPC socket
   │
   └─ 启动 Python 子进程
             │
             ↓
         script.py
             │
             │ import hermes_tools
             ↓
     hermes_tools.web_search()
             │
             ↓
         _call(...)
             │
             │ JSON RPC
             ↓
       Unix Domain Socket
             │
             ↓
      Hermes RPC thread
             │
             ↓
     handle_function_call()
             │
             ↓
       真正 web_search
             │
             ↓
        result 返回 RPC
             │
             ↓
          Python
```

Linux/macOS 本地主要使用 Unix Domain Socket；Windows 当前代码会退化到 `127.0.0.1` 的 loopback TCP。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

RPC 请求非常简单，大致就是：
```json
{
  "tool": "web_search",
  "args": {...},
  "token": "..."
}
```

主进程会检查 RPC token、工具白名单、调用次数，然后才进入：
```python
handle_function_call(tool_name, tool_args)
```

也就是说，<span style="background-color: #fff3cd">最终还是走 Hermes 正常的 Tool Dispatcher，而不是另起一套工具实现</span>。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

---

### 6. 所谓“中间过程零上下文成本”到底是什么意思

这里文档中的“零上下文成本”严格说需要加一个限定。

不是整个 `execute_code` **零 token**。

因为：

- LLM 生成 Python 代码要 token；
- `execute_code` 的 tool call 参数要进入上下文；
- Python 最终输出要进入上下文。

真正省掉的是：

> **Python 内部每一次工具调用产生的中间 Tool Result，不进入 LLM context。**

例如：
```python
for url in 50_urls:
    result = web_extract(url)
    ...
```

这 50 个网页正文：
```text
网页1 → Python
网页2 → Python
网页3 → Python
...
网页50 → Python
```

只存在于 Python 执行过程中。

LLM 最终可能只看到：
```text
共分析 50 个网页，
符合条件 7 个：
1. ...
2. ...
...
```

源码注释直接写明：

> only the script's stdout is returned to the LLM; intermediate tool results never enter the context window.

([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

所以更严谨的说法应该是：

> **中间工具结果的上下文成本接近于零，而不是整个执行过程零 token。**

---

### 7. Python 在这里承担的是“确定性控制流”

这个设计最适合：
```text
for
if/else
filter
map
reduce
sort
regex
JSON 解析
统计
批量文件处理
重试
```

例如：
```python
for file in files:
    content = read_file(file)

    if "TODO" not in content:
        continue

    matches = ...
```

这些东西让 LLM 一轮一轮做，其实非常浪费。

Python 做控制流更稳定：
```text
LLM 负责：
“我要怎么解决问题？”

Python 负责：
“把这个确定性流程执行 50 次。”

Tool 负责：
“真正访问外部世界。”
```

这就是 `execute_code` 最核心的设计思想。

源码甚至给 `hermes_tools` 内置了：
```text
json_parse()
shell_quote()
retry()
```

帮助模型写稳定的数据处理代码。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

---

### 8. 它不是子 Agent

这个区别非常重要。

`execute_code`：
```text
一个 LLM
↓
生成程序
↓
Python 自己机械执行
↓
没有新的 LLM 推理
```

而 `delegate_task`：
```text
父 Agent
↓
创建 Child Agent
↓
Child Agent 有自己的：
上下文
LLM
ReAct Loop
工具调用
推理
↓
返回结果
```

官方文档也明确区分二者：


|          | `execute_code` | `delegate_task` |
| -------- | -------------- | --------------- |
| 中间执行者    | Python         | LLM 子 Agent     |
| 是否持续推理   | 否              | 是               |
| 适合       | 机械流水线          | 复杂判断            |
| 上下文      | 无独立对话上下文       | 独立上下文           |
| Token 成本 | 很低             | 更高              |


([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/delegation.md?utm_source=chatgpt.com "hermes-agent/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/delegation.md at main · NousResearch/hermes-agent · GitHub"))

所以最合理的组合经常是：
```text
execute_code
→ 批量收集、清洗数据

delegate_task
→ 对清洗后的数据做复杂分析
```

Hermes 官方自己的 delegation guide 就推荐这种模式。([GitHub](https://github.com/nousresearch/hermes-agent/blob/main/website/docs/guides/delegation-patterns.md?utm_source=chatgpt.com "hermes-agent/website/docs/guides/delegation-patterns.md at main · NousResearch/hermes-agent · GitHub"))

---

### 9. 为什么说它把“多轮 ReAct”折叠成“一轮”

假设需要：
```text
Search A
→ Extract A
→ Search B
→ Extract B
→ 去重
→ Extract C
→ 统计
```

传统 ReAct：
```text
LLM → Tool → LLM → Tool → LLM → Tool → LLM ...
```

可能是 7 次甚至更多模型推理。

`execute_code`：
```text
LLM
 ↓
一次生成脚本
 ↓
Python:
 Search
 Extract
 Search
 Extract
 去重
 Extract
 统计
 ↓
最终结果
 ↓
LLM
```

因此这里的“single inference turn”本质上是：

> **把控制流从 LLM token space 下沉到 Python runtime。**

我认为这是 Hermes 这里最值得讲的一句话。

---

### 10. 安全边界也不能说得太理想

它不是严格意义上的高强度沙箱。

当前代码确实做了：

- 工具白名单；
- RPC token；
- 最多默认 50 次 Tool Call；
- 默认 300 秒超时；
- stdout 50 KB 限制；
- stderr 10 KB；
- 敏感环境变量清理；
- `terminal` 禁止 background、pty 等参数；
- `execute_code` 本身有 approval guard。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/code_execution_tool.py "hermes-agent/tools/code_execution_tool.py at main · NousResearch/hermes-agent · GitHub"))

但 Python 子进程本身仍然可以直接执行 Python/OS API。2026 年仓库里甚至有 issue 指出：
```python
open("~/.hermes/config.yaml", "w")
```

这种原生 Python 文件操作可能绕开 Hermes `write_file` 工具自己的路径保护。([GitHub](https://github.com/NousResearch/hermes-agent/issues/49578?utm_source=chatgpt.com "[Bug]: execute_code (Python) bypasses agent file edit restrictions · Issue #49578 · NousResearch/hermes-agent · GitHub"))

所以更准确的评价是：

> **RPC 工具调用有明确安全边界，但** `execute_code` **本身执行的是模型生成的 Python，因此真正的安全边界还取决于它所在的进程/容器隔离环境。**

---

最后回到你文档里的那句话：

> “Python 脚本通过 RPC 调用工具，把多步流水线折叠成一次执行，中间过程零上下文成本。”

更严谨地理解就是：
```text
LLM 负责生成“程序”
        ↓
execute_code 创建受控 Python 子进程
        ↓
hermes_tools.py 把 Tool 封装成 RPC Stub
        ↓
Python 用 for/if/filter 等控制流组合多个 Tool
        ↓
RPC 回到 Hermes 主进程真正执行 Tool
        ↓
大量中间 Tool Result 只在 Python 中流转
        ↓
只有最终 stdout 返回 LLM
```

所以它真正解决的问题是：

> **不要让 LLM 充当低效的流程解释器；让 LLM 写流程，让 Python 跑流程。**

这也是为什么它和 Claude Code 子 Agent 隔离虽然都在“省主上下文”，但机制完全不同：**Claude Code 是把中间推理放到另一个 LLM 上下文，Hermes** `execute_code` **是直接<u style="text-decoration-color: #e63946">把中间推理中可确定化的部分消掉，变成程序执行</u>。**

## 与dsh Code Mode的差异












你的感觉基本对：**从核心机制看，Hermes 的 Programmatic Tool Calling 和 dsh 的 Code Mode 没有本质区别。**

> **差异主要是**`工程抽象层级`**和**`接入方式`**。**

Hermes 这套机制首次进入主线是在 **2026 年 2 月 20 日**，commit `783acd7`，标题就是 `feat: implement code execution sandbox for programmatic tool calling`。这次提交一次性加入了 `execute_code`、Python 子进程、UDS RPC、`hermes_tools` 工具代理、调用次数/超时限制等，并在 TODO 中把 Programmatic Tool Calling 从“未开始”改成“Implemented (MVP)”。([GitHub](https://github.com/NousResearch/hermes-agent/commit/783acd712d6a382cd66efc5f8e76b1efc13211dc "feat: implement code execution sandbox for programmatic tool calling · NousResearch/hermes-agent@783acd7 · GitHub"))

而 dsh 的 Code Mode 实现说明文档日期是 **2026 年 6 月 15 日**，比 Hermes 晚约 4 个月。不过不能据此说 dsh 抄 Hermes，因为 dsh 自己明确说它的设计受到 **Cloudflare Code Mode** 思路启发。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-06-15-code-mode.md "deepseek-harness/.agents/notes/implemented/feature/2026-06-15-code-mode.md at master · deepseek-ai/deepseek-harness · GitHub"))

核心机制实际上完全同构：
```text
传统 ReAct
LLM → Tool → LLM → Tool → LLM → Tool

Hermes PTC
LLM → Python程序 → 工具SDK/RPC → 多次Tool → 最终输出 → LLM

dsh Code Mode
LLM → TS/Python程序 → 工具SDK/Binding → 多次Tool → 最终输出 → LLM
```

共同思想都是：

> **让 LLM 写一段程序来编排工具，<u style="text-decoration-color: #e63946">把循环、分支、过滤等控制流从 LLM 推理循环下沉到代码运行时</u>，中间 Tool Result 不回灌模型上下文。**

所以如果问“技术思想有无本质区别”，我的回答是：**没有。**

真正的区别主要有这几个：


|            | Hermes PTC                                    | dsh Code Mode                                                             |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| 定位         | Agent 的一个额外 `execute_code` Tool               | `ToolRuntime` 的一种一等“工具呈现模式”                                               |
| 模型看到工具     | 原生 Tool 仍然存在，必要时选择 `execute_code`             | `code` 模式下可以只给模型 `run_code + SDK`，直接隐藏全部原生 Tool schema                    |
| 代码接口       | `from hermes_tools import web_search...`      | `await tools.web_search(...)`                                             |
| 工具桥接       | Python 子进程 → UDS/RPC → Hermes Tool Dispatcher | Worker → MessagePort Binding → ToolRuntime                                |
| 默认语言       | Python                                        | 最初 TypeScript，现在运行时接口也支持 Python                                           |
| Runtime 抽象 | 和 Hermes `execute_code` 实现绑定较深                | 抽成独立 `CodeRuntime` capability seam，可替换 worker/container/Python runtime    |
| 工具范围       | `execute_code` 内有明确白名单                        | <u style="text-decoration-color: #e63946">根据当前 Tool Registry 自动生成 SDK</u> |
| 并发         | Hermes 侧相对直接                                  | dsh 后来做了 bounded parallel subcalls，复用原生工具并发策略                             |


dsh 源码里最明显的架构差异是：
```text
mode = native
→ 给模型所有 JSON Schema Tools

mode = code
→ 不给模型这些 Tools
→ 只给 run_code
→ system prompt 放自动生成的 tools SDK

mode = both
→ 两套都给
```

也就是说，**dsh 把 Code Mode 提升成了 <u style="text-decoration-color: #e63946">Tool Registry 的“呈现层协议”</u>**，而 Hermes 更像：
```text
普通工具系统
+
增加一个特殊 execute_code 工具
```

dsh 甚至把代码执行器进一步抽象成：
```text
dsh-tools
    ↓
CodeRuntime interface
    ↓
worker-thread runtime
    / Python runtime
    / future container runtime
```

Runtime 根本不知道什么叫 `web_search`、`read_file`，只知道“给我程序 + 一组 `async bindings`，我负责执行”。这一层解耦确实比 Hermes 更彻底。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-06-15-code-mode.md "deepseek-harness/.agents/notes/implemented/feature/2026-06-15-code-mode.md at master · deepseek-ai/deepseek-harness · GitHub"))

但这属于**架构工程差异，不是 Agent 方法论差异**。

所以之前文档里如果把两者写成“两种不同解法”，我现在会收紧成：

> **Hermes Programmatic Tool Calling 与 dsh Code Mode 本质上属于同一种 Code-Mediated Tool Use 范式：都让 LLM 生成程序来组合工具调用，从而消除中间 LLM round-trip 和上下文膨胀。**
>
> **区别在于 Hermes 将它实现为一个 Python** `execute_code` **工具，而 dsh 将 Code Mode进一步抽象为 ToolRuntime 的一等工具呈现模式与**`可插拔 CodeRuntime`**。**

我反而认为你说的“我没看出本质区别”是对的。**之前把它们表述成“三种解法”时，Hermes PTC 和 dsh Code Mode 应该归为同一类；真正不同的是 Claude Code subagent——它仍然用另一个 LLM 做中间推理，而 Code Mode 是把可确定化的中间推理直接变成程序执行。**

## dsh 把 Code Mode 做成 ToolRuntime 的“一等呈现模式”

> 这里说 dsh 把 Code Mode 做成 `ToolRuntime` 的“一等呈现模式”，意思是它不是简单地在原有工具列表里额外加一个 `run_code` 工具，而是从<u style="text-decoration-color: rgb(230, 57, 70)">更底层规定“这一组 Tool 到底以什么形式暴露给模型”</u>。

在 dsh 里，`ToolRuntime` 本身就维护一个 `mode` 配置：`native`、`code`、`both`。

- `native` 模式下，模型直接看到每个工具的 JSON Schema，然后像传统 function calling 一样调用；
- `code` 模式下，这些<u style="text-decoration-color: rgb(230, 57, 70)">原生 Tool Schema 会直接从模型视野里消失，模型只能看到一个统一入口</u> `run_code`，同时 system prompt 里会自动生成当前所有可用工具对应的 TypeScript/Python SDK，模型必须写程序，通过类似 `tools.web_search()` 的方式间接调用工具；
- `both` 则两种方式同时开放。

也就是说，dsh 把“原生 Tool Calling”和“Code Mode”看成**同一批底层 Tool 的两种模型侧表示协议**，工具本身只注册一次，权限、执行器、超时、重试、并发控制、日志等仍然走同一套 Tool Pipeline，只是给 LLM 的“接口长什么样”可以切换。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md?utm_source=chatgpt.com "deepseek-harness/packages/core/tools/README.md at master · deepseek-ai/deepseek-harness · GitHub"))

更进一步，`run_code` 里的程序调用 `tools.xxx()` 时，也不会绕开原来的工具系统，而是重新进入 `pre-execute → guard → execute → post-execute → result` 这条完整执行链，所以 Code Mode 并不是第二套 Tool Runtime，而只是 ToolRuntime 的另一种 presentation。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-06-15-code-mode.md?utm_source=chatgpt.com "deepseek-harness/.agents/notes/implemented/feature/2026-06-15-code-mode.md at master · deepseek-ai/deepseek-harness · GitHub"))

这就是它和 Hermes 最明显的工程差异：

- Hermes 更像“已有一堆普通 Tool，再额外注册一个特殊的 `execute_code` Tool，里面通过 `hermes_tools.py + RPC` 去调用其中一部分工具”；
- 而 dsh 是“Tool Registry 天生就支持 native/code/both 三种暴露方式”，<u style="text-decoration-color: rgb(230, 57, 70)">Code Mode 被做到</u>`工具系统的架构层`<u style="text-decoration-color: rgb(230, 57, 70)">，而不是一个外挂能力。</u>
<!-- created: 2026-08-24 10:28:54 -->
<!-- updated: 2026-08-25 15:48:16 -->
