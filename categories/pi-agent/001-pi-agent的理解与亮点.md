# pi-agent 的理解与亮点

## 题目

谈谈你对 pi-agent 的理解，着重谈其区别于 Claude Code 的亮点。

## 标签

[pi-agent](../../tags/pi-agent.md) | [Agent](../../tags/Agent.md) | [Claude Code](../../tags/Claude Code.md)

## 题目导航

← 无 | 无 →

## 面试直接答

> pi（Pi Agent Harness）是 Mario Zechner 发起、目前由 earendil-works 维护的 MIT 开源 TypeScript Agent Harness。它真正的核心不是“功能比 Claude Code 多”，而是相反：保持一个很小、很透明的 agent loop，把模型接入、上下文转换、工具执行、会话状态和 UI 都做成显式可组合的模块，再通过 Extensions、Skills 和 Pi Packages 把复杂能力放到核心之外。相对 Claude Code，pi 最有辨识度的亮点是多模型/多 provider、跨 provider 上下文交接、细粒度库化嵌入、强可扩展性和高度可观察的会话状态；代价是它刻意不内置 MCP、subagent、plan mode、运行时权限弹窗和 sandbox，安全与复杂工作流更多交给使用者自己组装。

先把定位说准。pi 不是单纯的一个终端聊天工具，也不只是 `pi-agent-core` 这个包，而是一套从 LLM 适配层到 coding agent CLI 的分层 harness。官方仓库当前包含 `pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui` 和 `pi-telemetry` 五个主要包。这里最重要的设计哲学不是“上下文是王道”这一句口号，而是 **minimal core + aggressive extensibility**：作者明确认为模型已经具备较强的 coding-agent 先验，因此核心默认只给 `read/write/edit/bash` 等少量能力，其余工作流尽量通过扩展、Skill、外部 CLI 或 tmux 组合，而不是不断往核心里塞特殊模式。

`pi-agent-core` 的源码非常适合理解一个最小但完整的 agent runtime。`Agent` 类持有 system prompt、model、tools、messages 等状态，并管理事件订阅、abort、steering queue 和 follow-up queue；真正的循环在 `agent-loop.ts`。源码里是一个双层循环：内层持续处理“LLM → tool calls → tool results → 下一轮 LLM”，并在每个 assistant turn 后检查 steering 消息；外层在 agent 原本准备结束时继续消费 follow-up 消息。也就是说它不是只写了一个简单的 `while(tool_calls)`，而是把用户中途打断、任务结束后的追加请求、流式事件和工具批处理都显式纳入 runtime。

上下文管线是另一个很值得讲的地方。Agent 内部维护 `AgentMessage[]`，其中既可以有标准 `user/assistant/toolResult`，也能通过 TypeScript declaration merging 扩展应用自己的消息类型。每次调用模型前，先经过可选的 `transformContext()`，用于裁剪、压缩或注入上下文；再经过必需的 `convertToLlm()`，把应用层消息过滤/转换成模型真正能接受的 `Message[]`。源码在 `streamAssistantResponse()` 里就是按这个顺序执行，因此“应用状态”和“provider 输入”之间有一条非常明确的边界。这种设计对于自己研究上下文压缩、RAG 注入、记忆或 UI-only message 很方便，因为你不需要修改 agent loop 本身。

区别于 Claude Code，我认为 pi 现在最值得讲的是五点。第一是**真正的模型与 provider 解耦**。`pi-ai` 不是只把不同 API 包一层相同函数，而是维护统一的 `Model/Context/Message` 抽象，并专门实现跨 provider handoff。比如一个会话可以先跑 Claude，再切到 GPT 或 Gemini；对于来自其他 provider 的 assistant thinking，`transformMessages()` 会降级成 `<thinking>` 文本，同时尽量保留普通文本、tool call 和 tool result。这里要强调“best effort”，因为不同厂商的 reasoning signature、tool-call id 和协议语义并不等价，pi 做的是兼容转换，不是无损迁移。

