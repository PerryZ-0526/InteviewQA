# 详述 dsh 的 PTC

## 题目

面试官问：DeepSeek Harness（dsh）里的 PTC（程序化工具调用 / Code Mode）是什么机制？请详述它的设计、执行流程与边界。

## 标签

[DeepSeek Harness](../../tags/DeepSeek Harness.md) | [Agent](../../tags/Agent.md) | [上下文压缩](../../tags/上下文压缩.md) | [成本优化](../../tags/成本优化.md)

## 题目导航

← [002-DeepSeek Harness与Claude Code的区别](002-DeepSeek Harness与Claude Code的区别) | 无 →

## 面试直接答

> PTC（Programmatic Tool Calling，dsh 内部称 Code Mode）是 dsh 里把工具调用的编排权交给程序的一种交互模式：模型不再逐次发起原生工具调用，而是针对当前会话可见工具集自动生成的 SDK 编写一段 TypeScript 程序，由宿主的 worker 线程整体执行，中间数据留在程序内部，只有打印日志与最终返回值回到模型上下文；核心收益是把 N 次工具往返压缩为一次模型往返，边界是 worker 运行时提供的是遏制（containment）而非安全隔离。

首先明确 PTC 在 dsh 中的定位：它不是内核机制，而是工具注册表的一种呈现模式。工具注册表本身始终运行在宿主侧，agent preset 通过 tool-presentation 这一行配置声明 mode: code，让挂在该 preset 下的 agent 的模型只看到 run\_code 这一个工具；官方随发行版提供的 code preset 就是 standard preset 原样加上这一行，其注释写得很直接——「本来要五次往返的序列变成一次往返」。code 模式下原生工具的 schema 不再进入模型请求，取而代之的是 tools:sdk 提示词段：注册表按词法序把会话可见工具的参数与返回类型确定性生成一份 declare const tools 的 TypeScript 声明，同一工具集下字节级稳定，因此可以利用提供商的前缀缓存摊销每次组装的成本；提示词里同时有一条 order 99 的显式规则——run\_code 是唯一可直接调用的工具，直接调用其他工具名会失败。

其次看执行机制。run\_code 有两个必填参数：code 是 async 函数体（支持顶层 await 与 return），description 是 5 到 10 个词的主动语态摘要，用作 UI 标签。每次调用在全新的 node:worker\_threads worker 里执行：模型代码先经 node:module 的 stripTypeScriptTypes 剥离类型（用 async 函数包装保证剥离后行列号不变），再以 AsyncFunction 构造，tools 命名空间、ToolCallError 错误类和一个只有五个方法的 console shim 作为形参注入。程序里的每次 await tools.xxx(args) 都不是进程内函数调用，而是经消息端口桥回宿主——宿主以 Object.hasOwn 校验绑定名、把每条入站消息当作敌对输入逐字段重建——然后走与原生工具调用完全相同的 pre-execute、审批、execute、post-execute 流水线，权限、审批、审计、超时一条都没有绕过。

第三是并发与一致性。每个子调用按提交序启动，默认最多 10 个并发安全（isConcurrencySafe）的子调用重叠执行，被分类为 exclusive 的调用会先排空池、独占执行并形成屏障，把 maxParallelSubCalls 配为 1 即恢复严格串行；结果按提交序落盘，每个子调用都会写入 tool/code-dispatch 会话事件，所以「模型可见即已记录」不变量对 PTC 同样成立，审计与回放不会出现日志缺口。

第四是预算与失败语义。每次运行受四重预算约束：computeMs 用事件循环利用率计量实际忙碌时间（等待慢工具不扣费，热循环躲不掉），maxWallMs 用定时器兜底总时长，堆内存有 resourceLimits 上限，外层输出（logs 加返回值）默认 64 MiB。程序异常、预算耗尽、中止或 worker 死亡统一收敛为 CodeRunFailedError（code: CODE\_RUN\_FAILED），由执行流水线转成结构化 isError 结果返回给模型，模型可以读错误信息自行修正。

最后必须讲清边界。官方在 worker 运行时模块的文档注释里明确定位：这是遏制而非安全边界，模型代码可达 Node API，权限与 bash 工具同级；worker.terminate() 只能终止线程，停不掉程序派生的 OS 进程。需要硬多租户边界时，必须把 codeRuntime 这个 seam 换成容器级后端。工程上还有两点提醒：一是 PTC 一次执行可以放大副作用（一段程序可能读写大量文件），上线时应为 run\_code 单独考虑审批与预算策略；二是 SDK 提示词段本身要占上下文，工具数量多时体积可能超过原生 schema，省 token 的前提是任务确实需要多步工具编排。

