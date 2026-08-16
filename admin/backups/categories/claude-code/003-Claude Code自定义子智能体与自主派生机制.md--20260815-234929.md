# ✅Claude Code 自定义子智能体与自主派生机制

## 题目

Claude Code 除了内置子智能体外支持自定义子智能体吗？如何自定义（用自然语言描述还是编写代码）？主智能体在执行任务时能否自主派生子智能体？

## 标签

[Claude Code](../../tags/Claude Code.md) | [Agent](../../tags/Agent.md) | [Multi-Agent](../../tags/Multi-Agent.md)

## 题目导航

← [002-Claude Code与Codex架构区别](002-Claude Code与Codex架构区别) | 无 →

## 面试直接答

> Claude Code 支持自定义子智能体，而且不需要编写代码：一个 Markdown 文件加少量 YAML 元数据就是全部定义，正文用自然语言书写系统提示词；
>
> 主智能体执行任务时无法现场注册新的子智能体类型，但可以用`固定枚举中的万能类型配合自包含提示词"当场派生"一次性执行实例`，或者现场写配置文件留待下次会话生效。

### 首先说自定义方式

自定义子智能体就是在项目根目录的 `.claude/agents/` 或用户目录 `~/.claude/agents/` 下放置一个 Markdown 文件：

- 文件头部是 YAML frontmatter
  - 其中 `name` 和 `description` 是必填字段；
  - `description` 决定主智能体在什么场景下自动委派给它；
  - `tools`、`model`、`permissionMode`、`maxTurns`、`effort` 等是可选的，用于限定工具白名单、指定运行模型和权限模式。
- frontmatter 之后的正文就是这个子智能体的系统提示词，用自然语言描述它的职责、工作方式和输出格式。

> 所以"写一个智能体"本质上是写提示词和写配置，不是写代码，工具能力全部来自内置工具集的白名单声明，没有任何可执行逻辑。

命令行层面还提供了 `--agents` 参数用 JSON 内联定义自定义智能体，以及 `--agent` 参数让当前会话直接以某个自定义智能体作为主角色运行。

### 其次说调用机制，有自动和显式两条路

自动委派依赖 description 的触发导向——主智能体会读取所有可用子智能体的描述，判断当前子任务与哪个匹配，然后自主决定派发，社区约定在描述中写 "Use PROACTIVELY" 之类的措辞来强化自动触发；

显式调用则可以直接说"用某个智能体做某事"、用 @ 提及，或启动时通过命令行指定。子智能体在独立的上下文中运行，拥有自己的系统提示词、工具集和模型，执行完毕后只把最终结果返回主会话，大量中间搜索和输出不会污染主上下文。

### 第三要区分自定义子智能体与 custom slash command

> 自定义斜杠命令 (Custom slash command)：你自己定义的命令，可以将常用的提示词封装成快捷方式。

两者虽然都是 Markdown 配置文件，但运行时语义完全不同：

- slash command 是在`主会话上下文中展开的提示词模板`，执行者还是主智能体本人；
- 子智能体则是独立的执行单元，有独立的上下文、工具权限和模型。

> 前者解决"把常用指令模板化"，后者解决"把职责和权限隔离出去"。

### 第四回答自主派生问题，这需要拆成"派生执行实例"和"派生新类型"两层

Agent 工具的 subagent\_type 是`会话启动时固化的枚举`，我在会话中不能凭空注册一个新的类型名，这一点做不到。但当场派生执行实例完全可以：使用 general-purpose 这类万能类型，写一段自包含的任务提示词——角色、边界、工具使用约定、返回格式——就等效于临时定义了一个子智能体，还能通过参数指定它的模型、让它后台运行、或者用 worktree 隔离它的文件改动。

它和持久化自定义智能体的差别只有三点：没有名字、不能硬限制工具集只能靠提示词约束、任务结束即消失。

此外我也有文件写入能力，真的可以在会话中现场写一个 `.claude/agents/` 配置文件把它固化下来，只是按当前版本的加载时机，它要在重启或新会话中才会成为可用的命名类型。

---

