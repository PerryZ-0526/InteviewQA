# 创建自定义 subagents

> <span style="font-size: 1em">在 Claude Code 中创建和使用专门的 AI subagents，用于特定任务的工作流和改进的上下文管理。</span>

<span style="font-size: 1em">Subagents 是处理特定类型任务的专门 AI 助手。当一个辅助任务会用搜索结果、日志或文件内容充斥您的主对话，而您不会再次引用这些内容时，请使用一个 subagent：该 subagent 在自己的上下文中完成这项工作，仅返回摘要。当您不断生成相同类型的工作者并使用相同的指令时，定义一个自定义 subagent。</span>

<span style="font-size: 1em">每个 subagent 在自己的 context window 中运行，具有自定义系统提示、特定的工具访问权限和独立的权限。当 Claude 遇到与 subagent 描述相匹配的任务时，它会委托给该 subagent，该 subagent 独立工作并返回结果。要在实践中看到上下文节省，[context window 可视化](https://code.claude.com/docs/zh-CN/context-window) 演示了一个 subagent 在自己的独立窗口中处理研究的会话。</span>

<span style="font-size: 1em">Subagents 在单个会话中工作。要在并行运行许多独立会话并从一个地方监控它们，请参阅 \[background agents\](003-agent-view.md)。对于相互通信的会话，请参阅 \[agent teams\](004-agent-teams.md)。</span>

<span style="font-size: 1em">Subagents 帮助您：</span>

- <span style="font-size: 1em">**保留上下文**，通过将探索和实现保持在主对话之外</span>
- <span style="font-size: 1em">**强制执行约束**，通过限制 subagent 可以使用的工具</span>
- <span style="font-size: 1em">**跨项目重用配置**，使用用户级 subagents</span>
- <span style="font-size: 1em">**专门化行为**，为特定领域使用专注的系统提示</span>
- <span style="font-size: 1em">**控制成本**，通过将任务路由到更快、更便宜的模型（如 Haiku）</span>

<span style="font-size: 1em">Claude 使用每个 subagent 的描述来决定何时委托任务。创建 subagent 时，请编写清晰的描述，以便 Claude 知道何时使用它。</span>

<span style="font-size: 1em">Claude Code 包括几个内置 subagents，如 Explore、Plan 和 general-purpose。您也可以创建自定义 subagents 来处理特定任务。</span>

## <span style="font-size: 1em">内置 subagents</span>

<span style="font-size: 1em">Claude Code 包括内置 subagents，Claude 在适当时自动使用。每个都继承父对话的权限，并有额外的工具限制。</span>

<span style="font-size: 1em">Explore 和 Plan 会跳过您的 CLAUDE.md 文件和父会话的 git 状态，以保持研究快速且成本低廉。所有其他内置和[自定义 subagent](#%E9%85%8D%E7%BD%AE%20subagents) 都会加载两者。有关到达 subagent 的内容的完整分解，请参阅[启动时加载的内容](#%E5%90%AF%E5%8A%A8%E6%97%B6%E5%8A%A0%E8%BD%BD%E7%9A%84%E5%86%85%E5%AE%B9)。</span>

### <span style="font-size: 1em">1.</span> `Explore`

<span style="color: rgb(62, 62, 62); font-size: 1em">一个快速的、只读的代理，针对搜索和分析代码库进行了优化。</span>

- <span style="font-size: 1em">**Model**: 从主对话继承，在 Claude API 上限制为 Opus，因此 Explore 永远不会在比您为会话选择的模型更昂贵的模型上运行</span>
- <span style="font-size: 1em">**Tools**: 只读工具；拒绝访问 Write 和 Edit</span>
- <span style="font-size: 1em">**Purpose**: 文件发现、代码搜索、代码库探索</span>

<span style="color: rgb(62, 62, 62); font-size: 1em">从 v2.1.198 开始，Explore 继承主对话的模型，而不是始终在 Haiku 上运行。在 Claude API 上，继承的模型限制为 Opus：主对话在更高层级上运行 Explore 时使用 Opus，主对话在 Sonnet 或 Haiku 上运行 Explore 时使用相同的模型。在任何其他提供商上，例如 [**Amazon Bedrock、Google Cloud 的 Agent Platform、Microsoft Foundry 或 AWS 上的 Claude Platform**](https://code.claude.com/docs/zh-CN/third-party-integrations)，Explore 直接继承主对话的模型。名为</span> `Explore` <span style="color: rgb(62, 62, 62); font-size: 1em">的[**用户或项目 subagent**](https://code.claude.com/docs/zh-CN/sub-agents#choose-the-subagent-scope) 会覆盖内置的，并保持其自己的</span> `model` <span style="color: rgb(62, 62, 62); font-size: 1em">字段，因此定义一个带有</span> `model: haiku` <span style="color: rgb(62, 62, 62); font-size: 1em">的来保持探索在较低成本的模型上。当 Claude 需要搜索或理解代码库而不进行更改时，它会委托给 Explore。这样可以将探索结果保持在主对话上下文之外。调用 Explore 时，Claude 指定一个彻底程度级别：**quick** 用于有针对性的查找，**medium** 用于平衡的探索，或 **very thorough** 用于全面分析。</span>

### <span style="font-size: 1em">2.</span> `Plan`

<span style="color: rgb(62, 62, 62); font-size: 1em">一个研究代理，在 [**plan mode**](https://code.claude.com/docs/zh-CN/permission-modes#analyze-before-you-edit-with-plan-mode) 期间使用，以在呈现计划之前收集上下文。</span>

- <span style="font-size: 1em">**Model**: 从主对话继承</span>
- <span style="font-size: 1em">**Tools**: 只读工具；拒绝访问 Write 和 Edit</span>
- <span style="font-size: 1em">**Purpose**: 用于规划的代码库研究</span>

<span style="color: rgb(62, 62, 62); font-size: 1em">当您处于 plan mode 并且 Claude 需要理解您的代码库时，它会将研究委托给 Plan subagent，以便探索输出保持在单独的上下文窗口中，而主对话保持只读。</span>

### <span style="font-size: 1em">3.</span> `General-purpose`

<span style="color: rgb(62, 62, 62); font-size: 1em">一个能够处理复杂、多步骤任务的代理，需要探索和操作。</span>

- <span style="font-size: 1em">**Model**：从主对话继承</span>
- <span style="font-size: 1em">**Tools**：</span><span style="font-size: 1em; background-color: #fff3cd">所有工具</span>
- <span style="font-size: 1em">**Purpose**：复杂研究、多步骤操作、代码修改</span>

<span style="color: rgb(62, 62, 62); font-size: 1em">当任务需要探索和修改、复杂推理来解释结果或多个依赖步骤时，Claude 会委托给 general-purpose。</span>

### <span style="font-size: 1em">4. 其他</span>

<span style="font-size: 1em">Claude Code 包括用于特定任务的其他辅助代理。这些通常会自动调用，因此您不需要直接使用它们。</span>


| <span style="font-size: 1em">**Agent**</span>         | <span style="font-size: 1em">**Model**</span> | <span style="font-size: 1em">**Claude 何时使用它**</span>                                                 |
| :----------------------------------------------------- | :--------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| <span style="font-size: 1em">statusline-setup</span>  | <span style="font-size: 1em">Sonnet</span>    | <span style="font-size: 1em">当您运行</span> `/statusline` <span style="font-size: 1em">来配置您的状态行时</span> |
| <span style="font-size: 1em">claude-code-guide</span> | <span style="font-size: 1em">Haiku</span>     | <span style="font-size: 1em">当您提出关于 Claude Code 功能的问题时</span>                                        |


<span style="font-size: 1em">内置 subagents 在交互式会话中默认被注册。要限制它们：</span>

- <span style="font-size: 1em">要阻止特定的内置类型，请将其添加到</span> `permissions.deny`<span style="font-size: 1em">，如[禁用特定 subagents](#%E7%A6%81%E7%94%A8%E7%89%B9%E5%AE%9A%20subagents) 中所示。</span>
- <span style="font-size: 1em">要防止 Claude 委托给任何 subagent，请使用</span> `permissions.deny` <span style="font-size: 1em">拒绝</span> `Agent` <span style="font-size: 1em">工具本身。</span>
- <span style="font-size: 1em">要仅移除内置的</span> `Explore` <span style="font-size: 1em">和</span> `Plan` <span style="font-size: 1em">subagents，请设置</span> `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`<span style="font-size: 1em">。Claude 直接读取和探索文件，而不是委托给它们。需要 Claude Code v2.1.198 或更高版本。</span>
- <span style="font-size: 1em">在[非交互模式](https://code.claude.com/docs/zh-CN/headless) 和 [Agent SDK](https://code.claude.com/docs/zh-CN/agent-sdk/overview) 中，设置</span> `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1` <span style="font-size: 1em">以移除所有内置类型并仅提供您自己的。</span>

<span style="font-size: 1em">除了这些内置 subagents，您可以创建自己的，具有自定义提示、工具限制、权限模式、hooks 和 skills。以下部分展示了如何开始和自定义 subagents。</span>

## <span style="font-size: 1em">快速入门：创建您的第一个 subagent</span>

<span style="font-size: 1em">Subagents 是带有 YAML frontmatter 的 Markdown 文件。要创建一个，请要求 Claude 为您编写，或者 [自己编写文件](#%E7%BC%96%E5%86%99%20subagent%20%E6%96%87%E4%BB%B6)。</span>

<span style="font-size: 1em">从 v2.1.198 开始，</span>`/agents` <span style="font-size: 1em">命令不再打开交互式创建向导；运行它会打印一个提醒，要求您询问 Claude 或直接编辑</span> `.claude/agents/`<span style="font-size: 1em">。Subagent 文件、frontmatter 字段以及</span> `.claude/agents/` <span style="font-size: 1em">和</span> `~/.claude/agents/` <span style="font-size: 1em">位置保持不变；仅删除了终端向导。</span>

<span style="font-size: 1em">本演练创建一个用户级 subagent，用于审查代码并建议改进。</span>

<span style="font-size: 1em">在 Claude Code 中，描述您想要的 subagent 及其保存位置：</span>
```
```text wrap theme={null}
Create a personal code-improver subagent in ~/.claude/agents/ that scans
files and suggests improvements for readability, performance, and best
practices. It should explain each issue, show the current code, and
provide an improved version. Make it read-only and have it use Sonnet.
```

<span style="font-size: 1em">Claude 使用</span> `name`<span style="font-size: 1em">、</span>`description`<span style="font-size: 1em">、</span>`tools` <span style="font-size: 1em">列表、</span>`model` <span style="font-size: 1em">和系统提示来编写文件。</span>
```

 打开 \`\~/.claude/agents/code-improver.md\` 并确认 frontmatter 与您的要求相符。结果如下所示：
```
```markdown
---
name: code-improver
description: Scans files and suggests improvements for readability, performance, and best practices. Use after writing or modifying code.
tools: Read, Grep, Glob
model: sonnet
---

You are a code improvement specialist. For each issue you find, explain
the problem, show the current code, and provide an improved version.
```

<span style="font-size: 1em">因为该文件位于</span> `~/.claude/agents/`<span style="font-size: 1em">，所以 subagent 在您机器上的每个项目中都可用。要将其范围限制在一个项目中，请将其移动到该项目的</span> `.claude/agents/` <span style="font-size: 1em">目录。[选择 subagent 范围](#%E9%80%89%E6%8B%A9%20subagent%20%E8%8C%83%E5%9B%B4) 比较了两者。</span>
```

 要求 Claude 委托给新的 subagent：
```
```text
Use the code-improver agent to suggest improvements in this project
```

<span style="font-size: 1em">Claude 委托给您的新 subagent，它扫描代码库并返回改进建议。</span>

<span style="font-size: 1em">如果 Claude 找不到新的 subagent，请重新启动 Claude Code 并重试。这仅在会话开始前</span> `~/.claude/agents/` <span style="font-size: 1em">不存在时发生，因为运行中的会话不会检测到新创建的</span> `agents` <span style="font-size: 1em">目录。</span>
```

现在您有了一个 subagent，可以在您机器上的任何项目中使用它来分析代码库并建议改进。

您也可以手动编写 subagent 文件、通过 CLI 标志定义它们，或通过 plugins 分发它们。以下部分涵盖所有配置选项。

 在 Claude Code v2.1.197 及更早版本中，\`/agents\` 打开一个交互式向导，其中有一个 \*\*Running\*\* 选项卡列出实时 subagents，以及一个 \*\*Library\*\* 选项卡用于创建、编辑和删除它们。

## 配置 subagents

一个 subagent 的文件位置决定了谁可以使用它，其 frontmatter 决定了它可以做什么。本节涵盖 subagent 文件的位置以及它们支持的每个字段。

### 选择 subagent 范围

根据范围将 subagent 文件存储在不同的位置。当多个 subagents 共享相同的名称时，Claude Code 使用来自更高优先级位置的那个。


| Location              | Scope         | Priority | 如何创建                                                                  |
| :--------------------- | :------------- | :-------- | :--------------------------------------------------------------------- |
| 托管设置                  | 组织范围          | 1（最高）    | 通过 [managed settings](https://code.claude.com/docs/zh-CN/settings) 部署 |
| `--agents` CLI 标志     | 当前会话          | 2        | 启动 Claude Code 时传递 JSON                                               |
| `.claude/agents/`     | 当前项目          | 3        | 询问 Claude，或手动创建文件                                                     |
| `~/.claude/agents/`   | 所有您的项目        | 4        | 询问 Claude，或手动创建文件                                                     |
| Plugin 的 `agents/` 目录 | 启用 plugin 的位置 | 5（最低）    | 与 [plugins](https://code.claude.com/docs/zh-CN/plugins) 一起安装          |


**项目 subagents**（`.claude/agents/`）非常适合特定于代码库的 subagents。将它们检入版本控制，以便您的团队可以协作使用和改进它们。

项目 subagents 通过从当前工作目录向上遍历来发现，因此会扫描那里和存储库根目录之间的每个 `.claude/agents/`。从 v2.1.178 开始，当这些嵌套目录中的多个目录定义相同的 `name` 时，Claude Code 使用最接近工作目录的定义。

使用 `--add-dir` 添加的目录也会被扫描：添加目录内的 `.claude/agents/` 文件夹与项目 subagents 一起加载。有关哪些其他配置类型从 `--add-dir` 加载，请参阅 [Additional directories](https://code.claude.com/docs/zh-CN/permissions#additional-directories-grant-file-access-not-configuration)。要在没有 `--add-dir` 的情况下跨项目共享 subagents，请使用 `~/.claude/agents/` 或 [plugin](https://code.claude.com/docs/zh-CN/plugins)。

**用户 subagents**（`~/.claude/agents/`）是在所有项目中可用的个人 subagents。

Claude Code 递归扫描 `.claude/agents/` 和 `~/.claude/agents/`，因此您可以将定义组织到子文件夹中，例如 `agents/review/` 或 `agents/research/`。子目录路径不会影响 subagent 的识别或调用方式，因为身份仅来自 `name` frontmatter 字段。

在整个树中保持 `name` 值唯一：如果同一 `.claude/agents/` 目录下的两个文件（包括其子文件夹）声明相同的名称，Claude Code 仅加载其中一个，由文件系统读取顺序选择，而不是有文档记录的优先级。在嵌套项目目录中，最接近工作目录的定义获胜，如上所述。`/doctor` 设置检查报告同一目录中共享名称的文件，并建议重命名或删除除一个之外的所有文件。在 v2.1.205 之前，`/doctor` 打开一个诊断屏幕，列出重复项并显示哪个定义是活跃的。

Plugin `agents/` 目录也会被递归扫描。与项目和用户范围不同，plugin 的 `agents/` 目录内的子文件夹成为 [scoped identifier](#%E6%98%BE%E5%BC%8F%E8%B0%83%E7%94%A8%20subagents) 的一部分：plugin `my-plugin` 中位于 `agents/review/security.md` 的文件注册为 `my-plugin:review:security`。

**CLI 定义的 subagents** 在启动 Claude Code 时作为 JSON 传递。它们仅存在于该会话中，不会保存到磁盘，使其对快速测试或自动化脚本很有用。您可以在单个 `--agents` 调用中定义多个 subagents：

 \`\`\`bash theme={null} claude --agents '{ "code-reviewer": { "description": "Expert code reviewer. Use proactively after code changes.", "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.", "tools": \["Read", "Grep", "Glob", "Bash"\], "model": "sonnet" }, "debugger": { "description": "Debugging specialist for errors and test failures.", "prompt": "You are an expert debugger. Analyze errors, identify root causes, and provide fixes." } }' \`\`\` \`\`\`powershell theme={null} claude --agents @' { "code-reviewer": { "description": "Expert code reviewer. Use proactively after code changes.", "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.", "tools": \["Read", "Grep", "Glob", "Bash"\], "model": "sonnet" }, "debugger": { "description": "Debugging specialist for errors and test failures.", "prompt": "You are an expert debugger. Analyze errors, identify root causes, and provide fixes." } } '@ \`\`\`

`--agents` 标志接受 JSON，具有与基于文件的 subagents 相同的 [frontmatter](#%E6%94%AF%E6%8C%81%E7%9A%84%20frontmatter%20%E5%AD%97%E6%AE%B5) 字段：`description`、`prompt`、`tools`、`disallowedTools`、`model`、`permissionMode`、`mcpServers`、`hooks`、`maxTurns`、`skills`、`initialPrompt`、`memory`、`effort`、`background`、`isolation` 和 `color`。对系统提示使用 `prompt`，等同于基于文件的 subagents 中的 markdown 正文。

**托管 subagents** 由组织管理员部署。在 [managed settings directory](https://code.claude.com/docs/zh-CN/settings#settings-files) 内的 `.claude/agents/` 中放置 markdown 文件，使用与项目和用户 subagents 相同的 frontmatter 格式。托管定义优先于具有相同名称的项目和用户 subagents。

**Plugin subagents** 来自您已安装的 [plugins](https://code.claude.com/docs/zh-CN/plugins)。它们与您的自定义 subagents 一起加载，并在 @-mention 类型提前中以其范围名称出现。有关创建 plugin subagents 的详细信息，请参阅 [plugin 组件参考](https://code.claude.com/docs/zh-CN/plugins-reference#agents)。

 出于安全原因，plugin subagents 不支持 \`hooks\`、\`mcpServers\` 或 \`permissionMode\` frontmatter 字段。加载来自 plugin 的代理时，这些字段被忽略。如果您需要它们，请将代理文件复制到 \`.claude/agents/\` 或 \`\~/.claude/agents/\`。您也可以在 \`settings.json\` 或 \`settings.local.json\` 中向 \[\`permissions.allow\`\](https://code.claude.com/docs/zh-CN/settings#permission-settings) 添加规则，但这些规则适用于整个会话，而不仅仅是 plugin subagent。

来自任何这些范围的 subagent 定义也可用于 [agent teams](004-agent-teams.md#%E4%B8%BA%E9%98%9F%E5%8F%8B%E4%BD%BF%E7%94%A8%20subagent%20%E5%AE%9A%E4%B9%89)：当生成一个队友时，您可以引用一个 subagent 类型，队友使用其 `tools` 和 `model`，定义的正文作为额外指令附加到队友的系统提示。有关哪些 frontmatter 字段适用于该路径，请参阅 [agent teams](004-agent-teams.md#%E4%B8%BA%E9%98%9F%E5%8F%8B%E4%BD%BF%E7%94%A8%20subagent%20%E5%AE%9A%E4%B9%89)。

### 编写 subagent 文件

Subagent 文件使用 YAML frontmatter 进行配置，然后是 Markdown 中的系统提示：

 Claude Code 监视 \`\~/.claude/agents/\` 和 \`.claude/agents/\`。当您在磁盘上添加或编辑 subagent 文件，或要求 Claude 为您编写一个时，Claude Code 会在几秒内检测到更改，下一次委托使用更新的定义，无需重启。

两种情况仍然需要重启：

- 监视器仅涵盖会话启动时存在的目录，因此在新 `agents` 目录中创建范围的第一个代理文件后，重启以加载它。
- 使用 `--disable-slash-commands` 启动的会话根本不监视这些目录。
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

<span style="font-size: 1em">Frontmatter 定义了 subagent 的元数据和配置。正文成为指导 subagent 行为的系统提示。Subagents 仅接收此系统提示（加上基本环境详细信息，如工作目录），而不是完整的 Claude Code 系统提示。</span>

<span style="font-size: 1em">在 [non-interactive mode](https://code.claude.com/docs/zh-CN/headless) 中，</span>`--append-subagent-system-prompt` <span style="font-size: 1em">标志将您提供的文本附加到每个 subagent 的系统提示末尾，包括嵌套 subagents。需要 Claude Code v2.1.205 或更高版本。</span>

<span style="font-size: 1em">一个 subagent 在主对话的当前工作目录中启动。在 subagent 中，</span>`cd` <span style="font-size: 1em">命令不会在 Bash 或 PowerShell 工具调用之间持续，也不会影响主对话的工作目录。要给 subagent 一个隔离的存储库副本，请改为设置</span> `isolation: worktree`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">具有</span> `isolation: worktree` <span style="font-size: 1em">的 subagent 在其 worktree 内运行其 Bash 和 PowerShell 命令。一个工作目录解析到您的主检出的命令，例如因为 worktree 目录在 subagent 运行时被删除，会失败并出现错误。在 v2.1.203 之前，这样的命令可能在主检出中运行。</span>

#### <span style="font-size: 1em">支持的 frontmatter 字段</span>

<span style="font-size: 1em">以下字段可以在 YAML frontmatter 中使用。只有</span> `name` <span style="font-size: 1em">和</span> `description` <span style="font-size: 1em">是必需的。</span>


| <span style="font-size: 1em">Field</span> | <span style="font-size: 1em">必需</span> | <span style="font-size: 1em">Description</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :----------------------------------------- | :-------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                    | <span style="font-size: 1em">是</span>  | <span style="font-size: 1em">使用小写字母和连字符的唯一标识符。[Hooks](https://code.claude.com/docs/zh-CN/hooks#subagentstart) 将此值作为</span> `agent_type` <span style="font-size: 1em">接收。文件名不必匹配</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `description`                             | <span style="font-size: 1em">是</span>  | <span style="font-size: 1em">Claude 何时应该委托给此 subagent</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tools`                                   | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[Tools](#%E5%8F%AF%E7%94%A8%E5%B7%A5%E5%85%B7) subagent 可以使用。如果省略，继承所有工具。要将 Skills 预加载到上下文中，请使用</span> `skills` <span style="font-size: 1em">字段而不是在此处列出</span> `Skill`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `disallowedTools`                         | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">要拒绝的工具，从继承或指定的列表中删除</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `model`                                   | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[Model](#%E9%80%89%E6%8B%A9%E6%A8%A1%E5%9E%8B) 使用：</span>`sonnet`<span style="font-size: 1em">、</span>`opus`<span style="font-size: 1em">、</span>`haiku`<span style="font-size: 1em">、</span>`fable`<span style="font-size: 1em">、完整模型 ID（例如，</span>`claude-opus-4-8`<span style="font-size: 1em">）或</span> `inherit`<span style="font-size: 1em">。默认为</span> `inherit`                                                                                                                                                                                                                                                     |
| `permissionMode`                          | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[Permission mode](#%E6%9D%83%E9%99%90%E6%A8%A1%E5%BC%8F)：</span>`default`<span style="font-size: 1em">、</span>`acceptEdits`<span style="font-size: 1em">、</span>`auto`<span style="font-size: 1em">、</span>`dontAsk`<span style="font-size: 1em">、</span>`bypassPermissions`<span style="font-size: 1em">、</span>`plan` <span style="font-size: 1em">或</span> `manual` <span style="font-size: 1em">作为</span> `default` <span style="font-size: 1em">的别名。</span>`manual` <span style="font-size: 1em">别名需要 Claude Code v2.1.200 或更高版本。对于 [plugin subagents](#%E9%80%89%E6%8B%A9%20subagent%20%E8%8C%83%E5%9B%B4) 被忽略</span> |
| `maxTurns`                                | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">subagent 停止前的最大代理轮数</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `skills`                                  | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[Skills](https://code.claude.com/docs/zh-CN/skills) 在启动时加载到 subagent 的上下文中。注入完整的技能内容，而不仅仅是描述。Subagents 仍然可以通过 Skill 工具调用未列出的项目、用户和 plugin 技能</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mcpServers`                              | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[MCP servers](https://code.claude.com/docs/zh-CN/mcp) 对此 subagent 可用。每个条目要么是引用已配置服务器的服务器名称（例如，</span>`"slack"`<span style="font-size: 1em">），要么是内联定义，其中服务器名称为键，完整的 [MCP server config](https://code.claude.com/docs/zh-CN/mcp#installing-mcp-servers) 为值。对于 [plugin subagents](#%E9%80%89%E6%8B%A9%20subagent%20%E8%8C%83%E5%9B%B4) 被忽略</span>                                                                                                                                                                                                                                                                              |
| `hooks`                                   | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[Lifecycle hooks](#%E4%B8%BA%20subagents%20%E5%AE%9A%E4%B9%89%20hooks) 限定于此 subagent。对于 [plugin subagents](#%E9%80%89%E6%8B%A9%20subagent%20%E8%8C%83%E5%9B%B4) 被忽略</span>                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `memory`                                  | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">[Persistent memory scope](#%E5%90%AF%E7%94%A8%E6%8C%81%E4%B9%85%E5%86%85%E5%AD%98)：</span>`user`<span style="font-size: 1em">、</span>`project` <span style="font-size: 1em">或</span> `local`<span style="font-size: 1em">。启用跨会话学习</span>                                                                                                                                                                                                                                                                                                                                                                                    |
| `background`                              | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">设置为</span> `true` <span style="font-size: 1em">以始终将此 subagent 作为 [background task](#%E5%9C%A8%E5%89%8D%E5%8F%B0%E6%88%96%E5%90%8E%E5%8F%B0%E8%BF%90%E8%A1%8C%20subagents) 运行，即使 Claude 需要其结果。未设置时，Claude 选择，从 v2.1.198 开始，它默认在后台运行 subagents</span>                                                                                                                                                                                                                                                                                                                                                                         |
| `effort`                                  | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">此 subagent 活跃时的努力级别。覆盖会话努力级别。默认：从会话继承。选项：</span>`low`<span style="font-size: 1em">、</span>`medium`<span style="font-size: 1em">、</span>`high`<span style="font-size: 1em">、</span>`xhigh`<span style="font-size: 1em">、</span>`max`<span style="font-size: 1em">；可用级别取决于模型</span>                                                                                                                                                                                                                                                                                                                                           |
| `isolation`                               | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">设置为</span> `worktree` <span style="font-size: 1em">以在临时 [git worktree](006-worktrees.md) 中运行 subagent，为其提供存储库的隔离副本，默认从您的 [default branch](006-worktrees.md#%E9%80%89%E6%8B%A9%E5%9F%BA%E7%A1%80%E5%88%86%E6%94%AF) 分支，而不是父会话的</span> `HEAD`<span style="font-size: 1em">。如果 subagent 不进行任何更改，worktree 会自动清理</span>                                                                                                                                                                                                                                                                                                          |
| `color`                                   | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">Subagent 在任务列表和转录中的显示颜色。接受</span> `red`<span style="font-size: 1em">、</span>`blue`<span style="font-size: 1em">、</span>`green`<span style="font-size: 1em">、</span>`yellow`<span style="font-size: 1em">、</span>`purple`<span style="font-size: 1em">、</span>`orange`<span style="font-size: 1em">、</span>`pink` <span style="font-size: 1em">或</span> `cyan`                                                                                                                                                                                                                                                               |
| `initialPrompt`                           | <span style="font-size: 1em">否</span>  | <span style="font-size: 1em">当此代理作为主会话代理运行时（通过</span> `--agent` <span style="font-size: 1em">或</span> `agent` <span style="font-size: 1em">设置），自动提交为第一个用户轮次。[Commands](https://code.claude.com/docs/zh-CN/commands) 和 [skills](https://code.claude.com/docs/zh-CN/skills) 被处理。前置于任何用户提供的提示</span>                                                                                                                                                                                                                                                                                                                                                        |


### <span style="font-size: 1em">选择模型</span>

`model` <span style="font-size: 1em">字段控制 subagent 使用的 [AI model](https://code.claude.com/docs/zh-CN/model-config)：</span>

- <span style="font-size: 1em">**Model alias**: 使用可用的别名之一：</span>`sonnet`<span style="font-size: 1em">、</span>`opus`<span style="font-size: 1em">、</span>`haiku` <span style="font-size: 1em">或</span> `fable`
- <span style="font-size: 1em">**Full model ID**: 使用完整的模型 ID，如</span> `claude-opus-4-8` <span style="font-size: 1em">或</span> `claude-sonnet-5`<span style="font-size: 1em">。接受与</span> `--model` <span style="font-size: 1em">标志相同的值</span>
- <span style="font-size: 1em">**inherit**: 使用与主对话相同的模型</span>
- <span style="font-size: 1em">**Omitted**: 默认为</span> `inherit` <span style="font-size: 1em">并使用与主对话相同的模型</span>

<span style="font-size: 1em">当 Claude 调用 subagent 时，它也可以为该特定调用传递</span> `model` <span style="font-size: 1em">参数。Claude Code 按以下顺序解析 subagent 的模型：</span>

1. `CLAUDE_CODE_SUBAGENT_MODEL` <span style="font-size: 1em">环境变量，当设置为模型别名或模型 ID 时</span>
2. <span style="font-size: 1em">每次调用的</span> `model` <span style="font-size: 1em">参数</span>
3. <span style="font-size: 1em">Subagent 定义的</span> `model` <span style="font-size: 1em">frontmatter</span>
4. <span style="font-size: 1em">主对话的模型</span>

<span style="font-size: 1em">从 v2.1.196 开始，将</span> `CLAUDE_CODE_SUBAGENT_MODEL` <span style="font-size: 1em">设置为</span> `inherit` <span style="font-size: 1em">与不设置它相同：解析继续使用每次调用的</span> `model` <span style="font-size: 1em">参数，然后是 frontmatter。在早期版本中，</span>`inherit` <span style="font-size: 1em">强制 subagents 使用主对话的模型，并忽略这两个来源。</span>

<span style="font-size: 1em">环境变量、每次调用的参数和 frontmatter 值会根据您组织的</span> `availableModels` <span style="font-size: 1em">允许列表进行检查。解析为排除模型的值不会被使用，subagent 会改为在继承的模型上运行。</span>

<span style="font-size: 1em">从 v2.1.198 开始，subagents 也继承主对话的 [extended thinking](https://code.claude.com/docs/zh-CN/model-config#extended-thinking) 配置：如果在您的会话中启用了思考，对于 subagent 也启用，如果关闭，则保持关闭。没有每个 subagent 的思考设置。在 v2.1.198 之前，subagents 运行时禁用了扩展思考，无论主对话的设置如何。</span>

### <span style="font-size: 1em">控制 subagent 能力</span>

<span style="font-size: 1em">您可以通过工具访问、权限模式和条件规则来控制 subagents 可以做什么。</span>

#### <span style="font-size: 1em">可用工具</span>

<span style="font-size: 1em">Subagents 默认继承主对话中可用的 [internal tools](https://code.claude.com/docs/zh-CN/tools-reference) 和 MCP 工具。以下工具取决于主对话的 UI 或会话状态，即使在</span> `tools` <span style="font-size: 1em">字段中列出也不可用于 subagents：</span>

- `AskUserQuestion`
- `EnterPlanMode`
- `ExitPlanMode`<span style="font-size: 1em">，除非 subagent 的</span> `permissionMode` <span style="font-size: 1em">是</span> `plan`
- `ScheduleWakeup`
- `WaitForMcpServers`

<span style="font-size: 1em">要限制工具，使用</span> `tools` <span style="font-size: 1em">字段（允许列表）或</span> `disallowedTools` <span style="font-size: 1em">字段（拒绝列表）。此示例使用</span> `tools` <span style="font-size: 1em">来专门允许 Read、Grep、Glob 和 Bash。Subagent 无法编辑文件、写入文件或使用任何 MCP 工具：</span>
```yaml
---
name: safe-researcher
description: Research agent with restricted capabilities
tools: Read, Grep, Glob, Bash
---
```

<span style="font-size: 1em">此示例使用</span> `disallowedTools` <span style="font-size: 1em">来继承主对话的每个工具，除了 Write 和 Edit。Subagent 保留 Bash、MCP 工具和其他所有内容：</span>
```yaml
---
name: no-writes
description: Inherits every tool except file writes
disallowedTools: Write, Edit
---
```

<span style="font-size: 1em">如果两者都设置，</span>`disallowedTools` <span style="font-size: 1em">首先应用，然后</span> `tools` <span style="font-size: 1em">针对剩余的池进行解析。同时列在两者中的工具被删除。</span>

<span style="font-size: 1em">当</span> `tools` <span style="font-size: 1em">列表中没有任何内容解析为工具时，例如因为每个条目都拼写错误或命名了对 subagents 不可用的工具，Claude Code 拒绝启动 subagent，Agent 工具返回一个错误，命名未解析的条目。在 v2.1.208 之前，该 subagent 启动时没有工具，可能返回空的或令人困惑的结果。</span>

<span style="font-size: 1em">两个字段都接受 MCP 服务器级别的模式，除了精确的工具名称：</span>`mcp__<server>` <span style="font-size: 1em">或</span> `mcp__<server>__*` <span style="font-size: 1em">授予或删除来自命名服务器的每个工具。在</span> `disallowedTools` <span style="font-size: 1em">中，</span>`mcp__*` <span style="font-size: 1em">也删除来自任何服务器的每个 MCP 工具。此示例删除来自</span> `github` <span style="font-size: 1em">MCP 服务器的每个工具，同时保留来自其他服务器的工具和每个内置工具：</span>
```yaml
---
name: local-only
description: Inherits every tool except those from the github MCP server
disallowedTools: mcp__github
---
```

#### <span style="font-size: 1em">限制可以生成哪些 subagents</span>

<span style="font-size: 1em">当代理作为主线程运行时，使用</span> `claude --agent`<span style="font-size: 1em">，它可以使用 Agent 工具生成 subagents。要限制它可以生成的 subagent 类型，在</span> `tools` <span style="font-size: 1em">字段中使用</span> `Agent(agent_type)` <span style="font-size: 1em">语法。</span>

<span style="font-size: 1em">在版本 2.1.63 中，Task 工具被重命名为 Agent。设置和代理定义中的现有</span> `Task(...)` <span style="font-size: 1em">引用仍然作为别名工作。</span>
```yaml
---
name: coordinator
description: Coordinates work across specialized agents
tools: Agent(worker, researcher), Read, Bash
---
```

<span style="font-size: 1em">这是一个允许列表：只有</span> `worker` <span style="font-size: 1em">和</span> `researcher` <span style="font-size: 1em">subagents 可以被生成。如果代理尝试生成任何其他类型，请求失败，代理在其提示中仅看到允许的类型。要在允许所有其他类型的同时阻止特定代理，请改用</span> `permissions.deny`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">要允许生成任何 subagent 而不受限制，使用不带括号的</span> `Agent`<span style="font-size: 1em">：</span>
```yaml
tools: Agent, Read, Bash
```

<span style="font-size: 1em">如果</span> `Agent` <span style="font-size: 1em">完全从</span> `tools` <span style="font-size: 1em">列表中省略，代理无法生成任何 subagents。</span>

`Agent(agent_type)` <span style="font-size: 1em">允许列表语法仅适用于作为主线程运行的代理，使用</span> `claude --agent`<span style="font-size: 1em">。在 subagent 定义中，在</span> `tools` <span style="font-size: 1em">中列出</span> `Agent` <span style="font-size: 1em">让该 subagent [生成嵌套 subagents](#%E7%94%9F%E6%88%90%E5%B5%8C%E5%A5%97%20subagents)，但括号内的任何类型列表都被忽略。</span>

#### <span style="font-size: 1em">将 MCP 服务器限定于 subagent</span>

<span style="font-size: 1em">使用</span> `mcpServers` <span style="font-size: 1em">字段为 subagent 提供对主对话中不可用的 [MCP](https://code.claude.com/docs/zh-CN/mcp) 服务器的访问。此处定义的内联服务器在 subagent 启动时连接，在完成时断开连接。字符串引用共享父会话的连接。</span>

<span style="font-size: 1em">\`mcpServers\` 字段适用于代理文件可以运行的两个上下文：</span>

- <span style="font-size: 1em">作为 subagent，通过 Agent 工具或 @-mention 生成</span>
- <span style="font-size: 1em">作为主会话，使用</span> `--agent` <span style="font-size: 1em">或</span> `agent` <span style="font-size: 1em">设置启动</span>

<span style="font-size: 1em">当代理是主会话时，内联服务器定义与来自</span> `.mcp.json` <span style="font-size: 1em">和设置文件的服务器一起在启动时连接。</span>

<span style="font-size: 1em">列表中的每个条目要么是内联服务器定义，要么是引用会话中已配置的 MCP 服务器的字符串：</span>
```yaml
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

<span style="font-size: 1em">内联定义使用与</span> `.mcp.json` <span style="font-size: 1em">服务器条目相同的架构，由服务器名称键入，并支持</span> `stdio`<span style="font-size: 1em">、</span>`http`<span style="font-size: 1em">、</span>`sse` <span style="font-size: 1em">和</span> `ws` <span style="font-size: 1em">类型。</span>

<span style="font-size: 1em">要将 MCP 服务器保持在主对话之外，并避免其工具描述消耗那里的上下文，请在此处内联定义它，而不是在</span> `.mcp.json` <span style="font-size: 1em">中。Subagent 获得工具；父对话不获得。</span>

<span style="font-size: 1em">从 v2.1.153 开始，适用于主会话的 MCP 限制也涵盖在 subagent frontmatter 中声明的服务器：</span>

- `--strict-mcp-config` <span style="font-size: 1em">和</span> `--bare`
- [<span style="font-size: 1em">Enterprise managed MCP configuration</span>](https://code.claude.com/docs/zh-CN/managed-mcp)
- `allowedMcpServers` <span style="font-size: 1em">[和](https://code.claude.com/docs/zh-CN/managed-mcp#policy-based-control-with-allowlists-and-denylists)</span> `deniedMcpServers` <span style="font-size: 1em">[策略](https://code.claude.com/docs/zh-CN/managed-mcp#policy-based-control-with-allowlists-and-denylists)</span>

<span style="font-size: 1em">当其中之一阻止服务器时，Claude Code 会跳过它并显示一个警告，命名被阻止的服务器。</span>

<span style="font-size: 1em">托管设置限制适用于每个 subagent，无论如何定义。</span>`--strict-mcp-config` <span style="font-size: 1em">不会过滤您通过</span> `--agents` <span style="font-size: 1em">或 SDK</span> `agents` <span style="font-size: 1em">选项内联传递的服务器，因为这些是显式调用者输入。</span>

#### <span style="font-size: 1em">权限模式</span>

`permissionMode` <span style="font-size: 1em">字段控制 subagent 如何处理权限提示。Subagents 从主对话继承权限上下文，并可以覆盖模式，除非父模式优先，如下所述。</span>


| <span style="font-size: 1em">Mode</span> | <span style="font-size: 1em">Behavior</span>                                                                                                                                                                                                                                                                                                             |
| :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`                                | <span style="font-size: 1em">标准权限检查，带有提示</span>                                                                                                                                                                                                                                                                                                          |
| `acceptEdits`                            | <span style="font-size: 1em">自动接受文件编辑和工作目录或</span> `additionalDirectories` <span style="font-size: 1em">中路径的常见文件系统命令</span>                                                                                                                                                                                                                              |
| `auto`                                   | <span style="font-size: 1em">[Auto mode](https://code.claude.com/docs/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)：后台分类器审查命令和受保护目录的写入</span>                                                                                                                                                                                                 |
| `dontAsk`                                | <span style="font-size: 1em">自动拒绝权限提示。显式允许的工具仍然工作；</span>`AskUserQuestion`<span style="font-size: 1em">、connector 工具 [您的组织设置为](https://code.claude.com/docs/zh-CN/mcp#organization-controls-on-connector-tools)</span> `ask` <span style="font-size: 1em">和标记为</span> `requiresUserInteraction` <span style="font-size: 1em">的 MCP 工具被拒绝，即使您已允许它们</span> |
| `bypassPermissions`                      | <span style="font-size: 1em">跳过权限提示</span>                                                                                                                                                                                                                                                                                                               |
| `plan`                                   | <span style="font-size: 1em">Plan mode（只读探索）</span>                                                                                                                                                                                                                                                                                                      |


<span style="font-size: 1em">谨慎使用 \`bypassPermissions\`。它跳过权限提示，允许 subagent 在没有批准的情况下执行操作，包括对 \`.git\`、\`.config/git\`、\`.claude\`、\`.vscode\`、\`.idea\`、\`.husky\`、\`.cargo\`、\`.devcontainer\`、\`.yarn\` 和 \`.mvn\` 的写入。</span>

<span style="font-size: 1em">显式</span> `ask` <span style="font-size: 1em">[规则](https://code.claude.com/docs/zh-CN/permissions#manage-permissions)、connector 工具 [您的组织设置为](https://code.claude.com/docs/zh-CN/mcp#organization-controls-on-connector-tools)</span> `ask`<span style="font-size: 1em">、标记为</span> `requiresUserInteraction` <span style="font-size: 1em">的 MCP 工具以及根目录和主目录删除（如</span> `rm -rf /`<span style="font-size: 1em">）仍然会提示。有关详细信息，请参阅 [permission modes](https://code.claude.com/docs/zh-CN/permission-modes#skip-all-checks-with-bypasspermissions-mode)。</span>

<span style="font-size: 1em">如果父级使用</span> `bypassPermissions` <span style="font-size: 1em">或</span> `acceptEdits`<span style="font-size: 1em">，这优先并且无法被覆盖。如果父级使用 [auto mode](https://code.claude.com/docs/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)，subagent 继承 auto mode，其 frontmatter 中的任何</span> `permissionMode` <span style="font-size: 1em">被忽略：分类器使用与父会话相同的块和允许规则评估 subagent 的工具调用。</span>

#### <span style="font-size: 1em">将技能预加载到 subagents</span>

<span style="font-size: 1em">使用</span> `skills` <span style="font-size: 1em">字段在启动时将技能内容注入到 subagent 的上下文中。这为 subagent 提供领域知识，而无需在执行期间发现和加载技能。</span>
```yaml
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---

Implement API endpoints. Follow the conventions and patterns from the preloaded skills.
```

<span style="font-size: 1em">每个列出的技能的完整内容被注入到 subagent 的上下文中。此字段控制哪些技能被预加载，而不是 subagent 可以访问哪些技能：没有它，subagent 仍然可以在执行期间通过 Skill 工具发现和调用项目、用户和 plugin 技能。要防止 subagent 完全调用技能，请从</span> `tools` <span style="font-size: 1em">列表中省略</span> `Skill` <span style="font-size: 1em">或将其添加到</span> `disallowedTools`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">您无法预加载设置了</span> `disable-model-invocation: true` <span style="font-size: 1em">的技能，因为预加载来自 Claude 可以调用的相同技能集。如果列出的技能缺失或被禁用，Claude Code 会跳过它并向调试日志记录警告。</span>

<span style="font-size: 1em">这与 \[在 subagent 中运行技能\]([https://code.claude.com/docs/zh-CN/skills#run-skills-in-a-subagent](https://code.claude.com/docs/zh-CN/skills#run-skills-in-a-subagent)) 相反。使用 subagent 中的 \`skills\`，subagent 控制系统提示并加载技能内容。使用技能中的 \`context: fork\`，技能内容被注入到您指定的代理中。两者都使用相同的底层系统。</span>

#### <span style="font-size: 1em">启用持久内存</span>

`memory` <span style="font-size: 1em">字段为 subagent 提供一个在对话中幸存的持久目录。Subagent 使用此目录随时间积累知识，例如代码库模式、调试见解和架构决策。</span>
```yaml
---
name: code-reviewer
description: Reviews code for quality and best practices
memory: user
---

You are a code reviewer. As you review code, update your agent memory with
patterns, conventions, and recurring issues you discover.
```

<span style="font-size: 1em">根据内存应该应用的广泛程度选择范围：</span>


| <span style="font-size: 1em">Scope</span> | <span style="font-size: 1em">Location</span>  | <span style="font-size: 1em">使用时机</span>                          |
| :----------------------------------------- | :--------------------------------------------- | :----------------------------------------------------------------- |
| `user`                                    | `~/.claude/agent-memory/<name-of-agent>/`     | <span style="font-size: 1em">subagent 应该在所有项目中记住学习</span>         |
| `project`                                 | `.claude/agent-memory/<name-of-agent>/`       | <span style="font-size: 1em">subagent 的知识是特定于项目的并可通过版本控制共享</span> |
| `local`                                   | `.claude/agent-memory-local/<name-of-agent>/` | <span style="font-size: 1em">subagent 的知识是特定于项目的但不应检入版本控制</span>  |


<span style="font-size: 1em">启用内存时：</span>

- <span style="font-size: 1em">Subagent 的系统提示包括读取和写入内存目录的说明。</span>
- <span style="font-size: 1em">Subagent 的系统提示还包括内存目录中</span> `MEMORY.md` <span style="font-size: 1em">的前 200 行或 25KB，以先到者为准，以及如果</span> `MEMORY.md` <span style="font-size: 1em">超过该限制则策划</span> `MEMORY.md` <span style="font-size: 1em">的说明。</span>
- <span style="font-size: 1em">Read、Write 和 Edit 工具会自动启用，以便 subagent 可以管理其内存文件。</span>

<span style="font-size: 1em">持久内存提示</span>

- `project` <span style="font-size: 1em">是推荐的默认范围。它使 subagent 知识可通过版本控制共享。</span>
- <span style="font-size: 1em">要求 subagent 在开始工作前查阅其内存："Review this PR, and check your memory for patterns you've seen before."</span>
- <span style="font-size: 1em">要求 subagent 在完成任务后更新其内存："Now that you're done, save what you learned to your memory." 随着时间的推移，这会建立一个知识库，使 subagent 更有效。</span>
- <span style="font-size: 1em">直接在 subagent 的 markdown 文件中包含内存说明，以便它主动维护自己的知识库：</span>
  ```markdown
  Update your agent memory as you discover codepaths, patterns, library
  locations, and key architectural decisions. This builds up institutional
  knowledge across conversations. Write concise notes about what you found
  and where.
  ```

#### <span style="font-size: 1em">使用 hooks 的条件规则</span>

<span style="font-size: 1em">为了更动态地控制工具使用，使用</span> `PreToolUse` <span style="font-size: 1em">hooks 在执行前验证操作。当您需要允许工具的某些操作同时阻止其他操作时，这很有用。</span>

<span style="font-size: 1em">此示例创建一个仅允许只读数据库查询的 subagent。</span>`PreToolUse` <span style="font-size: 1em">hook 在每个 Bash 命令执行前运行</span> `command` <span style="font-size: 1em">中指定的脚本：</span>
```yaml
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

<span style="font-size: 1em">Claude Code [通过 stdin 将 hook 输入作为 JSON 传递](https://code.claude.com/docs/zh-CN/hooks#pretooluse-input) 给 hook 命令。验证脚本读取此 JSON，提取 Bash 命令，并 [以代码 2 退出](https://code.claude.com/docs/zh-CN/hooks#exit-code-2-behavior-per-event) 以阻止写入操作：</span>
```bash
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

<span style="font-size: 1em">有关完整的输入架构，请参阅 [Hook input](https://code.claude.com/docs/zh-CN/hooks#pretooluse-input)，有关退出代码如何影响行为，请参阅 [exit codes](https://code.claude.com/docs/zh-CN/hooks#exit-code-output)。在 Windows 上，在 PowerShell 中编写 hook 脚本，并在 hook 条目中添加</span> `shell: powershell`<span style="font-size: 1em">，如 [在 PowerShell 中运行 hooks](https://code.claude.com/docs/zh-CN/hooks#windows-powershell-tool) 中所示。</span>

#### <span style="font-size: 1em">禁用特定 subagents</span>

<span style="font-size: 1em">您可以通过将 subagents 添加到您的 [settings](https://code.claude.com/docs/zh-CN/settings#permission-settings) 中的</span> `deny` <span style="font-size: 1em">数组来防止 Claude 使用特定 subagents。使用格式</span> `Agent(subagent-name)`<span style="font-size: 1em">，其中</span> `subagent-name` <span style="font-size: 1em">与 subagent 的 name 字段匹配。</span>
```json
{
  "permissions": {
    "deny": ["Agent(Explore)", "Agent(my-custom-agent)"]
  }
}
```

<span style="font-size: 1em">这对内置和自定义 subagents 都有效。您也可以使用</span> `--disallowedTools` <span style="font-size: 1em">CLI 标志：</span>
```bash
claude --disallowedTools "Agent(Explore)"
```

<span style="font-size: 1em">有关权限规则的更多详细信息，请参阅 [Permissions documentation](https://code.claude.com/docs/zh-CN/permissions#tool-specific-permission-rules)。</span>

### <span style="font-size: 1em">为 subagents 定义 hooks</span>

<span style="font-size: 1em">Subagents 可以定义在 subagent 的生命周期中运行的 [hooks](https://code.claude.com/docs/zh-CN/hooks)。有两种方式来配置 hooks：</span>

- <span style="font-size: 1em">**在 subagent 的 frontmatter 中**：定义仅在该 subagent 活跃时运行的 hooks</span>
- <span style="font-size: 1em">**在**</span> `settings.json` <span style="font-size: 1em">**中**：定义在 subagents 启动或停止时在主会话中运行的 hooks</span>

#### <span style="font-size: 1em">Subagent frontmatter 中的 Hooks</span>

<span style="font-size: 1em">直接在 subagent 的 markdown 文件中定义 hooks。这些 hooks 仅在该特定 subagent 活跃时运行，并在完成时清理。</span>

<span style="font-size: 1em">Frontmatter hooks 在代理通过 Agent 工具或 @-mention 作为 subagent 生成时触发，以及当代理通过 \[\`--agent\`\](#%E6%98%BE%E5%BC%8F%E8%B0%83%E7%94%A8%20subagents) 或 \`agent\` 设置作为主会话运行时触发。在主会话情况下，它们与在 \[\`settings.json\`\]([https://code.claude.com/docs/zh-CN/hooks](https://code.claude.com/docs/zh-CN/hooks)) 中定义的任何 hooks 一起运行。</span>

<span style="font-size: 1em">所有 [hook events](https://code.claude.com/docs/zh-CN/hooks#hook-events) 都被支持。subagents 最常见的事件是：</span>


| <span style="font-size: 1em">Event</span> | <span style="font-size: 1em">Matcher input</span> | <span style="font-size: 1em">何时触发</span>                                                                       |
| :----------------------------------------- | :------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `PreToolUse`                              | <span style="font-size: 1em">Tool name</span>     | <span style="font-size: 1em">在 subagent 使用工具之前</span>                                                          |
| `PostToolUse`                             | <span style="font-size: 1em">Tool name</span>     | <span style="font-size: 1em">在 subagent 使用工具之后</span>                                                          |
| `Stop`                                    | <span style="font-size: 1em">(none)</span>        | <span style="font-size: 1em">当 subagent 完成时（在运行时转换为</span> `SubagentStop`<span style="font-size: 1em">）</span> |


<span style="font-size: 1em">此示例使用</span> `PreToolUse` <span style="font-size: 1em">hook 验证 Bash 命令，并在文件编辑后使用</span> `PostToolUse` <span style="font-size: 1em">运行 linter：</span>
```yaml
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

<span style="font-size: 1em">Frontmatter 中的</span> `Stop` <span style="font-size: 1em">hooks 会自动转换为</span> `SubagentStop` <span style="font-size: 1em">事件。</span>

#### <span style="font-size: 1em">用于 subagent 事件的项目级 hooks</span>

<span style="font-size: 1em">在</span> `settings.json` <span style="font-size: 1em">中配置 hooks，以响应主会话中的 subagent 生命周期事件。</span>


| <span style="font-size: 1em">Event</span> | <span style="font-size: 1em">Matcher input</span>   | <span style="font-size: 1em">何时触发</span>             |
| :----------------------------------------- | :--------------------------------------------------- | :---------------------------------------------------- |
| `SubagentStart`                           | <span style="font-size: 1em">Agent type name</span> | <span style="font-size: 1em">当 subagent 开始执行时</span> |
| `SubagentStop`                            | <span style="font-size: 1em">Agent type name</span> | <span style="font-size: 1em">当 subagent 完成时</span>   |


<span style="font-size: 1em">两个事件都支持匹配器以按名称针对特定代理类型。匹配器值是项目级和用户级 subagents 的代理 frontmatter</span> `name`<span style="font-size: 1em">，或 [plugin subagents](https://code.claude.com/docs/zh-CN/plugins) 的 plugin 范围标识符，例如</span> `my-plugin:db-agent`<span style="font-size: 1em">。范围名称包含冒号，因此它被评估为 [unanchored regular expression](https://code.claude.com/docs/zh-CN/hooks#matcher-patterns)；使用</span> `^` <span style="font-size: 1em">和</span> `$` <span style="font-size: 1em">锚定它，如</span> `^my-plugin:db-agent$`<span style="font-size: 1em">，以仅匹配该代理。</span>

<span style="font-size: 1em">此示例仅在</span> `db-agent` <span style="font-size: 1em">subagent 启动时运行设置脚本，并在任何 subagent 停止时运行清理脚本：</span>
```json
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

<span style="font-size: 1em">一个带连字符的匹配器，如</span> `db-agent`<span style="font-size: 1em">，在 Claude Code v2.1.195 或更高版本上精确匹配。在早期版本上，它被评估为 unanchored regular expression，也会为任何包含它的代理类型触发，例如</span> `prod-db-agent`<span style="font-size: 1em">；在这些版本上使用</span> `^db-agent$` <span style="font-size: 1em">锚定它。</span>

<span style="font-size: 1em">有关完整的 hook 配置格式，请参阅 [Hooks](https://code.claude.com/docs/zh-CN/hooks)。</span>

## <span style="font-size: 1em">使用 subagents</span>

### <span style="font-size: 1em">理解自动委托</span>

<span style="font-size: 1em">Claude 根据您请求中的任务描述、subagent 配置中的</span> `description` <span style="font-size: 1em">字段和当前上下文自动委托任务。要鼓励主动委托，在您的 subagent 的 description 字段中包含"use proactively"之类的短语。</span>

### <span style="font-size: 1em">显式调用 subagents</span>

<span style="font-size: 1em">当自动委托不够时，您可以自己请求 subagent。三种模式从一次性建议升级到会话范围的默认值：</span>

- <span style="font-size: 1em">**自然语言**：在提示中命名 subagent；Claude 决定是否委托</span>
- <span style="font-size: 1em">**@-mention**：保证 subagent 为一个任务运行</span>
- <span style="font-size: 1em">**会话范围**：整个会话使用该 subagent 的系统提示、工具限制和模型，通过</span> `--agent` <span style="font-size: 1em">标志或</span> `agent` <span style="font-size: 1em">设置</span>

<span style="font-size: 1em">对于自然语言，没有特殊语法。命名 subagent，Claude 通常会委托：</span>
```text
Use the test-runner subagent to fix failing tests
Have the code-reviewer subagent look at my recent changes
```

<span style="font-size: 1em">**@-mention subagent。** 输入</span> `@` <span style="font-size: 1em">并从类型提前中选择 subagent，就像您 @-mention 文件一样。这确保特定 subagent 运行，而不是将选择留给 Claude：</span>
```text
@"code-reviewer (agent)" look at the auth changes
```

<span style="font-size: 1em">您的完整消息仍然发送给 Claude，它根据您的要求为 subagent 编写任务提示。@-mention 控制调用哪个 subagent，而不是它接收什么提示。</span>

<span style="font-size: 1em">由启用的 [plugin](https://code.claude.com/docs/zh-CN/plugins) 提供的 Subagents 在类型提前中显示为其作用域名称，例如</span> `my-plugin:code-reviewer` <span style="font-size: 1em">或</span> `my-plugin:review:security`<span style="font-size: 1em">，当 plugin [将 agents 组织到子文件夹中](#%E9%80%89%E6%8B%A9%20subagent%20%E8%8C%83%E5%9B%B4)。命名背景 subagents 当前在会话中运行也出现在类型提前中，在名称旁边显示其状态。您也可以手动输入提及而不使用选择器：</span>`@agent-<name>` <span style="font-size: 1em">用于本地 subagents，或</span> `@agent-` <span style="font-size: 1em">后跟 plugin subagents 的作用域名称，例如</span> `@agent-my-plugin:code-reviewer`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">**将整个会话作为 subagent 运行。** 传递</span> `--agent <name>` <span style="font-size: 1em">以启动一个会话，其中主线程本身采用该 subagent 的系统提示、工具限制和模型：</span>
```bash
claude --agent code-reviewer
```

<span style="font-size: 1em">Subagent 的系统提示完全替换默认 Claude Code 系统提示，就像</span> `--system-prompt` <span style="font-size: 1em">一样。</span>`CLAUDE.md` <span style="font-size: 1em">文件和项目内存仍然通过正常消息流加载。代理名称在启动标题中显示为</span> `@<name>`<span style="font-size: 1em">，以便您可以确认它是活跃的。</span>

<span style="font-size: 1em">这适用于内置和自定义 subagents，当您恢复会话时选择会持续。</span>

<span style="font-size: 1em">对于 plugin 提供的 subagent，您可以仅传递代理名称，Claude Code 会找到它：</span>
```bash
claude --agent security-reviewer
```

<span style="font-size: 1em">如果多个 plugins 提供具有相同名称的 agents，传递作用域名称以消除歧义：</span>
```bash
claude --agent my-plugin:security-reviewer
```

<span style="font-size: 1em">如果 plugin 将 agent 放在其</span> `agents/` <span style="font-size: 1em">目录的子文件夹中，请在作用域名称中包含子文件夹，例如</span> `claude --agent my-plugin:review:security`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">要使其成为项目中每个会话的默认值，在</span> `.claude/settings.json` <span style="font-size: 1em">中设置</span> `agent`<span style="font-size: 1em">：</span>
```json
{
  "agent": "code-reviewer"
}
```

<span style="font-size: 1em">如果两者都存在，CLI 标志覆盖设置。</span>

### <span style="font-size: 1em">在前台或后台运行 subagents</span>

<span style="font-size: 1em">Subagents 可以在前台或后台运行：</span>

- <span style="font-size: 1em">**前台 subagents** 阻塞主对话直到完成。权限提示会在出现时传递给您。</span>
- <span style="font-size: 1em">**后台 subagents** 在您继续工作时并发运行。从 v2.1.186 开始，当后台 subagent 到达需要权限的工具调用时，提示会在您的主会话中显示，并命名正在请求的 subagent。批准以让 subagent 继续，或按 Esc 拒绝该单个工具调用而不停止 subagent。在 v2.1.186 之前，后台 subagents 自动拒绝任何会提示的工具调用。</span>

<span style="font-size: 1em">从 v2.1.198 开始，subagents 默认在后台运行。Claude 在需要结果才能继续时在前台运行 subagent。默认值改变 subagent 运行的位置，而不是它被允许做什么：后台 subagents 仍然在您的主会话中显示每个权限提示。在 v2.1.198 之前，Claude 根据任务在前台和后台之间选择。</span>

<span style="font-size: 1em">您也可以自己控制这个：</span>

- <span style="font-size: 1em">要求 Claude 在后台或前台运行任务</span>
- <span style="font-size: 1em">按 **Ctrl+B** 将运行中的任务放在后台</span>

<span style="font-size: 1em">完成的后台 subagent 在</span> `/tasks` <span style="font-size: 1em">中保持列出，标记为完成并排序在运行工作下方，直到会话清理其任务列表。当 subagent 完成时，其详情视图保持打开。失败或您停止的 Subagents 离开列表。在 v2.1.208 之前，完成的 subagent 在完成时立即离开列表，其详情视图关闭。</span>

<span style="font-size: 1em">要禁用所有后台任务功能，请将</span> `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` <span style="font-size: 1em">环境变量设置为</span> `1`<span style="font-size: 1em">。请参阅 [Environment variables](https://code.claude.com/docs/zh-CN/env-vars)。</span>

<span style="font-size: 1em">当</span> `CLAUDE_CODE_FORK_SUBAGENT` <span style="font-size: 1em">设置为</span> `1` <span style="font-size: 1em">时，每个 subagent 生成都在后台运行，frontmatter</span> `background` <span style="font-size: 1em">字段无效，因为 fork 模式从</span> `Agent` <span style="font-size: 1em">工具中移除了</span> `run_in_background` <span style="font-size: 1em">参数。</span>`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` <span style="font-size: 1em">优先于 fork 模式，并将 subagent 生成保持在前台。</span>

### <span style="font-size: 1em">Subagents 中的 API 错误</span>

<span style="font-size: 1em">从 v2.1.199 开始，subagent 的运行因 API 错误（例如使用限制或重复的服务器错误）而结束时，会向 Claude 报告该失败，而不是返回错误文本，就像它是 subagent 的发现一样。Claude 接收的内容取决于 subagent 运行的位置：</span>

- <span style="font-size: 1em">**前台**：如果速率限制、过载或服务器错误切断已经产生输出的 subagent，Agent 工具返回该部分输出，并注明 subagent 被切断且未完成其任务。未产生任何内容的 subagent，或其唯一输出是工具调用的 subagent，失败并出现</span> `Agent terminated early due to an API error`<span style="font-size: 1em">，后跟错误详情。在 v2.1.199 中，切断仅工具调用形状的速率限制、过载或服务器错误返回了仅包含切断注记的空部分结果。</span>
- <span style="font-size: 1em">**后台**：subagent 被标记为失败，Claude 在其结束时接收的消息命名 API 错误并包括 subagent 的最后输出，所以部分工作不会丢失。</span>

<span style="font-size: 1em">一旦底层 API 错误清除，要求 Claude 重试任务或 [恢复 subagent](#%E6%81%A2%E5%A4%8D%20subagents)。</span>

### <span style="font-size: 1em">常见模式</span>

#### <span style="font-size: 1em">隔离高容量操作</span>

<span style="font-size: 1em">subagents 最有效的用途之一是隔离产生大量输出的操作。运行测试、获取文档或处理日志文件可能会消耗大量上下文。通过将这些委托给 subagent，详细输出保留在 subagent 的上下文中，而只有相关摘要返回到您的主对话。</span>
```text
Use a subagent to run the test suite and report only the failing tests with their error messages
```

#### <span style="font-size: 1em">运行并行研究</span>

<span style="font-size: 1em">对于独立的调查，生成多个 subagents 以同时工作：</span>
```text
Research the authentication, database, and API modules in parallel using separate subagents
```

<span style="font-size: 1em">每个 subagent 独立探索其区域，然后 Claude 综合这些发现。当研究路径彼此不依赖时，这效果最好。</span>

<span style="font-size: 1em">当 subagents 完成时，它们的结果返回到您的主对话。运行许多 subagents，每个都返回详细结果，可能会消耗大量上下文。</span>

<span style="font-size: 1em">对于需要持续并行性或超过您的 context window 的任务，[agent teams](004-agent-teams.md) 为每个工作者提供自己的独立上下文。</span>

#### <span style="font-size: 1em">链接 subagents</span>

<span style="font-size: 1em">对于多步骤工作流，要求 Claude 按顺序使用 subagents。每个 subagent 完成其任务并将结果返回给 Claude，然后将相关上下文传递给下一个 subagent。</span>
```text
Use the code-reviewer subagent to find performance issues, then use the optimizer subagent to fix them
```

### <span style="font-size: 1em">在 subagents 和主对话之间选择</span>

<span style="font-size: 1em">在以下情况下使用 **主对话**：</span>

- <span style="font-size: 1em">任务需要频繁的来回或迭代细化</span>
- <span style="font-size: 1em">多个阶段共享重要上下文，例如规划、实现和测试</span>
- <span style="font-size: 1em">您正在进行快速、有针对性的更改</span>
- <span style="font-size: 1em">延迟很重要。Subagents 从头开始，可能需要时间来收集上下文</span>

<span style="font-size: 1em">在以下情况下使用 **subagents**：</span>

- <span style="font-size: 1em">任务产生您不需要在主上下文中的详细输出</span>
- <span style="font-size: 1em">您想强制执行特定的工具限制或权限</span>
- <span style="font-size: 1em">工作是自包含的，可以返回摘要</span>

<span style="font-size: 1em">当您想要可重用的提示或在主对话上下文中运行的工作流而不是隔离的 subagent 上下文时，请改为考虑 [Skills](https://code.claude.com/docs/zh-CN/skills)。</span>

<span style="font-size: 1em">对于关于对话中已有内容的快速问题，使用</span> `/btw` <span style="font-size: 1em">而不是 subagent。它看到您的完整上下文但没有工具访问，答案被丢弃而不是添加到历史记录。</span>

### <span style="font-size: 1em">生成嵌套 subagents</span>

<span style="font-size: 1em">从 Claude Code v2.1.172 开始，subagent 可以生成自己的 subagents。当委托的任务本身分裂成并行子任务时使用这个，例如审查者 subagent 为每个发现分派一个验证者，所以中间输出永远不会到达您的主对话。只有顶级 subagent 的摘要返回给您。</span>

<span style="font-size: 1em">嵌套 subagent 的配置方式与顶级 subagent 相同，并从相同的 [scopes](#%E9%80%89%E6%8B%A9%20subagent%20%E8%8C%83%E5%9B%B4) 解析。</span>

<span style="font-size: 1em">subagent 面板在提示输入下方显示完整的树：每行显示一个</span> `(+N)` <span style="font-size: 1em">后代计数，从 v2.1.193 开始，打开一行显示该 subagent 的兄弟和直接子代，以及返回到</span> `main` <span style="font-size: 1em">的路径。</span>

<span style="font-size: 1em">深度计算为主对话下方的 subagent 级别数，无论每个级别是否在 [前台或后台](#%E5%9C%A8%E5%89%8D%E5%8F%B0%E6%88%96%E5%90%8E%E5%8F%B0%E8%BF%90%E8%A1%8C%20subagents) 运行。深度为五的 subagent 不接收 Agent 工具，无法进一步生成。限制是固定的且不可配置。</span>

<span style="font-size: 1em">从 Claude Code v2.1.187 开始，后台 subagent 的深度在首次生成时是固定的，[恢复](#%E6%81%A2%E5%A4%8D%20subagents)它稍后不会改变该深度。例如，如果您的主对话生成 subagent A，而 A 在深度二生成后台 subagent B，当您直接从主对话恢复 B 时，B 仍然在深度二。从更浅的上下文恢复 subagent 不会让它生成深度限制已经阻止的额外级别。</span>

<span style="font-size: 1em">要防止特定 subagent 生成其他 subagents，从其</span> `tools` <span style="font-size: 1em">列表中省略</span> `Agent` <span style="font-size: 1em">或将其添加到</span> `disallowedTools`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">[fork](#%E5%88%86%E5%8F%89%E5%BD%93%E5%89%8D%E5%AF%B9%E8%AF%9D) 仍然无法生成另一个 fork。它可以生成其他 subagent 类型，这些计入深度限制。</span>

### <span style="font-size: 1em">管理 subagent 上下文</span>

#### <span style="font-size: 1em">启动时加载的内容</span>

<span style="font-size: 1em">每个 subagent 都以新鲜的隔离上下文窗口开始。它看不到您的对话历史、您已经调用的技能或 Claude 已经读取的文件。Claude 编写一条委托消息来总结任务，subagent 从那里开始工作。例外是 [fork](#%E5%88%86%E5%8F%89%E5%BD%93%E5%89%8D%E5%AF%B9%E8%AF%9D)，它继承父对话而不是从头开始。</span>

<span style="font-size: 1em">非 fork subagent 的初始上下文包含：</span>

- <span style="font-size: 1em">**系统提示**：代理自己的提示加上 Claude Code 附加的环境详情，而不是完整的 Claude Code 系统提示。自定义 subagents 在 [markdown 正文](#%E7%BC%96%E5%86%99%20subagent%20%E6%96%87%E4%BB%B6) 或</span> `prompt` <span style="font-size: 1em">字段中定义它们。内置代理有预定义的提示。</span>
- <span style="font-size: 1em">**任务消息**：Claude 在移交工作时编写的委托提示。</span>
- <span style="font-size: 1em">**CLAUDE.md 和内存**：主对话加载的 [内存层次结构](https://code.claude.com/docs/zh-CN/memory#how-claude-md-files-load) 的每个级别，包括</span> `~/.claude/CLAUDE.md`<span style="font-size: 1em">、项目规则、</span>`CLAUDE.local.md` <span style="font-size: 1em">和托管策略文件。内置的 Explore 和 Plan 代理跳过这个。</span>
- <span style="font-size: 1em">**Git 状态**：在父会话开始时拍摄的快照。当工作目录不是 Git 存储库或</span> `includeGitInstructions` <span style="font-size: 1em">为</span> `false` <span style="font-size: 1em">时不存在。Explore 和 Plan 无论如何都跳过它。</span>
- <span style="font-size: 1em">**预加载的技能**：代理的</span> `skills` <span style="font-size: 1em">[字段](#%E5%B0%86%E6%8A%80%E8%83%BD%E9%A2%84%E5%8A%A0%E8%BD%BD%E5%88%B0%20subagents) 中命名的任何技能的完整内容。内置代理不预加载技能。</span>
- <span style="font-size: 1em">**兄弟名单**：系统提醒，列出</span> `main` <span style="font-size: 1em">和会话中的每个其他命名代理，每个都是</span> `SendMessage` <span style="font-size: 1em">的有效</span> `to` <span style="font-size: 1em">值。需要 Claude Code v2.1.206 或更高版本。名单仅在 subagent 的工具包括</span> `SendMessage` <span style="font-size: 1em">且至少有一个其他代理有名称时出现，无论 Claude 在生成时命名它还是它作为 [agent team](004-agent-teams.md) 队友运行。它是 subagent 启动时拍摄的快照，所以稍后命名的代理不会出现。</span>

<span style="font-size: 1em">Explore 和 Plan 是仅有的省略 CLAUDE.md 和 git 状态的 subagents。没有 frontmatter 字段或按代理设置来改变哪些代理跳过它们。</span>

<span style="font-size: 1em">主对话使用完整的 CLAUDE.md 上下文读取 Explore 和 Plan 结果，所以大多数规则不需要到达 subagent 本身。如果规则必须，例如"忽略</span> `vendor/` <span style="font-size: 1em">目录"，在您给 Claude 委托时的提示中重新陈述它。</span>

#### <span style="font-size: 1em">恢复 subagents</span>

<span style="font-size: 1em">每个 subagent 调用都会创建一个具有新鲜上下文的新实例。要继续现有 subagent 的工作而不是重新开始，要求 Claude 恢复它。</span>

<span style="font-size: 1em">恢复的 subagents 保留其完整的对话历史，包括所有以前的工具调用、结果和推理。Subagent 从它停止的地方继续，而不是从头开始。</span>

<span style="font-size: 1em">当 subagent 完成时，Claude 接收其代理 ID。内置的 Explore 和 Plan 代理是一次性的，不返回代理 ID，所以它们无法恢复；当您需要继续工作时，使用</span> `general-purpose` <span style="font-size: 1em">或自定义 subagent。</span>

<span style="font-size: 1em">Claude 使用</span> `SendMessage` <span style="font-size: 1em">工具，将代理的 ID 或名称作为</span> `to` <span style="font-size: 1em">字段来恢复它。</span>`SendMessage` <span style="font-size: 1em">不需要启用 [agent teams](004-agent-teams.md)；只有结构化的团队协议消息，例如</span> `shutdown_request` <span style="font-size: 1em">和</span> `plan_approval_response`<span style="font-size: 1em">，才需要启用。</span>

<span style="font-size: 1em">要恢复 subagent，要求 Claude 继续之前的工作：</span>
```text
Use the code-reviewer subagent to review the authentication module
[Agent completes]

Continue that code review and now analyze the authorization logic
[Claude resumes the subagent with full context from previous conversation]
```

<span style="font-size: 1em">完成的 subagent 如果接收</span> `SendMessage`<span style="font-size: 1em">，会在后台自动恢复，无需新的</span> `Agent` <span style="font-size: 1em">调用。同样适用于 Claude 用</span> `TaskStop` <span style="font-size: 1em">工具停止的 subagent。</span>

<span style="font-size: 1em">从 v2.1.191 开始，您自己停止的 subagent，使用</span> `/tasks` <span style="font-size: 1em">中的</span> `x` <span style="font-size: 1em">或 SDK</span> `stop_task` <span style="font-size: 1em">请求，不会自动恢复。</span>`SendMessage` <span style="font-size: 1em">调用返回拒绝，告诉 Claude 代理已被取消。在 subagent 面板中输入到该 subagent 的转录以自己恢复它，这会清除停止，以便稍后</span> `SendMessage` <span style="font-size: 1em">调用可以再次自动恢复它。</span>

<span style="font-size: 1em">恢复在相同 ID 下启动代理的新运行，所以已经失败或完成的 subagent 在任务列表和 Agent SDK 的任务事件中再次显示为运行。在 v2.1.205 之前，它在恢复的运行工作时保持显示其早期的失败或完成状态。</span>

<span style="font-size: 1em">从 v2.1.199 开始，</span>`SendMessage` <span style="font-size: 1em">检查名称是否仍然指向它在对话中早期到达的同一代理。如果较新的代理已经采用了该名称，例如重新生成的后台代理重新使用了它，Claude Code 会拒绝发送，而不是将其传递给错误的代理，错误会报告该名称现在到达的代理，以便 Claude 可以重新定向。要在它仍在运行时到达早期的代理，Claude 通过其生成结果中的代理 ID 来寻址它。检查的范围是当前对话，并在</span> `/clear` <span style="font-size: 1em">时重置。</span>

<span style="font-size: 1em">从 v2.1.198 开始，subagent 将来自启动它的代理的消息视为正常任务方向，包括中途任务方向更正，并在其自己的权限设置内对其进行操作。无论谁发送消息，两个限制仍然成立：来自任何代理的消息都不计为您对待处理权限提示的批准，任何代理消息都无法改变 subagent 的权限设置、</span>`CLAUDE.md` <span style="font-size: 1em">或配置。只有权限系统或您自己的消息可以授予批准。</span>

<span style="font-size: 1em">您也可以要求 Claude 提供代理 ID，如果您想明确引用它，或在</span> `~/.claude/projects/{project}/{sessionId}/subagents/` <span style="font-size: 1em">的转录文件中找到 ID。每个转录存储为</span> `agent-{agentId}.jsonl`<span style="font-size: 1em">。</span>

<span style="font-size: 1em">Subagent 转录独立于主对话持久化：</span>

- <span style="font-size: 1em">**主对话压缩**：当主对话压缩时，subagent 转录不受影响。它们存储在单独的文件中。</span>
- <span style="font-size: 1em">**会话持久性**：Subagent 转录在其会话中持久化。您可以通过恢复相同的会话在重启 Claude Code 后 [恢复 subagent](#%E6%81%A2%E5%A4%8D%20subagents)。</span>
- <span style="font-size: 1em">**自动清理**：转录根据</span> `cleanupPeriodDays` <span style="font-size: 1em">设置（默认为 30 天）进行清理。</span>

#### <span style="font-size: 1em">自动压缩</span>

<span style="font-size: 1em">Subagents 支持使用与主对话相同的逻辑进行自动压缩。压缩在相同条件下触发，</span>`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` <span style="font-size: 1em">也适用于 subagents。有关何时覆盖生效的信息，请参阅 [environment variables](https://code.claude.com/docs/zh-CN/env-vars)。</span>

<span style="font-size: 1em">压缩事件记录在 subagent 转录文件中：</span>
```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167189
  }
}
```

`preTokens` <span style="font-size: 1em">值显示压缩发生前使用了多少令牌。</span>

## <span style="font-size: 1em">分叉当前对话</span>

<span style="font-size: 1em">分叉 subagents 需要 Claude Code v2.1.117 或更高版本。从 v2.1.161 开始，\`/fork\` 命令默认启用；在早期版本中，它需要将 \[\`CLAUDE\_CODE\_FORK\_SUBAGENT\`\]([https://code.claude.com/docs/zh-CN/env-vars](https://code.claude.com/docs/zh-CN/env-vars)) 环境变量设置为 \`1\`。让 Claude 本身生成分叉是实验性的，可能在未来版本中更改。此功能也可以在交互式会话中启用，作为分阶段推出的一部分。</span>

<span style="font-size: 1em">分叉是一个 subagent，它继承到目前为止的整个对话，而不是从头开始。这消除了 subagents 通常提供的输入隔离：分叉看到与主会话相同的系统提示、工具、模型和消息历史，因此您可以将其交给一个辅助任务而无需重新解释情况。分叉自己的工具调用仍然保持在您的对话之外，只有其最终结果返回，因此您的主 context window 保持干净。当命名 subagent 需要太多背景才能有用时，或当您想从相同的起点并行尝试多种方法时，使用分叉。</span>

<span style="font-size: 1em">要控制分叉模式而不管分阶段推出，将</span> `CLAUDE_CODE_FORK_SUBAGENT` <span style="font-size: 1em">设置为</span> `1` <span style="font-size: 1em">以显式启用它，或设置为</span> `0` <span style="font-size: 1em">以禁用它。该变量在交互模式以及通过 SDK 或</span> `claude -p` <span style="font-size: 1em">中被遵守。</span>

<span style="font-size: 1em">启用分叉模式以两种方式改变 Claude Code：</span>

- <span style="font-size: 1em">Claude 可以通过显式请求</span> `fork` <span style="font-size: 1em">subagent 类型来生成分叉。没有 subagent 类型的生成仍然使用 [general-purpose](#%E5%86%85%E7%BD%AE%20subagents) subagent，命名 subagents 如 Explore 仍然像以前一样生成。</span>
- <span style="font-size: 1em">每个 subagent 生成都在 [background](#%E5%9C%A8%E5%89%8D%E5%8F%B0%E6%88%96%E5%90%8E%E5%8F%B0%E8%BF%90%E8%A1%8C%20subagents) 中运行，无论它是分叉还是命名 subagent。设置</span> `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` <span style="font-size: 1em">为</span> `1` <span style="font-size: 1em">以保持生成同步。</span>

<span style="font-size: 1em">您可以使用</span> `/fork` <span style="font-size: 1em">后跟指令自己启动分叉，无论是否设置了变量。Claude Code 从指令的前几个单词命名分叉。以下示例分叉对话以在您继续主会话中的实现时草拟测试用例：</span>
```text
/fork draft unit tests for the parser changes so far
```

<span style="font-size: 1em">分叉出现在提示下方的面板中，并在您继续工作时在后台运行。完成后，其结果作为消息到达您的主对话。下一部分涵盖了在分叉运行时观察和引导它们的面板控制。</span>

### <span style="font-size: 1em">观察和引导运行中的分叉</span>

<span style="font-size: 1em">运行中的分叉出现在提示输入下方的面板中，主会话有一行，每个分叉有一行。使用这些键与面板交互：</span>


| <span style="font-size: 1em">Key</span>       | <span style="font-size: 1em">Action</span>             |
| :--------------------------------------------- | :------------------------------------------------------ |
| `↑` <span style="font-size: 1em">/</span> `↓` | <span style="font-size: 1em">在行之间移动</span>             |
| `Enter`                                       | <span style="font-size: 1em">打开所选分叉的转录并向其发送后续消息</span> |
| `x`                                           | <span style="font-size: 1em">关闭完成的分叉或停止运行中的分叉</span>   |
| `Esc`                                         | <span style="font-size: 1em">将焦点返回到提示输入</span>         |


<span style="font-size: 1em">打开分叉或 subagent 的转录后，后续消息和 [skills](https://code.claude.com/docs/zh-CN/skills) 会发送到该代理，但内置命令仍在您的主对话中运行。从 v2.1.199 开始，在该视图中键入</span> `/model` <span style="font-size: 1em">或</span> `/fast` <span style="font-size: 1em">会显示一条通知，说明它改变主对话的模型或快速模式，而不是所查看代理的，而不是静默运行它。</span>

### <span style="font-size: 1em">分叉与命名 subagents 的区别</span>

<span style="font-size: 1em">分叉继承主会话在生成时拥有的一切。命名 subagent 从自己的定义开始。</span>


|                                                  | <span style="font-size: 1em">分叉</span>         | <span style="font-size: 1em">命名 subagent</span>                                                                                                |
| :------------------------------------------------ | :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| <span style="font-size: 1em">上下文</span>          | <span style="font-size: 1em">完整的对话历史</span>    | <span style="font-size: 1em">新鲜上下文，带有您传递的提示</span>                                                                                             |
| <span style="font-size: 1em">系统提示和工具</span>      | <span style="font-size: 1em">与主会话相同</span>     | <span style="font-size: 1em">来自 subagent 的 [definition file](#%E7%BC%96%E5%86%99%20subagent%20%E6%96%87%E4%BB%B6)</span>                       |
| <span style="font-size: 1em">模型</span>           | <span style="font-size: 1em">与主会话相同</span>     | <span style="font-size: 1em">来自 subagent 的</span> `model` <span style="font-size: 1em">字段</span>                                               |
| <span style="font-size: 1em">权限</span>           | <span style="font-size: 1em">提示在您的终端中出现</span> | [<span style="font-size: 1em">提示在后台运行时在您的主会话中出现</span>](#%E5%9C%A8%E5%89%8D%E5%8F%B0%E6%88%96%E5%90%8E%E5%8F%B0%E8%BF%90%E8%A1%8C%20subagents) |
| <span style="font-size: 1em">Prompt cache</span> | <span style="font-size: 1em">与主会话共享</span>     | <span style="font-size: 1em">单独的缓存</span>                                                                                                      |


<span style="font-size: 1em">因为分叉的系统提示和工具定义与父级相同，其第一个请求重用父级的 [prompt cache](https://code.claude.com/docs/zh-CN/prompt-caching#subagents-and-the-cache)。这使得分叉比为需要相同上下文的任务生成新 subagent 更便宜。</span>

<span style="font-size: 1em">当 Claude 通过 Agent 工具生成分叉时，它可以传递</span> `isolation: "worktree"` <span style="font-size: 1em">以便分叉的文件编辑被写入单独的 git worktree 而不是您的检出。</span>

### <span style="font-size: 1em">限制</span>

<span style="font-size: 1em">设置</span> `CLAUDE_CODE_FORK_SUBAGENT=1` <span style="font-size: 1em">在交互式会话、[non-interactive mode](https://code.claude.com/docs/zh-CN/headless) 和 Agent SDK 中启用分叉模式；将其设置为</span> `0` <span style="font-size: 1em">会在所有地方禁用分叉模式，包括任何服务器端推出。分叉无法生成进一步的分叉。</span>

## <span style="font-size: 1em">示例 subagents</span>

<span style="font-size: 1em">这些示例演示了构建 subagents 的有效模式。将它们用作起点，或使用 Claude 生成自定义版本。</span>

<span style="font-size: 1em">\*\*最佳实践：\*\*</span>

- <span style="font-size: 1em">**设计专注的 subagents：** 每个 subagent 应该在一个特定任务中表现出色</span>
- <span style="font-size: 1em">**编写详细的描述：** Claude 使用描述来决定何时委托</span>
- <span style="font-size: 1em">**限制工具访问：** 仅授予必要的权限以确保安全和专注</span>
- <span style="font-size: 1em">**检入版本控制：** 与您的团队共享项目 subagents</span>

### <span style="font-size: 1em">代码审查者</span>

<span style="font-size: 1em">一个只读 subagent，审查代码而不修改它。此示例展示了如何设计一个专注的 subagent，具有有限的工具访问（无 Edit 或 Write）和详细的提示，指定确切要查找的内容以及如何格式化输出。</span>
```markdown
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

### <span style="font-size: 1em">调试器</span>

<span style="font-size: 1em">一个可以分析和修复问题的 subagent。与代码审查者不同，这个包括 Edit，因为修复错误需要修改代码。提示提供了从诊断到验证的清晰工作流。</span>
```markdown
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

### <span style="font-size: 1em">数据科学家</span>

<span style="font-size: 1em">一个用于数据分析工作的特定领域 subagent。此示例展示了如何为典型编码任务之外的专门工作流创建 subagents。它明确设置</span> `model: sonnet` <span style="font-size: 1em">以获得更强大的分析能力。</span>
```markdown
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

### <span style="font-size: 1em">数据库查询验证器</span>

<span style="font-size: 1em">一个允许 Bash 访问但验证命令以仅允许只读 SQL 查询的 subagent。此示例展示了当您需要比</span> `tools` <span style="font-size: 1em">字段提供的更精细的控制时如何使用</span> `PreToolUse` <span style="font-size: 1em">hooks。</span>
```markdown
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

<span style="font-size: 1em">Claude Code [通过 stdin 将 hook 输入作为 JSON 传递](https://code.claude.com/docs/zh-CN/hooks#pretooluse-input) 给 hook 命令。验证脚本读取此 JSON，提取正在执行的命令，并根据 SQL 写入操作列表检查它。如果检测到写入操作，脚本 [以代码 2 退出](https://code.claude.com/docs/zh-CN/hooks#exit-code-2-behavior-per-event) 以阻止执行，并通过 stderr 向 Claude 返回错误消息。</span>

<span style="font-size: 1em">在您的项目中的任何位置创建验证脚本。路径必须与您的 hook 配置中的</span> `command` <span style="font-size: 1em">字段匹配：</span>
```bash
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

<span style="font-size: 1em">在 macOS 和 Linux 上，使脚本可执行：</span>
```bash
chmod +x ./scripts/validate-readonly-query.sh
```

<span style="font-size: 1em">在 Windows 上，用 PowerShell 编写验证脚本，并在 hook 条目中添加</span> `shell: powershell`<span style="font-size: 1em">。请参阅 [在 PowerShell 中运行 hooks](https://code.claude.com/docs/zh-CN/hooks#windows-powershell-tool)。</span>

<span style="font-size: 1em">Hook 通过 stdin 接收 JSON，Bash 命令在</span> `tool_input.command` <span style="font-size: 1em">中。退出代码 2 阻止操作并将错误消息反馈给 Claude。有关退出代码和输出的详细信息，请参阅 [Hooks](https://code.claude.com/docs/zh-CN/hooks#exit-code-output)，有关完整的输入架构，请参阅 [Hook input](https://code.claude.com/docs/zh-CN/hooks#pretooluse-input)。</span>

## <span style="font-size: 1em">后续步骤</span>

<span style="font-size: 1em">现在您了解了 subagents，探索这些相关功能：</span>

- <span style="font-size: 1em">[使用 plugins 分发 subagents](https://code.claude.com/docs/zh-CN/plugins) 以在团队或项目中共享 subagents</span>
- <span style="font-size: 1em">[以编程方式运行 Claude Code](https://code.claude.com/docs/zh-CN/headless)，使用 Agent SDK 进行 CI/CD 和自动化</span>
- <span style="font-size: 1em">[使用 MCP 服务器](https://code.claude.com/docs/zh-CN/mcp) 为 subagents 提供对外部工具和数据的访问</span>

<!-- created: 2026-08-13 18:20:12 -->
<!-- updated: 2026-08-19 14:54:22 -->