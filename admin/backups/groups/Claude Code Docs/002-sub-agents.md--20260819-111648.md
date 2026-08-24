> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建自定义 subagents

> 在 Claude Code 中创建和使用专门的 AI subagents，用于特定任务的工作流和改进的上下文管理。

Subagents 是处理特定类型任务的专门 AI 助手。当一个辅助任务会用搜索结果、日志或文件内容充斥您的主对话，而您不会再次引用这些内容时，请使用一个 subagent：该 subagent 在自己的上下文中完成这项工作，仅返回摘要。当您不断生成相同类型的工作者并使用相同的指令时，定义一个自定义 subagent。

每个 subagent 在自己的 context window 中运行，具有自定义系统提示、特定的工具访问权限和独立的权限。当 Claude 遇到与 subagent 描述相匹配的任务时，它会委托给该 subagent，该 subagent 独立工作并返回结果。要在实践中看到上下文节省，[context window 可视化](/docs/zh-CN/context-window) 演示了一个 subagent 在自己的独立窗口中处理研究的会话。

<Note>
  Subagents 在单个会话中工作。要在并行运行许多独立会话并从一个地方监控它们，请参阅 [background agents](/docs/zh-CN/agent-view)。对于相互通信的会话，请参阅 [agent teams](/docs/zh-CN/agent-teams)。
</Note>

Subagents 帮助您：

* **保留上下文**，通过将探索和实现保持在主对话之外
* **强制执行约束**，通过限制 subagent 可以使用的工具
* **跨项目重用配置**，使用用户级 subagents
* **专门化行为**，为特定领域使用专注的系统提示
* **控制成本**，通过将任务路由到更快、更便宜的模型（如 Haiku）

Claude 使用每个 subagent 的描述来决定何时委托任务。创建 subagent 时，请编写清晰的描述，以便 Claude 知道何时使用它。

Claude Code 包括几个内置 subagents，如 Explore、Plan 和 general-purpose。您也可以创建自定义 subagents 来处理特定任务。

<h2 id="built-in-subagents">
  内置 subagents
</h2>

Claude Code 包括内置 subagents，Claude 在适当时自动使用。每个都继承父对话的权限，并有额外的工具限制。

