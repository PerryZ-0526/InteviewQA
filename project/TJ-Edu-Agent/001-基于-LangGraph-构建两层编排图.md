# 基于 LangGraph 构建两层编排图

### 简历描述

> <span style="font-size: 12pt">基于 LangGraph 构建两层编排图：实时对话图集成 RAG 政策检索、学生画像、校内业务办理协助、资源推荐等，其中在线检索（导师推荐、期刊检索等）封装为 ReAct 子图，通过查询改写、补充检索与结果聚合完成多轮资源搜索；后台异步图驱动画像更新、资源推送、政策节点提醒及跨天 follow-up。</span>

## 一、一句话定位

用两张 `LangGraph 状态图`取代"一次 LLM 调用 + 若干 if/else"的脆性编排：**实时图**把一次学生对话拆成 12 个职责明确的节点，用"Plan-Validate-Execute + Reviewer-in-the-Loop"范式保证 LLM 的自由度被代码层安全边界约束；**后台图**把 Kafka 异步事件拆成 9 个节点的 DAG，完成从事件消费到通知下发的全自动推送闭环。两张图共享同一套 ToolRegistry 工具治理体系，但状态、预算、路由完全独立。

## 二、为什么是 LangGraph（范式选择）

### 2.1 候选方案对比


| 方案                                       | 问题                                                      |
| ---------------------------------------- | ------------------------------------------------------- |
| LangChain 链式调用（LLMChain/SequentialChain） | 流程固化，无法处理"执行到一半发现计划错了需要重来"；条件分支靠代码堆 if/else             |
| LangChain AgentExecutor（原生 ReAct）        | 黑盒循环，工具调用完全信任 LLM 输出；无法在执行前对整份计划做结构化审查；循环上限和中间态不可观测     |
| 手写状态机                                    | 可以做到同样的控制力，但要自己维护状态合并、条件路由、循环终止、trace 记录，等于重造 LangGraph |
| **LangGraph StateGraph（本项目）**            | 显式状态机 + 条件边 + 受控循环 + 节点级可观测，兼具 ReAct 的灵活性和代码层的硬约束       |


### 2.2 关键决策：Plan-Validate-Execute 而不是纯 ReAct

纯 ReAct（Thought→Action→Observation 逐轮）无法做到一件事：**在执行任何工具之前，对 LLM 的整份计划做跨步骤的结构化干预**。本项目的 plan\_validator 节点承担了这个职责——比如"意图是政策咨询，无论模型规划了什么，非只读工具全部删除，且必须保留一条 rag.query"。这种全局约束在逐轮 ReAct 里只能退化成 prompt 软约束，而这里是代码硬约束。plan 的定位是"**suspect-based**"：不信任模型生成的计划，先审查修正再允许执行。

### 2.3 为什么两张图而不是一张


|      | 实时对话图                   | 后台异步图                |
| ---- | ----------------------- | -------------------- |
| 触发源  | 前端 HTTP 请求（同步等待）        | Kafka 消费（异步不等待）      |
| 延迟要求 | 秒级返回                    | 分钟级可接受               |
| 失败处理 | reviewer 循环 + 人工确认      | 事件状态标记 failed + 审计落库 |
| 循环结构 | 有循环（reviewer→replanner） | 纯 DAG 无循环            |
| 状态字段 | 会话、意图、计划、步骤结果           | 事件、圈选结果、推送草稿、分发决策    |


两者唯一共享的是领域工具层（ToolRegistry），编排层零耦合。这保证改动后台推送逻辑不会影响实时对话，反之亦然。

---

## 三、实时对话图详解

### 3.1 图拓扑
```
input_guard → context_builder → intent_router → planner → plan_validator → executor → reviewer
                                                                                      │
                        ┌─────────────────────────────────────────────────────────────┤
                        ↓                ↓                 ↓                   ↓
                   replanner        human_gate     clarification_answer  answer_generator
                        ↓                ↓                 ↓                   ↓
                   plan_validator   answer_generator ─────────────────────────┘
                        （受控循环，max_replans=1）                       ↓
                                                                     state_writer → END
```

- **12 个节点**，每个节点是一个纯函数 `(RealtimeState) -> RealtimeState`（返回部分 dict）
- **1 条条件边**：reviewer 的四路路由（`route_after_review`）
- **1 个受控循环**：replanner → plan\_validator → executor → reviewer，用 `replan_count` 计数封顶
- 无 LangGraph 持久化依赖（checkpointer），单次 `invoke()` 同步完成，会话历史在数据库层管理