## 详细解析

> 内容基于 2026-08-16 克隆至 `ref_project/deepseek-harness` 的仓库源码（master）核验，关键结论均标注对应源码文件。

### 一、PTC 在 dsh 里的准确位置

PTC 不是内核机制，而是一行 preset 配置选择出来的「工具呈现模式」。**工具注册表**（ctx.tools）永远留在宿主面——agent loop 的调度器、API 代理的展示器都是它的消费者；preset 能拥有的只是「这个 agent 的模型以什么形式看到工具」。
```text
┌──────────────────────────────────────────────────────────────┐
│ agent preset: code（apps/cli/config/agent-presets/code/       │
│                agent.cordis.yml）                              │
│  = standard preset 全部行，仅追加一行：                        │
│    - id: tool-presentation                                     │
│      name: '@deepseek-ai/dsh-agent-tool-presentation'          │
│      config: { mode: code }                                    │
├──────────────────────────────────────────────────────────────┤
│ 宿主面（preset 无权拥有）：                                    │
│  · tools 注册表（mode 默认 native，可用 DSH_TOOLS_MODE 环境   │
│    变量临时整体切 code/both）                                  │
│  · code-runtime 行：@deepseek-ai/dsh-code-runtime-worker-thread│
│    （注册 ctx.codeRuntime 服务）                                │
├──────────────────────────────────────────────────────────────┤
│ code 模式下该 agent 的模型可见内容：                           │
│  · run_code 唯一工具（schema 按加载的运行时语言生成）          │
│  · tools:sdk 提示词段（order 150：确定性生成的 SDK 声明）      │
│  · tools:code-only 规则段（order 99）                          │
└──────────────────────────────────────────────────────────────┘
```

三个值得讲的工程细节。第一，`tool-presentation` 行通过 `ctx.inject(['codeRuntime'], ...)` **等待**运行时服务：部署里没挂 worker 运行时，preset 在挂载时就以该行 id 报错（fail fast），而不是拖到第一次请求才炸。第二，native / code / both 三种模式可在同一进程共存——native 会话与 PTC 会话各自看到自己的目录。第三，`run_code` 是保留名：它不进入可过滤的 global/scoped 能力层，每 agent 的可见性解析器在过滤之后才追加它，per-agent 限制删不掉它，作用域注册也遮不住它。

### 二、code 模式下模型看到什么

**run\_code 的 schema**（TypeScript 运行时，取自 code-mode.ts 的 RUN\_CODE\_FLAVORS）：
```json
{
  "name": "run_code",
  "arguments": {
    "description": "Count TODO markers across packages",
    "code": "const listing = await tools.bash({ command: 'ls notes', description: 'List notes' }); const demo = await tools.read({ file_path: 'notes/demo.txt' }); return { listing, demo };"
  }
}
```

`code` 是 async 函数体，顶层 `await` 与 `return` 合法；`description` 是必填的 5-10 词主动语态摘要，用作调用卡片的 UI 标题（bash 的 description 先例），程序正文则走 rawInput 展示。工具签名示例取自仓库 connection fixture；实际签名以每个会话的 SDK 声明为准。

**tools:sdk 段**由 `renderToolsSdk`（ts-types.ts）从 ToolSdkSchema 生成 `declare const tools` 命名空间：按词法序输出、同一工具集字节级相同、生成过程绝不抛异常（jsonSchemaToTs 对不支持的构造降级为 `unknown`，Python 侧 jsonSchemaToPy 降级为 `Any`）。SDK 与 run\_code schema 的语言都由 `ctx.codeRuntime.language` 在组装时决定，`CodeSdkLanguage` 的 satisfies 约束保证「TS 的 SDK 配 Python 的 schema」这类错配在 typecheck 阶段就失败。

**tools:code-only 规则段**（index.ts 原文）："`run_code` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program." 注意这条规则放在 order 99——persona 之后、100-199 工具指引带之前，让模型先读「只能调谁」再读「每个工具是干什么的」。

