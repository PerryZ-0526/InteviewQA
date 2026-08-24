# Hermes的自主技能创建与改进

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [Hermes的理解与亮点](Hermes的理解与亮点) | [Hermes 的 Honcho 辩证式用户建模](003-Hermes-的-Honcho-辩证式用户建模.md) →

## 面试直接答

Hermes 的“自主技能创建与改进”本质上不是模型参数自学习，而是把任务执行经验持续沉淀成可复用的 `SKILL.md`，再在后续任务中按需加载、验证和修正，形成“执行任务—后台复盘—生成/更新 Skill—再次复用—继续修正”的程序性记忆闭环。

从源码来看，Hermes 在任务执行过程中会累计工具调用迭代次数，达到一定阈值后触发 skill review。它不会直接让主 Agent 在当前上下文里做总结，而是启动一个隔离的后台 review agent，把当前会话快照交给它，并只开放 `skill_view`、`skills_list`、`skill_manage` 这类与技能管理相关的工具。这个后台 Agent 会判断刚才的任务中有没有具有长期复用价值的经验，例如一个复杂问题的稳定解决流程、某个容易踩坑的步骤，或者现有 Skill 中已经过时、不完整的部分。

如果已经存在相关 Skill，它优先通过 `patch` 或 `edit` 更新原有技能，而不是不断创建重复文件；如果没有相关 Skill，才创建新的 `SKILL.md`。这里还有一个比较重要的设计：Hermes 不鼓励“一次任务生成一个 Skill”，而是要求尽量抽象成某一类任务都能使用的 class-level Skill。比如一次 CUDA OOM 的排查，不应该保存成“修复某项目 OOM”，而应该抽象成“深度学习训练显存优化”这样的通用技能，把具体项目细节放到 reference 或 script 里。

Skill 落盘后，本质上就是带 YAML 元数据的 Markdown 文件，可以附带 `references`、`scripts`、`templates`。后续 Agent 不会把所有 Skill 全量塞进上下文，而是先只暴露名称和 description，模型判断相关后再通过 `skill_view` 加载完整内容，这是一种渐进式上下文加载。

所谓“使用中继续自我改进”，就是下一次执行同类任务时，如果 Agent 发现旧 Skill 的某一步已经失效、缺少边界条件，或者用户纠正了它，它可以直接修改这个 Skill。长期来看，Hermes 还通过 Curator 记录 Skill 的使用次数、修改次数和活跃度，对长期不用的技能做 stale 或 archive 管理，并可选地做技能合并。所以它真正的亮点不是“会生成 Skill”，而是把 Skill 当成一种可以由 Agent 自己创建、复用、修正和治理的长期程序性知识。其格式兼容 agentskills.io，意味着这些技能有跨 Agent 工具迁移的基础，但不能理解成完全无损迁移。

## 详细解析

> 根据当前 Hermes 源码，这个过程可以拆成两条路径：**前台 Agent 主动沉淀** + **后台 review 自动复盘**。真正体现“自主技能创建与改进”的主要是第二条。

### 1. 先判断“这次经历值不值得变成 Skill”

Hermes 的系统提示词里直接给主 Agent 注入了 `SKILLS_GUIDANCE`：

- 做完复杂/迭代任务；
- 解决棘手错误；
- 找到非平凡工作流；
- 使用已有 Skill 时发现其步骤错误、过时或缺失；

都应该考虑调用 `skill_manage` 保存或修改 Skill。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/agent/prompt_builder.py?utm_source=chatgpt.com "hermes-agent/agent/prompt_builder.py at main · NousResearch/hermes-agent · GitHub"))

这里原文的“5+ tool calls”更多是**给 LLM 的启发式规则**，不是一个严格的前台程序判断。真正可靠的自动触发在后台。

### 2. Hermes 有一个真正的自动 Skill nudge

源码维护：
```text
_iters_since_skill
```

每完成一次“工具调用迭代”就累加。默认：
```text
_skill_nudge_interval = 10
```

达到阈值后，在当前 turn 结束时：
```text
_iters_since_skill >= skill_nudge_interval
        ↓
_should_review_skills = True
        ↓
_iters_since_skill = 0
        ↓
_spawn_background_review(..., review_skills=True)
```