### 3.2 状态设计：TypedDict + 部分合并
```python
class RealtimeState(TypedDict, total=False):
    session_id: str          # 会话标识
    student_id: str          # 学生标识
    user_role: str           # student / advisor / admin
    user_message: str        # 原始用户消息
    intent_type: Optional[str]
    intent_analysis: Dict    # IntentAnalysis 的完整 dump
    current_plan: Optional[Dict]  # Plan 的完整 dump
    step_results: List       # 每步工具执行结果
    retrieved_evidence: List # 政策证据聚合
    pending_human_actions: List  # 待人工确认的高风险动作
    final_answer_payload: Dict
    final_status: str        # guarded/validated/completed/invalid/...
    context: Dict            # 画像、任务、工具清单、预算
    errors: List[str]
    replan_count: int        # 循环上限计数器
    execution_halted: bool
    side_effect_count: int
    tool_call_count: int     # 全局工具调用预算计数器
    ...
    # 以及 5 个 trace 字段（encoding/planner/executor/reviewer/local_react）+ timings
```

核心机制：**节点返回的 dict 由 LangGraph 浅合并进全局状态**。每个节点只写自己负责的字段（如 intent\_router 只返回 `intent_type` + `intent_analysis`），不感知其他字段的存在。节点间因此完全解耦，新增字段不影响已有节点。

选 TypedDict 而非 Pydantic 的原因：与 LangGraph 状态机兼容性最好、允许 `total=False` 表示节点间增量填充、避免每个节点返回完整对象的序列化开销。

### 3.3 节点职责（按执行顺序）

**① input\_guard —— 纯代码入口校验**

- 校验 session\_id / student\_id / user\_message 非空、user\_role 合法性
- 附带做编码诊断（`unicode_escape` 转义 + 疑似编码丢失启发式），把前端编码问题的排查成本从"线上追日志"降到"state 里直接看"

**② context\_builder —— 上下文组装（不调 LLM）**

- 读取学生画像快照、最近任务、最近 Case
- 注入工具清单（ToolRegistry 导出的 spec 列表，含 risk\_level、requires\_confirmation）
- 注入风险规则和**预算上限**（max\_steps / max\_tool\_calls 等），LLM 规划时能看到自己的预算

**③ intent\_router —— LLM 意图识别 + 代码层边界修正**

- 调用 qwen-turbo（流式优先，失败回退非流式），输出 `IntentAnalysis`：primary\_intent、required\_capabilities、confidence、missing\_slots、rationale
- **政策边界 guard（正则修正）**：用户消息命中"报销范围/资助标准/申请条件/截止时间"等政策边界词且无办理动作词时，强制把意图修正为政策咨询——防止"只问政策依据"被误判成"流程办理"而走错子链路。这是模型意图 + 规则兜底的混合设计，规则只做**保守修正**不做主判断

**④ planner —— LLM 生成结构化计划**

- 输入：intent\_analysis + 可用工具清单 + 画像上下文
- 输出 `Plan`：每个 step 包含 tool\_name、tool\_input、reason（为什么需要这步）、expected\_output、expected\_observation、fallback\_action、risk\_level、requires\_confirmation
- **降级路径**：LLM 不可用 / 输出不合法 → `_fallback_plan` 按 intent\_type + required\_capabilities 做确定性映射（政策咨询→rag.query 等），保证模型挂了系统仍可执行

**⑤ plan\_validator —— 编排链路的安全关卡（纯代码，不调 LLM）**

这是整个设计里最核心的节点。五重校验：

1. **工具存在性**：每个 tool\_name 必须在 ToolRegistry 中
2. **参数合法性**：tool\_input 过 Pydantic schema 校验（ToolRegistry.validate\_step）
3. **角色权限**：user\_role 是否在该工具 allowed\_roles 内
4. **预算校验**：steps 数量 ≤ max\_steps
5. **意图级强制干预**（跨步骤的全局约束，ReAct 做不到的部分）：

