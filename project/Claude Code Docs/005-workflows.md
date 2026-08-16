> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 使用动态工作流大规模编排子代理

> 动态工作流从 Claude 编写的脚本中编排许多子代理，您可以重新运行。用于代码库审计、大型迁移和交叉检查研究。

<Note>
  动态工作流需要 Claude Code v2.1.154 或更高版本，在所有付费计划上可用，具有 Anthropic API 访问权限，以及在 Amazon Bedrock、Google Cloud 的 Agent Platform 和 Microsoft Foundry 上可用。在 Pro 上，从 `/config` 中的"Dynamic workflows"行启用它们。
</Note>

动态工作流是一个 JavaScript 脚本，可大规模编排[子代理](/docs/zh-CN/sub-agents)。Claude 为您描述的任务编写脚本，运行时在后台执行它，同时您的会话保持响应。

当任务需要比一个对话能协调的更多代理时，或当您想将编排编纂为可以读取和重新运行的脚本时，请使用工作流。示例包括代码库范围的错误扫描、500 文件迁移、需要相互交叉检查来源的研究问题，以及在提交一个之前值得从多个独立角度起草的困难计划。

<h2 id="when-to-use-a-workflow">
  何时使用工作流
</h2>

[子代理](/docs/zh-CN/sub-agents)、[skills](/docs/zh-CN/skills)、[agent teams](/docs/zh-CN/agent-teams) 和工作流都可以运行多步骤任务。区别在于谁掌握计划：

|            | 子代理           | Skills        | Agent teams  | 工作流          |
| :--------- | :------------ | :------------ | :----------- | :----------- |
| 它是什么       | Claude 生成的工作者 | Claude 遵循的指令  | 监督对等会话的主导代理  | 运行时执行的脚本     |
| 谁决定接下来运行什么 | Claude，逐轮     | Claude，遵循提示   | 主导代理，逐轮      | 脚本           |
| 中间结果在哪里    | Claude 的上下文窗口 | Claude 的上下文窗口 | 共享任务列表       | 脚本变量         |
| 什么是可重复的    | 工作者定义         | 指令            | 团队定义         | 编排本身         |
| 规模         | 每轮几个委派任务      | 与子代理相同        | 少数几个长期运行的对等体 | 每次运行数十到数百个代理 |
| 中断         | 重启轮次          | 重启轮次          | 队友继续运行       | 在同一会话中可恢复    |

工作流将计划移入代码。使用子代理、skills 和 agent teams，Claude 是编排者：它逐轮决定接下来生成或分配什么，每个结果都进入上下文窗口。工作流脚本持有循环、分支和中间结果本身，所以 Claude 的上下文只持有最终答案。

将计划移入代码也让工作流应用可重复的质量模式，而不仅仅是运行更多代理：它可以让独立代理在报告之前对彼此的发现进行对抗性审查，或从多个角度起草计划并相互权衡，所以您获得比单次通过更可信的结果。

<h2 id="run-a-bundled-workflow">
  运行捆绑工作流
</h2>

