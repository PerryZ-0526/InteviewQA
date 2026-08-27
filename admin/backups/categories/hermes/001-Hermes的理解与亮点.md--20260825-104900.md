# ✅Hermes 的理解与亮点

## 题目

谈谈你对 Hermes 的理解，着重谈其区别于 Claude Code 的亮点。

## 标签

[Hermes](../../tags/Hermes.md) | [Agent](../../tags/Agent.md) | [Claude Code](../../tags/Claude Code.md)

## 题目导航

← 无 | [Hermes的自主技能创建与改进](Hermes的自主技能创建与改进) →

## 面试直接答

> `Hermes` Agent 是 Nous Research 的`开源自改进 agent`，核心竞争力不在工具循环而在`闭环学习`：`从经验沉淀技能`、使用中自我改进、跨会话记忆检索、用户画像建模，叠加单一 gateway 的多平台常驻与七种终端后端；
>
> 相对 Claude Code 的亮点是学习闭环、云端常驻与模型自由，短板是成熟度与内置权限体系。

### 先厘清一个概念边界

Hermes Agent 产品内置的学习能力，和 Nous Research 单独开源的 hermes-agent-self-evolution 项目是两件事：后者是用 DSPy 与 GEPA 做`反思式进化搜索`的研发项目，候选改进要经过<u style="text-decoration-color: rgb(230, 57, 70)">评测、约束门和人工 PR 审查</u>，是`「受约束的离线候选搜索」`，不是无监督的在线自我修改。谈 Hermes 的学习能力时守住这条边界，能避免把路线图能力说成已上线生产能力，这正是面试官常挖的点。

### 产品内置的学习闭环有四个组件

- 第一个是 <u style="text-decoration-color: rgb(230, 57, 70)">agent 策划的记忆</u>加<u style="text-decoration-color: rgb(230, 57, 70)">周期性 nudge</u>：agent 自己决定什么值得记，系统周期性提醒它沉淀知识，而不是被动等待用户整理。
  > `nudge` /nʌdʒ/ 就是“轻推、提醒一下”的意思。系统定期轻轻提醒 Agent：要不要检查一下最近有没有值得记住的东西？
- 第二个是`自主技能创建与改进`：<u style="text-decoration-color: rgb(230, 57, 70)">复杂任务完成后，agent 把过程提炼成技能文件，技能在使用中继续自我改进，</u>并兼容 agentskills.io 开放标准——这意味着技能资产可以跨工具迁移。
  > Hermes <u style="text-decoration-color: #e63946">把任务执行轨迹当作经验来源</u>，用周期性后台 Agent 将成功经验抽象成程序性 Skill；未来任务按需加载这些 Skill，并把新的纠正和实践结果再次反写进去，从而形成“`执行 → 反思 → Skill → 复用 → 修正”`的闭环。
- 第三个是 `FTS5 全文检索`加 LLM 摘要的跨会话回忆：<u style="text-decoration-color: #e63946">过去对话被全文索引，检索出的片段经模型摘要后注入当前会话</u>，解决「上周讨论过的结论今天怎么用」的问题。
- 第四个是 Honcho 辩证式用户建模：跨会话构建对用户的长期理解，让回复越来越贴合个人语境。
  > Hermes 持续把用户与 Agent 的双向交互同步给 Honcho；Honcho 以稳定的 User Peer 为中心积累跨会话消息、事实和用户表示，并<u style="text-decoration-color: #e63946">周期性通过 LLM 对这些证据进行多轮审视和综合</u>；Hermes 在每轮推理前再<u style="text-decoration-color: #e63946">根据当前问题检索相关的用户表示、画像卡片和辩证结论</u>，注入当前上下文。

这四件事组合起来，是 Claude Code 目前没有的东西——Claude Code 的记忆本质是 CLAUDE.md 这类静态项目规则加会话内压缩，不会主动创造技能、不会跨会话自我积累。

### 运行形态是第二个亮点

Claude Code 绑定开发者本机终端，会话随终端生命周期走。

Hermes <u style="text-decoration-color: #e63946">通过单一 gateway 进程常驻云端</u>，Telegram、Discord、Slack、WhatsApp、Signal 和 CLI 都是它的前端，<u style="text-decoration-color: #e63946">跨平台会话连续</u>；执行后端有七种，从本地、Docker、SSH 到 Modal、Daytona、Vercel Sandbox 这类 serverless 环境，agent 环境闲置时休眠、唤醒时恢复，跑在 5 美元 VPS 上也能工作。

配套的内置 cron 调度器让自然语言定时任务成为一等公民——日报、夜间备份、周报审计，无人值守运行。

