# Hermes、pi-agent 与 Claude Code 的差异

## 题目

谈谈 Hermes、pi-agent、Claude Code 三者间的差异。

## 标签

[Claude Code](../../tags/Claude Code.md) | [Hermes](../../tags/Hermes.md) | [pi-agent](../../tags/pi-agent.md) | [Agent](../../tags/Agent.md)

## 题目导航

← [004-Claude Code架构梳理](004-Claude Code架构梳理) | 无 →

## 面试直接答

> 三个都是 coding agent，但设计哲学分野清晰：Claude Code 是绑定 Anthropic 模型的垂直整合闭源产品，Hermes 是带学习闭环的多平台常驻个人 agent（开源 Python），pi 是可编程、可嵌入的 agent harness 工具包（开源 TypeScript）；比较的主线是记忆与学习机制、运行位置、扩展模型与权限取舍。

先看定位与技术栈。Claude Code 是终端优先的生产级产品，Node.js/TypeScript 实现，闭源，官方对自家模型深度调优，入口覆盖 CLI、桌面、IDE 与 Web。Hermes 由 Nous Research 开发，Python 实现、MIT 开源，自我定位是「自改进的 AI agent」——不是只在终端里干活，而是通过单一 gateway 进程常驻，从 Telegram、Discord、Slack、WhatsApp、Signal 和 CLI 都能触达，支持七种终端后端，包括本地、Docker、SSH 和 Modal、Daytona 这类 serverless 环境，闲置时近乎零成本。pi 是 Mario Zechner（badlogic，libGDX 作者）主导的 TypeScript monorepo，MIT 开源，自称 self-extensible coding agent 工具包，既发 CLI 也发库，定位是让别人拿它组装自己的 agent 产品，而不是直接跟终端用户竞争。

记忆与学习机制是三者最本质的差异。Claude Code 的记忆是分层静态输入：CLAUDE.md 项目规则、skills、对话历史加 auto-compact 压缩摘要，本质是「每次会话重新组装上下文」，没有跨会话的自主学习。Hermes 把学习做成闭环：复杂任务完成后自主创建技能文件，技能在使用中自我改进，遵循 agentskills.io 开放标准；周期性的 nudge 提示它沉淀值得记住的知识；FTS5 全文检索加 LLM 摘要实现跨会话回忆；Honcho 辩证式用户建模构建跨会话的用户画像。pi 走第三条路：上下文显式控制——AgentMessage 是规范消息格式，应用层可自定义消息类型，每次 LLM 调用前经过 transformContext 剪枝注入、convertToLlm 过滤转换的两段式管线，上下文还可以序列化，实现跨 provider 的会话交接。三者分别代表「静态记忆」「学习闭环」「显式工程化上下文」三种路线。

运行位置差异决定了使用场景。Claude Code 绑定开发者本机终端会话，主要服务于编码工作流。Hermes 设计上脱离笔记本：gateway 常驻云端，手机上发条 Telegram 消息就能推进任务，内置 cron 调度支持自然语言定时任务，比如日报、夜间备份、周报审计。pi 介于两者之间：CLI 在终端用，但作为库可以被嵌入任何 Node.js/Bun 应用，甚至被编译成独立二进制分发。

扩展模型也各有取舍。Claude Code 用 hooks、MCP、subagents、skills、plugins 这组受控扩展点，核心循环封闭。Hermes 是 Python 生态的路子：工具可以按需启用配置，子代理隔离并行，特色是 Python 脚本通过 RPC 调用工具——把多步流水线折叠成一次调用，中间过程不进上下文，零上下文成本轮次。pi 则刻意不做 MCP，采用「CLI 工具 + 按需加载 README」的轻量扩展：工具注册即声明，描述从工具自带文档懒加载，避免 MCP 的进程管理开销，工具定义用 TypeBox 校验。

权限模型是三家差距最大的地方。Claude Code 有内置权限系统，allow、deny、ask 三态规则加 OS 级沙箱，默认安全边界明确。Hermes 的安全边界主要靠执行后端隔离——Docker、SSH、沙箱后端各自提供约束，但没有 Claude Code 那样细粒度的工具级权限裁决。pi 明确没有内置权限系统，官方文档直言它以启动用户的权限运行，需要强边界就容器化，推荐 Gondolin 微 VM 扩展、Docker 或 OpenShell 三种模式。这是设计取舍：pi 假设你是开发者，把安全策略留给你自己组装；Claude Code 假设权限错误不可接受，把裁决做成产品内置。

选型结论：需要开箱即用、权限可控的生产编码工具选 Claude Code；需要常驻云端、多端可达、能自己积累经验的个人助手选 Hermes；需要嵌入自己的产品、掌控上下文管线、或做跨模型研究选 pi。三者都在快速迭代，比较必须注明版本；Hermes 的「自进化」也不是无约束的在线自我修改，而是受评测与人工 PR 审查约束的离线候选搜索，这一点在比较它的学习能力时尤其要准确表述。

## 详细解析

> 公开信息核验日期：2026-08-16。Hermes 侧基于 NousResearch/Hermes-Agent 仓库 README；pi 侧基于 earendil-works/pi 仓库与包文档；Claude Code 侧基于官方文档与工程博客。

### 一、逐项对比