Explore 和 Plan 会跳过您的 CLAUDE.md 文件和父会话的 git 状态，以保持研究快速且成本低廉。所有其他内置和[自定义 subagent](#configure-subagents) 都会加载两者。有关到达 subagent 的内容的完整分解，请参阅[启动时加载的内容](#what-loads-at-startup)。

<Tabs>
  <Tab title="Explore">
    一个快速的、只读的代理，针对搜索和分析代码库进行了优化。

    * **Model**: 从主对话继承，在 Claude API 上限制为 Opus，因此 Explore 永远不会在比您为会话选择的模型更昂贵的模型上运行
    * **Tools**: 只读工具；拒绝访问 Write 和 Edit
    * **Purpose**: 文件发现、代码搜索、代码库探索

    从 v2.1.198 开始，Explore 继承主对话的模型，而不是始终在 Haiku 上运行。在 Claude API 上，继承的模型限制为 Opus：主对话在更高层级上运行 Explore 时使用 Opus，主对话在 Sonnet 或 Haiku 上运行 Explore 时使用相同的模型。在任何其他提供商上，例如 [Amazon Bedrock、Google Cloud 的 Agent Platform、Microsoft Foundry 或 AWS 上的 Claude Platform](/docs/zh-CN/third-party-integrations)，Explore 直接继承主对话的模型。

    名为 `Explore` 的[用户或项目 subagent](#choose-the-subagent-scope) 会覆盖内置的，并保持其自己的 `model` 字段，因此定义一个带有 `model: haiku` 的来保持探索在较低成本的模型上。

    当 Claude 需要搜索或理解代码库而不进行更改时，它会委托给 Explore。这样可以将探索结果保持在主对话上下文之外。

    调用 Explore 时，Claude 指定一个彻底程度级别：**quick** 用于有针对性的查找，**medium** 用于平衡的探索，或 **very thorough** 用于全面分析。
  </Tab>

  <Tab title="Plan">
    一个研究代理，在 [plan mode](/docs/zh-CN/permission-modes#analyze-before-you-edit-with-plan-mode) 期间使用，以在呈现计划之前收集上下文。

    * **Model**: 从主对话继承
    * **Tools**: 只读工具；拒绝访问 Write 和 Edit
    * **Purpose**: 用于规划的代码库研究

    当您处于 plan mode 并且 Claude 需要理解您的代码库时，它会将研究委托给 Plan subagent，以便探索输出保持在单独的上下文窗口中，而主对话保持只读。
  </Tab>

  <Tab title="General-purpose">
    一个能够处理复杂、多步骤任务的代理，需要探索和操作。

    * **Model**: 从主对话继承
    * **Tools**: 所有工具
    * **Purpose**: 复杂研究、多步骤操作、代码修改

    当任务需要探索和修改、复杂推理来解释结果或多个依赖步骤时，Claude 会委托给 general-purpose。
  </Tab>

  <Tab title="Other">
    Claude Code 包括用于特定任务的其他辅助代理。这些通常会自动调用，因此您不需要直接使用它们。

    | Agent             | Model  | Claude 何时使用它                 |
    | :---------------- | :----- | :--------------------------- |
    | statusline-setup  | Sonnet | 当您运行 `/statusline` 来配置您的状态行时 |
    | claude-code-guide | Haiku  | 当您提出关于 Claude Code 功能的问题时    |
  </Tab>
</Tabs>

内置 subagents 在交互式会话中默认被注册。要限制它们：

* 要阻止特定的内置类型，请将其添加到 `permissions.deny`，如[禁用特定 subagents](#disable-specific-subagents) 中所示。
* 要防止 Claude 委托给任何 subagent，请使用 [`permissions.deny`](/docs/zh-CN/permissions#tool-specific-permission-rules) 拒绝 `Agent` 工具本身。
* 要仅移除内置的 `Explore` 和 `Plan` subagents，请设置 [`CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`](/docs/zh-CN/env-vars)。Claude 直接读取和探索文件，而不是委托给它们。需要 Claude Code v2.1.198 或更高版本。
* 在[非交互模式](/docs/zh-CN/headless) 和 [Agent SDK](/docs/zh-CN/agent-sdk/overview) 中，设置 [`CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1`](/docs/zh-CN/env-vars) 以移除所有内置类型并仅提供您自己的。

除了这些内置 subagents，您可以创建自己的，具有自定义提示、工具限制、权限模式、hooks 和 skills。以下部分展示了如何开始和自定义 subagents。

<h2 id="quickstart-create-your-first-subagent">
  快速入门：创建您的第一个 subagent
</h2>

Subagents 是带有 YAML frontmatter 的 Markdown 文件。要创建一个，请要求 Claude 为您编写，或者 [自己编写文件](#write-subagent-files)。

从 v2.1.198 开始，`/agents` 命令不再打开交互式创建向导；运行它会打印一个提醒，要求您询问 Claude 或直接编辑 `.claude/agents/`。Subagent 文件、frontmatter 字段以及 `.claude/agents/` 和 `~/.claude/agents/` 位置保持不变；仅删除了终端向导。

本演练创建一个用户级 subagent，用于审查代码并建议改进。

<Steps>
  <Step title="要求 Claude 创建 subagent">
    在 Claude Code 中，描述您想要的 subagent 及其保存位置：

    ```text wrap theme={null}
    Create a personal code-improver subagent in ~/.claude/agents/ that scans
    files and suggests improvements for readability, performance, and best
    practices. It should explain each issue, show the current code, and
    provide an improved version. Make it read-only and have it use Sonnet.
    ```

    Claude 使用 `name`、`description`、`tools` 列表、`model` 和系统提示来编写文件。
  </Step>

  <Step title="审查文件">
    打开 `~/.claude/agents/code-improver.md` 并确认 frontmatter 与您的要求相符。结果如下所示：

    ```markdown theme={null}
    ---
    name: code-improver
    description: Scans files and suggests improvements for readability, performance, and best practices. Use after writing or modifying code.
    tools: Read, Grep, Glob
    model: sonnet
    ---

    You are a code improvement specialist. For each issue you find, explain
    the problem, show the current code, and provide an improved version.
    ```

    因为该文件位于 `~/.claude/agents/`，所以 subagent 在您机器上的每个项目中都可用。要将其范围限制在一个项目中，请将其移动到该项目的 `.claude/agents/` 目录。[选择 subagent 范围](#choose-the-subagent-scope) 比较了两者。
  </Step>

  <Step title="尝试一下">
    要求 Claude 委托给新的 subagent：

    ```text wrap theme={null}
    Use the code-improver agent to suggest improvements in this project
    ```

    Claude 委托给您的新 subagent，它扫描代码库并返回改进建议。

    如果 Claude 找不到新的 subagent，请重新启动 Claude Code 并重试。这仅在会话开始前 `~/.claude/agents/` 不存在时发生，因为运行中的会话不会检测到新创建的 `agents` 目录。
  </Step>
</Steps>

现在您有了一个 subagent，可以在您机器上的任何项目中使用它来分析代码库并建议改进。

您也可以手动编写 subagent 文件、通过 CLI 标志定义它们，或通过 plugins 分发它们。以下部分涵盖所有配置选项。

<Note>
  在 Claude Code v2.1.197 及更早版本中，`/agents` 打开一个交互式向导，其中有一个 **Running** 选项卡列出实时 subagents，以及一个 **Library** 选项卡用于创建、编辑和删除它们。
</Note>

<h2 id="configure-subagents">
  配置 subagents
</h2>

一个 subagent 的文件位置决定了谁可以使用它，其 frontmatter 决定了它可以做什么。本节涵盖 subagent 文件的位置以及它们支持的每个字段。

<h3 id="choose-the-subagent-scope">
  选择 subagent 范围
</h3>

根据范围将 subagent 文件存储在不同的位置。当多个 subagents 共享相同的名称时，Claude Code 使用来自更高优先级位置的那个。

| Location              | Scope         | Priority | 如何创建                                      |
| :-------------------- | :------------ | :------- | :---------------------------------------- |
| 托管设置                  | 组织范围          | 1（最高）    | 通过 [managed settings](/docs/zh-CN/settings) 部署 |
| `--agents` CLI 标志     | 当前会话          | 2        | 启动 Claude Code 时传递 JSON                   |
| `.claude/agents/`     | 当前项目          | 3        | 询问 Claude，或手动创建文件                         |
| `~/.claude/agents/`   | 所有您的项目        | 4        | 询问 Claude，或手动创建文件                         |
| Plugin 的 `agents/` 目录 | 启用 plugin 的位置 | 5（最低）    | 与 [plugins](/docs/zh-CN/plugins) 一起安装          |

**项目 subagents**（`.claude/agents/`）非常适合特定于代码库的 subagents。将它们检入版本控制，以便您的团队可以协作使用和改进它们。

项目 subagents 通过从当前工作目录向上遍历来发现，因此会扫描那里和存储库根目录之间的每个 `.claude/agents/`。从 v2.1.178 开始，当这些嵌套目录中的多个目录定义相同的 `name` 时，Claude Code 使用最接近工作目录的定义。

使用 `--add-dir` 添加的目录也会被扫描：添加目录内的 `.claude/agents/` 文件夹与项目 subagents 一起加载。有关哪些其他配置类型从 `--add-dir` 加载，请参阅 [Additional directories](/docs/zh-CN/permissions#additional-directories-grant-file-access-not-configuration)。要在没有 `--add-dir` 的情况下跨项目共享 subagents，请使用 `~/.claude/agents/` 或 [plugin](/docs/zh-CN/plugins)。

**用户 subagents**（`~/.claude/agents/`）是在所有项目中可用的个人 subagents。

Claude Code 递归扫描 `.claude/agents/` 和 `~/.claude/agents/`，因此您可以将定义组织到子文件夹中，例如 `agents/review/` 或 `agents/research/`。子目录路径不会影响 subagent 的识别或调用方式，因为身份仅来自 `name` frontmatter 字段。

在整个树中保持 `name` 值唯一：如果同一 `.claude/agents/` 目录下的两个文件（包括其子文件夹）声明相同的名称，Claude Code 仅加载其中一个，由文件系统读取顺序选择，而不是有文档记录的优先级。在嵌套项目目录中，最接近工作目录的定义获胜，如上所述。[`/doctor`](/docs/zh-CN/commands#all-commands) 设置检查报告同一目录中共享名称的文件，并建议重命名或删除除一个之外的所有文件。在 v2.1.205 之前，`/doctor` 打开一个诊断屏幕，列出重复项并显示哪个定义是活跃的。

Plugin `agents/` 目录也会被递归扫描。与项目和用户范围不同，plugin 的 `agents/` 目录内的子文件夹成为 [scoped identifier](#invoke-subagents-explicitly) 的一部分：plugin `my-plugin` 中位于 `agents/review/security.md` 的文件注册为 `my-plugin:review:security`。

**CLI 定义的 subagents** 在启动 Claude Code 时作为 JSON 传递。它们仅存在于该会话中，不会保存到磁盘，使其对快速测试或自动化脚本很有用。您可以在单个 `--agents` 调用中定义多个 subagents：

<Tabs>
  <Tab title="macOS, Linux, WSL">
    ```bash theme={null}
    claude --agents '{
      "code-reviewer": {
        "description": "Expert code reviewer. Use proactively after code changes.",
        "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
        "tools": ["Read", "Grep", "Glob", "Bash"],
        "model": "sonnet"
      },
      "debugger": {
        "description": "Debugging specialist for errors and test failures.",
        "prompt": "You are an expert debugger. Analyze errors, identify root causes, and provide fixes."
      }
    }'
    ```
  </Tab>

  <Tab title="Windows PowerShell">
    ```powershell theme={null}
    claude --agents @'
    {
      "code-reviewer": {
        "description": "Expert code reviewer. Use proactively after code changes.",
        "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
        "tools": ["Read", "Grep", "Glob", "Bash"],
        "model": "sonnet"
      },
      "debugger": {
        "description": "Debugging specialist for errors and test failures.",
        "prompt": "You are an expert debugger. Analyze errors, identify root causes, and provide fixes."
      }
    }
    '@
    ```
  </Tab>
</Tabs>

`--agents` 标志接受 JSON，具有与基于文件的 subagents 相同的 [frontmatter](#supported-frontmatter-fields) 字段：`description`、`prompt`、`tools`、`disallowedTools`、`model`、`permissionMode`、`mcpServers`、`hooks`、`maxTurns`、`skills`、`initialPrompt`、`memory`、`effort`、`background`、`isolation` 和 `color`。对系统提示使用 `prompt`，等同于基于文件的 subagents 中的 markdown 正文。

**托管 subagents** 由组织管理员部署。在 [managed settings directory](/docs/zh-CN/settings#settings-files) 内的 `.claude/agents/` 中放置 markdown 文件，使用与项目和用户 subagents 相同的 frontmatter 格式。托管定义优先于具有相同名称的项目和用户 subagents。

**Plugin subagents** 来自您已安装的 [plugins](/docs/zh-CN/plugins)。它们与您的自定义 subagents 一起加载，并在 @-mention 类型提前中以其范围名称出现。有关创建 plugin subagents 的详细信息，请参阅 [plugin 组件参考](/docs/zh-CN/plugins-reference#agents)。

<Note>
  出于安全原因，plugin subagents 不支持 `hooks`、`mcpServers` 或 `permissionMode` frontmatter 字段。加载来自 plugin 的代理时，这些字段被忽略。如果您需要它们，请将代理文件复制到 `.claude/agents/` 或 `~/.claude/agents/`。您也可以在 `settings.json` 或 `settings.local.json` 中向 [`permissions.allow`](/docs/zh-CN/settings#permission-settings) 添加规则，但这些规则适用于整个会话，而不仅仅是 plugin subagent。
</Note>

来自任何这些范围的 subagent 定义也可用于 [agent teams](/docs/zh-CN/agent-teams#use-subagent-definitions-for-teammates)：当生成一个队友时，您可以引用一个 subagent 类型，队友使用其 `tools` 和 `model`，定义的正文作为额外指令附加到队友的系统提示。有关哪些 frontmatter 字段适用于该路径，请参阅 [agent teams](/docs/zh-CN/agent-teams#use-subagent-definitions-for-teammates)。

<h3 id="write-subagent-files">
  编写 subagent 文件
</h3>

Subagent 文件使用 YAML frontmatter 进行配置，然后是 Markdown 中的系统提示：

<Note>
  Claude Code 监视 `~/.claude/agents/` 和 `.claude/agents/`。当您在磁盘上添加或编辑 subagent 文件，或要求 Claude 为您编写一个时，Claude Code 会在几秒内检测到更改，下一次委托使用更新的定义，无需重启。

  两种情况仍然需要重启：

  * 监视器仅涵盖会话启动时存在的目录，因此在新 `agents` 目录中创建范围的第一个代理文件后，重启以加载它。
  * 使用 `--disable-slash-commands` 启动的会话根本不监视这些目录。
</Note>

```markdown theme={null}
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Frontmatter 定义了 subagent 的元数据和配置。正文成为指导 subagent 行为的系统提示。Subagents 仅接收此系统提示（加上基本环境详细信息，如工作目录），而不是完整的 Claude Code 系统提示。

在 [non-interactive mode](/docs/zh-CN/headless) 中，[`--append-subagent-system-prompt`](/docs/zh-CN/cli-reference#cli-flags) 标志将您提供的文本附加到每个 subagent 的系统提示末尾，包括嵌套 subagents。需要 Claude Code v2.1.205 或更高版本。

一个 subagent 在主对话的当前工作目录中启动。在 subagent 中，`cd` 命令不会在 Bash 或 PowerShell 工具调用之间持续，也不会影响主对话的工作目录。要给 subagent 一个隔离的存储库副本，请改为设置 [`isolation: worktree`](#supported-frontmatter-fields)。

具有 `isolation: worktree` 的 subagent 在其 worktree 内运行其 Bash 和 PowerShell 命令。一个工作目录解析到您的主检出的命令，例如因为 worktree 目录在 subagent 运行时被删除，会失败并出现错误。在 v2.1.203 之前，这样的命令可能在主检出中运行。

<h4 id="supported-frontmatter-fields">
  支持的 frontmatter 字段
</h4>

以下字段可以在 YAML frontmatter 中使用。只有 `name` 和 `description` 是必需的。

| Field             | 必需 | Description                                                                                                                                                                                                                         |
| :---------------- | :- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | 是  | 使用小写字母和连字符的唯一标识符。[Hooks](/docs/zh-CN/hooks#subagentstart) 将此值作为 `agent_type` 接收。文件名不必匹配                                                                                                                                                  |
| `description`     | 是  | Claude 何时应该委托给此 subagent                                                                                                                                                                                                            |
| `tools`           | 否  | [Tools](#available-tools) subagent 可以使用。如果省略，继承所有工具。要将 Skills 预加载到上下文中，请使用 `skills` 字段而不是在此处列出 `Skill`                                                                                                                              |
| `disallowedTools` | 否  | 要拒绝的工具，从继承或指定的列表中删除                                                                                                                                                                                                                 |
| `model`           | 否  | [Model](#choose-a-model) 使用：`sonnet`、`opus`、`haiku`、`fable`、完整模型 ID（例如，`claude-opus-4-8`）或 `inherit`。默认为 `inherit`                                                                                                                  |
| `permissionMode`  | 否  | [Permission mode](#permission-modes)：`default`、`acceptEdits`、`auto`、`dontAsk`、`bypassPermissions`、`plan` 或 `manual` 作为 `default` 的别名。`manual` 别名需要 Claude Code v2.1.200 或更高版本。对于 [plugin subagents](#choose-the-subagent-scope) 被忽略 |
| `maxTurns`        | 否  | subagent 停止前的最大代理轮数                                                                                                                                                                                                                 |
| `skills`          | 否  | [Skills](/docs/zh-CN/skills) 在启动时加载到 subagent 的上下文中。注入完整的技能内容，而不仅仅是描述。Subagents 仍然可以通过 Skill 工具调用未列出的项目、用户和 plugin 技能                                                                                                                    |
| `mcpServers`      | 否  | [MCP servers](/docs/zh-CN/mcp) 对此 subagent 可用。每个条目要么是引用已配置服务器的服务器名称（例如，`"slack"`），要么是内联定义，其中服务器名称为键，完整的 [MCP server config](/docs/zh-CN/mcp#installing-mcp-servers) 为值。对于 [plugin subagents](#choose-the-subagent-scope) 被忽略                  |
| `hooks`           | 否  | [Lifecycle hooks](#define-hooks-for-subagents) 限定于此 subagent。对于 [plugin subagents](#choose-the-subagent-scope) 被忽略                                                                                                                  |
| `memory`          | 否  | [Persistent memory scope](#enable-persistent-memory)：`user`、`project` 或 `local`。启用跨会话学习                                                                                                                                             |
| `background`      | 否  | 设置为 `true` 以始终将此 subagent 作为 [background task](#run-subagents-in-foreground-or-background) 运行，即使 Claude 需要其结果。未设置时，Claude 选择，从 v2.1.198 开始，它默认在后台运行 subagents                                                                       |
| `effort`          | 否  | 此 subagent 活跃时的努力级别。覆盖会话努力级别。默认：从会话继承。选项：`low`、`medium`、`high`、`xhigh`、`max`；可用级别取决于模型                                                                                                                                              |
| `isolation`       | 否  | 设置为 `worktree` 以在临时 [git worktree](/docs/zh-CN/worktrees) 中运行 subagent，为其提供存储库的隔离副本，默认从您的 [default branch](/docs/zh-CN/worktrees#choose-the-base-branch) 分支，而不是父会话的 `HEAD`。如果 subagent 不进行任何更改，worktree 会自动清理                                 |
| `color`           | 否  | Subagent 在任务列表和转录中的显示颜色。接受 `red`、`blue`、`green`、`yellow`、`purple`、`orange`、`pink` 或 `cyan`                                                                                                                                          |
| `initialPrompt`   | 否  | 当此代理作为主会话代理运行时（通过 `--agent` 或 `agent` 设置），自动提交为第一个用户轮次。[Commands](/docs/zh-CN/commands) 和 [skills](/docs/zh-CN/skills) 被处理。前置于任何用户提供的提示                                                                                                       |

<h3 id="choose-a-model">
  选择模型
</h3>

`model` 字段控制 subagent 使用的 [AI model](/docs/zh-CN/model-config)：

* **Model alias**: 使用可用的别名之一：`sonnet`、`opus`、`haiku` 或 `fable`
* **Full model ID**: 使用完整的模型 ID，如 `claude-opus-4-8` 或 `claude-sonnet-5`。接受与 `--model` 标志相同的值
* **inherit**: 使用与主对话相同的模型
* **Omitted**: 默认为 `inherit` 并使用与主对话相同的模型

当 Claude 调用 subagent 时，它也可以为该特定调用传递 `model` 参数。Claude Code 按以下顺序解析 subagent 的模型：

1. [`CLAUDE_CODE_SUBAGENT_MODEL`](/docs/zh-CN/model-config#environment-variables) 环境变量，当设置为模型别名或模型 ID 时
2. 每次调用的 `model` 参数
3. Subagent 定义的 `model` frontmatter
4. 主对话的模型

从 v2.1.196 开始，将 `CLAUDE_CODE_SUBAGENT_MODEL` 设置为 `inherit` 与不设置它相同：解析继续使用每次调用的 `model` 参数，然后是 frontmatter。在早期版本中，`inherit` 强制 subagents 使用主对话的模型，并忽略这两个来源。

环境变量、每次调用的参数和 frontmatter 值会根据您组织的 [`availableModels`](/docs/zh-CN/model-config#restrict-model-selection) 允许列表进行检查。解析为排除模型的值不会被使用，subagent 会改为在继承的模型上运行。

从 v2.1.198 开始，subagents 也继承主对话的 [extended thinking](/docs/zh-CN/model-config#extended-thinking) 配置：如果在您的会话中启用了思考，对于 subagent 也启用，如果关闭，则保持关闭。没有每个 subagent 的思考设置。在 v2.1.198 之前，subagents 运行时禁用了扩展思考，无论主对话的设置如何。

<h3 id="control-subagent-capabilities">
  控制 subagent 能力
</h3>

您可以通过工具访问、权限模式和条件规则来控制 subagents 可以做什么。

<h4 id="available-tools">
  可用工具
</h4>

Subagents 默认继承主对话中可用的 [internal tools](/docs/zh-CN/tools-reference) 和 MCP 工具。以下工具取决于主对话的 UI 或会话状态，即使在 `tools` 字段中列出也不可用于 subagents：

* `AskUserQuestion`
* `EnterPlanMode`
* `ExitPlanMode`，除非 subagent 的 [`permissionMode`](#permission-modes) 是 `plan`
* `ScheduleWakeup`
* `WaitForMcpServers`

要限制工具，使用 `tools` 字段（允许列表）或 `disallowedTools` 字段（拒绝列表）。此示例使用 `tools` 来专门允许 Read、Grep、Glob 和 Bash。Subagent 无法编辑文件、写入文件或使用任何 MCP 工具：

```yaml theme={null}
---
name: safe-researcher
description: Research agent with restricted capabilities
tools: Read, Grep, Glob, Bash
---
```

此示例使用 `disallowedTools` 来继承主对话的每个工具，除了 Write 和 Edit。Subagent 保留 Bash、MCP 工具和其他所有内容：

```yaml theme={null}
---
name: no-writes
description: Inherits every tool except file writes
disallowedTools: Write, Edit
---
```

如果两者都设置，`disallowedTools` 首先应用，然后 `tools` 针对剩余的池进行解析。同时列在两者中的工具被删除。

当 `tools` 列表中没有任何内容解析为工具时，例如因为每个条目都拼写错误或命名了对 subagents 不可用的工具，Claude Code 拒绝启动 subagent，Agent 工具返回一个错误，命名未解析的条目。在 v2.1.208 之前，该 subagent 启动时没有工具，可能返回空的或令人困惑的结果。

两个字段都接受 MCP 服务器级别的模式，除了精确的工具名称：`mcp__<server>` 或 `mcp__<server>__*` 授予或删除来自命名服务器的每个工具。在 `disallowedTools` 中，`mcp__*` 也删除来自任何服务器的每个 MCP 工具。此示例删除来自 `github` MCP 服务器的每个工具，同时保留来自其他服务器的工具和每个内置工具：

```yaml theme={null}
---
name: local-only
description: Inherits every tool except those from the github MCP server
disallowedTools: mcp__github
---
```

<h4 id="restrict-which-subagents-can-be-spawned">
  限制可以生成哪些 subagents
</h4>

当代理作为主线程运行时，使用 `claude --agent`，它可以使用 Agent 工具生成 subagents。要限制它可以生成的 subagent 类型，在 `tools` 字段中使用 `Agent(agent_type)` 语法。

<Note>在版本 2.1.63 中，Task 工具被重命名为 Agent。设置和代理定义中的现有 `Task(...)` 引用仍然作为别名工作。</Note>

```yaml theme={null}
---
name: coordinator
description: Coordinates work across specialized agents
tools: Agent(worker, researcher), Read, Bash
---
```

这是一个允许列表：只有 `worker` 和 `researcher` subagents 可以被生成。如果代理尝试生成任何其他类型，请求失败，代理在其提示中仅看到允许的类型。要在允许所有其他类型的同时阻止特定代理，请改用 [`permissions.deny`](#disable-specific-subagents)。

要允许生成任何 subagent 而不受限制，使用不带括号的 `Agent`：

```yaml theme={null}
tools: Agent, Read, Bash
```

如果 `Agent` 完全从 `tools` 列表中省略，代理无法生成任何 subagents。

`Agent(agent_type)` 允许列表语法仅适用于作为主线程运行的代理，使用 `claude --agent`。在 subagent 定义中，在 `tools` 中列出 `Agent` 让该 subagent [生成嵌套 subagents](#spawn-nested-subagents)，但括号内的任何类型列表都被忽略。

<h4 id="scope-mcp-servers-to-a-subagent">
  将 MCP 服务器限定于 subagent
</h4>

使用 `mcpServers` 字段为 subagent 提供对主对话中不可用的 [MCP](/docs/zh-CN/mcp) 服务器的访问。此处定义的内联服务器在 subagent 启动时连接，在完成时断开连接。字符串引用共享父会话的连接。

<Note>
  `mcpServers` 字段适用于代理文件可以运行的两个上下文：

  * 作为 subagent，通过 Agent 工具或 @-mention 生成
  * 作为主会话，使用 [`--agent`](#invoke-subagents-explicitly) 或 `agent` 设置启动

  当代理是主会话时，内联服务器定义与来自 [`.mcp.json`](/docs/zh-CN/mcp) 和设置文件的服务器一起在启动时连接。
</Note>

列表中的每个条目要么是内联服务器定义，要么是引用会话中已配置的 MCP 服务器的字符串：

```yaml theme={null}
---
name: browser-tester
description: Tests features in a real browser using Playwright
mcpServers:
  # Inline definition: scoped to this subagent only
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  # Reference by name: reuses an already-configured server
  - github
---

Use the Playwright tools to navigate, screenshot, and interact with pages.
```

内联定义使用与 `.mcp.json` 服务器条目相同的架构，由服务器名称键入，并支持 `stdio`、`http`、`sse` 和 `ws` 类型。

要将 MCP 服务器保持在主对话之外，并避免其工具描述消耗那里的上下文，请在此处内联定义它，而不是在 `.mcp.json` 中。Subagent 获得工具；父对话不获得。

从 v2.1.153 开始，适用于主会话的 MCP 限制也涵盖在 subagent frontmatter 中声明的服务器：

* [`--strict-mcp-config`](/docs/zh-CN/cli-reference) 和 [`--bare`](/docs/zh-CN/cli-reference)
* [Enterprise managed MCP configuration](/docs/zh-CN/managed-mcp)
* [`allowedMcpServers` 和 `deniedMcpServers` 策略](/docs/zh-CN/managed-mcp#policy-based-control-with-allowlists-and-denylists)

当其中之一阻止服务器时，Claude Code 会跳过它并显示一个警告，命名被阻止的服务器。

托管设置限制适用于每个 subagent，无论如何定义。`--strict-mcp-config` 不会过滤您通过 `--agents` 或 SDK `agents` 选项内联传递的服务器，因为这些是显式调用者输入。

<h4 id="permission-modes">
  权限模式
</h4>

`permissionMode` 字段控制 subagent 如何处理权限提示。Subagents 从主对话继承权限上下文，并可以覆盖模式，除非父模式优先，如下所述。

| Mode                | Behavior                                                                                                                                                                                                                        |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`           | 标准权限检查，带有提示                                                                                                                                                                                                                     |
| `acceptEdits`       | 自动接受文件编辑和工作目录或 `additionalDirectories` 中路径的常见文件系统命令                                                                                                                                                                             |
| `auto`              | [Auto mode](/docs/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)：后台分类器审查命令和受保护目录的写入                                                                                                                                        |
| `dontAsk`           | 自动拒绝权限提示。显式允许的工具仍然工作；`AskUserQuestion`、connector 工具 [您的组织设置为 `ask`](/docs/zh-CN/mcp#organization-controls-on-connector-tools) 和标记为 [`requiresUserInteraction`](/docs/zh-CN/mcp#require-approval-for-a-specific-tool) 的 MCP 工具被拒绝，即使您已允许它们 |
| `bypassPermissions` | 跳过权限提示                                                                                                                                                                                                                          |
| `plan`              | Plan mode（只读探索）                                                                                                                                                                                                                 |

<Warning>
  谨慎使用 `bypassPermissions`。它跳过权限提示，允许 subagent 在没有批准的情况下执行操作，包括对 `.git`、`.config/git`、`.claude`、`.vscode`、`.idea`、`.husky`、`.cargo`、`.devcontainer`、`.yarn` 和 `.mvn` 的写入。

  显式 [`ask` 规则](/docs/zh-CN/permissions#manage-permissions)、connector 工具 [您的组织设置为 `ask`](/docs/zh-CN/mcp#organization-controls-on-connector-tools)、标记为 [`requiresUserInteraction`](/docs/zh-CN/mcp#require-approval-for-a-specific-tool) 的 MCP 工具以及根目录和主目录删除（如 `rm -rf /`）仍然会提示。有关详细信息，请参阅 [permission modes](/docs/zh-CN/permission-modes#skip-all-checks-with-bypasspermissions-mode)。
</Warning>

如果父级使用 `bypassPermissions` 或 `acceptEdits`，这优先并且无法被覆盖。如果父级使用 [auto mode](/docs/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)，subagent 继承 auto mode，其 frontmatter 中的任何 `permissionMode` 被忽略：分类器使用与父会话相同的块和允许规则评估 subagent 的工具调用。

<h4 id="preload-skills-into-subagents">
  将技能预加载到 subagents
</h4>

使用 `skills` 字段在启动时将技能内容注入到 subagent 的上下文中。这为 subagent 提供领域知识，而无需在执行期间发现和加载技能。

```yaml theme={null}
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---

Implement API endpoints. Follow the conventions and patterns from the preloaded skills.
```

每个列出的技能的完整内容被注入到 subagent 的上下文中。此字段控制哪些技能被预加载，而不是 subagent 可以访问哪些技能：没有它，subagent 仍然可以在执行期间通过 Skill 工具发现和调用项目、用户和 plugin 技能。要防止 subagent 完全调用技能，请从 [`tools`](#available-tools) 列表中省略 `Skill` 或将其添加到 `disallowedTools`。

您无法预加载设置了 [`disable-model-invocation: true`](/docs/zh-CN/skills#control-who-invokes-a-skill) 的技能，因为预加载来自 Claude 可以调用的相同技能集。如果列出的技能缺失或被禁用，Claude Code 会跳过它并向调试日志记录警告。

<Note>
  这与 [在 subagent 中运行技能](/docs/zh-CN/skills#run-skills-in-a-subagent) 相反。使用 subagent 中的 `skills`，subagent 控制系统提示并加载技能内容。使用技能中的 `context: fork`，技能内容被注入到您指定的代理中。两者都使用相同的底层系统。
</Note>

<h4 id="enable-persistent-memory">
  启用持久内存
</h4>

`memory` 字段为 subagent 提供一个在对话中幸存的持久目录。Subagent 使用此目录随时间积累知识，例如代码库模式、调试见解和架构决策。

```yaml theme={null}
---
name: code-reviewer
description: Reviews code for quality and best practices
memory: user
---

You are a code reviewer. As you review code, update your agent memory with
patterns, conventions, and recurring issues you discover.
```

根据内存应该应用的广泛程度选择范围：

| Scope     | Location                                      | 使用时机                          |
| :-------- | :-------------------------------------------- | :---------------------------- |
| `user`    | `~/.claude/agent-memory/<name-of-agent>/`     | subagent 应该在所有项目中记住学习         |
| `project` | `.claude/agent-memory/<name-of-agent>/`       | subagent 的知识是特定于项目的并可通过版本控制共享 |
| `local`   | `.claude/agent-memory-local/<name-of-agent>/` | subagent 的知识是特定于项目的但不应检入版本控制  |

启用内存时：

* Subagent 的系统提示包括读取和写入内存目录的说明。
* Subagent 的系统提示还包括内存目录中 `MEMORY.md` 的前 200 行或 25KB，以先到者为准，以及如果 `MEMORY.md` 超过该限制则策划 `MEMORY.md` 的说明。
* Read、Write 和 Edit 工具会自动启用，以便 subagent 可以管理其内存文件。

<h5 id="persistent-memory-tips">
  持久内存提示
</h5>

* `project` 是推荐的默认范围。它使 subagent 知识可通过版本控制共享。
* 要求 subagent 在开始工作前查阅其内存："Review this PR, and check your memory for patterns you've seen before."
* 要求 subagent 在完成任务后更新其内存："Now that you're done, save what you learned to your memory." 随着时间的推移，这会建立一个知识库，使 subagent 更有效。
* 直接在 subagent 的 markdown 文件中包含内存说明，以便它主动维护自己的知识库：

  ```markdown theme={null}
  Update your agent memory as you discover codepaths, patterns, library
  locations, and key architectural decisions. This builds up institutional
  knowledge across conversations. Write concise notes about what you found
  and where.
  ```

<h4 id="conditional-rules-with-hooks">
  使用 hooks 的条件规则
</h4>

为了更动态地控制工具使用，使用 `PreToolUse` hooks 在执行前验证操作。当您需要允许工具的某些操作同时阻止其他操作时，这很有用。

此示例创建一个仅允许只读数据库查询的 subagent。`PreToolUse` hook 在每个 Bash 命令执行前运行 `command` 中指定的脚本：

```yaml theme={null}
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

Claude Code [通过 stdin 将 hook 输入作为 JSON 传递](/docs/zh-CN/hooks#pretooluse-input) 给 hook 命令。验证脚本读取此 JSON，提取 Bash 命令，并 [以代码 2 退出](/docs/zh-CN/hooks#exit-code-2-behavior-per-event) 以阻止写入操作：

```bash theme={null}
#!/bin/bash
# ./scripts/validate-readonly-query.sh

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block SQL write operations (case-insensitive)
if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b' > /dev/null; then
  echo "Blocked: Only SELECT queries are allowed" >&2
  exit 2
fi

exit 0
```

有关完整的输入架构，请参阅 [Hook input](/docs/zh-CN/hooks#pretooluse-input)，有关退出代码如何影响行为，请参阅 [exit codes](/docs/zh-CN/hooks#exit-code-output)。在 Windows 上，在 PowerShell 中编写 hook 脚本，并在 hook 条目中添加 `shell: powershell`，如 [在 PowerShell 中运行 hooks](/docs/zh-CN/hooks#windows-powershell-tool) 中所示。

<h4 id="disable-specific-subagents">
  禁用特定 subagents
</h4>

您可以通过将 subagents 添加到您的 [settings](/docs/zh-CN/settings#permission-settings) 中的 `deny` 数组来防止 Claude 使用特定 subagents。使用格式 `Agent(subagent-name)`，其中 `subagent-name` 与 subagent 的 name 字段匹配。

```json theme={null}
{
  "permissions": {
    "deny": ["Agent(Explore)", "Agent(my-custom-agent)"]
  }
}
```

这对内置和自定义 subagents 都有效。您也可以使用 `--disallowedTools` CLI 标志：

```bash theme={null}
claude --disallowedTools "Agent(Explore)"
```

有关权限规则的更多详细信息，请参阅 [Permissions documentation](/docs/zh-CN/permissions#tool-specific-permission-rules)。

<h3 id="define-hooks-for-subagents">
  为 subagents 定义 hooks
</h3>

Subagents 可以定义在 subagent 的生命周期中运行的 [hooks](/docs/zh-CN/hooks)。有两种方式来配置 hooks：

* **在 subagent 的 frontmatter 中**：定义仅在该 subagent 活跃时运行的 hooks
* **在 `settings.json` 中**：定义在 subagents 启动或停止时在主会话中运行的 hooks

<h4 id="hooks-in-subagent-frontmatter">
  Subagent frontmatter 中的 Hooks
</h4>

直接在 subagent 的 markdown 文件中定义 hooks。这些 hooks 仅在该特定 subagent 活跃时运行，并在完成时清理。

<Note>
  Frontmatter hooks 在代理通过 Agent 工具或 @-mention 作为 subagent 生成时触发，以及当代理通过 [`--agent`](#invoke-subagents-explicitly) 或 `agent` 设置作为主会话运行时触发。在主会话情况下，它们与在 [`settings.json`](/docs/zh-CN/hooks) 中定义的任何 hooks 一起运行。
</Note>

所有 [hook events](/docs/zh-CN/hooks#hook-events) 都被支持。subagents 最常见的事件是：

| Event         | Matcher input | 何时触发                                   |
| :------------ | :------------ | :------------------------------------- |
| `PreToolUse`  | Tool name     | 在 subagent 使用工具之前                      |
| `PostToolUse` | Tool name     | 在 subagent 使用工具之后                      |
| `Stop`        | (none)        | 当 subagent 完成时（在运行时转换为 `SubagentStop`） |

此示例使用 `PreToolUse` hook 验证 Bash 命令，并在文件编辑后使用 `PostToolUse` 运行 linter：

```yaml theme={null}
---
name: code-reviewer
description: Review code changes with automatic linting
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh $TOOL_INPUT"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
---
```

Frontmatter 中的 `Stop` hooks 会自动转换为 `SubagentStop` 事件。

<h4 id="project-level-hooks-for-subagent-events">
  用于 subagent 事件的项目级 hooks
</h4>

在 `settings.json` 中配置 hooks，以响应主会话中的 subagent 生命周期事件。

| Event           | Matcher input   | 何时触发             |
| :-------------- | :-------------- | :--------------- |
| `SubagentStart` | Agent type name | 当 subagent 开始执行时 |
| `SubagentStop`  | Agent type name | 当 subagent 完成时   |

两个事件都支持匹配器以按名称针对特定代理类型。匹配器值是项目级和用户级 subagents 的代理 frontmatter `name`，或 [plugin subagents](/docs/zh-CN/plugins) 的 plugin 范围标识符，例如 `my-plugin:db-agent`。范围名称包含冒号，因此它被评估为 [unanchored regular expression](/docs/zh-CN/hooks#matcher-patterns)；使用 `^` 和 `$` 锚定它，如 `^my-plugin:db-agent$`，以仅匹配该代理。

此示例仅在 `db-agent` subagent 启动时运行设置脚本，并在任何 subagent 停止时运行清理脚本：

```json theme={null}
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "db-agent",
        "hooks": [
          { "type": "command", "command": "./scripts/setup-db-connection.sh" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "./scripts/cleanup-db-connection.sh" }
        ]
      }
    ]
  }
}
```

一个带连字符的匹配器，如 `db-agent`，在 Claude Code v2.1.195 或更高版本上精确匹配。在早期版本上，它被评估为 unanchored regular expression，也会为任何包含它的代理类型触发，例如 `prod-db-agent`；在这些版本上使用 `^db-agent$` 锚定它。

有关完整的 hook 配置格式，请参阅 [Hooks](/docs/zh-CN/hooks)。

<h2 id="work-with-subagents">
  使用 subagents
</h2>

<h3 id="understand-automatic-delegation">
  理解自动委托
</h3>

Claude 根据您请求中的任务描述、subagent 配置中的 `description` 字段和当前上下文自动委托任务。要鼓励主动委托，在您的 subagent 的 description 字段中包含"use proactively"之类的短语。

<h3 id="invoke-subagents-explicitly">
  显式调用 subagents
</h3>

当自动委托不够时，您可以自己请求 subagent。三种模式从一次性建议升级到会话范围的默认值：

* **自然语言**：在提示中命名 subagent；Claude 决定是否委托
* **@-mention**：保证 subagent 为一个任务运行
* **会话范围**：整个会话使用该 subagent 的系统提示、工具限制和模型，通过 `--agent` 标志或 `agent` 设置

对于自然语言，没有特殊语法。命名 subagent，Claude 通常会委托：

```text wrap theme={null}
Use the test-runner subagent to fix failing tests
Have the code-reviewer subagent look at my recent changes
```

**@-mention subagent。** 输入 `@` 并从类型提前中选择 subagent，就像您 @-mention 文件一样。这确保特定 subagent 运行，而不是将选择留给 Claude：

```text wrap theme={null}
@"code-reviewer (agent)" look at the auth changes
```

您的完整消息仍然发送给 Claude，它根据您的要求为 subagent 编写任务提示。@-mention 控制调用哪个 subagent，而不是它接收什么提示。

由启用的 [plugin](/docs/zh-CN/plugins) 提供的 Subagents 在类型提前中显示为其作用域名称，例如 `my-plugin:code-reviewer` 或 `my-plugin:review:security`，当 plugin [将 agents 组织到子文件夹中](#choose-the-subagent-scope)。命名背景 subagents 当前在会话中运行也出现在类型提前中，在名称旁边显示其状态。您也可以手动输入提及而不使用选择器：`@agent-<name>` 用于本地 subagents，或 `@agent-` 后跟 plugin subagents 的作用域名称，例如 `@agent-my-plugin:code-reviewer`。

**将整个会话作为 subagent 运行。** 传递 [`--agent <name>`](/docs/zh-CN/cli-reference) 以启动一个会话，其中主线程本身采用该 subagent 的系统提示、工具限制和模型：

```bash theme={null}
claude --agent code-reviewer
```

Subagent 的系统提示完全替换默认 Claude Code 系统提示，就像 [`--system-prompt`](/docs/zh-CN/cli-reference) 一样。`CLAUDE.md` 文件和项目内存仍然通过正常消息流加载。代理名称在启动标题中显示为 `@<name>`，以便您可以确认它是活跃的。

这适用于内置和自定义 subagents，当您恢复会话时选择会持续。

对于 plugin 提供的 subagent，您可以仅传递代理名称，Claude Code 会找到它：

```bash theme={null}
claude --agent security-reviewer
```

如果多个 plugins 提供具有相同名称的 agents，传递作用域名称以消除歧义：

```bash theme={null}
claude --agent my-plugin:security-reviewer
```

如果 plugin 将 agent 放在其 `agents/` 目录的子文件夹中，请在作用域名称中包含子文件夹，例如 `claude --agent my-plugin:review:security`。

要使其成为项目中每个会话的默认值，在 `.claude/settings.json` 中设置 `agent`：

```json theme={null}
{
  "agent": "code-reviewer"
}
```

如果两者都存在，CLI 标志覆盖设置。

<h3 id="run-subagents-in-foreground-or-background">
  在前台或后台运行 subagents
</h3>

Subagents 可以在前台或后台运行：

* **前台 subagents** 阻塞主对话直到完成。权限提示会在出现时传递给您。
* **后台 subagents** 在您继续工作时并发运行。从 v2.1.186 开始，当后台 subagent 到达需要权限的工具调用时，提示会在您的主会话中显示，并命名正在请求的 subagent。批准以让 subagent 继续，或按 Esc 拒绝该单个工具调用而不停止 subagent。在 v2.1.186 之前，后台 subagents 自动拒绝任何会提示的工具调用。

从 v2.1.198 开始，subagents 默认在后台运行。Claude 在需要结果才能继续时在前台运行 subagent。默认值改变 subagent 运行的位置，而不是它被允许做什么：后台 subagents 仍然在您的主会话中显示每个权限提示。在 v2.1.198 之前，Claude 根据任务在前台和后台之间选择。

您也可以自己控制这个：

* 要求 Claude 在后台或前台运行任务
* 按 **Ctrl+B** 将运行中的任务放在后台

完成的后台 subagent 在 [`/tasks`](/docs/zh-CN/commands) 中保持列出，标记为完成并排序在运行工作下方，直到会话清理其任务列表。当 subagent 完成时，其详情视图保持打开。失败或您停止的 Subagents 离开列表。在 v2.1.208 之前，完成的 subagent 在完成时立即离开列表，其详情视图关闭。

要禁用所有后台任务功能，请将 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 环境变量设置为 `1`。请参阅 [Environment variables](/docs/zh-CN/env-vars)。

当 [`CLAUDE_CODE_FORK_SUBAGENT`](#fork-the-current-conversation) 设置为 `1` 时，每个 subagent 生成都在后台运行，frontmatter `background` 字段无效，因为 fork 模式从 `Agent` 工具中移除了 `run_in_background` 参数。`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 优先于 fork 模式，并将 subagent 生成保持在前台。

<h3 id="api-errors-in-subagents">
  Subagents 中的 API 错误
</h3>

从 v2.1.199 开始，subagent 的运行因 API 错误（例如使用限制或重复的服务器错误）而结束时，会向 Claude 报告该失败，而不是返回错误文本，就像它是 subagent 的发现一样。Claude 接收的内容取决于 subagent 运行的位置：

* **前台**：如果速率限制、过载或服务器错误切断已经产生输出的 subagent，Agent 工具返回该部分输出，并注明 subagent 被切断且未完成其任务。未产生任何内容的 subagent，或其唯一输出是工具调用的 subagent，失败并出现 [`Agent terminated early due to an API error`](/docs/zh-CN/errors#agent-terminated-early-due-to-an-api-error)，后跟错误详情。在 v2.1.199 中，切断仅工具调用形状的速率限制、过载或服务器错误返回了仅包含切断注记的空部分结果。
* **后台**：subagent 被标记为失败，Claude 在其结束时接收的消息命名 API 错误并包括 subagent 的最后输出，所以部分工作不会丢失。

一旦底层 API 错误清除，要求 Claude 重试任务或 [恢复 subagent](#resume-subagents)。

<h3 id="common-patterns">
  常见模式
</h3>

<h4 id="isolate-high-volume-operations">
  隔离高容量操作
</h4>

subagents 最有效的用途之一是隔离产生大量输出的操作。运行测试、获取文档或处理日志文件可能会消耗大量上下文。通过将这些委托给 subagent，详细输出保留在 subagent 的上下文中，而只有相关摘要返回到您的主对话。

```text wrap theme={null}
Use a subagent to run the test suite and report only the failing tests with their error messages
```

<h4 id="run-parallel-research">
  运行并行研究
</h4>

对于独立的调查，生成多个 subagents 以同时工作：

```text wrap theme={null}
Research the authentication, database, and API modules in parallel using separate subagents
```

每个 subagent 独立探索其区域，然后 Claude 综合这些发现。当研究路径彼此不依赖时，这效果最好。

<Warning>
  当 subagents 完成时，它们的结果返回到您的主对话。运行许多 subagents，每个都返回详细结果，可能会消耗大量上下文。
</Warning>

对于需要持续并行性或超过您的 context window 的任务，[agent teams](/docs/zh-CN/agent-teams) 为每个工作者提供自己的独立上下文。

<h4 id="chain-subagents">
  链接 subagents
</h4>

对于多步骤工作流，要求 Claude 按顺序使用 subagents。每个 subagent 完成其任务并将结果返回给 Claude，然后将相关上下文传递给下一个 subagent。

```text wrap theme={null}
Use the code-reviewer subagent to find performance issues, then use the optimizer subagent to fix them
```

<h3 id="choose-between-subagents-and-main-conversation">
  在 subagents 和主对话之间选择
</h3>

在以下情况下使用 **主对话**：

* 任务需要频繁的来回或迭代细化
* 多个阶段共享重要上下文，例如规划、实现和测试
* 您正在进行快速、有针对性的更改
* 延迟很重要。Subagents 从头开始，可能需要时间来收集上下文

在以下情况下使用 **subagents**：

* 任务产生您不需要在主上下文中的详细输出
* 您想强制执行特定的工具限制或权限
* 工作是自包含的，可以返回摘要

当您想要可重用的提示或在主对话上下文中运行的工作流而不是隔离的 subagent 上下文时，请改为考虑 [Skills](/docs/zh-CN/skills)。

对于关于对话中已有内容的快速问题，使用 [`/btw`](/docs/zh-CN/interactive-mode#side-questions-with-%2Fbtw) 而不是 subagent。它看到您的完整上下文但没有工具访问，答案被丢弃而不是添加到历史记录。

<h3 id="spawn-nested-subagents">
  生成嵌套 subagents
</h3>

从 Claude Code v2.1.172 开始，subagent 可以生成自己的 subagents。当委托的任务本身分裂成并行子任务时使用这个，例如审查者 subagent 为每个发现分派一个验证者，所以中间输出永远不会到达您的主对话。只有顶级 subagent 的摘要返回给您。

嵌套 subagent 的配置方式与顶级 subagent 相同，并从相同的 [scopes](#choose-the-subagent-scope) 解析。

subagent 面板在提示输入下方显示完整的树：每行显示一个 `(+N)` 后代计数，从 v2.1.193 开始，打开一行显示该 subagent 的兄弟和直接子代，以及返回到 `main` 的路径。

深度计算为主对话下方的 subagent 级别数，无论每个级别是否在 [前台或后台](#run-subagents-in-foreground-or-background) 运行。深度为五的 subagent 不接收 Agent 工具，无法进一步生成。限制是固定的且不可配置。

从 Claude Code v2.1.187 开始，后台 subagent 的深度在首次生成时是固定的，[恢复](#resume-subagents)它稍后不会改变该深度。例如，如果您的主对话生成 subagent A，而 A 在深度二生成后台 subagent B，当您直接从主对话恢复 B 时，B 仍然在深度二。从更浅的上下文恢复 subagent 不会让它生成深度限制已经阻止的额外级别。

要防止特定 subagent 生成其他 subagents，从其 [`tools`](#available-tools) 列表中省略 `Agent` 或将其添加到 `disallowedTools`。

[fork](#fork-the-current-conversation) 仍然无法生成另一个 fork。它可以生成其他 subagent 类型，这些计入深度限制。

<h3 id="manage-subagent-context">
  管理 subagent 上下文
</h3>

<h4 id="what-loads-at-startup">
  启动时加载的内容
</h4>

每个 subagent 都以新鲜的隔离上下文窗口开始。它看不到您的对话历史、您已经调用的技能或 Claude 已经读取的文件。Claude 编写一条委托消息来总结任务，subagent 从那里开始工作。例外是 [fork](#fork-the-current-conversation)，它继承父对话而不是从头开始。

非 fork subagent 的初始上下文包含：

* **系统提示**：代理自己的提示加上 Claude Code 附加的环境详情，而不是完整的 Claude Code 系统提示。自定义 subagents 在 [markdown 正文](#write-subagent-files) 或 `prompt` 字段中定义它们。内置代理有预定义的提示。
* **任务消息**：Claude 在移交工作时编写的委托提示。
* **CLAUDE.md 和内存**：主对话加载的 [内存层次结构](/docs/zh-CN/memory#how-claude-md-files-load) 的每个级别，包括 `~/.claude/CLAUDE.md`、项目规则、`CLAUDE.local.md` 和托管策略文件。内置的 Explore 和 Plan 代理跳过这个。
* **Git 状态**：在父会话开始时拍摄的快照。当工作目录不是 Git 存储库或 [`includeGitInstructions`](/docs/zh-CN/settings#available-settings) 为 `false` 时不存在。Explore 和 Plan 无论如何都跳过它。
* **预加载的技能**：代理的 [`skills` 字段](#preload-skills-into-subagents) 中命名的任何技能的完整内容。内置代理不预加载技能。
* **兄弟名单**：系统提醒，列出 `main` 和会话中的每个其他命名代理，每个都是 [`SendMessage`](#resume-subagents) 的有效 `to` 值。需要 Claude Code v2.1.206 或更高版本。名单仅在 subagent 的工具包括 `SendMessage` 且至少有一个其他代理有名称时出现，无论 Claude 在生成时命名它还是它作为 [agent team](/docs/zh-CN/agent-teams) 队友运行。它是 subagent 启动时拍摄的快照，所以稍后命名的代理不会出现。

Explore 和 Plan 是仅有的省略 CLAUDE.md 和 git 状态的 subagents。没有 frontmatter 字段或按代理设置来改变哪些代理跳过它们。

主对话使用完整的 CLAUDE.md 上下文读取 Explore 和 Plan 结果，所以大多数规则不需要到达 subagent 本身。如果规则必须，例如"忽略 `vendor/` 目录"，在您给 Claude 委托时的提示中重新陈述它。

<h4 id="resume-subagents">
  恢复 subagents
</h4>

每个 subagent 调用都会创建一个具有新鲜上下文的新实例。要继续现有 subagent 的工作而不是重新开始，要求 Claude 恢复它。

恢复的 subagents 保留其完整的对话历史，包括所有以前的工具调用、结果和推理。Subagent 从它停止的地方继续，而不是从头开始。

当 subagent 完成时，Claude 接收其代理 ID。内置的 Explore 和 Plan 代理是一次性的，不返回代理 ID，所以它们无法恢复；当您需要继续工作时，使用 `general-purpose` 或自定义 subagent。

Claude 使用 `SendMessage` 工具，将代理的 ID 或名称作为 `to` 字段来恢复它。`SendMessage` 不需要启用 [agent teams](/docs/zh-CN/agent-teams)；只有结构化的团队协议消息，例如 `shutdown_request` 和 `plan_approval_response`，才需要启用。

要恢复 subagent，要求 Claude 继续之前的工作：

```text wrap theme={null}
Use the code-reviewer subagent to review the authentication module
[Agent completes]

Continue that code review and now analyze the authorization logic
[Claude resumes the subagent with full context from previous conversation]
```

完成的 subagent 如果接收 `SendMessage`，会在后台自动恢复，无需新的 `Agent` 调用。同样适用于 Claude 用 `TaskStop` 工具停止的 subagent。

从 v2.1.191 开始，您自己停止的 subagent，使用 `/tasks` 中的 `x` 或 SDK `stop_task` 请求，不会自动恢复。`SendMessage` 调用返回拒绝，告诉 Claude 代理已被取消。在 subagent 面板中输入到该 subagent 的转录以自己恢复它，这会清除停止，以便稍后 `SendMessage` 调用可以再次自动恢复它。

恢复在相同 ID 下启动代理的新运行，所以已经失败或完成的 subagent 在任务列表和 Agent SDK 的任务事件中再次显示为运行。在 v2.1.205 之前，它在恢复的运行工作时保持显示其早期的失败或完成状态。

从 v2.1.199 开始，`SendMessage` 检查名称是否仍然指向它在对话中早期到达的同一代理。如果较新的代理已经采用了该名称，例如重新生成的后台代理重新使用了它，Claude Code 会拒绝发送，而不是将其传递给错误的代理，错误会报告该名称现在到达的代理，以便 Claude 可以重新定向。要在它仍在运行时到达早期的代理，Claude 通过其生成结果中的代理 ID 来寻址它。检查的范围是当前对话，并在 `/clear` 时重置。

从 v2.1.198 开始，subagent 将来自启动它的代理的消息视为正常任务方向，包括中途任务方向更正，并在其自己的权限设置内对其进行操作。无论谁发送消息，两个限制仍然成立：来自任何代理的消息都不计为您对待处理权限提示的批准，任何代理消息都无法改变 subagent 的权限设置、`CLAUDE.md` 或配置。只有权限系统或您自己的消息可以授予批准。

您也可以要求 Claude 提供代理 ID，如果您想明确引用它，或在 `~/.claude/projects/{project}/{sessionId}/subagents/` 的转录文件中找到 ID。每个转录存储为 `agent-{agentId}.jsonl`。

Subagent 转录独立于主对话持久化：

* **主对话压缩**：当主对话压缩时，subagent 转录不受影响。它们存储在单独的文件中。
* **会话持久性**：Subagent 转录在其会话中持久化。您可以通过恢复相同的会话在重启 Claude Code 后 [恢复 subagent](#resume-subagents)。
* **自动清理**：转录根据 `cleanupPeriodDays` 设置（默认为 30 天）进行清理。

<h4 id="auto-compaction">
  自动压缩
</h4>

Subagents 支持使用与主对话相同的逻辑进行自动压缩。压缩在相同条件下触发，`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 也适用于 subagents。有关何时覆盖生效的信息，请参阅 [environment variables](/docs/zh-CN/env-vars)。

压缩事件记录在 subagent 转录文件中：

```json theme={null}
{
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167189
  }
}
```

`preTokens` 值显示压缩发生前使用了多少令牌。

<h2 id="fork-the-current-conversation">
  分叉当前对话
</h2>

<Note>
  分叉 subagents 需要 Claude Code v2.1.117 或更高版本。从 v2.1.161 开始，`/fork` 命令默认启用；在早期版本中，它需要将 [`CLAUDE_CODE_FORK_SUBAGENT`](/docs/zh-CN/env-vars) 环境变量设置为 `1`。让 Claude 本身生成分叉是实验性的，可能在未来版本中更改。此功能也可以在交互式会话中启用，作为分阶段推出的一部分。
</Note>

分叉是一个 subagent，它继承到目前为止的整个对话，而不是从头开始。这消除了 subagents 通常提供的输入隔离：分叉看到与主会话相同的系统提示、工具、模型和消息历史，因此您可以将其交给一个辅助任务而无需重新解释情况。分叉自己的工具调用仍然保持在您的对话之外，只有其最终结果返回，因此您的主 context window 保持干净。当命名 subagent 需要太多背景才能有用时，或当您想从相同的起点并行尝试多种方法时，使用分叉。

要控制分叉模式而不管分阶段推出，将 [`CLAUDE_CODE_FORK_SUBAGENT`](/docs/zh-CN/env-vars) 设置为 `1` 以显式启用它，或设置为 `0` 以禁用它。该变量在交互模式以及通过 SDK 或 `claude -p` 中被遵守。

启用分叉模式以两种方式改变 Claude Code：

* Claude 可以通过显式请求 `fork` subagent 类型来生成分叉。没有 subagent 类型的生成仍然使用 [general-purpose](#built-in-subagents) subagent，命名 subagents 如 Explore 仍然像以前一样生成。
* 每个 subagent 生成都在 [background](#run-subagents-in-foreground-or-background) 中运行，无论它是分叉还是命名 subagent。设置 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 为 `1` 以保持生成同步。

您可以使用 `/fork` 后跟指令自己启动分叉，无论是否设置了变量。Claude Code 从指令的前几个单词命名分叉。以下示例分叉对话以在您继续主会话中的实现时草拟测试用例：

```text wrap theme={null}
/fork draft unit tests for the parser changes so far
```

分叉出现在提示下方的面板中，并在您继续工作时在后台运行。完成后，其结果作为消息到达您的主对话。下一部分涵盖了在分叉运行时观察和引导它们的面板控制。

<h3 id="observe-and-steer-running-forks">
  观察和引导运行中的分叉
</h3>

运行中的分叉出现在提示输入下方的面板中，主会话有一行，每个分叉有一行。使用这些键与面板交互：

| Key       | Action             |
| :-------- | :----------------- |
| `↑` / `↓` | 在行之间移动             |
| `Enter`   | 打开所选分叉的转录并向其发送后续消息 |
| `x`       | 关闭完成的分叉或停止运行中的分叉   |
| `Esc`     | 将焦点返回到提示输入         |

打开分叉或 subagent 的转录后，后续消息和 [skills](/docs/zh-CN/skills) 会发送到该代理，但内置命令仍在您的主对话中运行。从 v2.1.199 开始，在该视图中键入 `/model` 或 `/fast` 会显示一条通知，说明它改变主对话的模型或快速模式，而不是所查看代理的，而不是静默运行它。

<h3 id="how-forks-differ-from-named-subagents">
  分叉与命名 subagents 的区别
</h3>

分叉继承主会话在生成时拥有的一切。命名 subagent 从自己的定义开始。

|              | 分叉         | 命名 subagent                                                     |
| :----------- | :--------- | :-------------------------------------------------------------- |
| 上下文          | 完整的对话历史    | 新鲜上下文，带有您传递的提示                                                  |
| 系统提示和工具      | 与主会话相同     | 来自 subagent 的 [definition file](#write-subagent-files)          |
| 模型           | 与主会话相同     | 来自 subagent 的 `model` 字段                                        |
| 权限           | 提示在您的终端中出现 | [提示在后台运行时在您的主会话中出现](#run-subagents-in-foreground-or-background) |
| Prompt cache | 与主会话共享     | 单独的缓存                                                           |

因为分叉的系统提示和工具定义与父级相同，其第一个请求重用父级的 [prompt cache](/docs/zh-CN/prompt-caching#subagents-and-the-cache)。这使得分叉比为需要相同上下文的任务生成新 subagent 更便宜。

当 Claude 通过 Agent 工具生成分叉时，它可以传递 `isolation: "worktree"` 以便分叉的文件编辑被写入单独的 git worktree 而不是您的检出。

<h3 id="limitations">
  限制
</h3>

设置 `CLAUDE_CODE_FORK_SUBAGENT=1` 在交互式会话、[non-interactive mode](/docs/zh-CN/headless) 和 Agent SDK 中启用分叉模式；将其设置为 `0` 会在所有地方禁用分叉模式，包括任何服务器端推出。分叉无法生成进一步的分叉。

<h2 id="example-subagents">
  示例 subagents
</h2>

这些示例演示了构建 subagents 的有效模式。将它们用作起点，或使用 Claude 生成自定义版本。

<Tip>
  **最佳实践：**

  * **设计专注的 subagents：** 每个 subagent 应该在一个特定任务中表现出色
  * **编写详细的描述：** Claude 使用描述来决定何时委托
  * **限制工具访问：** 仅授予必要的权限以确保安全和专注
  * **检入版本控制：** 与您的团队共享项目 subagents
</Tip>

<h3 id="code-reviewer">
  代码审查者
</h3>

一个只读 subagent，审查代码而不修改它。此示例展示了如何设计一个专注的 subagent，具有有限的工具访问（无 Edit 或 Write）和详细的提示，指定确切要查找的内容以及如何格式化输出。

```markdown theme={null}
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

<h3 id="debugger">
  调试器
</h3>

一个可以分析和修复问题的 subagent。与代码审查者不同，这个包括 Edit，因为修复错误需要修改代码。提示提供了从诊断到验证的清晰工作流。

```markdown theme={null}
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

<h3 id="data-scientist">
  数据科学家
</h3>

一个用于数据分析工作的特定领域 subagent。此示例展示了如何为典型编码任务之外的专门工作流创建 subagents。它明确设置 `model: sonnet` 以获得更强大的分析能力。

```markdown theme={null}
---
name: data-scientist
description: Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries.
tools: Bash, Read, Write
model: sonnet
---

You are a data scientist specializing in SQL and BigQuery analysis.

When invoked:
1. Understand the data analysis requirement
2. Write efficient SQL queries
3. Use BigQuery command line tools (bq) when appropriate
4. Analyze and summarize results
5. Present findings clearly

Key practices:
- Write optimized SQL queries with proper filters
- Use appropriate aggregations and joins
- Include comments explaining complex logic
- Format results for readability
- Provide data-driven recommendations

For each analysis:
- Explain the query approach
- Document any assumptions
- Highlight key findings
- Suggest next steps based on data

Always ensure queries are efficient and cost-effective.
```

<h3 id="database-query-validator">
  数据库查询验证器
</h3>

一个允许 Bash 访问但验证命令以仅允许只读 SQL 查询的 subagent。此示例展示了当您需要比 `tools` 字段提供的更精细的控制时如何使用 `PreToolUse` hooks。

```markdown theme={null}
---
name: db-reader
description: Execute read-only database queries. Use when analyzing data or generating reports.
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---

You are a database analyst with read-only access. Execute SELECT queries to answer questions about the data.

When asked to analyze data:
1. Identify which tables contain the relevant data
2. Write efficient SELECT queries with appropriate filters
3. Present results clearly with context

You cannot modify data. If asked to INSERT, UPDATE, DELETE, or modify schema, explain that you only have read access.
```

Claude Code [通过 stdin 将 hook 输入作为 JSON 传递](/docs/zh-CN/hooks#pretooluse-input) 给 hook 命令。验证脚本读取此 JSON，提取正在执行的命令，并根据 SQL 写入操作列表检查它。如果检测到写入操作，脚本 [以代码 2 退出](/docs/zh-CN/hooks#exit-code-2-behavior-per-event) 以阻止执行，并通过 stderr 向 Claude 返回错误消息。

在您的项目中的任何位置创建验证脚本。路径必须与您的 hook 配置中的 `command` 字段匹配：

```bash theme={null}
#!/bin/bash
# Blocks SQL write operations, allows SELECT queries

# Read JSON input from stdin
INPUT=$(cat)

# Extract the command field from tool_input using jq
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block write operations (case-insensitive)
if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b' > /dev/null; then
  echo "Blocked: Write operations not allowed. Use SELECT queries only." >&2
  exit 2
fi

exit 0
```

在 macOS 和 Linux 上，使脚本可执行：

```bash theme={null}
chmod +x ./scripts/validate-readonly-query.sh
```

在 Windows 上，用 PowerShell 编写验证脚本，并在 hook 条目中添加 `shell: powershell`。请参阅 [在 PowerShell 中运行 hooks](/docs/zh-CN/hooks#windows-powershell-tool)。

Hook 通过 stdin 接收 JSON，Bash 命令在 `tool_input.command` 中。退出代码 2 阻止操作并将错误消息反馈给 Claude。有关退出代码和输出的详细信息，请参阅 [Hooks](/docs/zh-CN/hooks#exit-code-output)，有关完整的输入架构，请参阅 [Hook input](/docs/zh-CN/hooks#pretooluse-input)。

<h2 id="next-steps">
  后续步骤
</h2>

现在您了解了 subagents，探索这些相关功能：

* [使用 plugins 分发 subagents](/docs/zh-CN/plugins) 以在团队或项目中共享 subagents
* [以编程方式运行 Claude Code](/docs/zh-CN/headless)，使用 Agent SDK 进行 CI/CD 和自动化
* [使用 MCP 服务器](/docs/zh-CN/mcp) 为 subagents 提供对外部工具和数据的访问