总结来说：自定义子智能体的门槛是配置而非代码，自然语言描述就是定义本身；主智能体的自主派生能力表现为`"临时角色用提示词现场委派、固定角色用配置文件固化复用"`，两者组合已经覆盖了任务执行中临时需要专业分工的绝大多数场景。

## 详细解析

> 功能核验日期：2026-08-14。核验方式：本机安装的 Claude Code CLI（`claude --help` 输出 + 二进制内嵌字符串）。产品能力迭代很快，面试时应说明核验版本。

### 一、定义方式：Markdown 配置文件，不是代码

**文件位置**：

- 项目级 `.claude/agents/`（随仓库走，团队共享）
- 用户级 `~/.claude/agents/`（个人全局生效）

本机 CLI 二进制中可提取到 `Personal (~/.claude/agents/)` 与 `.claude/agents/` 路径字符串，证实两级目录约定。

**文件结构**：YAML frontmatter + 自然语言正文。
```markdown
---
name: code-reviewer
description: 审查代码改动的质量、安全与可维护性。Use PROACTIVELY after editing code.
tools: Read, Grep, Bash
model: haiku
---
你是资深代码审查员。先用 git diff 查看改动，再按严重程度报告问题。
```

**字段 schema 的核验证据**（本机 CLI 二进制内嵌的校验错误信息）：

- 必填 `name`：二进制内嵌 `Cannot destructure property 'name' from null or undefined value`
- 必填 `description`：二进制内嵌 `is missing required 'description' in frontmatter`
- 可选 `model`：二进制内嵌 `Optional model override for this agent. Takes precedence over the agent definition's model frontmatter.`（即模型既可以在 frontmatter 里声明，也可以在派发时覆盖）
- 可选 `tools`：二进制内嵌 `Custom agents defined in` .claude/agents/ `may have their own tool restrictions.`
- 可选 `permissionMode`、`maxTurns`、`effort`、`background`、`memory`、`isolation`：二进制内嵌各自的 `has invalid xxx` 校验错误，说明这些字段均在 schema 中

**CLI 层面的定义入口**（`claude --help` 一手输出）：

- `--agent <agent>`：`Agent for the current session. Overrides the 'agent' setting.`——以某个自定义智能体作为当前会话的主角色
- `--agents <json>`：`JSON object defining custom agents (e.g. '{"reviewer": {"description": "Reviews code", "prompt": "You are a code reviewer"}}')`——内联 JSON 定义，无需文件

### 二、"自然语言还是代码"：答案是自然语言

正文即 system prompt，不含任何可执行逻辑；frontmatter 是结构化元数据。工具的"能力"来自内置工具集的白名单声明，不存在代码钩子。这是它与"插件/自定义工具"的关键差别——自定义智能体改变的是"谁用什么权限做什么事"，而不是"增加什么新能力"。


| 定义维度         | 载体                          | 性质            |
| ------------ | --------------------------- | ------------- |
| 职责、工作方式、输出格式 | 正文（自然语言）                    | system prompt |
| 身份与触发条件      | name / description          | 元数据           |
| 权限边界         | tools / permissionMode      | 白名单声明         |
| 运行配置         | model / maxTurns / effort 等 | 参数            |


### 三、调用与生效机制

- **自动委派**：主智能体读取全部可用子智能体的 description，按任务匹配度自主决定派发。description 写得越具体（触发场景、能力边界），自动委派越准确；模糊描述会导致误派发或永不派发。
- **显式调用**：按名字要求（"用 code-reviewer 检查改动"）、@ 提及、`claude --agent <name>` 作为主会话。
- **生效时机**：agent 定义在会话启动时加载。新建/修改 `.claude/agents/` 文件后，需要重启 Claude Code 或新会话才会作为命名类型出现在 Agent 工具的可用类型枚举中（此前查证结论，建议以官方文档为准）。
- **独立上下文**：子智能体不继承主会话对话历史，只接收委派说明；最终只回传结果。因此委派说明必须自包含：目标、边界、已知事实、返回格式。

### 四、与 slash command 的本质区别