也就是说，**默认累计 10 次工具迭代后，自动触发一次技能复盘**，并不是“每个复杂任务结束都必然创建 Skill”。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/agent/turn_finalizer.py?utm_source=chatgpt.com "hermes-agent/agent/turn_finalizer.py at main · NousResearch/hermes-agent · GitHub"))

### 3. 它不会让主 Agent 自己继续复盘，而是 fork 一个后台 Agent

这里和 Claude Code 的 `memory_extract → forked subagent` 思路非常像：
```text
主 Agent
   │
   │ 会话快照
   ↓
Background Review Agent
   │
   ├─ skill_view
   ├─ skills_list
   ├─ skill_manage
   └─ memory
```

这个后台 Agent：

- 拿当前 conversation snapshot；
- 继承父 Agent 的模型/provider 等运行环境；
- 与主会话隔离；
- 不修改主对话；
- 工具在运行时被白名单限制，不能随便调用 terminal、web、send\_message 等。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py?utm_source=chatgpt.com "hermes-agent/agent/background_review.py at main · NousResearch/hermes-agent · GitHub"))

所以它本质上是一个**专门负责“经验反思 → 程序性知识沉淀”的子 Agent**。

### 4. Review Agent 不是简单“总结本次任务”

这是 Hermes 现在比较有意思的地方。

`_SKILL_REVIEW_PROMPT` 明确要求不要：
```text
一个任务 → 一个 Skill
一个 bug → 一个 Skill
一次经验 → 一个 Skill
```

而要求形成 **class-level skill**，也就是“任务类别级”的技能。

比如这次 Agent 做的是：
```text
发现 CUDA OOM
→ 调 batch size
→ 开 gradient checkpointing
→ 修改 DeepSpeed 配置
→ 最终训练成功
```

它不应该创建：
```text
fix-user-project-cuda-oom-20260821
```

而应该尝试沉淀到类似：
```text
llm-training-memory-optimization
```

里面写：
```text
When to Use
Procedure
Pitfalls
Verification
```

本次项目特有的细节则放到：
```text
references/
```

而不是污染通用 Skill。源码的 review prompt 明确强调这种“umbrella skill”结构。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py "hermes-agent/agent/background_review.py at main · NousResearch/hermes-agent · GitHub"))

### 5. 它具体怎么决定“创建还是更新”

后台 Review Agent 的优先级大致是：
```text
本次产生新经验
       ↓
有没有相关 Skill？
       │
   ┌───┴────┐
   有        没有
   ↓          ↓
patch       create
已有 Skill   新的类别级 Skill
   │
   ├─ 小修改 → patch
   ├─ 大调整 → edit
   └─ 案例/脚本 → write_file
```

`skill_manage` 提供的核心操作就是：

- `create`：创建新 Skill；
- `patch`：局部修改，优先使用；
- `edit`：整体重写；
- `write_file`：增加 references、templates、scripts；
- `delete/remove_file`：删除。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md?utm_source=chatgpt.com "hermes-agent/website/docs/user-guide/features/skills.md at main · NousResearch/hermes-agent · GitHub"))

因此所谓“Skill 自我改进”，实际上就是：

> **Agent 再次遇到同类任务 → 使用旧 Skill → 实践发现新问题 →** `skill_manage(patch)` **把新经验反写进 Skill。**

不是模型参数发生变化。

### 6. Skill 最终是什么东西

最终就是：
```text
~/.hermes/skills/
└── devops/
    └── deploy-k8s/
        ├── SKILL.md
        ├── references/
        ├── scripts/
        └── templates/
```

核心 `SKILL.md`：
```yaml
---
name: deploy-k8s
description: ...
version: 1.0.0
metadata:
  hermes:
    tags: [...]
---
```

下面再写：
```text
When to Use
Procedure
Pitfalls
Verification
```

所以 Hermes 的“学习”最终落盘的是**Markdown + YAML + 可选脚本/参考文件**，不是权重更新。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md?utm_source=chatgpt.com "hermes-agent/website/docs/user-guide/features/skills.md at main · NousResearch/hermes-agent · GitHub"))

### 7. 下次怎么重新利用这个 Skill

Hermes 不会把所有 Skill 全文塞进 system prompt。