- `政策咨询` → 白名单裁剪为 {profile.read, rag.query, policy.retrieve}，删除其余全部步骤，且**强制注入 rag.query**（若缺失）——政策问答不能绕过证据检索
- 需要 `workflow_context` 能力 → 强制注入 kg.query\_workflow 步骤
- 高风险工具（case.create / task.create 等）→ 标记 requires\_confirmation=True，plan 整体标记 whether\_need\_human=True

**⑥ executor —— 受控执行 + Local ReAct**

- 严格按 plan 步骤顺序执行，每步走 ToolRegistry.call（内部再做一次 validate\_step，双保险）
- **预算控制**：总调用 ≤ max\_tool\_calls(8)；副作用工具成功调用 ≤ max\_side\_effect\_tools(1)；超限即 halt
- **高风险挂起**：requires\_confirmation 的步骤不执行，推入 pending\_human\_actions，整个执行暂停（execution\_halted=True），等前端人工确认
- **证据聚合**：rag.query / policy.retrieve 的结果自动抽入 retrieved\_evidence，供 reviewer 验收
- **Local ReAct（详见 3.5）**：每个只读工具步骤完成后做局部补救判断

**⑦ reviewer —— 确定性验收 + 模型降级审查**

- **先做确定性验收**（纯代码）：检查三类硬缺口——policy\_evidence 能力要求但无证据、workflow\_context 能力要求但无流程结果、recommendation 能力要求但无资源候选；再检查 failed\_steps、missing\_slots、pending\_human\_actions
- 判定优先级：有错误→need\_clarification；missing\_slots→need\_clarification；有 pending\_human\_actions→need\_human；有失败步骤且重规划预算未耗尽→need\_replan；能力缺口且预算未耗尽→need\_replan；否则 completed / failed
- **模型审查只允许单向降级**：`_try_model_review` 的结果只有当确定性验收是 completed 且模型给出更保守状态时才被采纳。模型永远不能把"确定性判定失败"的 case 升级为完成——这保证了安全底线不依赖 LLM
- evidence\_score 粗粒度验收分：政策证据 0.45 + 流程上下文 0.3 + 推荐资源 0.2，封顶 1.0

**⑧ 四个出口分支**

- **replanner**：删除失败步骤，按 recommended\_capabilities 追加补齐步骤（policy.retrieve / kg.query\_workflow / recommendation.generate），回到 plan\_validator。replan\_count 封顶（默认 1 次）——够用即可，避免无限循环烧 token
- **human\_gate**：高风险动作已挂起，answer\_generator 生成"等待确认"的回答；用户在前端确认后，经 `confirm_human_actions()` 走 ToolRegistry.call（context 带 confirmed=True）真正执行，并写审计日志
- **clarification\_answer**：生成澄清问题
- **answer\_generator**：基于 step\_results + retrieved\_evidence 生成带引用的最终回答

**⑨ state\_writer —— 收尾**

- 写会话摘要（session\_summary）和审计日志（realtime\_graph.completed，含 intent\_type / final\_status / active\_case\_id）

### 3.4 工具治理：ToolRegistry（自建，不用 LangChain Tool）
```
ToolSpec {
    name, description,          # 给 planner 看的能力描述
    input_schema: Pydantic,     # 参数强校验
    side_effect: bool,          # 是否产生副作用
    idempotent: bool,           # 幂等性标记
    risk_level: low/medium/high,
    allowed_roles: [student, advisor, admin, background],
    requires_confirmation: bool,
    handler,                    # 实际执行函数
}
```

调用链上的**五重校验**（validate\_step）：工具存在 → 全局 allowlist/blocklist → 角色权限矩阵 → Pydantic 参数校验 →（执行前 executor 还叠加预算和人工门控）。任何异常被折叠成 `ToolCallResult(success=False, error=...)` 交给 reviewer 判断，而不是抛出去中断图。

角色权限矩阵（AgentRuntimeConfig.role\_permissions）：

- student：可读画像、查政策、查流程、建 Case/任务（但要人工确认）
- advisor：可读 + 通知草稿（不能发）
- admin：全量（含 profile.update、notification.send）
- background：后台图专用权限

**为什么不用 LangChain 原生 Tool**：原生 Tool 的 schema 校验和执行耦合在模型调用协议里，难以在"模型规划→代码校验→执行"三段之间插入独立的安全层，也不方便携带 side\_effect / risk\_level / requires\_confirmation 这类治理元数据。