两者都是 Markdown + frontmatter 文件，容易混淆，但运行时语义完全不同：


|      | slash command       | 自定义子智能体                           |
| ---- | ------------------- | --------------------------------- |
| 上下文  | 在主会话上下文展开           | 全新独立上下文                           |
| 执行者  | 主智能体本人              | 独立实例（独立 system prompt / 工具集 / 模型） |
| 目的   | 模板化常用指令             | 隔离职责与权限                           |
| 文件位置 | `.claude/commands/` | `.claude/agents/`                 |


一句话：slash command 是"换个方式说话"，子智能体是"换个人干活"。

### 五、主智能体能否"当场派生子智能体"

这个问题要拆成两层回答，混在一起回答会在面试中露怯。

**第一层：派生新类型——不能。** Agent 工具的 `subagent_type` 是会话启动时固化的枚举（本会话中为 claude、claude-code-guide、Explore、general-purpose、Plan、statusline-setup；配置了自定义 agent 的环境中会扩展出对应类型）。会话进行中无法动态注册新的类型名。

**第二层：派生执行实例——能，有两条路径：**

1. **临时委派（即用即弃）**：使用 catch-all 类型（general-purpose / claude，拥有全部工具）加一段自包含的提示词，这段提示词实质上就是临时 system prompt。Agent 工具参数还可以指定模型（sonnet / opus / haiku）、后台运行（run\_in\_background）、worktree 隔离（isolation）。与持久化自定义智能体的差距只有一个实质点：**没有 tools 白名单参数，只能靠提示词软约束**。
2. **现场固化**：用 Write 工具直接写 `.claude/agents/*.md` 文件。物理上可行，但按当前加载时机，新类型要重启或新会话才生效——所以它服务于"以后复用"，不服务于"当场使用"。


|      | 当场派生（临时）            | `.claude/agents/*.md`（持久） |
| ---- | ------------------- | ------------------------- |
| 定义方式 | Agent 工具的 prompt 参数 | Markdown 配置文件             |
| 工具限制 | 无法硬限制，靠提示词约束        | 可精确声明 tools 白名单           |
| 生命周期 | 任务结束即消失             | 跨会话保留                     |
| 生效时机 | 立即                  | 需重启 / 新会话                 |


**成本视角**：本机二进制内嵌提示 `Each spawn starts cold and re-derives context you already have`——每次派生都是冷启动，需要重建上下文。所以简单任务直接做更快；派生要付"任务描述成本 + 上下文重建成本"，只有在任务独立、输出量大、或需要隔离时才有净收益。

### 六、面试追问准备

- **为什么 tools 白名单比提示词约束更可靠？** 白名单是硬限制（工具调用被拒绝），提示词约束是软约束（模型可能不遵守）。最小权限原则下，权限边界应该落在机制上而不是落在语言上。
- **description 怎么写才有利于自动委派？** 写触发场景和拒绝边界，而不是人格描述。例如"Use PROACTIVELY after editing code"比"你是一个严谨的审查员"更能驱动自动派发。
- **自定义智能体与多 Agent 协作（teammates）的关系？** 本机二进制中有 `Custom agent type for this teammate` 字符串，说明自定义类型可以作为团队成员的代理类型使用——同一套角色定义可以在"被主智能体委派"和"作为团队成员协作"两种模式下复用。
- **主智能体派发时的输入契约？** 子智能体是独立上下文，不继承主会话的隐含决定，委派说明必须自包含：目标、非目标、允许读写范围、已知事实、验证命令、返回格式。

### 参考链接

- [Subagents - Claude Code Docs](https://code.claude.com/docs/en/sub-agents)（官方文档；撰写时本机网络策略拦截了该域名，核心结论以本机安装的 CLI 核验为准）
- [Slash commands - Claude Code Docs](https://code.claude.com/docs/en/slash-commands)（同上）
- 本机核验：`claude --help` 输出、claude.exe 二进制内嵌字符串（2026-08-14）


## 我的作答

(暂无作答记录)






<!-- created: 2026-08-14 03:35:18 -->
<!-- updated: 2026-08-15 23:26:29 -->
