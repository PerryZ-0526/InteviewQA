# DeepSeek Harness 与 Claude Code 的区别

## 题目

DeepSeek Harness 和 Claude Code 有什么区别？

## 标签

[DeepSeek Harness](../../tags/DeepSeek Harness.md) | [Claude Code](../../tags/Claude Code.md) | [Agent](../../tags/Agent.md)

## 题目导航

← [001-DeepSeek Harness架构设计](001-DeepSeek Harness架构设计) | [003-详述dsh的PTC](003-详述dsh的PTC) →

## 面试直接答

> 两者的根本区别是产品形态：Claude Code 是绑定 Anthropic 模型的垂直整合闭源产品，把 harness 藏在固定扩展点后面；DeepSeek Harness 是 MIT 开源的元框架，把 agent loop 本身都做成可替换插件，模型、工具、沙箱、会话日志全部可重组；差异主线是架构开放性、扩展机制、权限模型与工程成熟度。

先从定位说起。Claude Code 的公式是「模型 + 产品化 harness」，用户拿到的是开箱即用的 coding agent，内部架构不开放，扩展通过官方设计的固定接口完成——hooks、MCP、subagents、skills 和 plugins。DeepSeek Harness 的公式是 Model + Harness = Agent，官方自己把它定位成组装 Agent 的框架而非产品，社区评价也是「更像开发框架而不是 Coding Agent 产品」。这意味着回答这道题时，Claude Code 侧讲的是可观察行为与官方文档，dsh 侧可以直接引用源码。

架构开放性是最实质的差异。Claude Code 的核心循环不可替换：你可以在 PreToolUse 钩子里拦截一次工具调用，可以通过 MCP 增加工具，可以定义子智能体，但 agent loop、上下文投影、权限裁决的实现是固定的，hooks 是「预置的窗」而不是「可以拆的墙」。dsh 建立在 Cordis 微内核上，agent loop 只是 ctx.agentLoop 上的一个服务，模型适配器只是 ctx.llm 上的注册，会话日志只是 ctx.sessions 的提供方——任何一条都可以被 patch 按 id 整体替换，配置分层（组合包、profile patch、home patch、--patch overlay）保证替换不侵入源码。同样是「扩展」，一个是受控扩展点，一个是架构级可替换性。

模型绑定程度也不同。Claude Code 作为 Anthropic 产品绑定 Claude 系列模型，官方体验围绕自家模型的推理与工具调用能力调优。dsh 把模型适配器做成插件，ctx.llm 上注册任意 provider 即可接入，官方 README 明确它不与任何模型绑定，DeepSeek 自己的模型也只是默认选项之一。

会话与轨迹的模型是第三处差异。Claude Code 用会话历史加 auto-compact 压缩，用 checkpoints 做文件系统快照支撑 /rewind 回退和 fork。dsh 用仅追加的 SessionEvent 日志作为单一事实源，「模型可见即已记录」的不变量保证一切进入模型请求的内容都能从日志重建，fork、恢复、转写、遥测、回放全部派生自同一条事件流。两者都解决「长任务状态可追溯」，但 dsh 把审计与回放做成了架构约束，Claude Code 把回退做成了文件快照的产品功能。