> 这套形态回答的问题是「agent 能不能像人一样随时在线」，而 Claude Code 回答的是「agent 能不能把编码这件事做到极致」。

### 第三个亮点是模型自由

Claude Code 绑定 Claude 系列，Hermes 用 hermes model 一条命令在任意 provider 间切换——Nous Portal、OpenRouter、OpenAI、自建端点，Portal 聚合了 300 多个模型，连 web 搜索、图像生成、TTS、云浏览器这些工具网关也一并订阅化，省去收集五把 API key 的麻烦。对模型敏感型任务的团队，这个自由度的价值在于可以在同一个 agent 框架里横向评测不同模型，而不被单一厂商锁定。

### 第四个亮点是 Programmatic Tool Calling

Python 脚本通过 RPC 调用工具，把多步流水线折叠成一次执行，中间过程零上下文成本——这和 DeepSeek Harness 的 Code Mode、Claude Code 的子智能体隔离是<u style="text-decoration-color: #e63946">同一问题的三种解法</u>，Hermes 的做法对脚本能力强的用户特别自然。

> 源码入口主要在 `tools/code_execution_tool.py`
>
> 官方工具描述甚至直接提示模型：当预计有 **3 次以上工具调用，并且中间存在处理逻辑、循环、条件分支或批量过滤**时优先考虑 `execute_code`

此外它还是研究基础设施：批量轨迹生成与轨迹压缩，直接服务于下一代工具调用模型的训练数据管线。

### 短板同样要讲

<u style="text-decoration-color: #e63946">产品成熟度、生态规模与权限体系</u>不如 Claude Code：

- Claude Code 的 `allow/deny/ask` 加 `OS 沙箱`是`确定性安全默认`；
- Hermes 的安全边界主要靠执行后端隔离，工具级权限裁决不细；<u style="text-decoration-color: #e63946">学习闭环的长期记忆质量依赖检索与摘要的工程实现，做不好就是噪音注入</u>；多平台 gateway 常驻意味着要管理一个长期运行的服务。

---

总结来说：Claude Code 是把编码工作流做到极致的终端产品，Hermes 是把 agent 变成常驻个人助手的实验性探索——它的自进化叙事有真实机制支撑，但落地程度必须逐项核实，面试中把「机制存在」和「效果验证」分开表述，是理解 Hermes 的关键。

## 详细解析

> 内容基于 2026-08-16 核验的 NousResearch/Hermes-Agent 仓库 README 与官方文档。

### 一、学习闭环结构图
```text
                ┌──────────────────────────────┐
                │        学习闭环（内置）         │
                │                              │
 复杂任务 ──────→ 自主创建技能 ──→ 使用中自改进 ──┤
 对话经历 ──────→ 周期性 nudge ──→ 记忆沉淀      │
 历史会话 ──────→ FTS5 全文索引 ──→ LLM 摘要召回 ─┤
 交互数据 ──────→ Honcho 辩证建模 ──→ 用户画像   │
                └──────────────┬───────────────┘
                               ↓ 注入当前会话上下文
                ┌──────────────────────────────┐
                │   gateway 常驻进程             │
                │   Telegram/Discord/Slack/      │
                │   WhatsApp/Signal/CLI          │
                ├──────────────────────────────┤
                │   7 种终端后端                  │
                │   local/Docker/SSH/Singularity/│
                │   Modal/Daytona/Vercel Sandbox │
                └──────────────────────────────┘
```

### 二、与 Claude Code 逐项对比


| 维度     | Claude Code                            | Hermes Agent                             |
| ------ | -------------------------------------- | ---------------------------------------- |
| 开发者/许可 | Anthropic，闭源                           | Nous Research，MIT 开源                     |
| 技术栈    | Node.js/TypeScript                     | Python                                   |
| 记忆模型   | CLAUDE.md + skills + auto-compact，静态组装 | 技能自创/自改进 + nudge + FTS5 检索 + Honcho 用户建模 |
| 运行位置   | 本机终端会话                                 | 云端 gateway 常驻，多平台可达                      |
| 执行环境   | 本机 + OS 沙箱                             | 7 种后端（本地/Docker/SSH/serverless），休眠零成本    |
| 定时任务   | 无内置                                    | 内置 cron，自然语言设定                           |
| 模型绑定   | Claude 系列                              | 任意 provider，`hermes model` 切换            |
| 权限模型   | allow/deny/ask + Seatbelt/Landlock     | 依赖后端隔离，工具级裁决较弱                           |
| 折叠中间态  | 子智能体隔离 + background tasks              | Python RPC 脚本，零上下文成本轮次                   |
| 研究能力   | 无公开轨迹数据管线                              | 批量轨迹生成、轨迹压缩                              |


