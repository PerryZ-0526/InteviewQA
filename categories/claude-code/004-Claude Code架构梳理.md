# Claude Code 架构梳理

## 题目

梳理一下 Claude Code 的架构。

## 标签

[Claude Code](../../tags/Claude%20Code.md) | [Agent](../../tags/Agent.md) | [Harness](../../tags/Harness.md)

## 题目导航

← [003-Claude Code自定义子智能体与自主派生机制](003-Claude%20Code自定义子智能体与自主派生机制.md) | [005-Hermes、pi-agent与Claude Code的差异](005-Hermes、pi-agent与Claude%20Code的差异.md) →

## 面试直接答

> Claude Code 是 Anthropic 的终端优先 agentic coding 产品，架构本质是一个确定性 harness 包裹模型推理：工具系统、权限门控、钩子、子智能体、上下文管理与检查点构成执行层，模型只负责决策，两者通过工具调用循环耦合；应用边界是内部推理实现不公开，架构描述只能基于可观察行为与官方披露。

先从整体形态讲。Claude Code 本身是 Node.js/TypeScript 程序，通过 npm 包或原生二进制分发，覆盖 CLI、桌面应用、IDE 扩展和 Web 入口。它自己就是「用 Claude 构建 Claude Code」的产物——Anthropic 工程博客披露，harness 代码量在十万行量级，测试也主要由 Claude 编写，这本身就是 agentic 开发可行性的一个案例。它的定位是 coding agent 而不是代码补全工具：能读代码、跑命令、改文件、验证结果，并且用 todo 追踪任务、用检查点保护文件状态。

核心是工具调用循环。一次任务大致这样流转：接收输入后组装上下文——系统提示、项目记忆 CLAUDE.md、skills、对话历史、工具定义，必要时加上自动压缩后的摘要；模型生成文本或工具调用；工具调用进入权限系统裁决，允许后执行，比如 Bash 命令、文件编辑、子智能体委派；结果回填上下文，循环继续，直到任务完成或上下文、预算耗尽。每个工具执行后系统写入 checkpoint 文件快照，支撑 /rewind 回退、对话分叉和 worktree 并行。

上下文管理是第二层架构。窗口被分层使用：系统层放提示与工具定义，项目层放 CLAUDE.md 规则（支持目录层级继承）和 skills，会话层放历史消息。接近窗口上限时 auto-compact 自动压缩历史为摘要。更重要的机制是子智能体隔离——Explore、Plan、general-purpose 和自定义子智能体各自拥有独立上下文窗口，只把结论回传主会话，避免长任务污染主上下文；background tasks 则把耗时任务异步化，结果按需取回。这三者共同构成「主上下文只保留决策所需信息」的设计原则。

工具与权限是第三层。内置工具体系包括文件编辑（Read、Write、Edit、Glob、Grep）、Bash、WebFetch、WebSearch、Task 委派、NotebookEdit 等。权限系统是 allow、deny、ask 三态规则，按工具、路径、命令模式匹配，授权可以会话级记忆，核心原则是「模型建议与真实执行分离」。sandbox 模式进一步用 OS 级隔离（macOS Seatbelt、Linux Landlock）限制 Bash 和文件访问。hooks 是执行流的拦截点：PreToolUse、PostToolUse、UserPromptSubmit、SessionStart、Stop 等事件允许外部脚本校验参数、注入上下文、改写结果，是安全审计和团队策略的主要落点。

扩展体系是第四层。MCP 让外部工具与数据源以统一协议接入，和内置工具走同一套权限裁决；skills 以 SKILL.md 形式按需注入领域知识与操作流程；subagents 通过配置文件定义或主智能体自然语言当场派生；plugins 按厂商聚合工具、技能与子智能体。这些扩展点的共同特点是：扩展的是「能力」，不是「循环」——agent loop 本身不可替换，这与 DeepSeek Harness 的一切皆插件形成鲜明对比。

最后是边界。Claude Code 的内部推理循环细节没有完整公开，不能武断归类为纯 ReAct 或带内部规划的某种结构；工程博客确认的公开事实是「harness 决定工具使用、上下文投影与权限语义」。面试时应当按可观察行为描述架构——工具调用模式、权限语义、上下文管理策略——而不是宣称知道内部实现。Claude Code 的架构优势在于垂直整合的调优深度与产品成熟度，代价是核心循环的封闭性，这正是它与 Codex、dsh 等产品比较时的主线。

## 详细解析

> 公开信息核验日期：2026-08-16。内部实现以官方披露为限，不臆断未公开的调度算法。

### 一、分层结构图

```text
┌────────────────────────────────────────────────┐
│  入口层：CLI / 桌面应用 / IDE 扩展 / Web         │
├────────────────────────────────────────────────┤
│  会话与上下文层                                  │
│  · 系统提示 + 工具定义 + CLAUDE.md + skills      │
│  · 对话历史 + auto-compact 压缩摘要              │
│  · 子智能体隔离上下文 / background tasks         │
├────────────────────────────────────────────────┤
│  执行层（harness 主体）                          │
│  · todo 任务追踪                                │
│  · 工具调用循环：模型输出 → 权限裁决 → 执行 → 回填│
│  · checkpoints 文件快照（/rewind、fork 基础）    │
├────────────────────────────────────────────────┤
│  工具层                                         │
│  · 内置：Bash / 文件编辑 / WebFetch / Task 委派   │
│  · 扩展：MCP 工具（与内置同权限裁决）            │
├────────────────────────────────────────────────┤
│  权限与安全层                                    │
│  · allow / deny / ask 三态规则（工具/路径/命令）  │
│  · hooks 拦截点（PreToolUse/PostToolUse/...）   │
│  · sandbox：macOS Seatbelt / Linux Landlock     │
└────────────────────────────────────────────────┘
```