查看工作流运行的最快方式是运行 `/deep-research`，这是 Claude Code 包含的[内置工作流](#bundled-workflows)，用于跨许多来源调查问题。您将看到代理在后台通过一组阶段工作，同时您的会话保持空闲，最后获得一份报告而不是逐轮记录。

<Steps>
  <Step title="运行工作流">
    使用您想要调查的问题运行 `/deep-research`。它在多个角度上扇出网络搜索，获取并交叉检查它找到的来源，并综合一份引用的报告。

    ```text theme={null}
    /deep-research What changed in the Node.js permission model between v20 and v22?
    ```
  </Step>

  <Step title="允许工作流">
    Claude Code 询问是否允许工作流。选择**是**继续。确切的提示取决于您的权限模式。有关每种模式的选项，请参阅[在运行前批准计划](#approve-the-plan-before-it-runs)。
  </Step>

  <Step title="观看进度">
    运行在后台启动。运行 `/workflows`，使用箭头键选择运行，然后按 Enter 打开其进度视图：

    ```text theme={null}
    /workflows
    ```

    该视图显示每个阶段及其代理计数、令牌总数和经过的时间。深入任何阶段以查看其代理及每个代理发现的内容。有关完整的控制集，请参阅[观看运行](#watch-the-run)。

    您也可以从输入框下方的任务面板观看：运行进行时会出现一行进度摘要。按向下箭头聚焦它，然后按 Enter 展开。
  </Step>

  <Step title="阅读报告">
    运行完成后，报告进入您的会话。它引用每个声明来自的来源，未通过交叉检查的声明已被过滤掉。

    从 v2.1.196 开始，当验证代理无法检查声明时（例如在速率限制或 API 错误之后），报告将该声明列为未验证，而不是计为被驳回。
  </Step>
</Steps>

要为您自己的任务运行工作流，[让 Claude 编写一个](#have-claude-write-a-workflow)，一旦运行完成您想要的操作，您可以[保存它](#save-the-workflow-for-reuse)作为您自己的命令。

<h3 id="bundled-workflows">
  捆绑工作流
</h3>

Claude Code 包含 `/deep-research` 作为内置工作流：

| 命令                          | 它做什么                                                                                                                                 |
| :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `/deep-research <question>` | 在多个角度上扇出网络搜索问题，获取并交叉检查它找到的来源，对每个声明投票，并返回一份引用的报告，其中未通过交叉检查的声明已被过滤掉。需要[WebSearch 工具](/docs/zh-CN/tools-reference#websearch-tool-behavior)可用 |

[您自己保存的工作流](#save-the-workflow-for-reuse)以相同方式成为命令，并在 `/` 自动完成中与捆绑的工作流一起出现。

<h3 id="watch-the-run">
  观看运行
</h3>

工作流在后台运行，所以会话在代理工作时保持响应。随时运行 `/workflows` 列出运行中和已完成的工作流，然后选择一个打开其进度视图。

```text theme={null}
/workflows
```

进度视图显示每个阶段及其代理计数、令牌总数和经过的时间。页脚列出每个操作的键：

| 键             | 操作                                                          |
| :------------ | :---------------------------------------------------------- |
| `↑` / `↓`     | 选择一个阶段或代理                                                   |
| `Enter` 或 `→` | 深入选定的阶段，然后进入代理以读取其提示、最近的工具调用和结果                             |
| `Esc` 或 `←`   | 返回一个级别。在 v2.1.203 至 v2.1.205 中，`←` 没有退出阶段或代理；在这些版本上使用 `Esc` |
| `j` / `k`     | 当代理详情溢出时在其中滚动                                               |
| `f`           | 按状态过滤选定阶段中的代理列表。再次按下以循环                                     |
| `p`           | 暂停或恢复运行                                                     |
| `x`           | 停止选定的代理，或当焦点在运行上时停止整个工作流                                    |
| `r`           | 重启选定的运行中代理                                                  |
| `s`           | [保存](#save-the-workflow-for-reuse)运行的脚本作为命令                 |

<h2 id="have-claude-write-a-workflow">
  让 Claude 编写工作流
</h2>

您可以通过两种方式让 Claude 为您的任务编写工作流：

* [在您的提示中请求工作流](#ask-for-a-workflow-in-your-prompt)，使用关键字 `ultracode`，Claude 为任务编写一个。
* [让 Claude 使用 ultracode 决定](#let-claude-decide-with-ultracode)：设置 `/effort ultracode`，Claude 为会话中的每个实质性任务规划工作流。

您也可以运行已存在的工作流命令：一个[捆绑工作流](#bundled-workflows)如 `/deep-research`，或一个您已[保存](#save-the-workflow-for-reuse)的。

<h3 id="ask-for-a-workflow-in-your-prompt">
  在您的提示中请求工作流
</h3>

要在不改变会话的努力级别的情况下将单个任务作为工作流运行，在您的提示中包含关键字 `ultracode`。用您自己的话提问，例如"使用工作流"或"运行工作流"，也可以工作：Claude 将直接请求视为相同的选择加入。在 v2.1.160 之前，字面触发关键字是 `workflow`；自然语言请求在两个版本中都有效。

```text theme={null}
ultracode: audit every API endpoint under src/routes/ for missing auth checks
```

Claude Code 在您的输入中突出显示该关键字，Claude 为任务编写工作流脚本，而不是逐轮处理它。如果您不打算启动工作流，在 macOS 上按 `Option+W` 或在 Windows 和 Linux 上按 `Alt+W` 来忽略此提示的突出显示，或在突出显示的关键字后面的光标处按退格键。要完全停止该关键字触发，请在 `/config` 中关闭 Ultracode 关键字触发。

如果运行完成了您想要的操作，您可以之后[将其保存为命令](#save-the-workflow-for-reuse)。

如果您已经用另一种方式构建了编排器，例如子代理提示的文件夹或一个分散工作的技能，您可以指向 Claude 并要求一个执行相同操作的工作流。

<h3 id="let-claude-decide-with-ultracode">
  让 Claude 使用 ultracode 决定
</h3>

Ultracode 是一个 Claude Code 设置，它结合了 `xhigh` [推理努力](/docs/zh-CN/model-config#adjust-effort-level)与自动工作流编排。启用它后，Claude 为每个实质性任务规划工作流，而不是等待您要求。

```text theme={null}
/effort ultracode
```

要启动已启用 ultracode 的会话，请使用 `claude --effort ultracode` 启动。需要 Claude Code v2.1.203 或更高版本。

启用 ultracode 后，Claude 决定任务何时值得工作流。单个请求可以变成一系列工作流：一个理解代码，一个进行更改，一个验证它。这适用于会话中的每个任务，所以每个请求使用更多令牌并花费比较低努力级别更长的时间。

Ultracode 持续当前会话，当您启动新会话时重置。当您返回日常工作时，使用 `/effort high` 下降。它在支持 `xhigh` [努力](/docs/zh-CN/model-config#adjust-effort-level)的模型上可用；在其他模型上，`/effort` 菜单不提供它。

<h3 id="approve-the-plan-before-it-runs">
  在运行前批准计划
</h3>

在 CLI 中，每次运行的提示显示计划的阶段和这些选项：

* **是，运行它**：启动运行
* **是，不再为 `<path>` 中的 `<name>` 询问**：启动，并从现在起跳过此项目中此工作流的此提示
* **查看原始脚本**：在决定前读取脚本
* **否**：取消

`Ctrl+G` 在您的编辑器中打开脚本。`Tab` 让您在运行启动前调整提示。

您是否看到此提示取决于您的[权限模式](/docs/zh-CN/permission-modes)：

| 权限模式                       | 何时提示您                                                  |
| :------------------------- | :----------------------------------------------------- |
| 默认，接受编辑                    | 每次运行，除非您已为此项目中的该工作流选择**是，不再询问**                        |
| 自动                         | 仅首次启动。任何**是**在您的用户设置中记录同意，之后启动无需提示。当 ultracode 启用时完全跳过 |
| 绕过权限，`claude -p`，Agent SDK | 从不。运行立即启动                                              |

在桌面应用中，批准卡显示工作流名称、阶段列表和令牌使用警告，带有**一次**、**总是**和**拒绝**操作。进度视图出现在"后台任务"侧窗格中。

您的权限模式仅控制上面的启动提示。工作流生成的子代理始终在 `acceptEdits` 模式下运行，并继承您的[工具允许列表](/docs/zh-CN/settings#permission-settings)，无论您的会话模式如何。文件编辑自动批准。

Shell 命令、网络获取和不在您的允许列表中的 MCP 工具仍然可以在运行中提示您。要在长时间运行中避免这种情况，在启动前将代理需要的命令添加到您的允许列表。

在 `claude -p` 和 Agent SDK 中没有人提示，所以工具调用遵循您配置的权限规则，无需交互式确认。

<h3 id="save-the-workflow-for-reuse">
  保存工作流以供重用
</h3>

当 Claude 为您将重复的任务编写工作流时，您可以将该运行的脚本保存为命令。像您在每个分支上运行的审查这样的过程然后每次运行相同的编排。

运行 `/workflows`，选择您想保留的运行，然后按 `s`。在保存对话中，Tab 在两个保存位置之间切换：

* `.claude/workflows/` 在您的项目中：与克隆仓库的每个人共享
* `~/.claude/workflows/` 在您的主目录中：在每个项目中可用，仅对您可见。如果您设置了 [`CLAUDE_CONFIG_DIR`](/docs/zh-CN/env-vars)，此位置是该路径下的 `workflows/` 目录。

保存对话显示个人位置的已解析路径。在 v2.1.208 之前，即使设置了 `CLAUDE_CONFIG_DIR`，它也显示 `~/.claude/workflows/`；文件仍然保存在配置的目录下。

按 Enter 保存。工作流在未来会话中从任一位置作为 `/<name>` 运行。

在具有多个 `.claude/` 目录的单体仓库中，您可以将工作流保存在它们适用的包旁边。截至 v2.1.178，保存到项目位置会写入您的工作目录和仓库根之间已存在的最近的 `.claude/workflows/` 目录，或如果尚不存在则写入仓库根。项目工作流也从该路径上的每个 `.claude/workflows/` 加载，当多个定义相同名称时 Claude Code 运行最接近工作目录的那个。

如果项目工作流和个人工作流共享名称，项目工作流运行。

<h3 id="pass-input-to-a-saved-workflow">
  将输入传递给保存的工作流
</h3>

保存的工作流可以通过 `args` 参数接受输入。脚本将其读取为名为 `args` 的全局变量。使用此功能在调用时提供研究问题、目标路径列表或配置对象，而不是为每次运行编辑脚本。

以下提示使用问题编号列表运行保存的工作流：

```text theme={null}
> Run /triage-issues on issues 1024, 1025, and 1030
```

Claude 将列表作为结构化数据传递，所以脚本可以直接在 `args` 上调用数组和对象方法，无需先解析它。如果省略 `args`，脚本内的全局变量为 `undefined`。

<h2 id="example-workflow-prompts">
  工作流提示示例
</h2>

工作流最适合当任务大于一个代理可以在上下文中容纳的情况，或当相同的步骤需要在许多项目中运行时。下面的提示显示常见的形状。每一个都要求 Claude 为该任务编写并运行工作流；您不自己编写脚本。

<h3 id="audit-many-files-for-the-same-issue">
  审计许多文件以查找相同问题
</h3>

扇出每个文件一个代理，然后收集并验证发现。

```text theme={null}
> use a workflow to audit every route handler under src/routes/ for missing authentication checks, and adversarially verify each finding before reporting it
```

<h3 id="keep-fixing-until-a-check-passes">
  保持修复直到检查通过
</h3>

运行检查器，修复失败的内容，然后重复直到通过或停止取得进展。

```text theme={null}
> use a workflow to run npx tsc --noEmit and keep fixing the reported errors until the type check passes or two rounds in a row make no progress
```

<h3 id="migrate-many-files-in-parallel">
  并行迁移许多文件
</h3>

发现要迁移的文件，在隔离的副本中转换每个文件，以便编辑不会冲突，并验证每个结果。

```text theme={null}
> use a workflow to migrate every component under src/components/ from styled-components to Tailwind, working on each file in its own isolated copy
```

<h3 id="review-every-changed-file-and-write-one-summary">
  审查每个更改的文件并写一份摘要
</h3>

为每个文件运行审查者，然后将所有发现交给一个代理，该代理对它们进行排名和去重。

```text theme={null}
> use a workflow to review every file changed in this PR for correctness issues, then merge the per-file findings into one ranked summary
```

<h3 id="research-a-topic-across-many-sources">
  跨许多来源研究一个主题
</h3>

在更改日志、问题和文档中扇出读者，然后综合。捆绑的 `/deep-research` 工作流执行此操作；您也可以描述一个更狭窄的版本。

```text theme={null}
> use a workflow to research how our three competitors handle rate limiting: read their public docs and recent changelog entries in parallel, then compare the approaches
```

<h3 id="find-issues-until-the-list-stops-growing">
  查找问题直到列表停止增长
</h3>

保持分轮搜索并在新轮次找不到任何新内容时停止。

```text theme={null}
> use a workflow to find flaky tests in this repo: run the suite repeatedly, record which tests fail intermittently, and stop once two rounds in a row find nothing new
```

<h3 id="what-the-saved-script-looks-like">
  保存的脚本看起来像什么
</h3>

当您[保存工作流](#save-the-workflow-for-reuse)时，`.claude/workflows/` 中的文件包含一个 `meta` 块，后跟编排子代理的脚本体。您通常不需要编辑它，但这是一个小的形状，所以您可以识别 Claude 生成的内容：

```javascript theme={null}
export const meta = {
  name: 'audit-routes',
  description: 'Audit every route handler for missing auth checks',
}

const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})

const audits = await pipeline(found.files, file =>
  agent(`Audit ${file} for missing authentication checks.`, { label: file }),
)

return audits.filter(Boolean)
```

主体是带有顶级 `await` 的纯 JavaScript。`agent()` 生成一个子代理，`pipeline()` 为列表中的每个项目运行一个。如果您想手动编辑脚本，要求 Claude 引导您完成更改，或查看 [Agent SDK 参考](/docs/zh-CN/agent-sdk/typescript)中的 Workflow 工具条目以获取完整的选项集。

<h2 id="how-a-workflow-runs">
  工作流如何运行
</h2>

工作流运行时在隔离环境中执行脚本，与您的对话分开。中间结果保留在脚本变量中，而不是进入 Claude 的上下文。

每次运行都会将其脚本写入您会话目录下 `~/.claude/projects/` 中的文件。运行开始时 Claude 会收到该路径，因此您可以要求它提供。您可以打开该文件来读取 Claude 编写的编排脚本，将其与之前运行的脚本进行对比，或编辑它并要求 Claude 从编辑后的版本重新启动。

运行时在运行进行时跟踪每个代理的结果，这是使运行在同一会话中[可恢复](#resume-after-a-pause)的原因。

<h3 id="behavior-and-limits">
  行为和限制
</h3>

运行时应用以下约束：

| 约束                           | 为什么                                      |
| :--------------------------- | :--------------------------------------- |
| 无中途用户输入                      | 仅代理权限提示可以暂停运行。对于阶段之间的签署，将每个阶段作为其自己的工作流运行 |
| 无来自工作流本身的直接文件系统或 shell 访问    | 代理读取、写入和运行命令。脚本协调代理                      |
| 最多 16 个并发代理，在 CPU 核心有限的机器上更少 | 限制本地资源使用                                 |
| 每次运行 1,000 个代理总数             | 防止失控循环                                   |

<h2 id="manage-runs">
  管理运行
</h2>

运行启动后，您可以从 `/workflows` 视图管理它，或通过展开输入框下方任务面板中的其进度行来管理。

<h3 id="resume-after-a-pause">
  暂停后恢复
</h3>

如果您停止运行，您可以恢复它：已完成的代理返回其缓存结果，其余的实时运行。从 `/workflows` 恢复暂停的运行，选择它并按 `p`，或要求 Claude 使用相同脚本重新启动工作流。

恢复在同一 Claude Code 会话中工作。如果您在工作流运行时退出 Claude Code，下一个会话将从头启动工作流。

<h3 id="cost">
  成本
</h3>

工作流生成许多代理，所以单次运行可以使用比在对话中处理相同任务更多的令牌。运行计入您的计划使用和速率限制，如任何其他会话。

要在提交大型任务前评估支出，请先在小范围上运行工作流：一个目录而不是整个仓库，或一个狭窄的问题而不是一个宽泛的问题。`/workflows` 视图显示每个代理的令牌使用情况，随着运行进行，您可以随时在那里停止运行而不会丢失已完成的工作。运行时的[代理上限](#behavior-and-limits)限制单次运行可以生成多少个代理，这限制了失控脚本的成本。要默认保持每次运行更小，在 `/config` 中[设置大小指南](#set-a-size-guideline)。

Claude Code 还会标记增长异常大的运行。当工作流调度超过 25 个代理，或其预计令牌总数超过 150 万时，输入框下方任务面板中的其进度行显示 `Large workflow` 警告。警告指向您可以停止运行的 [`/workflows`](#watch-the-run)。需要 Claude Code v2.1.203 或更高版本。

警告是建议性的：它不会暂停或限制运行。当您看到它时，两个设置会改变：

* 如果您[设置大小指南](#set-a-size-guideline)，指南的代理计数替换 25 个代理的阈值。
* 启用[ultracode](#let-claude-decide-with-ultracode)的会话不显示警告，因为打开 ultracode 已经让您选择加入大型运行。

工作流中的每个代理使用您的会话模型，除非脚本将阶段路由到不同的模型，或设置了 [`CLAUDE_CODE_SUBAGENT_MODEL`](/docs/zh-CN/model-config#environment-variables) 环境变量，该变量会覆盖两者。要控制模型成本：

* 在大型运行前检查 `/model`，如果您通常为日常工作切换到较小的模型
* 当您描述任务时，要求 Claude 为不需要最强模型的阶段使用较小的模型

<h3 id="set-a-size-guideline">
  设置大小指南
</h3>

`/config` 中的 Dynamic workflow size 设置使 Claude 编写的工作流默认保持在较小规模。Claude Code 将该设置作为建议发送给 Claude，所以调用不同规模的提示仍然会覆盖它。需要 Claude Code v2.1.202 或更高版本。

每个值设置 Claude 在其编写的脚本中针对的代理计数。

| 值              | 发送给 Claude 的指导 |
| :------------- | :------------- |
| `unrestricted` | 无指南。这是默认值。     |
| `small`        | 目标少于 5 个代理。    |
| `medium`       | 目标少于 15 个代理。   |
| `large`        | 目标少于 50 个代理。   |

更改在下一个提示时生效。[运行时代理上限](#behavior-and-limits)仍然适用，无论设置如何。

<h3 id="turn-workflows-off">
  关闭工作流
</h3>

工作流在 CLI、桌面应用、IDE 扩展、[非交互模式](/docs/zh-CN/headless)与 `claude -p` 和 [Agent SDK](/docs/zh-CN/agent-sdk/overview) 中可用。相同的禁用设置在每个表面上应用。

要为自己关闭工作流：

* 在 `/config` 中切换"Dynamic workflows"关闭。在会话中持续。
* 在 `~/.claude/settings.json` 中设置 `"disableWorkflows": true`。在会话中持续。
* 设置 `CLAUDE_CODE_DISABLE_WORKFLOWS=1`。在启动时读取，所以它在您设置它的任何地方应用。

要为整个组织关闭工作流，在[托管设置](/docs/zh-CN/server-managed-settings)中设置 `"disableWorkflows": true`，或使用[Claude Code 管理员设置](https://claude.ai/admin-settings/claude-code)页面上的切换。

当工作流被禁用时，捆绑工作流命令不可用，`ultracode` 关键字不再触发运行，`ultracode` 从 `/effort` 菜单中移除。

<h2 id="related-resources">
  相关资源
</h2>

* [并行运行代理](/docs/zh-CN/agents)：比较子代理、代理视图、代理团队和工作流
* [创建自定义子代理](/docs/zh-CN/sub-agents)：工作流编排的工作者原语
* [管理成本](/docs/zh-CN/costs)：多代理运行如何计入使用限制