权限与安全模型差异明显。Claude Code 有内置权限系统：allow、deny、ask 三态规则，按工具、路径、命令匹配，sandbox 模式用 OS 级隔离（macOS Seatbelt、Linux Landlock）限制 Bash 与文件访问。dsh 把沙箱和审批也做成插件：fs 与进程提供方共享同一执行世界，指向远程沙箱后 Bash、PTY、LSP 一并搬走；审批策略挂在 tools/* 事件流水线上，是可编程的策略层。Claude Code 给你一个安全的默认，dsh 给你组装安全策略的零件——后者对使用者提出了更高的安全设计责任。

最后是成熟度与生态。Claude Code 是经过多年迭代的生产级产品，覆盖终端、桌面、IDE 与 Web，权限系统、检查点、并行子智能体都经过了真实工程考验。dsh 2026 年 8 月才发布开发者预览版，官方明确承诺未来有破坏性变更，插件生态刚起步，社区对第三方插件长期可维护性存在质疑。选型上，团队要开箱即用的生产工具选 Claude Code；要构建自己的 Agent 产品、需要替换核心行为或复用多产品能力栈，dsh 的插件化架构价值更大，但需要接受预览期风险和自建安全策略的成本。dsh 的 Code Mode 这类 token 优化创新值得关注，但架构优势不等同于当下任务完成率优势，最终还是要用真实任务基准说话。

## 详细解析

> 内容基于 2026-08-16 核验：dsh 侧引用 `deepseek-ai/deepseek-harness` 源码与官方文档；Claude Code 侧引用官方文档与工程博客的公开信息，不涉及未公开的内部实现。

### 一、逐项对比


| 维度    | Claude Code                                | DeepSeek Harness                   |
| ----- | ------------------------------------------ | ---------------------------------- |
| 产品形态  | 闭源垂直整合产品                                   | MIT 开源元框架（开发者预览）                   |
| 核心公式  | 模型 + 产品化 harness                           | Model + Harness = Agent            |
| 技术栈   | Node.js/TypeScript CLI                     | Node.js/TypeScript monorepo（pnpm）  |
| 模型绑定  | 绑定 Claude 系列                               | 模型无关，适配器即插件（ctx.llm）               |
| 核心循环  | 固定实现，不可替换                                  | agent loop 本身是插件，可 patch 替换        |
| 扩展机制  | hooks / MCP / subagents / skills / plugins | Cordis 插件 + 服务键 + 类型化事件 + patch 分层 |
| 会话状态  | 对话历史 + auto-compact + 文件 checkpoints       | 仅追加 SessionEvent 日志，模型可见即已记录       |
| 权限模型  | 内置 allow/deny/ask + OS 沙箱                  | 沙箱与审批均为插件（landlock-run、e2b 等后端）    |
| 回退/分叉 | /rewind、worktree、对话分叉                      | 日志派生 fork / 恢复 / 回放 / 遥测           |
| 并行机制  | subagents（隔离上下文）+ background tasks         | subagent 插件 + workflow + schedule  |
| 特色机制  | CLAUDE.md 项目记忆、hooks 拦截                    | agent preset 作用域链、Code Mode（PTC）   |
| 成熟度   | 生产级，多入口（终端/桌面/IDE/Web）                     | 2026-08 预览版，破坏性变更承诺                |


### 二、扩展模型的形式化对比
```text
Claude Code：固定 harness + 预置扩展点
  请求 → [固定循环] → 工具执行
           ↑  hooks 拦截（PreToolUse/PostToolUse/...）
           ↑  MCP 工具、subagents、skills、plugins
  结论：能插拔的是「能力」，不能替换的是「循环」

DeepSeek Harness：一切皆插件
  ctx.agentLoop / ctx.llm / ctx.tools / ctx.sessions / ctx.sandbox
  任何一个服务键的提供方都可以被 patch 按 id 整体替换
  结论：能插拔的是「能力」，也能替换「循环与基础设施」
```

### 三、同一需求的两种解法：拦截工具执行

Claude Code 用 hook 拦截（`.claude/settings.json`）：
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "python pre_bash_check.py" }
        ]
      }
    ]
  }
}
```

dsh 用 waterfall 事件监听（插件内注册，可短路）：
```ts
// 监听 tools/* 能力事件；策略监听器拥有决策权时可短路
ctx.on('tools/pre-execute', async (call, next) => {
  if (call.tool === 'bash' && !isAllowed(call.args)) {
    return { error: 'blocked by policy' };   // 短路：不调用 next()
  }
  return next();
});
```

表面都是「执行前拦截」，实质不同：Claude Code 的 hook 是官方预留的固定窗口，dsh 的事件是流水线本身的组成部分——审批策略、观察者、遥测可以来自任意插件，且策略插件可以整体替换。

### 四、面试追问

**追问一：既然 dsh 架构更开放，是不是说明它比 Claude Code 更先进？**

不是。开放性是设计目标的选择，不是质量的指标。Claude Code 的固定循环意味着 Anthropic 可以对上下文投影、工具执行、权限裁决做深度联合调优，hooks 和子智能体覆盖了绝大多数真实需求，产品成熟度带来的任务完成率优势是实打实的。dsh 的开放性换来的是复用与定制能力，但代价是调试面更大、安全责任转移给使用者、插件生态治理不确定。架构先进与否要看场景：做产品选成熟度，做平台选开放性。

**追问二：两者的「记忆」机制怎么比较？**

Claude Code 的记忆是分层静态输入：系统提示、CLAUDE.md 项目规则、skills、对话历史，加上 auto-compact 的压缩摘要，本质是「每次会话重新组装上下文」。dsh 的记忆是事件日志的派生：会话日志是唯一事实源，跨会话恢复靠回放日志，还有 spill（溢出到文件系统）与 compaction 插件。dsh 不预设「哪些内容该进上下文」的产品哲学，把这个决定暴露给插件；Claude Code 则用产品化规则管理。方向上 dsh 更可审计，Claude Code 更省心。

**追问三：dsh 的 Code Mode 解决了 Claude Code 的什么问题？**

传统工具循环里，模型每调一次工具就要一轮请求，中间结果全部回填上下文，token 消耗和延迟随工具调用次数线性增长。Code Mode 让模型写一段程序在宿主异步绑定上运行，中间数据留在运行环境，只有最终结果进入上下文——把多轮编排压缩成一次代码执行。Claude Code 侧对应的是子智能体隔离上下文与 background tasks 按需回传，思路不同：一个压缩「轮次内」的中间态，一个隔离「子任务」的中间态。两者都承认中间过程不该全额占用主上下文，dsh 的做法在 token 效率上更激进，但要求模型具备可靠的编程编排能力。

**追问四：如果团队要基于 dsh 构建自己的 Agent 产品，最需要补的是什么？**

三件事。安全策略：dsh 不替你决定什么操作该批准，需要自建审批插件和沙箱选型，这是从「用产品」到「做产品」最大的责任转移。稳定插件集：预览期有破坏性变更承诺，要锁定版本、维护自己的 patch 层，把升级成本算进工程预算。评测体系：架构开放性不直接等于任务成功率，必须建立真实任务基准对比默认配置与自研配置，否则容易陷入「改了很多插件但效果没提升」的困境。

### 五、参考

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness 架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md)
- [Claude Code 官方文档](https://code.claude.com/docs)
- [Anthropic 工程博客：How we built Claude Code](https://www.anthropic.com/engineering/building-claude-code)
- [Claude Code hooks 文档](https://code.claude.com/docs/en/hooks)
- [Claude Code IAM 权限文档](https://code.claude.com/docs/en/iam)


<!-- created: 2026-08-16 01:43:31 -->
<!-- updated: 2026-08-16 05:34:35 -->