### 3.5 Local ReAct：executor 内的受限补救循环

简历里"ReAct 子图"在实时图侧的落点。设计动机：**外层 replan 循环太重（要重新过 planner+validator），局部"这步结果不够，补一步别的"不该上升到全局**。

三层决策，按成本从低到高：

1. **确定性 gate（不调 LLM）**：当前步骤结果是否有效？后续 plan 是否还覆盖缺失能力？已有 observation 是否已满足 required\_capabilities？三种情况直接 stop——大部分请求在这里就结束了，零额外 LLM 成本
2. **确定性 fallback 决策**：gate 判定有缺口时，先查规则映射能不能直接给出补救工具
3. **LLM 决策（最后手段）**：只有规则无法覆盖时才调 LOCAL\_REACT\_EXECUTOR prompt 让模型决定 next\_tool + tool\_input

执行约束（安全边界）：

- 只能调用**只读工具白名单**（profile.read / rag.query / policy.retrieve / kg.query\_workflow / kg.reason / recommendation.generate）
- 已成功执行过的工具类型不重复调用（防循环）
- 轮次 ≤ max\_local\_react\_rounds(2)，且与主计划共享全局 tool\_call\_count 预算
- 所有决策、阻塞原因、耗时写进 local\_react\_trace（可观测）

### 3.6 流式路径

`RealtimeGraphService.prepare()` 支持只运行前五节点（input\_guard → plan\_validator）拿到 plan，流式策略可复用；`complete()` 统一回写会话摘要和审计，保证同步/流式两条路径行为一致。

---

## 四、在线资源检索："ReAct 子图"的完整技术链路

简历这句"查询改写、补充检索与结果聚合"对应三层实现，面试时需要讲清每层落点：

### 4.1 多轮循环：Local ReAct（executor 内嵌，见 3.5）

资源检索作为只读工具步骤（recommendation.generate）执行后，Local ReAct gate 检查"是否拿到了可解释的资源候选"——结果为空或只有 warnings 时触发补救轮次，可再调一次 recommendation.generate（换参数）或其他只读工具，最多 2 轮。这就是"多轮资源搜索"的循环骨架。

### 4.2 查询改写：KnowledgeGraphTool 内

- **资源类型归一化**：别名映射（"导师/实验室/课题组"→advisor\_team，"会议"→conference）+ 从 query 文本中提取信号词自动补类型
- **区域归一化**：国内/海外/校内 → CN/global/campus，与 query 关键词双向推断
- **学术关键词扩展**：中英映射表（"大模型"→\["large language model","foundation model","LLM"\]），解决中文方向词在英文学术库检索不到的问题
- **国内导师定向检索词构造**（4 条变体，本质是 query rewriting）：
  - `site:edu.cn {学校} {方向} (教师主页 OR 个人主页 OR 教授) -报告 -通知 -招生`
  - `inurl:szdw`（师资队伍页）、`inurl:teacher OR inurl:faculty`、`课题组 实验室 团队 -讲座 -新闻`
  - 负向词过滤掉年度报告/招生简章/新闻动态类噪声

### 4.3 补充检索：多 Provider 扇出与降级链


| 检索目标     | 数据源                                            | 降级/补充策略                               |
| -------- | ---------------------------------------------- | ------------------------------------- |
| 学术论文     | OpenAlex → Semantic Scholar → Crossref → arXiv | **链式补量**：前一 provider 不足 limit 时用下一个补齐 |
| 国内导师/团队  | SerpApi（百度，4 条定向 query）                        | 缺 API key 时返回明确 warning，不生成占位假数据      |
| 海外导师/实验室 | Exa → Tavily → SerpApi（按环境变量优先级）               | provider 级降级                          |
| 学术会议 CFP | 同上，query 注入当年年份                                | —                                     |
| 校内资源     | 本地 mock 数据 + 画像标签匹配打分                          | —                                     |
| 网页正文抽取   | Firecrawl（命中 URL 后补抽取正文，失败保留搜索摘要）              | 失败不阻塞主流程                              |


### 4.4 结果聚合：打分、过滤、去重、置信度

