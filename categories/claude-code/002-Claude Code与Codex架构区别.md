# Claude Code 与 Codex 的 Agent 架构区别

## 题目

Claude Code 和 Codex 在 Agent 架构、执行环境与使用方式上有什么区别？

## 标签

[Agent](../../tags/Agent.md) | [Claude Code](../../tags/Claude Code.md)

## 题目导航

← [001-Claude Code子智能体类型与vibe-coding场景](001-Claude Code子智能体类型与vibe-coding场景.md) | [003-Claude Code自定义子智能体与自主派生机制](003-Claude Code自定义子智能体与自主派生机制.md) →

## 面试直接答

Claude Code 和 Codex 都不是“只能聊天的代码补全工具”，而是能读取代码、调用终端、修改文件并验证结果的 coding agent。两者的底层私有推理实现没有完整公开，所以我不会把它们武断地归类为某一种内部算法；更可靠的比较方式是看公开的执行环境、上下文管理、委派能力和权限边界。

Claude Code 的公开工作流以终端中的主会话为核心，支持 Explore、Plan、general-purpose 和自定义子智能体，也支持继承当前会话的对话分叉与 Git worktree。Codex 当前同时覆盖桌面应用、CLI、IDE、远程/云端任务，支持 shell、Git、worktree、subagents、多 Agent、技能和 MCP 等能力。因此“Claude Code 是自主 Agent、Codex 只是 IDE 内单 Agent”的二分已经过时。

权限方面，两者都会把模型建议和真实执行分开。Codex 的关键边界是沙箱、工作区根目录、网络访问和审批策略；Claude Code 则通过权限模式、工具授权规则和审批控制操作。界面是否展示 diff 或工具状态，不等同于执行权限，也不能说产品公开了模型的原始思维链。

实际选型要看团队已有生态、执行位置、是否需要云端长任务、委派/并行方式、权限政策和集成成本，而不是依据未经公开验证的“ReAct 对 AST”内部架构标签。

## 详细解析

> 功能核验日期：2026-08-10。产品能力会快速变化，面试时应说明版本。

### 一、只比较可观察、可核验能力

公开资料无法证明 Claude Code 的内部循环必然是某种纯 ReAct，也无法证明 Codex 依赖某个“AST 语义索引”且因此更准确。两者都会综合模型、工具结果、项目规则和环境状态做决策；私有调度和模型实现不应被写成事实。

### 二、能力维度


| 维度   | Claude Code           | Codex                      |
| ---- | --------------------- | -------------------------- |
| 主要入口 | 终端/开发工作流              | 桌面应用、CLI、IDE、远程与云端         |
| 项目规则 | CLAUDE.md、skills 等    | AGENTS.md、skills、plugins 等 |
| 委派   | 内置/自定义 subagents、对话分叉 | subagents、多 Agent 与任务协作    |
| 隔离   | 独立上下文、worktree        | 独立任务/上下文、worktree、沙箱       |
| 工具扩展 | 工具、MCP、skills         | shell、MCP、skills、plugins 等 |
| 权限   | 权限模式、工具规则、审批          | sandbox、roots、网络和审批策略      |


表格只描述当前公开能力，不代表功能完全等价，也不对质量作无数据排名。

### 三、上下文与并行

Claude Code 的命名型子智能体通常不继承完整主对话，对话分叉则继承创建点的完整上下文。Codex 也能通过 subagents 或独立任务隔离上下文，并结合 worktree 并行处理文件修改。两者都需要主协调者明确任务边界、输出契约和验证方式；并行写同一文件或共享外部资源仍会冲突。

### 四、权限与可见性

工具活动、命令、diff 和状态摘要是可审计的执行痕迹，不等于原始 chain-of-thought。安全边界应依赖确定性权限系统，而不是模型“记得先问”。读操作、已授权命令和高风险写操作在不同模式下的审批行为不同，不能概括成“每次都问”或“从不问”。

### 五、选型

优先做一组真实任务基准，比较任务成功率、单位成功任务成本、P95 延迟、人工接管率、权限策略、并行冲突和团队集成成本。若团队深度依赖终端和 Claude Code 的项目规则，可优先沿用；若需要桌面、CLI、IDE、云端任务和插件化协作，可评估 Codex。结论应基于当前版本和团队工作流，而不是品牌或假设的底层架构。

### 六、官方资料

- Codex CLI：[https://learn.chatgpt.com/docs/codex/cli](https://learn.chatgpt.com/docs/codex/cli)
- Codex 开发者命令：[https://learn.chatgpt.com/docs/developer-commands?surface=cli](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- Claude Code Subagents：[https://code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)
- Claude Code Worktrees：[https://code.claude.com/docs/en/worktrees](https://code.claude.com/docs/en/worktrees)


### 七、可比较的架构层次

架构比较应拆成交互入口、任务生命周期、执行位置、工具扩展、上下文隔离、并行单元、文件隔离、权限审计和规则复用。界面更偏终端或桌面，不代表内部只有单一 Agent。私有检索与调度没有官方材料时，不能从 UI 反推为 ReAct、AST 引擎等确定事实。

### 八、上下文与任务生命周期

交互会话适合即时反馈，远程任务适合长时异步工作；两者都需要任务契约、预算、检查点和验证证据。上下文能力也不能只比窗口长度，还要看规则加载、历史压缩、文件按需读取、恢复状态和任务间污染。

### 九、权限评估方法

用具体场景测试工作区外读取、网络、依赖安装、密钥、危险命令和外部服务修改，观察默认边界、配置规则、审批粒度与审计。沙箱不自动隔离云账号，worktree 不隔离数据库；已批准的宽泛命令也可能扩大影响。

### 十、真实选型基准

统一仓库快照、验收器与预算，对局部修复、跨模块功能、陌生代码探索、长任务、并行修改和高风险变更重复运行。比较成功率、单位成功任务成本、P95、人工纠正、权限阻断和冲突恢复，并同时考虑规则资产、团队熟悉度、审计、数据政策和 CI 集成。

“更自主”只有在定义了任务范围、审批策略和人工介入后才可测量；工具轨迹、命令、diff 和验证证据构成可审计性，不需要声称产品展示原始思维链。

## 我的作答

(暂无作答记录)

<!-- created: 2026-08-04 16:36:00 -->
<!-- updated: 2026-08-11 10:30:28 -->
