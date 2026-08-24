> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 协调 Claude Code 会话团队

> 协调多个 Claude Code 实例作为一个团队一起工作，具有共享任务、代理间消息传递和集中管理。

<Warning>
  Agent teams 是实验性功能，默认禁用。通过将 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 添加到你的 [settings.json](/docs/zh-CN/settings) 或环境变量来启用它们。如果没有该变量，会话启动时不会设置任何团队，不会写入团队目录，Claude 也不会生成或提议队友。Agent teams 在 [已知限制](#limitations) 中存在关于会话恢复、任务协调和关闭行为的问题。
</Warning>

Agent teams 让你协调多个 Claude Code 实例一起工作。一个会话充当团队负责人，协调工作、分配任务和综合结果。队友独立工作，每个都在自己的 context window 中，并直接相互通信。

与 [subagents](/docs/zh-CN/sub-agents) 不同，subagents 在单个会话中运行，只能向主代理报告，你也可以直接与个别队友互动，无需通过负责人。

<Note>
  本页描述的是 v2.1.178 版本的 agent teams。设置 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 后，生成队友不再需要设置步骤，会话退出时会自动清理。在 v2.1.178 之前，你需要要求 Claude 先创建并命名一个团队，Claude 使用 `TeamCreate` 和 `TeamDelete` 工具来设置和删除它。这两个工具已不再存在。Agent 工具上的 `team_name` 输入被接受但被忽略，`TaskCreated`、`TaskCompleted` 和 `TeammateIdle` [hook payloads](/docs/zh-CN/hooks#taskcreated) 中的 `team_name` 字段携带会话派生的名称，已被弃用。
</Note>

<h2 id="when-to-use-agent-teams">
  何时使用 agent teams
</h2>

Agent teams 最适合用于并行探索能增加真实价值的任务。有关完整场景，请参阅 [用例示例](#use-case-examples)。最强的用例是：

* **研究和审查**：多个队友可以同时调查问题的不同方面，然后分享和质疑彼此的发现
* **新模块或功能**：队友可以各自拥有一个独立的部分，不会相互干扰
* **使用竞争假设进行调试**：队友并行测试不同的理论，更快地收敛到答案
* **跨层协调**：跨越前端、后端和测试的更改，每个由不同的队友负责

Agent teams 增加了协调开销，使用的令牌数量明显多于单个会话。当队友可以独立运作时，它们效果最好。对于顺序任务、同一文件编辑或有许多依赖关系的工作，单个会话或 [subagents](/docs/zh-CN/sub-agents) 更有效。

<h3 id="compare-with-subagents">
  与 subagents 比较
</h3>

Agent teams 和 [subagents](/docs/zh-CN/sub-agents) 都让你并行化工作，但它们的运作方式不同。根据你的工作人员是否需要相互通信来选择：

<Frame caption="Subagents 仅向主代理报告结果，彼此不交谈。在 agent teams 中，队友共享任务列表、认领工作并直接相互通信。">
  <img src="https://mintcdn.com/claude-code/nsvRFSDNfpSU5nT7/images/subagents-vs-agent-teams-light.png?fit=max&auto=format&n=nsvRFSDNfpSU5nT7&q=85&s=2f8db9b4f3705dd3ab931fbe2d96e42a" className="dark:hidden" alt="比较 subagent 和 agent team 架构的图表。Subagents 由主代理生成、执行工作并报告结果。Agent teams 通过共享任务列表进行协调，队友彼此直接通信。" width="4245" height="1615" data-path="images/subagents-vs-agent-teams-light.png" />

  <img src="https://mintcdn.com/claude-code/nsvRFSDNfpSU5nT7/images/subagents-vs-agent-teams-dark.png?fit=max&auto=format&n=nsvRFSDNfpSU5nT7&q=85&s=d573a037540f2ada6a9ae7d8285b46fd" className="hidden dark:block" alt="比较 subagent 和 agent team 架构的图表。Subagents 由主代理生成、执行工作并报告结果。Agent teams 通过共享任务列表进行协调，队友彼此直接通信。" width="4245" height="1615" data-path="images/subagents-vs-agent-teams-dark.png" />
</Frame>

|             | Subagents                   | Agent teams             |
| :---------- | :-------------------------- | :---------------------- |
| **Context** | 自己的 context window；结果返回给调用者 | 自己的 context window；完全独立 |
| **通信**      | 仅向主代理报告结果                   | 队友直接相互发送消息              |
| **协调**      | 主代理管理所有工作                   | 具有自我协调的共享任务列表           |
| **最适合**     | 只有结果重要的专注任务                 | 需要讨论和协作的复杂工作            |
| **令牌成本**    | 较低：结果汇总回主 context           | 较高：每个队友是一个独立的 Claude 实例 |

当你需要快速、专注的工作人员报告结果时，使用 subagents。当队友需要分享发现、相互质疑和自我协调时，使用 agent teams。

<h2 id="enable-agent-teams">
  启用 agent teams
</h2>

Agent teams 默认禁用。通过将 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 环境变量设置为 `1`，在你的 shell 环境中或通过 [settings.json](/docs/zh-CN/settings) 来启用它：

```json settings.json theme={null}
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

<h2 id="start-your-first-agent-team">
  启动你的第一个 agent team
</h2>

启用 agent teams 后，用自然语言描述你想要的任务和队友。Claude 会生成他们并根据你的提示协调工作。

这个例子效果很好，因为三个角色是独立的，可以在不相互等待的情况下探索问题：

```text theme={null}
I'm designing a CLI tool that helps developers track TODO comments across
their codebase. Spawn three teammates to explore this from different angles:
one on UX, one on technical architecture, one playing devil's advocate.
```

从那里，Claude 会填充一个 [共享任务列表](/docs/zh-CN/interactive-mode#task-list)，为每个角度生成队友，让他们探索问题，并在完成时综合发现。

负责人的终端在提示输入下方的 agent 面板中列出队友。从该面板中：

* **向上和向下箭头**：选择一个队友
* **Enter**：打开所选队友的记录并直接向其发送消息
* **Escape**：中断所选队友的当前轮次

从 v2.1.199 开始，当任何队友或子 agent 仍在工作时，空闲队友的行会保留在面板中，因此你可以选择它来查看其记录或向其分配更多工作。一旦面板中的每个 agent 都处于空闲状态，空闲行会在 30 秒后隐藏，并在队友的下一轮时重新出现；队友在隐藏时仍然保持运行并可寻址。在 v2.1.181 到 v2.1.198 中，空闲行在其自己的轮次结束后 30 秒隐藏，即使其他队友仍在工作；v2.1.181 之前的版本不隐藏空闲行。

当超过三个队友同时处于空闲状态时，前三个之外的行会折叠成一行，计数折叠的队友，例如当五个处于空闲状态时显示 `2 idle agents`。选择它并按 Enter 展开折叠的行，或按 Esc 再次折叠它们。工作中的队友、失败的队友和你正在查看的队友始终保持自己的行。

如果你想让每个队友在自己的分割窗格中，请参阅 [选择显示模式](#choose-a-display-mode)。

<h2 id="control-your-agent-team">
  控制你的 agent team
</h2>

用自然语言告诉负责人你想要什么。它根据你的指示处理团队协调、任务分配和委派。

<h3 id="choose-a-display-mode">
  选择显示模式
</h3>

Agent teams 支持两种显示模式：

* **In-process**：所有队友在你的主终端内运行。在 agent 面板中使用上下箭头键选择队友，然后按 Enter 查看它并输入以直接向它发送消息。在任何终端中工作，无需额外设置。
* **Split panes**：每个队友获得自己的窗格。你可以同时看到每个人的输出，并点击窗格直接交互。需要 tmux 或 iTerm2。

<Note>
  `tmux` 在某些操作系统上有已知限制，传统上在 macOS 上效果最好。在 iTerm2 中使用 `tmux -CC` 是进入 `tmux` 的建议入口点。
</Note>

默认值是 `"in-process"`。在 v2.1.179 之前，默认值是 `"auto"`，所以升级的会话如果之前打开了分割窗格，现在会保持在一个终端中，除非你显式设置模式。设置 `"auto"` 以在你已经在 tmux 会话中运行或你的终端是 iTerm2 时启用分割窗格，否则回退到 in-process。`"tmux"` 设置启用分割窗格模式，并根据你的终端自动检测是使用 tmux 还是 iTerm2。

从 v2.1.186 开始，设置 `"iterm2"` 以显式使用 iTerm2 原生分割窗格。此模式需要 [`it2` CLI](https://github.com/mkusaka/it2)，如果 `it2` 缺失，会显示带有安装命令的错误。当你的终端是 iTerm2 且 tmux 可用作备选方案时，在 `"auto"` 或 `"tmux"` 下会出现提供安装 `it2` 或切换到 tmux 的设置提示。

要覆盖默认值，在 `~/.claude/settings.json` 中设置 [`teammateMode`](/docs/zh-CN/settings#available-settings)：

```json theme={null}
{
  "teammateMode": "auto"
}
```

要为单个会话设置模式，将其作为标志传递：

```bash theme={null}
claude --teammate-mode auto
```

分割窗格模式需要 [tmux](https://github.com/tmux/tmux/wiki) 或 iTerm2 与 [`it2` CLI](https://github.com/mkusaka/it2)。手动安装：

* **tmux**：通过你的系统包管理器安装。有关特定于平台的说明，请参阅 [tmux wiki](https://github.com/tmux/tmux/wiki/Installing)。
* **iTerm2**：安装 [`it2` CLI](https://github.com/mkusaka/it2)，然后在 **iTerm2 → Settings → General → Magic → Enable Python API** 中启用 Python API。

<h3 id="specify-teammates-and-models">
  指定队友和模型
</h3>

Claude 根据你的任务决定要生成的队友数量，或者你可以指定你想要的确切内容：

```text theme={null}
Spawn 4 teammates to refactor these modules in parallel. Use Sonnet for
each teammate.
```

队友默认不继承负责人的 `/model` 选择。要更改在提示未指定模型时使用的模型，在 `/config` 中设置**默认队友模型**。选择\*\*默认（负责人的模型）\*\*以让队友遵循负责人的当前模型。

队友继承负责人的[工作量级别](/docs/zh-CN/model-config#adjust-effort-level)。在分割窗格模式中，这从 v2.1.186 开始适用；较早的版本没有将负责人的会话工作量传递给分割窗格队友。

<h3 id="require-plan-approval-for-teammates">
  要求队友的计划批准
</h3>

对于复杂或有风险的任务，你可以要求队友在实施前进行规划。队友在只读计划模式下工作，直到负责人批准他们的方法：

```text theme={null}
Spawn an architect teammate to refactor the authentication module.
Require plan approval before they make any changes.
```

当队友完成规划时，它向负责人发送计划批准请求。负责人审查计划并批准或拒绝并提供反馈。如果被拒绝，队友保持在计划模式，根据反馈进行修订并重新提交。一旦批准，队友退出计划模式并开始实施。

负责人自主做出批准决定。要影响负责人的判断，在你的提示中给出标准，例如"仅批准包括测试覆盖的计划"或"拒绝修改数据库架构的计划"。

<h3 id="talk-to-teammates-directly">
  直接与队友交谈
</h3>

每个队友都是一个完整的、独立的 Claude Code 会话。你可以直接向任何队友发送消息，以提供额外的指示、提出后续问题或改变他们的方法。

* **In-process 模式**：在 agent 面板中使用上下箭头键选择队友，然后按 Enter 查看其会话并输入以向其发送消息。在选定的队友上按 `x` 以停止它。按 Ctrl+T 切换任务列表。
* **Split-pane 模式**：点击队友的窗格以直接与他们的会话交互。每个队友都有自己终端的完整视图。

当你查看 in-process 队友时，纯文本和 [skills](/docs/zh-CN/skills) 会发送给该队友，但内置命令仍在负责人的会话中运行。

队友的模型和快速模式在它生成时是固定的，所以 `/model` 和 `/fast` 只改变负责人的设置。从 v2.1.199 开始，在查看队友时输入任一命令会显示一个通知，表示更改适用于负责人；较早的版本会将其应用于负责人而没有任何指示。`/effort` 仍然适用于所查看队友的后续轮次，因为队友遵循负责人的[工作量级别](/docs/zh-CN/model-config#adjust-effort-level)。

<h3 id="assign-and-claim-tasks">
  分配和认领任务
</h3>

共享任务列表协调整个团队的工作。负责人创建任务，队友完成它们。任务有三种状态：待处理、进行中和已完成。任务也可以依赖其他任务：具有未解决依赖关系的待处理任务在这些依赖关系完成之前无法被认领。

负责人可以显式分配任务，或队友可以自我认领：

* **负责人分配**：告诉负责人将哪个任务分配给哪个队友
* **自我认领**：完成任务后，队友自己选择下一个未分配、未阻止的任务

任务认领使用文件锁定来防止多个队友同时尝试认领同一任务时的竞态条件。

<h3 id="shut-down-teammates">
  关闭队友
</h3>

要优雅地结束队友的会话，按名称引用它。例如，对于一个名为 researcher 的队友：

```text theme={null}
Ask the researcher teammate to shut down
```

负责人发送关闭请求。队友可以批准，优雅地退出，或拒绝并提供解释。

团队的共享目录在会话结束时自动清理，因此没有单独的清理步骤。请参阅[架构](#architecture)了解哪些目录被删除以及哪些目录为恢复的会话保留。

<h3 id="enforce-quality-gates-with-hooks">
  使用 hooks 强制质量门
</h3>

使用 [hooks](/docs/zh-CN/hooks) 在队友完成工作或任务创建或完成时强制执行规则：

* [`TeammateIdle`](/docs/zh-CN/hooks#teammateidle)：当队友即将空闲时运行。以代码 2 退出以发送反馈并保持队友工作。
* [`TaskCreated`](/docs/zh-CN/hooks#taskcreated)：当任务被创建时运行。以代码 2 退出以防止创建并发送反馈。
* [`TaskCompleted`](/docs/zh-CN/hooks#taskcompleted)：当任务被标记为完成时运行。以代码 2 退出以防止完成并发送反馈。

<h2 id="how-agent-teams-work">
  Agent teams 如何工作
</h2>

本部分涵盖 agent teams 背后的架构和机制。如果你想开始使用它们，请参阅上面的 [控制你的 agent team](#control-your-agent-team)。

<h3 id="how-claude-starts-agent-teams">
  Claude 如何启动 agent teams
</h3>

当第一个队友被生成时，agent team 就形成了，主会话充当负责人。队友有两种方式被生成：

* **你请求队友**：给 Claude 一个受益于并行工作的任务，并明确要求队友。Claude 根据你的指示生成他们。
* **Claude 提议队友**：如果 Claude 确定你的任务将受益于并行工作，它可能会建议生成队友。你在它继续之前确认。

在这两种情况下，你都保持控制。Claude 不会在没有你的批准的情况下生成队友。

<h3 id="architecture">
  架构
</h3>

Agent team 由以下部分组成：

| 组件            | 角色                         |
| :------------ | :------------------------- |
| **Team lead** | 生成队友并协调工作的主 Claude Code 会话 |
| **Teammates** | 各自处理分配任务的独立 Claude Code 实例 |
| **Task list** | 队友认领和完成的共享工作项列表            |
| **Mailbox**   | 代理之间通信的消息系统                |

有关显示配置选项，请参阅 [选择显示模式](#choose-a-display-mode)。队友消息自动到达负责人。

每个代理的邮箱是位于 `~/.claude/teams/{team-name}/inboxes/{agent-name}.json` 的 JSON 文件。Claude Code 在读取邮箱文件时验证每个条目。不匹配消息格式的条目被报告为错误并从文件中删除；有效的消息仍然会被传递。在 v2.1.207 之前，单个格式错误的邮箱条目会导致每秒重复出现错误，并阻止该邮箱的传递，直到你手动删除文件。

系统自动管理任务依赖关系。当队友完成其他任务依赖的任务时，被阻止的任务会自动解除阻止。

团队和任务存储在本地，名称来自会话派生的名称。名称是 `session-` 后跟会话 ID 的前八个字符：

* **Team config**：`~/.claude/teams/{team-name}/config.json`
* **Task list**：`~/.claude/tasks/{team-name}/`

Claude Code 在会话启动时自动生成这两个，并在队友加入、空闲或离开时更新它们。团队配置目录在会话结束时被删除。任务列表目录在本地持久化，永远不会上传，所以恢复的会话会保留它们的任务。保留期由你已经为会话记录控制的相同 [`cleanupPeriodDays`](/docs/zh-CN/settings#available-settings) 管理。

团队配置保存运行时状态，例如会话 ID 和 tmux 窗格 ID，所以不要手动编辑它或预先编写它：你的更改会在下一次状态更新时被覆盖。

要定义可重用的队友角色，请改用 [subagent 定义](#use-subagent-definitions-for-teammates)。

团队配置包含一个 `members` 数组，其中包含每个队友的名称、代理 ID 和代理类型。队友可以读取此文件以发现其他团队成员。

没有项目级别的团队配置等效项。项目目录中的 `.claude/teams/teams.json` 之类的文件不被识别为配置；Claude 将其视为普通文件。

<h3 id="use-subagent-definitions-for-teammates">
  为队友使用 subagent 定义
</h3>

当生成队友时，你可以引用来自任何 [subagent 范围](/docs/zh-CN/sub-agents#choose-the-subagent-scope) 的 [subagent](/docs/zh-CN/sub-agents) 类型：项目、用户、插件或 CLI 定义。这让你定义一个角色一次，例如安全审查员或测试运行器，并将其同时重用为委派的 subagent 和 agent team 队友。

要使用 subagent 定义，在要求 Claude 生成队友时按名称提及它：

```text theme={null}
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```

队友遵守该定义的 `tools` 允许列表和 `model`，定义的主体被附加到队友的系统提示作为额外指示，而不是替换它。Team coordination tools 例如 `SendMessage` 和任务管理工具始终对队友可用，即使 `tools` 限制其他工具。

<Note>
  subagent 定义中的 `skills` 和 `mcpServers` frontmatter 字段在该定义作为队友运行时不被应用。队友从你的项目和用户设置加载 skills 和 MCP servers，与常规会话相同。
</Note>

<h3 id="permissions">
  权限
</h3>

队友从负责人的权限设置开始。如果负责人使用 `--dangerously-skip-permissions` 运行，所有队友也会这样做。生成后，你可以更改个别队友模式，但在生成时无法设置每个队友的模式。

当一个代理通过 `SendMessage` 向另一个代理发送消息时，接收代理被告知它来自另一个 Claude 会话，而不是来自你。队友无法批准权限提示或代表你提供同意，被拒绝某项操作的队友无法将其转发给另一个队友以绕过检查。在 [auto mode](/docs/zh-CN/permission-modes#eliminate-prompts-with-auto-mode) 中，分类器将从另一个代理转发的批准声明视为不受信任的输入，而不是来自你的确认。

队友权限提示会冒泡到负责人会话，所以请在那里自己批准它们。[Plan approval](#require-plan-approval-for-teammates) 是设计的例外：负责人会话授予队友计划批准，无需向你单独提示。

<h3 id="context-and-communication">
  Context 和通信
</h3>

每个队友都有自己的 context window。生成时，队友加载与常规会话相同的项目 context：CLAUDE.md、MCP servers 和 skills。它还接收来自负责人的生成提示。负责人的对话历史不会继承。

**队友如何共享信息：**

* **自动消息传递**：当队友发送消息时，它们会自动传递给收件人。负责人不需要轮询更新。
* **空闲通知**：当队友完成并停止时，他们会自动通知负责人。从 v2.1.198 开始，其轮次因 API 错误而结束的队友会通知负责人它失败了并包含错误文本，而不是显示为正常完成。
* **共享任务列表**：所有代理都可以看到任务状态并认领可用工作。
* **队友消息传递**：按名称向一个特定的队友发送消息。要联系所有人，请为每个收件人发送一条消息。

负责人在生成队友时为其分配一个名称，任何队友都可以按该名称向任何其他队友发送消息。要获得可预测的名称，你可以在后续提示中引用，在你的生成指令中告诉负责人如何称呼每个队友。

<h3 id="token-usage">
  令牌使用
</h3>

Agent teams 使用的令牌数量明显多于单个会话。每个队友都有自己的 context window，令牌使用量随活跃队友数量而增加。对于研究、审查和新功能工作，额外的令牌通常是值得的。对于日常任务，单个会话更具成本效益。有关使用指导，请参阅 [agent team 令牌成本](/docs/zh-CN/costs#agent-team-token-costs)。

<h2 id="use-case-examples">
  用例示例
</h2>

这些示例展示了 agent teams 如何处理并行探索增加价值的任务。

<h3 id="run-a-parallel-code-review">
  运行并行代码审查
</h3>

单个审查者往往一次只关注一种类型的问题。将审查标准分解为独立的领域意味着安全性、性能和测试覆盖都同时获得彻底的关注。提示为每个队友分配一个不同的视角，以便他们不重叠：

```text theme={null}
Spawn three teammates to review PR #142:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

每个审查者从同一个 PR 工作，但应用不同的过滤器。负责人在他们完成后综合所有三个的发现。

<h3 id="investigate-with-competing-hypotheses">
  使用竞争假设进行调查
</h3>

当根本原因不清楚时，单个代理往往会找到一个看似合理的解释并停止寻找。提示通过让队友明确对抗来对抗这一点：每个队友的工作不仅是调查自己的理论，还要质疑其他队友的理论。

```text theme={null}
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific
debate. Update the findings doc with whatever consensus emerges.
```

辩论结构是这里的关键机制。顺序调查受到锚定的影响：一旦探索了一个理论，后续调查就会偏向于它。

有多个独立的调查者积极尝试相互反驳，存活下来的理论更有可能是实际的根本原因。

<h2 id="best-practices">
  最佳实践
</h2>

<h3 id="give-teammates-enough-context">
  给队友足够的 context
</h3>

队友自动加载项目 context，包括 CLAUDE.md、MCP servers 和 skills，但他们不继承负责人的对话历史。有关详细信息，请参阅 [Context 和通信](#context-and-communication)。在生成提示中包含特定于任务的详细信息：

```text theme={null}
Spawn a security reviewer teammate with the prompt: "Review the authentication module
at src/auth/ for security vulnerabilities. Focus on token handling, session
management, and input validation. The app uses JWT tokens stored in
httpOnly cookies. Report any issues with severity ratings."
```

<h3 id="choose-an-appropriate-team-size">
  选择适当的团队规模
</h3>

队友数量没有硬限制，但实际限制适用：

* **令牌成本线性增加**：每个队友都有自己的 context window 并独立消耗令牌。有关详细信息，请参阅 [agent team 令牌成本](/docs/zh-CN/costs#agent-team-token-costs)。
* **协调开销增加**：更多队友意味着更多通信、任务协调和潜在冲突
* **收益递减**：超过一定点，额外的队友不会按比例加快工作

对于大多数工作流，从 3-5 个队友开始。这平衡了并行工作和可管理的协调。本指南中的示例使用 3-5 个队友，因为该范围在不同任务类型中效果很好。

每个队友有 5-6 个 [tasks](/docs/zh-CN/agent-teams#architecture) 可以让每个人保持生产力，而不会过度的上下文切换。如果你有 15 个独立任务，3 个队友是一个很好的起点。

仅当工作真正受益于队友同时工作时才扩展。三个专注的队友通常胜过五个分散的队友。

<h3 id="size-tasks-appropriately">
  适当调整任务大小
</h3>

* **太小**：协调开销超过收益
* **太大**：队友长时间工作而不进行检查，增加浪费努力的风险
* **恰到好处**：自包含的单位，产生清晰的可交付成果，例如函数、测试文件或审查

<Tip>
  负责人将工作分解为任务并自动分配给队友。如果它没有创建足够的任务，要求它将工作分成更小的部分。每个队友有 5-6 个任务可以让每个人保持生产力，并让负责人在有人卡住时重新分配工作。
</Tip>

<h3 id="wait-for-teammates-to-finish">
  等待队友完成
</h3>

有时负责人开始自己实施任务，而不是等待队友。如果你注意到这一点：

```text theme={null}
Wait for your teammates to complete their tasks before proceeding
```

<h3 id="start-with-research-and-review">
  从研究和审查开始
</h3>

如果你是 agent teams 的新手，从具有明确边界且不需要编写代码的任务开始：审查 PR、研究库或调查错误。这些任务展示了并行探索的价值，而不会带来并行实施所带来的协调挑战。

<h3 id="avoid-file-conflicts">
  避免文件冲突
</h3>

两个队友编辑同一文件会导致覆盖。分解工作，使每个队友拥有不同的文件集。

<h3 id="monitor-and-steer">
  监控和指导
</h3>

检查队友的进度，重定向不起作用的方法，并在发现时综合发现。让团队无人值守运行太长时间会增加浪费努力的风险。

<h2 id="troubleshooting">
  故障排除
</h2>

<h3 id="teammates-not-appearing">
  队友未出现
</h3>

如果在你要求 Claude 创建队友后队友没有出现：

* 在 in-process 模式中，队友出现在提示输入下方的代理面板中。使用上下箭头键选择一个，然后按 Enter 键查看它。
* 闲置后消失的队友行已被隐藏，而不是停止。闲置行在整个面板闲置 30 秒后隐藏，并在队友的下一轮出现时重新出现。当超过三个队友闲置时，他们的多余行会折叠成一个 `N idle agents` 行，按 Enter 键可展开。按名称向队友发送消息以将隐藏的行恢复。
* 检查你给 Claude 的任务是否足够复杂以保证需要团队。Claude 根据任务决定是否生成队友。
* 如果你明确要求分割窗格，请确保 tmux 已安装并在你的 PATH 中可用：
  ```bash theme={null}
  which tmux
  ```
* 对于 iTerm2，验证 `it2` CLI 已安装，并在 iTerm2 偏好设置中启用了 Python API。

<h3 id="too-many-permission-prompts">
  过多权限提示
</h3>

队友权限请求冒泡到负责人，这可能会造成摩擦。在生成队友之前，在你的 [权限设置](/docs/zh-CN/permissions) 中预批准常见操作，以减少中断。

<h3 id="teammates-stopping-on-errors">
  队友在错误后停止
</h3>

队友可能在遇到错误后停止，而不是恢复。通过在代理面板中选择队友并在 in-process 模式中按 Enter 键，或在分割模式中点击窗格来检查他们的输出，然后：

* 直接给他们额外的指示
* 生成一个替代队友来继续工作

从 v2.1.198 开始，来自负责人或另一个队友的消息会唤醒正在等待重试失败 API 请求的 in-process 队友，因此它会立即重试，而不是等待完整的重试延迟。

<h3 id="lead-shuts-down-before-work-is-done">
  负责人在工作完成前关闭
</h3>

负责人可能会在所有任务实际完成之前决定团队已完成。如果发生这种情况，告诉它继续。你也可以告诉负责人在继续之前等待队友完成，如果它开始做工作而不是委派。

<h3 id="orphaned-tmux-sessions">
  孤立的 tmux 会话
</h3>

如果 tmux 会话在 Claude Code 会话结束后仍然存在，它可能没有被完全清理。列出会话并杀死由团队创建的会话：

```bash theme={null}
tmux ls
tmux kill-session -t <session-name>
```

<h2 id="limitations">
  限制
</h2>

Agent teams 是实验性的。需要注意的当前限制：

* **In-process 队友没有会话恢复**：`/resume` 和 `/rewind` 不会恢复 in-process 队友。恢复会话后，负责人可能会尝试向不再存在的队友发送消息。如果发生这种情况，告诉负责人生成新队友。
* **任务状态可能滞后**：队友有时无法将任务标记为已完成，这会阻止依赖任务。如果任务似乎卡住，检查工作是否实际完成，并手动更新任务状态或告诉负责人推动队友。
* **关闭可能很慢**：队友在关闭前完成他们的当前请求或工具调用，这可能需要时间。
* **每个会话一个团队**：一个会话恰好有一个团队，作用域限于该会话。你无法创建额外的命名团队或在会话间共享团队。
* **没有嵌套团队**：队友无法生成自己的队友。只有负责人可以管理团队。
* **没有来自 in-process 队友的后台子代理**：in-process 队友自己的子代理在前台运行。无论是使用 `run_in_background` 还是设置 `background: true` 的子代理定义，请求后台子代理都会返回错误，因为队友的后台工作无法超越负责人的进程。从主对话启动的子代理遵循[后台默认值](/docs/zh-CN/sub-agents#run-subagents-in-foreground-or-background)。
* **负责人是固定的**：主会话在其生命周期内是其团队的负责人。你无法将队友提升为负责人或转移领导权。
* **权限在生成时设置**：所有队友从负责人的权限模式开始。你可以在生成后更改个别队友模式，但在生成时无法设置每个队友的模式。
* **分割窗格需要 tmux 或 iTerm2**：默认 in-process 模式在任何终端中工作。VS Code 的集成终端、Windows Terminal 或 Ghostty 不支持分割窗格模式。

<Tip>
  **`CLAUDE.md` 正常工作**：队友从他们的工作目录读取 `CLAUDE.md` 文件。使用这个为所有队友提供项目特定的指导。
</Tip>

<h2 id="next-steps">
  后续步骤
</h2>

探索用于并行工作和委派的相关方法：

* **轻量级委派**：[subagents](/docs/zh-CN/sub-agents) 在你的会话中生成辅助代理以进行研究或验证，更适合不需要代理间协调的任务
* **手动并行会话**：[Git worktrees](/docs/zh-CN/worktrees) 让你自己运行多个 Claude Code 会话，无需自动化团队协调
* **比较方法**：查看 [subagent vs agent team](/docs/zh-CN/features-overview#compare-similar-features) 比较以获得并排分解