而是采用渐进式加载：
```text
system prompt
   ↓
只放 Skill 名称 + description
   ↓
LLM 判断相关
   ↓
skill_view(name)
   ↓
加载完整 SKILL.md
   ↓
需要时再读 references/scripts
```

所以 Skill 数量增加后，不至于把所有内容都占满上下文。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md?utm_source=chatgpt.com "hermes-agent/website/docs/user-guide/features/skills.md at main · NousResearch/hermes-agent · GitHub"))

### 8. “使用中继续自我改进”具体发生在哪里

例如旧 Skill 写着：
```text
部署前运行 docker build
```

实际任务里发现：
```text
ARM64 下必须加 --platform linux/amd64
```

Agent 使用这个 Skill 后发现问题，系统 prompt 明确要求：

> Skill 如果过时、不完整或错误，不要等用户要求，直接 `patch`。

于是：
```text
skill_view("deploy")
       ↓
执行任务
       ↓
发现旧步骤不完整
       ↓
skill_manage(
    action="patch",
    old_string="docker build ...",
    new_string="..."
)
       ↓
永久更新 SKILL.md
```

这才是 Hermes 所谓的 **skill self-improvement loop**。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/agent/prompt_builder.py?utm_source=chatgpt.com "hermes-agent/agent/prompt_builder.py at main · NousResearch/hermes-agent · GitHub"))

还有一个很重要的细节：后台 review 创建的 Skill 会通过 provenance 标记成：
```text
created_by = "agent"
```

保存到 `.usage.json`，这样 Hermes 才知道这是“Agent 自己创造的资产”，以后可以交给 Curator 管理；用户手写或前台按用户要求创建的 Skill，不会自动被这样接管。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/skill_provenance.py?utm_source=chatgpt.com "hermes-agent/tools/skill_provenance.py at main · NousResearch/hermes-agent · GitHub"))

### 9. Curator 是再往上一层的“技能库治理”

随着 Agent 不断学习，会出现：
```text
skill-A
skill-A-v2
skill-A-debug
skill-B-fix
...
```

所以 Hermes 又加了 Curator，记录：
```text
view_count
use_count
patch_count
last_activity_at
state
```

长期不用：
```text
active → stale → archived
```

但不会自动永久删除。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/skill_usage.py?utm_source=chatgpt.com "hermes-agent/tools/skill_usage.py at main · NousResearch/hermes-agent · GitHub"))

这里有个当前源码的细节值得注意：**Curator 的 LLM consolidation 目前默认是关闭的**；默认主要做确定性的 stale/archive 管理。只有开启 `curator.consolidate` 后，才会让后台模型主动合并重叠 Skill、建立 umbrella Skill。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/agent/curator.py "hermes-agent/agent/curator.py at main · NousResearch/hermes-agent · GitHub"))

所以完整闭环实际上是：
```text
执行任务
   ↓
产生成功经验 / 用户纠正 / 新 workaround
   ↓
每 10 个 tool iteration 左右触发后台 review
   ↓
fork Background Review Agent
   ↓
判断经验是否具有复用价值
   ↓
已有 Skill ──→ patch / edit / 增加 reference
没有 Skill ──→ 创建 class-level SKILL.md
   ↓
~/.hermes/skills/
   ↓
以后遇到相关任务 → skill_view 按需加载
   ↓
实际使用发现新问题
   ↓
再次 patch
   ↓
usage telemetry
   ↓
Curator 做 stale / archive / 可选 consolidation
```

因此你文档里的那句话如果展开，本质就是：

> **Hermes 把任务执行轨迹当作经验来源，用周期性后台 Agent 将成功经验抽象成程序性 Skill；未来任务按需加载这些 Skill，并把新的纠正和实践结果再次反写进去，从而形成“执行 → 反思 → Skill → 复用 → 修正”的闭环。**

而所谓兼容 `agentskills.io`，主要是指 `SKILL.md` **的文件格式和组织规范兼容**，因此有较好的迁移基础；不能理解成“任何 Agent 平台拿过去一定可以完全无损运行”。([GitHub](https://github.com/NousResearch/hermes-agent/blob/main/tools/skills_tool.py?utm_source=chatgpt.com "hermes-agent/tools/skills_tool.py at main · NousResearch/hermes-agent · GitHub"))

<!-- created: 2026-08-21 18:41:50 -->
<!-- updated: 2026-08-21 18:45:48 -->