### 三、Python RPC 折叠示例（README 所述模式）
```python
# Hermes 允许 Python 脚本经 RPC 调用 agent 工具
# 多步流水线折叠为一次调用，中间结果不进模型上下文
result = rpc.call("read_file", path="config.json")
parsed = parse(result.content)
summary = summarize(parsed)
rpc.call("write_file", path="summary.md", content=summary)
```

对比三种「折叠中间态」的路线：Claude Code 用子智能体隔离上下文窗口，dsh 用 Code Mode 在宿主绑定上跑模型写的程序，Hermes 用用户（或模型）写的 Python 脚本经 RPC 调工具——共同点是中间过程不占主上下文，<u style="text-decoration-color: rgb(230, 57, 70)">差异在谁来写这段编排代码</u>。

### 四、面试追问

**追问一：Hermes 的学习闭环和 Claude Code 的 skills 有什么区别？**

Claude Code 的 skills 是<u style="text-decoration-color: rgb(230, 57, 70)">人工编写的静态资产</u>，加载时机由规则决定，内容不会在使用中变化。Hermes 的技能是 <u style="text-decoration-color: rgb(230, 57, 70)">agent 从自身经验中生成的，并且声称在使用中自我改进——技能从「输入」变成了「产出物」</u>。但要注意核实度：产品内置的自改进程度与 hermes-agent-self-evolution 项目的评测约束是两个层级，前者是产品行为，后者是有约束门和人工 PR 的搜索流水线，不能把后者的严谨性自动算到前者头上。

**追问二：nudge 机制为什么重要？**

长期记忆系统的核心难题不是存储而是触发——什么时候该写、写什么。固定规则（每 N 轮总结一次）要么打断工作要么错过时机。nudge 把沉淀动作变成`系统对 agent 的周期性提示`，<u style="text-decoration-color: rgb(230, 57, 70)">由 agent 判断当下是否有值得记的内容</u>，把「机械备份」变成「选择性归档」。代价是它依赖模型自身的判断力，判断失误就产生噪音记忆；所以工程上还需要`检索质量`、`去重`与`衰减机制`配套，nudge 不是记忆问题的全部答案。

**追问三：多平台 gateway 常驻的架构代价是什么？**

1. 运维负担：一个长期运行的进程需要<u style="text-decoration-color: rgb(230, 57, 70)">监控、升级与故障恢复</u>，这已经是服务运维而不是工具使用。
2. 安全面扩大：消息平台都是新的攻击面，Telegram bot token 泄露、群组身份冒用、平台侧的内容政策都成为风险，执行后端隔离不能解决消息层的认证与授权问题。
3. 状态一致性：多端并发操作同一任务时，需要排队与冲突处理。

> Claude Code 把这些复杂度留在终端会话里规避了，Hermes 则是主动承担换来的常驻能力。

**追问四：如果 Hermes 的自进化声称「越用越强」，如何验证这个说法？**

用分离数据集看增量：让同一 agent 在相同评测集上跑「未使用记忆」与「使用积累记忆」两个条件，比较成功率与成本；

记忆质量单独评估——检索注入的内容与任务的相关性、`技能库的重复率与腐化率`。

警惕两个陷阱：评测集污染（反复优化同一批任务）和主观感受偏差（回答风格更贴合个人不等于任务能力更强）。

> 自进化类声明必须落到「哪个指标、提升多少、在什么测试集上」，否则只是叙事。

### 五、参考

- [Hermes Agent 官方仓库](https://github.com/NousResearch/Hermes-Agent)
- [Hermes Agent 官方文档](https://hermes-agent.nousresearch.com/docs/)
- [hermes-agent-self-evolution 项目](https://github.com/NousResearch/hermes-agent-self-evolution)
- [Honcho 辩证式用户建模](https://github.com/plastic-labs/honcho)
- [agentskills.io 开放标准](https://agentskills.io)
- [Claude Code 官方文档](https://code.claude.com/docs)


## Hermes记忆提取的触发机制

> \*\*每累计 N 个用户 prompt → 触发一次 memory review，当前默认 N=10。\*\*源码里就是 `_turns_since_memory >= _memory_nudge_interval`。

触发之后不是直接“把最近 10 轮总结进 memory”，而是：
```text
10 个用户 prompt
        ↓
触发 memory nudge
        ↓
复制当前会话快照
        ↓
启动独立 background review agent
        ↓
让 LLM 判断：
这段会话里有没有值得长期保存的信息？
        ↓
有 → 调 memory tool 写 MEMORY.md / USER.md
无 → 什么都不写
```
<!-- created: 2026-08-16 01:43:31 -->
<!-- updated: 2026-08-25 09:57:26 -->