第二是**核心库化和产品层解耦**。`pi-ai` 可以单独做多模型 API，`pi-agent-core` 可以单独作为 runtime，`pi-coding-agent` 再负责 session、compaction、resource loading 和 CLI，`pi-tui` 只是终端 UI。Claude Code 到 2026 年也已经有 Claude Agent SDK，不能再简单说“Claude Code 只有产品、不能嵌入”；真正的差异应该表述为：Claude Agent SDK 提供 Claude Code 的 agent 能力作为 Python/TypeScript 库，而 pi 把更底层的 provider、agent loop、TUI 等拆成 MIT 开源的独立包，并且模型层不限定 Claude。

第三是**扩展优先，而不是内置工作流优先**。Pi 的 TypeScript Extensions 可以订阅生命周期事件、拦截/阻断 tool call、注入上下文、自定义 compaction、注册 tool/command/shortcut/flag，甚至扩展 UI；扩展通过 jiti 直接加载 TypeScript。再往上一层，Pi Packages 可以把 extensions、skills、prompt templates、themes 打包成 npm/git 包分发。这个设计比单纯说“工具就是一个 schema 函数”更完整，因为真正决定 pi 可塑性的不是 Tool API 本身，而是 extension event bus + resource/package system。

第四是**对上下文开销非常敏感的极简主义**。Pi 官方明确不内置 MCP。作者给出的替代思路是：对于很多能力，使用 CLI + README/SKILL.md 做 progressive disclosure，启动时只让模型看到 Skill 的 name/description，真正命中任务后再 `read` 完整 `SKILL.md`，这样不用把大量工具 schema 常驻上下文。这里不能说成“pi 的 Tool 描述会自动从 README 加载”：自定义 Tool 实际通过 `pi.registerTool()` 注册 schema；README/SKILL.md 按需加载是另一条扩展路线。MCP 当然也有跨客户端复用、远程服务和统一协议的价值，因此这不是绝对优劣，而是 pi 主动选择“上下文成本和可组合 CLI”优先于“协议生态”。

第五是**会话状态和可观察性做得非常显式**。`pi-coding-agent` 默认把 session 持久化为 JSONL，而且不是简单线性聊天记录，而是通过 `id/parentId` 形成一棵树，可以在同一个文件里 `/tree` 回到历史节点并分叉；session 还会记录 model change、thinking level、compaction、branch summary 和 extension entries。长上下文会触发自动 compaction：旧消息生成结构化摘要，但完整历史仍保留在 JSONL 中。再结合 `steer()`、`followUp()`、JSON event stream、RPC 和 SDK，可以把“模型现在在做什么、工具执行到哪一步、会话从哪里分叉”暴露给上层。这其实比“上下文可序列化”四个字更能体现 pi 的 harness 价值。

安全边界也必须讲准确。pi **没有内置 sandbox，也没有 Claude Code 那种默认的细粒度工具权限审批系统**，默认工具和 Extension 都以启动 pi 的用户权限运行；但是它现在已经有 Project Trust，用来阻止未信任仓库在启动阶段自动加载 `.pi/settings.json`、项目 Extension、Package 等可执行资源。Project Trust 只是输入加载防线，不是运行时沙箱。需要强隔离时，官方建议使用 Gondolin micro-VM、Docker、OpenShell 或其他 OS/VM 边界；如果只是希望某些危险命令先确认，也可以通过 Extension 的 `tool_call` 事件自己实现确认逻辑。

最后不要把 pi 描述成“功能少所以工程成熟度低”。更准确的说法是：**它有意把许多产品级策略留在核心之外**。Claude Code 当前已经内置 MCP、subagents/agent teams、plan mode、background work、permissions、hooks、skills/plugins，并且 Agent SDK 也可以嵌入应用；这些能力在团队治理、复杂任务编排和安全默认值上更完整。Pi 的优势不是“比 Claude Code 更强”，而是更容易看清并改写 harness 的每一层：你可以换 provider、重写 context transform、拦截 tool call、替换 compaction、扩展 UI，甚至只拿其中一个包做自己的系统。总结起来，Claude Code 更偏“完整的 Claude agent 平台”，pi 更偏“极小、透明、模型无关、允许你自己定义产品形态的 Agent Harness”。