| 维度   | Claude Code                                | Hermes Agent                                      | pi-agent (earendil-works/pi)                     |
| ---- | ------------------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| 开发者  | Anthropic                                  | Nous Research                                     | Mario Zechner (badlogic)                         |
| 许可证  | 闭源                                         | MIT                                               | MIT                                              |
| 技术栈  | Node.js/TypeScript                         | Python                                            | TypeScript monorepo（Bun 二进制）                     |
| 定位   | 终端优先 coding agent 产品                       | 自改进、多平台常驻个人 agent                                 | 可自扩展的 agent harness 工具包                          |
| 记忆模型 | CLAUDE.md + compact，静态组装                   | 技能自创/自改进 + FTS5 检索 + Honcho 用户建模                  | AgentMessage 规范格式 + transformContext 管线 + 上下文序列化 |
| 运行位置 | 本机终端/桌面/IDE/Web                            | 云端 gateway + 消息平台 + 7 种终端后端                       | 终端 CLI + 可嵌入库                                    |
| 定时任务 | 无内置 cron                                   | 内置 cron 调度，自然语言设定                                 | 无内置                                              |
| 扩展机制 | hooks / MCP / subagents / skills / plugins | agentskills.io 技能 + Python RPC 脚本 + 多工具           | npm 包组合，无 MCP，CLI 工具懒加载 README                   |
| 权限模型 | 内置 allow/deny/ask + OS 沙箱                  | 依赖后端隔离（Docker/SSH/serverless）                     | 无内置权限系统，建议容器化                                    |
| 模型绑定 | Claude 系列                                  | 任意 provider，`hermes model` 切换，Nous Portal 300+ 模型 | 统一 pi-ai API，多 provider 与跨 provider 交接           |
| 特色能力 | checkpoints、/rewind、hooks                  | 学习闭环、多端可达、轨迹研究数据                                  | 事件流 UI 解耦、并行工具执行、会话分享                            |


### 二、记忆机制的结构化对比
```text
Claude Code：静态组装
  系统提示 + CLAUDE.md + skills + 历史 → 每会话重新组装 → 模型

Hermes：学习闭环
  经验 → 创建/改进技能 → 技能库 ─┐
  对话 → nudge 沉淀 → 记忆库 ───┼→ 跨会话检索（FTS5 + LLM 摘要）
  交互 → Honcho 用户画像 ───────┘

pi：显式工程化
  AgentMessage[] → transformContext()（剪枝/注入，可选）
                → convertToLlm()（过滤 UI 消息/转换自定义类型，必需）
                → LLM
  上下文可序列化 → 跨 provider 交接 / 会话分享
```

三条路线的本质区别：Claude Code 相信产品化规则，Hermes 相信 agent 自己学习，pi 相信开发者显式控制。

### 三、pi 的上下文管线代码示例
```typescript
// @earendil-works/pi-agent-core
// AgentMessage → transformContext → convertToLlm → LLM
const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,   // 来自 pi-ai 统一模型注册表
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

对比 Hermes 的 RPC 折叠思路（Python 脚本经 RPC 调工具、结果不入上下文）与 Claude Code 的子智能体隔离思路（子上下文只回传结论），三者都在解决「中间过程不该全额占用主上下文」，但落点分别是：消息管线可编程、脚本折叠轮次、子代理隔离窗口。

### 四、面试追问

**追问一：Hermes 的「自改进」和 pi 的「可自扩展」有什么区别？**

一个是运行时行为，一个是代码结构。Hermes 的自改进是 agent 在运行中产出并改进技能文本资产，改进对象是提示词层面的能力描述，受评测与人工审查约束（详见 Hermes 分类 001 题）。pi 的可自扩展是架构属性：agent 是库，任何包都可以注册工具、消息类型、会话后端，扩展发生在编译期/配置期而不是运行期。追问这个问题的面试官想确认你没有把「学习能力」和「插件架构」混为一谈。

**追问二：pi 为什么不实现 MCP？**

作者的设计判断是 MCP 的进程管理与 schema 协商开销对大部分工具场景是多余的：一个 CLI 工具的 README 就是现成的工具描述，按需加载即可，TypeBox 在类型层面做 schema 校验。这个取舍在工具数量少、同进程的场景成立；工具生态庞大、需要跨语言复用、需要进程隔离的场景，MCP 的标准化价值仍在。这正好和 Claude Code 的「MCP 与内置工具同权限裁决」形成对比：产品级工具要考虑生态互通，harness 工具包可以优先考虑极简。

**追问三：没有内置权限系统，pi 用户怎么保证安全？**

官方文档给了三条路径：Gondolin 扩展把工具与 ! 命令路由进本地 Linux 微 VM，宿主机只留 pi 进程与 provider 认证；整体跑进 Docker 容器；或用 OpenShell 策略沙箱。本质是把「权限裁决」从产品责任变成部署责任——适合开发者自用或公司内部有容器基建的场景，不适合面向普通用户的直接分发。Claude Code 走相反路线，权限是产品核心卖点之一。

**追问四：如果三选一给团队落地，评估顺序是什么？**

先看运行位置需求：需要云端常驻与多端触达，Hermes 是唯一内置答案。再看组织形态：团队直接用，Claude Code 的成熟度与权限体系是安全底线；团队要自研 Agent 产品，pi 的库化与上下文管线最省定制成本。最后看模型策略：深度绑定 Claude 生态选 Claude Code，模型无关或混合 provider 选 Hermes 或 pi。无论选哪个，都应以真实任务基准（成功率、成本、接管率）做最终裁决，而不是以架构叙事做裁决。

### 五、参考

- [Claude Code 官方文档](https://code.claude.com/docs)
- [Hermes Agent 官方仓库](https://github.com/NousResearch/Hermes-Agent)
- [Hermes Agent 官方文档](https://hermes-agent.nousresearch.com/docs/)
- [pi 官方仓库（earendil-works/pi）](https://github.com/earendil-works/pi)
- [pi 项目官网与文档](https://pi.dev)
- [pi-agent-core 包文档](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
- [Anthropic 工程博客：How we built Claude Code](https://www.anthropic.com/engineering/building-claude-code)


<!-- created: 2026-08-16 01:43:31 -->
<!-- updated: 2026-08-16 03:41:41 -->