### 三、执行链路（源码级）
```text
模型输出 run_code 调用
   ↓ registry.execute（code-mode.ts）
   ├─ jsonNormalizeArgs：参数先做无损 JSON 快照
   │   （undefined / BigInt / 循环引用 / 稀疏数组 / -0 / 奇异对象 → 该调用拒绝）
   ├─ 枚举 registry.schemas(agent)：取调用 agent 的可见工具集
   │   （作用域工具并入、受限全局消失）→ null-prototype + defineProperty
   │   构造 bindings；run_code 自身被排除，禁止程序递归调用 run_code
   ↓ runtime.run({ program, bindings: [{ global:'tools', errorClass:
        { name:'ToolCallError', memberNameProperty:'toolName' } }], signal })
   ↓ worker-thread 后端（每次运行一个全新 worker）
   ├─ stripTypeScriptTypes('async function __dsh_program__() {\n' + code + '\n')
   │   （node:module 位置保持剥离：行列号不变，报错定位仍是模型原文）
   ├─ new AsyncFunction(...'tools','ToolCallError','console', `'use strict';` + code)
   ├─ env:{}、execArgv:[]、resourceLimits.maxOldGenerationSizeMb（默认 512 MiB）
   ├─ console shim 仅 5 个方法（log/info/warn/error/debug），
   │   process.stdout/stderr 的 write 被劫持进带字节预算的 LogBuffer
   ├─ 程序内 await tools.xxx(args)
   │   → postMessage { type:'call', id, global, name, args }
   │   → 宿主 onCall：parseWorkerMessage 逐字段重建校验（敌对 peer 假设）、
   │     Object.hasOwn 查绑定、重复 id 忽略 → 进入 registry 调度器：
   │        tools/pre-execute → 审批 guards → execute → post-execute
   │        （与原生工具调用完全同一套内核）
   │   → reply { id, ok, value }（成功值同样必须是无损 JSON）
   ├─ 完成值 prepareCompletion：非无损 JSON → invalid-output 失败；
   │   超出预算 → output-limit 失败
   └─ 程序结束后 runController.abort('run_code settled') + drainDispatches：
      所有子调用事件都在本 turn 内落盘后才关闭
```

**调度契约**（code-mode.ts execute，与原生 loop 同一套并发规则）：每个 run 持有一个 AbortController；子调用严格按提交序启动；连续的 `isConcurrencySafe` 调用最多 `maxParallelSubCalls`（默认 10，配 1 恢复串行）重叠；exclusive 分类的调用（或分类器抛错，fail-closed 按 exclusive 处理）先排空池、独占执行，屏障一直覆盖到其 post-execute 提交完成。结果按提交序经 head-of-line cursor 提交；每个子调用先写 `tool/code-dispatch-start`（id 形如 `<父调用id>:code:<n>`），结束时写 `tool/code-dispatch` 事件，携带模型可见的 content/isError——UI 走原生渲染路径展示子调用。绑定失败在程序侧表现为带 `toolName` 字段的 **ToolCallError**，可 `instanceof` 捕获后自行降级；整个程序失败抛 **CodeRunFailedError**（code: `CODE_RUN_FAILED`），由注册表的执行流水线转成结构化 isError。

### 四、与原生结构化工具调用对比


| 维度       | 原生（native）         | PTC（code）                        |
| -------- | ------------------ | -------------------------------- |
| 模型看到     | 每个工具的 JSON schema  | run\_code schema + 生成的 SDK 声明    |
| 多步编排     | 每步一次模型往返（step）     | 一次往返，程序内写循环/条件/错误处理              |
| 中间结果     | 全部进入上下文            | 留在 worker 内，仅 logs + 返回值回传       |
| token 成本 | N 次调用 → N 轮上下文     | 1 轮上下文 + 程序文本 + SDK 摊销           |
| 子调用执行    | 调度器直接执行            | 桥回宿主进入**同一调度器**（同一流水线）           |
| 审计事件     | tool/call\* 事件     | tool/code-dispatch\* 事件（父子链、提交序） |
| 失败语义     | 单工具错误单独可见          | 绑定抛 ToolCallError；整体失败 → isError |
| 执行环境     | 宿主进程内工具实现          | 全新 worker 线程：遏制而非沙箱              |
| 并发       | 原生并发契约             | 同一契约：默认 10 重叠、exclusive 屏障       |
| 停轮次能力    | concludesTurn 原生生效 | 嵌套结果转发 concludesTurn（仅成功结果可携带）   |


### 五、省 token 的定量逻辑