## 详细解析

> 内容基于 2026-08-21 核验的 `earendil-works/pi` 当前仓库、`pi-agent-core` 源码、pi.dev 官方文档以及 Mario Zechner 对 pi 设计取舍的公开说明。注意：仓库中存在 harness v2 等设计/RFC 内容，本文只把当前公开 API 与官方文档明确支持的能力视为稳定事实，不把设计稿路线图当成现有能力。

### 一、包结构与职责
```text
@earendil-works/pi (monorepo)
├── packages/ai            → pi-ai：统一多 provider LLM API、消息兼容转换、工具调用/推理流
├── packages/agent         → pi-agent-core：Agent 状态、agent loop、工具执行、事件流、消息队列
├── packages/coding-agent  → pi-coding-agent：CLI、Session、Compaction、Extensions、Skills、RPC/SDK
├── packages/tui           → pi-tui：retained-mode TUI + differential rendering
└── packages/telemetry     → pi-telemetry：厂商中立的遥测契约、schema 与适配接口
```

这里的依赖关系大致可以理解成：

```text
Provider APIs
     ↓
   pi-ai
     ↓
pi-agent-core
     ↓
pi-coding-agent ──→ Extensions / Skills / Pi Packages
     ↓
   pi-tui
```

它和传统“大一统 Agent 框架”的不同点在于：provider 适配、agent runtime、产品会话层、UI 并没有绑成一个不可拆整体。

### 二、消息流与事件流
```text
一次 LLM 调用前：

AgentMessage[]
      ↓
transformContext()                 // 可选：裁剪、压缩、外部上下文注入
      ↓
AgentMessage[]
      ↓
convertToLlm()                     // 必需：过滤 UI-only / 转换自定义消息
      ↓
Message[]
      ↓
pi-ai provider adapter
      ↓
Anthropic / OpenAI / Google / ...
```

```text
Agent 主循环：

prompt
  ↓
agent_start
  ↓
┌─────────────────────────────────────────────┐
│ inner loop                                  │
│  LLM response                              │
│      ↓                                      │
│  tool calls? ──yes→ validate/preflight      │
│      │                 ↓                    │
│      │          parallel / sequential       │
│      │                 ↓                    │
│      │             tool results             │
│      │                 ↓                    │
│      └──────────── next LLM turn            │
│                                             │
│  每个 turn 后检查 steering queue             │
└─────────────────────────────────────────────┘
  ↓
本应结束时检查 follow-up queue
  ├─ 有 → 再进入 loop
  └─ 无 → agent_end
```

工具执行也不是简单 `Promise.all()`。源码先解析并校验参数，再执行 `beforeToolCall`；如果全局模式是 `parallel` 且批次中没有工具声明 `executionMode: "sequential"`，才并发执行。完成事件可以按真实完成顺序发出，但最终持久化的 tool-result message 仍恢复 assistant 原始 tool-call 顺序，避免并发导致上下文顺序不确定。之后还可以经过 `afterToolCall` 修改结果或决定是否 terminate。

### 三、Quick Start（官方文档示例）
```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());

const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

真正值得注意的不只是 `getModel(provider, model)`，而是 `Agent` 根本不关心底层具体是哪家模型：它依赖统一的 `Model`、`Message` 和 `streamFn` 契约。Provider 差异被压到 `pi-ai`，agent loop 只处理标准化消息、工具调用和事件。

跨 provider handoff 的大致逻辑则是：

```text
Claude history
  user
  assistant(text + thinking + toolCall)
  toolResult
        ↓ switch model/provider
transformMessages(history, targetModel)
        ↓
GPT / Gemini 可接受的历史
  user                        → 基本保留
  assistant text              → 保留
  foreign-provider thinking   → <thinking>...</thinking> 文本降级
  toolCall / toolResult       → 尽量规范化并保留