- **负向信号过滤**：标题/URL 命中"年度报告、招生简章、公示、新闻、.pdf、/upload、/news"等模式直接 0 分丢弃
- **正向信号打分**：导师身份词、个人主页/师资页/团队页词、URL 路径模式（/faculty|/teacher|/szdw|/lab/）、.edu.cn 域名、方向词命中，逐项加分
- **硬门槛**：必须同时具备"导师页信号 + 方向匹配信号"才可入选——防止"搜到相关方向的新闻"混入推荐
- **URL 去重** + 统一资源 DTO（title/url/reason/evidence/confidence/tags）+ 按 confidence 排序截断
- **confidence 计算**：0.55 + score × 0.04，封顶 0.9——设计上刻意不封顶到 1.0，因为网页检索结果仍需人工核验（这个细节面试时讲出来很加分）

### 4.5 架构表述与实现落点（设计演进视角）

简历表述"封装为 ReAct 子图"是**架构层的描述**：在线检索在系统设计中就是一个有独立状态、有界循环、可单独测试的检索单元——查询改写 → 多路补充检索 → 结果聚合 → 判断是否继续下一轮。这套机制的全部能力（多轮、改写、补检、聚合）在系统里都是真实运行的功能。

当前代码的实际落点有两处：多轮循环逻辑在实时图 executor 节点的 Local ReAct 机制内，多 Provider 扇出与聚合在 KnowledgeGraphTool 内部。**这个落点本身就是一条已知的设计债**，原因是：

1. **职责耦合**：executor 的 Local ReAct 同时承担"能力缺口补救"（如证据不足补一次检索）和"资源搜索多轮迭代"两类语义不同的循环，两者的终止条件、预算、只读白名单本应独立管理
2. **可测试性差**：检索循环无法脱离整张实时图单独 invoke，单元测试必须 mock 整个 executor 上下文
3. **状态不可见**：检索轮次、每轮 query 改写、聚合中间态都塞在 local\_react\_trace 里，没有独立的状态结构

**演进方向（面试时可主动提出）**：将在线检索编译为独立的 LangGraph 子图（`search_loop` 子图：改写节点 → 多路检索节点 → 聚合评审节点 → 条件边决定继续/收敛），挂载为实时图 executor 中的一个复合工具节点。这样检索循环有自己的状态 schema、独立预算、可单独测试，同时外层图拓扑不变——这正是"子图"一词对应的目标形态。

**面试应对策略**：

- **设计层追问**（"这个子图怎么设计的？"）→ 直接讲 4.1\~4.4 的机制，因为机制与代码一致，是真实能力
- **代码层追问**（"子图代码在哪？"）→ 回答"循环当前在 executor 的 Local ReAct 内嵌实现，我后续复盘时把它识别为设计债，规划演进为独立编译的子图"，然后展开 4.5 的三点理由。主动暴露设计债并给出演进方案，是比"代码完全对得上"更强的信号——说明你有架构复盘能力

---

## 五、后台异步图详解

### 5.1 事件驱动链路
```
前端 debug 页 / scheduler → POST /api/admin/events/mock
  → 写 event_logs（status: publishing → published）
  → Kafka topic（resource.published / policy.deadline.reminder / followup.scan.trigger / profile.update.request）
  → worker 进程消费 → event_logs.status = consumed
  → BackgroundEventHandler.handle() → background_graph.invoke(state)
  → 写 notification_jobs → event_logs.status = completed
```

关键设计：**API 只发布事件，不同步执行后台图**。发布接口毫秒级返回，圈选/生成/分发全部在 worker 进程完成——同步链路永远不被推送逻辑拖慢。

### 5.2 图拓扑（纯 DAG，无循环）
```
event_guard → event_router ──┬─(profile.update.request)→ profile_update ──────────┐
                             ├─(resource.published 等) → event_interpreter        │
                             │        → audience_planner → content_planner         │
                             │        → dispatch_validator → notification_writer   │
                             └─(followup.scan.trigger) → followup ────────────────┤
                                                                                   ↓
                                                                              audit_writer → END
```

9 个节点，`event_router` 的条件边做三路分流，所有分支最终汇聚到 audit\_writer 统一收口（写事件状态 + 审计日志）。

### 5.3 节点职责与治理要点