往返压缩是主要来源：原生模式下 k 次工具调用至少产生 k 次模型请求，每次都重新组装并发送上下文；PTC 压缩为 1 次请求加 1 次程序执行。次要来源是中间数据不进上下文：遍历 100 个文件的循环体中间内容，原生模式下要靠 pruner 截断、靠上下文折叠，PTC 里根本不离开 worker。SDK 的成本则要靠缓存摊销：SDK 文本按词法序确定生成，同一工具集字节级相同，提供商前缀缓存可以命中；`both` 模式会同时携带 schema 与 SDK 两份表示，不是免费的。反例也要讲：工具少、任务单步时，SDK 体积反而大于单个原生 schema，收益为负。媒体实测（品玩评测）称同一多步任务约 4 分钟压到 30 秒、token 消耗差近 20 倍，属于特定多步任务的极端样本，不应作为一般性保证引用。

### 六、安全与预算

worker 后端模块注释的官方定位原文："This is containment, not a security boundary: model code has bash-equivalent trust despite an empty environment, a heap cap, measured event-loop busy-time and wall-time budgets, and termination that also stops synchronous loops." 即：空环境、堆上限、忙碌时间与墙钟预算、可终止同步循环的硬终止，合起来是**遏制**，不是**隔离**——模型代码可达 Node API，权限与 bash 工具同级，worker.terminate() 停不掉它派生的 OS 进程。

默认预算（WorkerThreadCodeRuntime.Config）：computeMs 60\_000（每 25 ms 采样一次 `worker.performance.eventLoopUtilization()`，等待慢工具不累积、热循环即使挂着假调度也照常累积）、maxWallMs 600\_000、maxOutputBytes 67\_108\_864（64 MiB，仅计 logs + 返回值 + 失败消息的外层序列化，中间绑定值无逐项上限）、maxOldGenerationSizeMb 512。选用 worker 线程而非 node:vm 的官方理由：vm 类同进程沙箱原型链可逃逸，热循环无法从外部真正打断；worker 线程换来真正独立的 V8 堆与外部可强制终止的环境。

安全审计（GitHub Discussion #817，针对 0.1.0-rc.5）公开的问题包括：H1 本地 RPC 无认证（伪造 Host 头可创建 approval: never 的全权限会话）、H2 绑定 0.0.0.0 时局域网可达、M1 workflow 沙箱绕过（`vm.createContext` 冻结闭包挡不住 `.constructor`）、M5 Landlock 对 NFS/CIFS/FUSE 无效却报告 full；Code Mode 进程内执行列为 L2（已文档化，建议 UI 明示）。部署建议：为 run\_code 单独设置审批与预算（一次执行可放大副作用）；需要硬多租户边界时更换容器级 codeRuntime 与 bash 后端；本地回环监听不可假定可安全暴露到公网。

### 七、面试追问

**追问一：PTC 程序里的工具调用和原生调用是两条执行路径吗？**

不是。子调用通过消息通道回到宿主后进入 registry 的同一调度器（TOOL\_RUNTIME\_SCHEDULER），prepare（pre-execute/guards）、dispatch、finalize（post-execute）与原生调用完全一致，审批、上下文附加、concludesTurn 全部原样生效；差异只在发起方（模型直接发起 vs 程序内绑定发起）和审计事件形态（tool/code-dispatch\*，携带父调用 token 的父子链）。这正是 PTC 不构成审批旁路的原因。

**追问二：为什么 computeMs 用事件循环利用率而不是墙钟计时？**

墙钟对「程序在等一个慢工具」不公平（等待不耗 CPU 却被计时），也容易被假调度规避（挂一个永不完成的 dispatch 把墙钟拖过去）。ELU 计量的是 worker 事件循环的实际活跃时间：await 慢工具时活跃时间几乎为零，同步热循环或微任务风暴即使同时挂着假调度也照常累积。但 ELU 看不见「永不 resolve 的 promise」这类空等，所以必须有 maxWallMs 定时器兜底——两者互补，缺一不可。

**追问三：选 worker 线程而不是 node:vm 沙箱，代价是什么？**

每 run 新建线程有启动成本（这也是预算按 run 而非按调用计的原因之一）；worker 与宿主靠消息端口通信，绑定值必须是无损 JSON，跨边界没有共享内存的便利。换来的是真正独立的 V8 堆、可外部强制终止（能打断同步死循环）以及可被资源限制约束的堆。官方把这项权衡写得很清楚：vm 类同进程沙箱的原型链可逃逸与热循环不可打断，是硬伤而非缺点。

**追问四：PTC 和 Claude Code 的 PTC 是同一个东西吗？**

