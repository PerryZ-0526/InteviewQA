> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 并行运行代理

> 比较 Claude Code 同时处理多个任务的方式：子代理、代理视图、代理团队和动态工作流。

[子代理](/docs/zh-CN/sub-agents)、[代理视图](/docs/zh-CN/agent-view)、[代理团队](/docs/zh-CN/agent-teams) 和 [动态工作流](/docs/zh-CN/workflows) 各自以不同的方式并行化工作。正确的选择取决于您是否想在每个对话中保持参与、交付任务并稍后检查，或让 Claude 为您协调一组工作人员。

| 方法                         | 它提供什么                                           | 何时使用                                                                     |
| :------------------------- | :---------------------------------------------- | :----------------------------------------------------------------------- |
| [子代理](/docs/zh-CN/sub-agents)   | 在一个会话内的委派工作人员，在自己的上下文中执行辅助任务并返回摘要               | 辅助任务会用搜索结果、日志或文件内容淹没您的主对话，而您不会再次引用这些内容                                   |
| [代理视图](/docs/zh-CN/agent-view)  | 一个屏幕来分派和监控在后台运行的会话，使用 `claude agents` 打开。研究预览   | 您有多个独立任务，想要交付它们，一目了然地检查状态，并仅在需要时介入                                       |
| [代理团队](/docs/zh-CN/agent-teams) | 多个协调的会话，具有共享任务列表和代理间消息传递，由主导者管理。实验性功能，默认禁用      | 您希望 Claude 将项目分成多个部分、分配它们，并保持工作人员同步                                      |
| [动态工作流](/docs/zh-CN/workflows)  | 一个脚本，运行许多子代理并交叉检查其结果，用于一个太大而无法一次协调的工作或需要多次处理的工作 | 一个任务对于少数几个子代理来说太大了，或者您想要对结果进行相互验证：代码库范围的审计、500 个文件的迁移、交叉检查的研究或从多个角度起草的计划 |

在每种方法中，工作人员都是 Claude 会话。要涉及不同的工具，请将其作为 [MCP server](/docs/zh-CN/mcp) 公开给 Claude。

还有两个工具支持这项工作，但它们本身不是运行代理的方式：

* [Worktrees](/docs/zh-CN/worktrees) 为每个会话提供单独的 git 检出，因此并行会话永远不会编辑相同的文件。将它们用于您自己运行的会话。代理视图会自动将每个分派的会话移到自己的 worktree 中，您生成的子代理也可以各自获得一个。
* [`/batch`](/docs/zh-CN/commands) 是一个 [skill](/docs/zh-CN/skills)，它让 Claude 将一个大型更改分成 5 到 30 个 worktree 隔离的子代理，每个都打开一个拉取请求。它是子代理和 worktrees 的打包使用，不是一个单独的协调风格。

还有一些其他功能在没有您驱动每一步的情况下运行 Claude，但它们解决的问题与在代理之间分割工作不同：

* [后台 bash 命令](/docs/zh-CN/interactive-mode#background-bash-commands) 运行一个 shell 命令而不阻止对话。它不会生成代理。
* [分叉子代理](/docs/zh-CN/sub-agents#fork-the-current-conversation) 是一个继承您完整对话上下文而不是从头开始的子代理。它是生成子代理的一种方式，不是一个单独的界面。
* [routine](/docs/zh-CN/routines) 在 Anthropic 的云中按计划运行会话，而不是在您的机器上并行运行。

<Note>
  同时运行多个会话或子代理会增加令牌使用量。有关使用情况和速率限制详情，请参阅 [Costs](/docs/zh-CN/costs)。
</Note>

<h2 id="choose-an-approach">
  选择一种方法
</h2>

正确的方法取决于谁协调工作、工作人员是否需要通信以及他们是否编辑相同的文件：

* **谁协调工作？**
  * Claude 在一个对话中委派和收集结果：[子代理](/docs/zh-CN/sub-agents)
  * 您交付独立任务并稍后检查：[代理视图](/docs/zh-CN/agent-view)
  * Claude 计划、分配和监督一组工作人员：[代理团队](/docs/zh-CN/agent-teams)，实验性功能，默认禁用
  * 脚本而不是 Claude 的逐轮判断来保持协调：[动态工作流](/docs/zh-CN/workflows)。请参阅[工作流与子代理和 skills 的比较](/docs/zh-CN/workflows#when-to-use-a-workflow)
* **工作人员需要相互交谈吗？** 子代理将结果报告回生成它们的对话，代理视图会话仅向您报告。代理团队中的队友共享任务列表并直接相互发送消息。
* **任务是否接触相同的文件？** 使用 [worktrees](/docs/zh-CN/worktrees) 隔离工作。子代理和您自己运行的会话可以各自使用单独的 worktree。代理团队不会在 worktrees 中隔离队友，因此[分区工作](/docs/zh-CN/agent-teams#avoid-file-conflicts)，以便每个队友拥有不同的文件集。

<h2 id="check-on-running-work">
  检查运行中的工作
</h2>

检查运行中工作的命令取决于您使用的方法：

* 对于后台会话，`claude agents` 打开 [代理视图](/docs/zh-CN/agent-view)：一个屏幕显示每个会话、其状态以及哪些需要您的输入。
* 对于当前会话中的子代理，命名的后台子代理出现在 @-mention 类型提前中，显示其状态。从 v2.1.198 开始，`/agents` 不再打开面板；它打印一个通知，指向子代理文件位置。要 [创建和编辑自定义子代理](/docs/zh-CN/sub-agents#configure-subagents)，请询问 Claude 或直接编辑文件。尽管名称相似，`/agents` 与 `claude agents` 是分开的。
* 对于当前会话后台运行的任何内容，`/tasks` 列出每个项目，让您检查、附加到或停止它。该列表还包括已完成的子代理。
* 对于动态工作流，`/workflows` 列出运行和已完成的运行、每个运行所处的阶段以及有多少代理已完成。

有关所有会话的桌面视图，请参阅 [桌面应用中的并行会话](/docs/zh-CN/desktop#work-in-parallel-with-sessions)。

<h2 id="learn-more">
  了解更多
</h2>

下面的每个指南涵盖一种方法的设置和配置：

* [创建自定义子代理](/docs/zh-CN/sub-agents)：定义可重用的专家并控制他们可以使用的工具。
* [使用代理视图管理代理](/docs/zh-CN/agent-view)：分派会话、观察其状态，并在需要时附加。
* [编排代理团队](/docs/zh-CN/agent-teams)：设置主导者和队友、分配任务并审查他们的工作。
* [编排动态工作流](/docs/zh-CN/workflows)：运行捆绑的工作流或让 Claude 编写一个运行许多子代理并相互验证其发现的工作流。
* [使用 worktrees 运行并行会话](/docs/zh-CN/worktrees)：在隔离的检出中启动 Claude、控制复制的内容并在之后清理。