- **event\_guard**：校验 event\_type 非空，无 event\_id 时补建 event\_log
- **event\_router**：纯事件类型路由（profile\_update / proactive\_push / followup），未识别类型保守归入 proactive\_push
- **profile\_update**：按 payload 目标学生列表更新画像快照
- **event\_interpreter**：把事件解释为结构化策略（event\_kind、urgency、action\_policy=send\_after\_validation）——LLM 增强可接在这里，但输出必须是结构化字段，模型不能直接决定"发不发"
- **audience\_planner**：圈选目标学生。**三层优先级**：显式指定名单（精确调试/回归测试用，跳过模型）→ 无名单时 LLM 圈选（AudienceSelectorTool，只给候选）→ 代码层标签匹配兜底（profile 标签 ∩ 事件 target\_tags，score=0 且模型未选中的直接过滤）。LLM 的圈选结果**永远要过标签兜底过滤**——这是"模型建议、代码裁决"的又一实例
- **content\_planner**：逐学生生成推送草稿（含匹配原因、score、selector），**只生成草稿不落库**——内容生成和发送治理分离，模型无法绕过校验直接发送
- **dispatch\_validator**：发送前代码级收口。决策三态：send / draft\_only / rejected；缺 student\_id 或 title 直接 rejected；生成去重键 `event_type:title:student_id`
- **notification\_writer**：只有 decision=send 的草稿才走 create\_or\_dedupe 创建通知——**Redis 去重键 + 数据库唯一约束双重去重**，重复事件不会无限新增消息
- **followup\_flow**：扫库查临近截止的 pending/in\_progress 任务（`scan_due_tasks`），逐任务生成提醒（dedupe 键含任务 ID + 截止日期，同一天不重复提醒）
- **audit\_writer**：更新 event 状态为 completed 并写审计日志

### 5.4 事件状态机与可观测性
```
publishing → published → consumed → completed / failed
```

failed 时 event\_log 里落完整 traceback，审计日志记录整条链路的 ranking\_result / content\_plan / dispatch\_decisions——排障时不用重新消费 Kafka，直接查库就能还原"这条推送为什么发给/没发给这个学生"。

---

## 六、降级设计（面试高频追问点）

整个编排体系遵循一个原则：**安全底线不依赖 LLM，功能可用性也不依赖 LLM**。


| 环节          | LLM 正常           | LLM 不可用                                                 |
| ----------- | ---------------- | ------------------------------------------------------- |
| 意图识别        | qwen-turbo 结构化输出 | 保守回退"未知意图"（clarification 能力）                            |
| 计划生成        | 模型 planner       | 确定性 fallback plan（intent→工具映射）                          |
| Local ReAct | 模型决策             | 确定性 gate + 规则 fallback（大部分 case 已覆盖）                    |
| reviewer    | 模型补充审查           | 纯确定性验收（证据缺口/失败步骤/预算判断全是代码）                              |
| 政策问答        | 真实 RAG 链         | RagPolicyTool 降级答案（明确声明"服务不可用，以学校最新通知为准"，degraded=True） |


**单向信任原则**：模型在三个位置参与（意图、规划、审查），但每个位置的输出都必须经过代码校验层才能生效；模型审查只能把"确定性 completed"降级为更保守状态，永远不能反向升级。

---

## 七、高频面试问答

**Q1：为什么用 LangGraph 而不是 LangChain 的 AgentExecutor？**
AgentExecutor 的 ReAct 循环是黑盒：工具调用完全信任模型、循环上限和中间状态不可观测、无法在执行前审查整份计划。我需要三件事：执行前的跨步骤计划审查（plan\_validator）、可观测的状态流转（TypedDict + trace 字段）、受控循环（replanner 有独立预算）。LangGraph 的 StateGraph 恰好提供了这三件事，而且节点是纯函数，单测容易写。

**Q2：Plan-and-Execute 会不会过度设计？大部分请求 plan 都很简单。**
简单请求的 plan 确实只有 1-2 步，但 plan\_validator 的价值不在 plan 的复杂度，而在于它是唯一能在任何工具执行前做跨步骤强制干预的位置。比如"政策咨询意图必须保有一条 rag.query"这个约束，纯 ReAct 只能靠 prompt 软约束，而这里是代码硬删硬加。plan 本质是安全审查的攻击面。

**Q3：如何防止 LLM 乱调工具或绕过权限？**
五层防线：① planner 只能看到工具清单（无 handler）② plan\_validator 五重校验（存在性/参数/角色/预算/意图级裁剪）③ executor 执行前 ToolRegistry 再校验一遍 ④ 高风险工具不进自动执行，走人工确认 ⑤ reviewer 只能降级不能升级。模型在每一层的输出都被下一层代码裁决。