```

这说明“模型无关”并不是简单换一个 base URL，而是包含了历史上下文协议兼容层。

### 四、面试追问

**追问一：transformContext 和 convertToLlm 为什么要拆成两层？**

因为它们面对的是两个不同抽象层。`transformContext` 面向 **Agent 应用状态**，它仍然操作 `AgentMessage`，所以可以保留通知、UI 消息、记忆对象等应用自己的类型，并决定哪些内容要裁剪、压缩或注入；`convertToLlm` 面向 **模型边界**，负责把最终上下文降成 provider 能理解的标准 `Message[]`。源码里的 `streamAssistantResponse()` 就是先 transform、再 convert，最后才构造 `llmContext`。这样做的价值是：RAG、memory、compaction 等上下文工程可以改前一层，模型协议适配改后一层，两边不会互相污染。

**追问二：pi 的“跨 provider 会话交接”到底强在哪里，又有什么损失？**

强点不是 JSONL 本身，而是 `pi-ai` 有一套 provider-neutral message model 和 `transformMessages()` 兼容逻辑。它允许在一个历史上下文中切换 Claude、GPT、Gemini 等不同模型，普通文本、tool call、tool result 可以继续复用。损失主要出现在 provider 私有语义：例如 reasoning/thinking 往往带签名或专有结构，切到另一 provider 时不能等价复现，所以 pi 会把外部 provider 的 thinking 降级成普通 `<thinking>` 文本。也就是说，这是“尽量保持任务上下文连续”的 handoff，不应该说成完全无损的运行时迁移。

**追问三：pi 为什么明确不内置 MCP？团队已有 MCP 工具怎么办？**

作者的核心反对点是**上下文常驻成本和复杂度**：很多 MCP Server 会一次性暴露大量 tool schema，而当前任务可能只用到其中极少数。Pi 更偏好 progressive disclosure：把能力包装成 CLI + Skill，系统提示里只保留 Skill 的名字和描述，需要时再读取完整 `SKILL.md`，然后通过 bash 调 CLI。如果团队已经积累了 MCP 资产，不能说 MCP 没价值；可以通过 Extension 自己接入 MCP，或者把 MCP Server 包成 CLI。选择标准应该是：如果重点是跨客户端协议互通和已有 MCP 生态，MCP 更合适；如果重点是本地开发、上下文预算和 shell 可组合性，pi 的路线更轻。

**追问四：pi 明明故意不做 subagent、plan mode、todo 和 background bash，为什么这反而是它的设计亮点？**

因为 pi 的目标不是替用户规定一套“正确工作流”，而是把底层 harness 做小，把策略放到可观察的外部状态里。计划可以写 `PLAN.md`，任务状态可以写 `TODO.md`，长期命令和并行会话可以交给 tmux，需要 subagent 时可以启动另一个 pi 进程，复杂能力也可以做 Extension。这样做的收益是状态更显式、可版本化、可调试，core prompt 和 tool schema 也更稳定；代价是用户自己承担更多工程组装成本。Claude Code 选择的是另一条路线：把 subagent、Agent Teams、plan mode、background work、permissions 等做成产品一等能力，开箱即用程度更高。两者不是“高级 vs 低级”，而是 **policy in core** 和 **policy outside core** 的不同取舍。

### 五、参考

- [pi 官方仓库（earendil-works/pi）](https://github.com/earendil-works/pi)
- [pi 官方文档](https://pi.dev/docs/latest)
- [pi-agent-core 源码：agent.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts)
- [pi-agent-core 源码：agent-loop.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)
- [pi-ai 官方文档与跨 Provider Handoff](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
- [Pi Extensions 文档](https://pi.dev/docs/latest/extensions)
- [Pi Skills 文档](https://pi.dev/docs/latest/skills)
- [Pi Session Format](https://pi.dev/docs/latest/session-format)
- [Pi Compaction 文档](https://pi.dev/docs/latest/compaction)
- [Pi Security 文档](https://pi.dev/docs/latest/security)
- [Mario Zechner：What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Claude Agent SDK 官方文档](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code Subagents 官方文档](https://code.claude.com/docs/en/sub-agents)


<!-- created: 2026-08-16 01:43:31 -->
<!-- updated: 2026-08-21 18:20:00 -->