### 二、扩展点职责对比

| 扩展点 | 职责 | 典型场景 |
|---|---|---|
| hooks | 执行流拦截：校验、注入、改写 | PreToolUse 拦截危险命令；PostToolUse 追加产物信息 |
| MCP | 外部工具与数据源接入 | 连接内部 API、数据库、浏览器自动化 |
| skills | 领域知识与操作流程注入 | 部署流程、代码审查规范、特定框架约定 |
| subagents | 隔离上下文的子任务委派 | Explore 调研代码库、Plan 设计、general-purpose 泛化执行 |
| plugins | 按厂商聚合扩展 | 团队统一分发工具+技能+子智能体组合 |
| CLAUDE.md | 项目记忆与规则 | 构建命令约定、代码规范、目录导航 |

### 三、权限配置示例（`.claude/settings.json`）

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run test:*)",
      "Read(~/.claude/CLAUDE.md)",
      "WebFetch(domain:docs.example.com)"
    ],
    "deny": [
      "Bash(rm -rf /:*)",
      "Edit(//*.env)"
    ],
    "ask": [
      "Bash(git push:*)"
    ]
  }
}
```

规则按工具、路径、命令模式匹配，粒度到具体命令前缀；未匹配的默认行为取决于权限模式（default / acceptEdits / plan / bypassPermissions）。sandbox 模式启用后，Bash 与文件访问被 OS 级机制约束，网络默认隔离——这是「模型建议与真实执行分离」的确定性兜底，不依赖模型「记得先问」。

### 四、hooks 拦截示例

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/pre_bash.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

hook 脚本通过 stdin 接收 JSON（含工具名、参数、会话信息），输出 JSON 可批准、修改参数或阻止执行。hooks 是团队安全策略与审计的主落点：策略变更不用改产品代码，直接换脚本。

### 五、面试追问

**追问一：harness 与模型的职责边界在哪里？**

Anthropic 工程博客的公开表述是：模型负责推理和决策，harness 负责把决策落地为确定性执行——包括工具选择如何映射到实际命令、权限如何裁决、上下文如何投影、文件状态如何保护。这条边界有实际意义：可靠性要求高的部分（权限、检查点、回退）必须确定性实现，不能用模型行为兜底；而任务理解、方案设计、代码生成这些开放决策留给模型。判断一个设计该放哪边，标准是「错了能不能承受」——权限裁决错了是安全事故，必须确定性；变量命名风格错了可以重来，交给模型即可。

**追问二：auto-compact 会丢失细节，长任务怎么保证不丢状态？**

三个互补机制。checkpoints 保护文件系统状态：每次工具执行后的快照让 /rewind 可以精确回退到任意检查点，状态恢复不依赖对话历史。子智能体隔离保护上下文质量：Explore 读完代码库只回传结论，主上下文不承载调研细节；compact 压缩的是主会话历史，而关键结论已经浓缩在子智能体返回里。todo 与计划持久化任务结构：压缩历史不压缩目标。所以长任务的可靠性来自「文件状态有快照、调研细节在子上下文、任务结构在 todo」，而非指望压缩摘要保留一切。

**追问三：MCP 工具和内置工具在架构上有什么不同？**

对 harness 而言基本等价——都走工具调用循环，都过同一套权限裁决，MCP 工具同样受 allow/deny 规则约束。差异在生命周期与信任边界：内置工具由产品团队维护，行为有保证；MCP 服务是外部进程，schema 在运行时发现，可用性和安全性取决于服务提供方，所以官方文档建议对 MCP 服务的授权规则更保守。这也解释了为什么 MCP 是「接入」而不是「替代」内置工具：文件编辑这类高频核心能力不值得承担外部进程的稳定性风险。

**追问四：hooks 和 MCP 都能执行外部代码，什么时候用哪个？**

hooks 是「拦截与策略」——不新增能力，而是校验、注入、改写已有执行流，同步语义要求快速返回。MCP 是「能力扩展」——给模型新增可调用的工具与数据源，异步语义允许长耗时。用错方向会很难受：把业务校验做成 MCP 工具，模型就可能不调用它，策略形同虚设；把外部能力做成 hook，就得在拦截点里塞副作用，执行流语义被破坏。一句话：要模型「能看到并选择」的用 MCP，要「无条件发生」的用 hooks。

### 六、参考

- [Anthropic 工程博客：How we built Claude Code](https://www.anthropic.com/engineering/building-claude-code)
- [Claude Code 官方文档](https://code.claude.com/docs)
- [Claude Code hooks 文档](https://code.claude.com/docs/en/hooks)
- [Claude Code IAM 权限文档](https://code.claude.com/docs/en/iam)
- [Claude Code 子智能体文档](https://code.claude.com/docs/en/sub-agents)
- [Anthropic 工程博客：Claude Code 最佳实践](https://www.anthropic.com/engineering/claude-code-best-practices)

<!-- created: 2026-08-16 01:43:31 -->
<!-- updated: 2026-08-16 01:43:31 -->