**Q4：人工确认是怎么串起来的？**
高风险步骤（case.create / task.create）在 plan\_validator 被标记 requires\_confirmation，executor 执行到该步时推入 pending\_human\_actions 并暂停，回答里告知用户"有 N 个动作待确认"。用户在前端确认后调用 confirm\_human\_actions 接口，ToolRegistry 带 confirmed=True 上下文真正执行，每次执行写审计日志。图本身不等待——确认是带外完成的。

**Q5：Local ReAct 和全局 replan 为什么分两层？**
局部问题（这步结果不够，补一步别的）不该付出全局代价（重过 planner + validator + 一轮 LLM 规划）。Local ReAct 有确定性 gate 先挡一刀，大部分 case 零 LLM 成本就解决了；上升到 reviewer 的 need\_replan 意味着"计划本身有缺陷或能力有缺口"，才值得全局重规划。两层各有独立预算（Local ≤2 轮，replan ≤1 次），防止任何一层失控。

**Q6：后台图为什么不做成实时图那样的循环？**
后台事件是"圈选→生成→校验→发送"的单向流水线，不存在"执行到一半发现信息不够"的场景——人群圈选有兜底过滤、内容生成有校验收口、发送有去重。循环只会引入重入风险（重复发送）。实时图面对的是开放式对话，用户意图在执行中可能暴露新缺口，所以需要循环。

**Q7：状态为什么用 TypedDict 而不是 Pydantic BaseModel？**
与 LangGraph 状态机协议的兼容性最好（部分合并语义），节点间增量填充（total=False），且 LangGraph 对 TypedDict 的支持最成熟。缺点是缺运行时校验——我们的补偿措施是每个节点输出在消费端都有 schema 校验（Plan.model\_validate 等），校验粒度下放到关键结构。

**Q8：Kafka 消息重复消费怎么办？**
消费端不依赖"恰好一次"语义：event\_guard 检查 event\_id 是否已存在（幂等）；通知创建走 Redis 去重键 + DB 唯一约束双保险；followup 提醒的 dedupe 键含日期，同一天不会重复提醒。重复事件最多多跑一次图的只读部分。

**Q9：政策问答为什么强制 rag.query 而不是让模型自由决定？**
这是业务正确性约束：政策咨询必须有可追溯的证据来源，不能是模型自由发挥。plan\_validator 把政策咨询的工具白名单收窄到只读三件套并强制注入 rag.query——即使模型规划的 plan 完全没提检索，代码也会补上。reviewer 侧还有对应验收：policy\_evidence 能力要求下 retrieved\_evidence 为空即判 need\_replan。

**Q10：整个链路怎么观测？**
每个 state 有 5 个 trace 字段（encoding / planner / executor / reviewer / local\_react）+ timings；intent\_router 有 t1\~t7 的 timing 打点（进入、LLM 请求发送、首 token、解析完成等）；每步工具结果记录 step\_results；后台图写完整 audit\_logs + event\_logs 状态机。排障时从审计日志能还原任意一次执行的完整决策链。

---

## 八、相关代码索引


| 模块        | 路径                                                                 |
| --------- | ------------------------------------------------------------------ |
| 实时图拓扑     | `backend/app/orchestration/realtime/graph.py`                      |
| 实时图节点     | `backend/app/orchestration/realtime/nodes.py`                      |
| 实时图状态     | `backend/app/orchestration/realtime/state.py`                      |
| 后台图拓扑     | `backend/app/orchestration/background/graph.py`                    |
| 后台图节点     | `backend/app/orchestration/background/nodes.py`                    |
| 后台图状态     | `backend/app/orchestration/background/state.py`                    |
| 工具治理      | `backend/app/tools/registry.py`、`contracts.py`                     |
| 运行时预算     | `backend/app/orchestration/runtime.py`                             |
| 在线资源检索    | `backend/app/tools/knowledge_graph_tool.py`                        |
| 事件路由层     | `backend/app/orchestration/background/event_router.py`、`worker.py` |
| Prompt 模板 | `backend/app/prompts/agent_runtime_prompts.py`                     |


---



<!-- created: 2026-08-11 16:54:54 -->
<!-- updated: 2026-08-16 21:35:58 -->