同属「程序化工具调用」这一设计家族——让模型写程序、宿主提供绑定、中间结果不出沙箱，思路一致（本库 002 号题有 dsh 与 Claude Code 的系统对比）。dsh 侧的差异点：PTC 只是呈现模式，原生模式在同一进程共存；实现是 worker 线程 + 消息端口 + 复用同一审批流水线；运行时本身是 seam，可整体替换为容器级后端；SDK 文本按语言确定性生成且前缀缓存友好。详见 \[002-DeepSeek Harness与Claude Code的区别\](002-DeepSeek Harness与Claude Code的区别.md)。

### 八、与题库已有题目交叉引用

- 架构背景与 Code Mode 简版：见 [001-DeepSeek Harness架构设计](001-DeepSeek%20Harness%E6%9E%B6%E6%9E%84%E8%AE%BE%E8%AE%A1.md)
- 与 Claude Code 的系统对比：见 \[002-DeepSeek Harness与Claude Code的区别\](002-DeepSeek Harness与Claude Code的区别.md)
- 上下文压缩的同族手段：见 [agent/004-agent上下文压缩策略](../agent/004-agent%E4%B8%8A%E4%B8%8B%E6%96%87%E5%8E%8B%E7%BC%A9%E7%AD%96%E7%95%A5.md)
- 成本视角：见 [agent/001-如何降低agent的运营成本](../agent/001-%E5%A6%82%E4%BD%95%E9%99%8D%E4%BD%8Eagent%E7%9A%84%E8%BF%90%E8%90%A5%E6%88%90%E6%9C%AC.md)

### 九、参考

- 本地源码：`ref_project/deepseek-harness`（2026-08-16 克隆，master 分支）
- [code agent preset 组合文件](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/config/agent-presets/code/agent.cordis.yml)
- [tool-presentation 行实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-tool-presentation/src/index.ts)
- [run\_code 实现（code-mode.ts）](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/code-mode.ts)
- [工具注册表：tools:sdk 段与调度契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)
- [TS SDK 生成（ts-types.ts）](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/ts-types.ts)
- [worker 线程后端（预算与协议）](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/code-runtime/code-runtime-worker-thread/src/index.ts)
- [worker 内执行器（bootstrap.ts）](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/code-runtime/code-runtime-worker-thread/src/bootstrap.ts)
- [code-runtime seam 官方文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/code-runtime/README.zh.md)
- [子系统参考 code-runtime.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/code-runtime.md)
- [安全审计报告 Discussion #817](https://github.com/deepseek-ai/deepseek-harness/discussions/817)


## 面试直接答 · 通俗版


一句话版本：普通模式里 AI 每做一个动作都要「打电话请示」一次——调用工具、等结果、看结果、再调用下一个工具，每一轮都要完整过一遍模型上下文；PTC 模式是让 AI 直接写一段小程序，把要做的事一次性写进程序里，程序在宿主给的环境里跑完，中间过程 AI 不用看，最后只把结果拿回来。就像让秘书出去办完整件事再回来汇报，而不是每跑一个窗口就打电话请示一次。

为什么省 token 能省得很可观？因为模型上下文里最贵的就是反复往返：每调用一次工具，模型都要重新读一遍历史才能决定下一步。压缩成一次执行后，模型只读一次、只决定一次，中间那十几轮的上下文全部消失。当然这是有前提的——任务得是多步编排才有得赚，只调一次工具的任务，生成 SDK 说明书反而亏。

它是怎么实现的？模型写的是 TypeScript 程序（也支持 Python），系统会先把当前能用的所有工具自动生成一份 SDK 说明书，程序里按说明书写 await tools.xxx() 就能调用工具。程序在独立线程里跑，每次跑都开一个新线程，跑完就销毁。程序里调工具不是真的直接调用，而是通过消息通道把请求传回主程序，主程序照常走审批、执行、记录这套流程——所以换成程序调用，安全管控一点没放松。

有什么坑？最大的一条：官方明说这个线程环境只算「关禁闭」不算「保险柜」——程序里的代码能摸到 Node 的能力，权限跟直接执行 bash 命令一样大；线程可以被掐死，但它派生出去的系统进程掐不死。真要严格隔离，得把整个执行环境换成容器方案。另外 AI 写的程序一口气可能改很多东西，比单次工具调用更需要盯紧审批和预算。<!-- created: 2026-08-16 05:12:43 -->
<!-- updated: 2026-08-16 19:57:12 -->
