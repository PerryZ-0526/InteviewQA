# Agent 沙箱的理解与实现

## 题目

谈谈你对 agent sandbox 的理解？怎么做一个 agent sandbox？

## 标签

[Agent](../../tags/Agent.md) | [Claude Code](../../tags/Claude Code.md) | [OS](../../tags/OS.md)

## 题目导航

← [006-agent长时间循环的注意事项](006-agent长时间循环的注意事项) | 无 →

## 面试直接答

> Agent sandbox 是给 LLM 生成的代码和工具调用提供的一个`受限隔离执行环境`，核心机制是默认拒绝加最小授权——文件系统白名单写入、网络出口默认关闭、系统调用过滤、资源配额与全量审计；隔离强度从进程级、OS 级沙箱、容器到微虚拟机逐级递增，越强的隔离越贵越慢，选择取决于代码的不可信程度和宿主资产的价值。

### 首先要理解为什么 Agent 必须沙箱化

Agent 执行的代码不是可信开发者写的，而是 LLM 即时生成的，并且生成过程可能被 prompt injection 污染——工具抓取的网页、文档里可以藏着注入指令，诱导模型生成恶意代码。所以沙箱的威胁模型必须假设「被执行的一切代码都是敌意的」。风险分三类：破坏宿主，比如删文件、改 shell 配置、写 cron 定时任务；窃取数据，比如读 `~/.ssh`、环境变量里的密钥然后外传；滥用资源，比如挖矿、扫内网横向移动。Claude Code 和 Codex 在本地执行命令时都提供 OS 级沙箱，正是出于这个原因。

### 理解 sandbox 的关键是看清「隔离边界在哪里」

最弱的是进程级隔离，用 seccomp 过滤系统调用、rlimit 限制资源，但和宿主共享内核，一个内核漏洞就全部击穿；中间是 OS 原生沙箱，macOS 的 Seatbelt 和 Linux 的 bubblewrap 用内核强制机制把进程关进受限域，毫秒级启动；再往上是容器，靠 namespace 和 cgroups 隔离，但依然共享宿主内核；gVisor 用用户态内核 Sentry 拦截系统调用，把攻击面从整个宿主内核缩小到 Sentry 一层；最强的是 Firecracker 这类微虚拟机，每个沙箱一个独立 guest 内核跑在 KVM 上，硬件虚拟化隔离。共享内核还是独立内核，是安全等级的分水岭。

### 怎么做一个 agent sandbox，我按六层设计

第一层文件系统：默认只读，写入走白名单。Claude Code 的默认策略就是「读全部、写仅限 workspace」，同时硬保护 `~/.ssh`、`~/.gnupg`、`.git/config`、shell 配置文件这类敏感路径。第二层网络：默认全部拒绝，出网必须命中域名白名单；Claude Code 在宿主侧起 HTTP/SOCKS5 代理做出口闸门，Linux 上直接把网络命名空间整个摘掉，再用 seccomp 把 `socket(AF_UNIX)` 系统调用拦住，防止通过 docker.sock 这类通道逃逸。第三层系统调用过滤：seccomp-BPF 做白名单或黑名单。第四层资源配额：CPU、内存、进程数、执行超时，防止死循环和资源耗尽。第五层审计与审批：每次命令执行全量记录，写系统目录、外发网络、调用特权命令等高危操作设人工审批闸门。第六层生命周期：沙箱一次性使用、任务结束即销毁，凭证永不直接放进沙箱，走短时效 token 的代理注入。

### 工程上要回答三个权衡

安全与能力的权衡：docker、watchman 这类命令在沙箱里跑不了，所以 Claude Code 设计了 `excludedCommands` 和 `dangerouslyDisableSandbox` 逃生舱，逃生必须走权限审批，还可以用 `allowUnsandboxedCommands: false` 彻底禁用。安全与性能的权衡：容器冷启动约 50 毫秒，Firecracker 微虚拟机 125 到 200 毫秒，gVisor 介于两者之间但系统调用有 20% 到 50% 的额外开销，传统虚拟机要一两秒；所以高频短任务用 OS 沙箱，执行不可信生成代码用微虚拟机，云端还可以用预热池和快照恢复把冷启动压到毫秒级。本地与云端的权衡：本地 OS 沙箱零延迟、贴合开发工作流；云端微虚拟机隔离最强、环境统一、便于计费和销毁，E2B 就是基于 Firecracker 的托管方案。

最后要强调边界。沙箱不是银弹，Claude Code 官方文档明确列了已知弱点：CDN 域前置可以绕过域名白名单，把 docker.sock 挂进沙箱等于拿到宿主，Linux 嵌套沙箱场景下隔离会明显降级，Ubuntu 24.04 默认的 `apparmor_restrict_unprivileged_userns` 会直接挡住 bubblewrap。所以正确的姿势是纵深防御：沙箱是第一道防线，外面还要有权限审批、审计告警、凭证隔离和最小权限的宿主配置，任何一层失效都不至于全盘沦陷。

## 详细解析

### 一、威胁模型：为什么 Agent 必须沙箱化

传统程序执行的环境假设是「代码由可信开发者编写」，而 Agent 打破了这一假设：执行的代码来自 LLM 的实时生成，且生成过程受上下文影响，而上下文里混入了大量外部内容——网页、文档、issue 评论、工具返回结果。攻击者可以把注入指令藏在这些内容里（**prompt injection**），诱导模型生成恶意代码。E2B 等沙箱厂商的威胁模型直接假设「沙箱内的代码具有敌意」，Manus、Perplexity 等产品选择微虚拟机而非容器，正是因为其威胁模型（注入逃逸、资源滥用、横向移动）要求强隔离。

风险按 CIA 三性归类：

| 维度 | 典型攻击 | 沙箱对策 |
|------|----------|----------|
| 完整性 | 删文件、改 `.bashrc`、写 cron、污染依赖缓存 | 文件系统白名单写入、敏感路径硬保护 |
| 机密性 | 读 `~/.ssh`、`.env`、浏览器 cookie 后外传 | 敏感路径禁读、网络出口代理审计、凭证隔离 |
| 可用性 | 挖矿、fork 炸弹、占满磁盘、扫内网 | cgroups/配额、超时、进程数限制、网络隔离 |

另外，长循环 Agent 的工具副作用会放大风险——重复执行、半完成状态、错误重试（详见 [006-agent长时间循环的注意事项](006-agent长时间循环的注意事项.md) 的「工具副作用」一节），沙箱的「一次性销毁」特性恰好能兜住这类问题。

### 二、隔离技术谱系对比

| 方案 | 隔离边界 | 启动开销 | 代表实现 | 适用场景 |
|------|----------|----------|----------|----------|
| 进程级 | 共享内核，seccomp/rlimit 过滤 | 毫秒级 | 受限子进程 | 可信的确定性命令 |
| OS 原生沙箱 | 内核强制机制（Seatbelt / bubblewrap + 命名空间） | 毫秒级 | Claude Code、Codex 本地沙箱 | 本地 Agent 命令执行 |
| 容器 | namespace + cgroups，共享宿主内核 | ~50ms | Docker | CI、可信流水线 |
| 用户态内核 | Sentry 拦截系统调用，不进宿主内核 | 容器 + 20~50% syscall 开销 | gVisor（Modal、Cloud Run） | 半可信、性能敏感负载 |
| 微虚拟机 | 独立 guest 内核 + KVM 硬件虚拟化 | 125~200ms（快照恢复可至毫秒级） | Firecracker（E2B、Fly.io） | 不可信 LLM 生成代码 |
| 全虚拟机 | 完整硬件虚拟化 | 1~2s | QEMU/KVM | 最强隔离、低频任务 |

核心判断：**是否共享宿主内核是安全分水岭**。容器和 OS 沙箱共享内核，逃逸依赖内核漏洞；gVisor 把内核攻击面缩小为 Sentry；微虚拟机每个租户独立内核，一条内核利用链无法横向打穿其他沙箱。行业共识是：不可信代码用微虚拟机，可信流水线用 gVisor 或容器换性能。

### 三、Claude Code 的 OS 级沙箱实现（查证细节）

Claude Code 原生沙箱（v2.1.0+）不走容器路线，而是直接用 OS 原生机制，三平台三套实现：

- **macOS**：Seatbelt，动态生成 profile 后经 `sandbox-exec` 应用，无额外依赖；
- **Linux/WSL2**：bubblewrap（bwrap）+ socat，依赖 bind mount 与网络命名空间；
- **Windows**：Alpha 阶段，进程跑在专用 `srt-sandbox` 本地账户下，用 Windows Filtering Platform（WFP）做出口过滤 + NTFS ACL 标记。

文件系统语义是「读默认允许、写默认拒绝」：读侧 `denyRead` 屏蔽敏感区域、`allowRead` 可再放开（allow 优先）；写侧默认全拒、`allowWrite` 白名单放行（deny 优先）。默认策略即「读全部、写仅 workspace」，并强制保护 `~/.ssh`、`~/.gnupg`、`.git/config`、`.git/hooks/`、shell 配置文件等路径。

网络架构是**宿主侧出口代理**：

```
┌──────────────────────────────────────────────────────┐
│ Host                                                  │
│  ┌───────────────┐    allowlist      ┌─────────────┐  │
│  │ HTTP/SOCKS5   │◄──────────────────┤  Sandbox    │  │
│  │ 出口代理        │  Unix domain     │  bwrap/     │  │
│  │ (域名白名单)    │  socket (socat)  │  Seatbelt   │  │
│  └──────┬────────┘                   └─────────────┘  │
│         │ egress（仅白名单域名）                        │
│         ▼                                             │
│     Internet                                          │
└──────────────────────────────────────────────────────┘
```

Linux 上网络命名空间被整体移除，流量只能经 Unix domain socket 由 socat 桥接到代理；macOS 上 Seatbelt profile 只放行指向本地代理端口的连接；`socket(AF_UNIX)` 在 Linux 上被 seccomp-BPF 直接阻断（同时阻断 io_uring 系列调用防止绕过），杜绝通过 docker.sock 逃逸。

配套配置项：`sandbox.enabled`（默认关闭）、`sandbox.excludedCommands`（如 `git`、`docker` 这类与沙箱不兼容的命令走外部执行）、`sandbox.autoAllowBashIfSandboxed`（沙箱内自动放行 bash）、`sandbox.allowUnsandboxedCommands`（控制 `dangerouslyDisableSandbox` 逃生舱是否可用）。底层实现已开源为 `@anthropic-ai/sandbox-runtime`（srt CLI），可对任意进程甚至 MCP server 施加同样的文件系统与网络限制。

官方文档同样承认已知弱点：CDN 域前置（Cloudflare 等托管任意用户内容，白名单域名形同虚设）、允许 `/var/run/docker.sock` 类 socket 等于宿主接管、Linux 嵌套场景 `enableWeakerNestedSandbox` 会明显弱化隔离、Ubuntu 24.04 起 `kernel.apparmor_restrict_unprivileged_userns` 默认挡住 bubblewrap。

### 四、云端沙箱：Firecracker 微虚拟机与 gVisor

**E2B** 是托管云端沙箱的代表：每个沙箱一个 **Firecracker microVM**，独立 guest 内核 + KVM 硬件虚拟化，内存开销约 5MB 量级，冷启动 125~200ms，配合预热池与快照恢复可进一步压低。默认短生命周期（约 1 天上限）、用完即弃，SDK 用模板定义环境并做版本化缓存。**gVisor** 走另一条路线：Sentry 作为用户态内核拦截系统调用，性能介于容器与微虚拟机之间，Modal、Cloud Run 用它换启动速度和密度。两者取舍的本质是「攻击面」对「性能密度」：微虚拟机把共享内核攻击面降为零，gVisor 把攻击面收缩到 Sentry 一个组件。

### 五、自建最小沙箱的落地步骤

以容器为例，最小可用形态（命令白名单之外再加内核级兜底）：

```bash
docker run --rm \
  --network none \                          # 网络默认全拒
  --read-only \                             # 根文件系统只读
  --tmpfs /tmp:size=64m,noexec \            # 可写区仅限 tmpfs
  --cap-drop ALL \                          # 丢弃全部 capabilities
  --security-opt no-new-privileges \        # 禁止提权
  --pids-limit 64 --memory 512m --cpus 1 \  # 资源配额
  -v "$WORKDIR:/workspace:rw" \             # 仅 workspace 可写
  sandbox-image:latest timeout 30 python main.py
```

再往上封装一层面向 Agent 的沙箱 API，关键设计决策：

- **命令白名单**：模型只能调用预注册工具，`bash -c` 自由执行要单独授权；
- **出口代理**：`--network none` 之上，如需出网走带域名白名单的 HTTP 代理，沙箱内无直连能力；
- **凭证注入**：密钥不进环境变量，由代理在出口处附加短时效签名；
- **审计与审批**：每次执行落日志（命令、参数、退出码、耗时），高危动作（写系统路径、外发数据、下载并执行）触发人工确认——这与 [006-agent长时间循环的注意事项](006-agent长时间循环的注意事项.md) 中「高风险操作设审批节点」一脉相承；
- **生命周期**：任务级沙箱用完即毁；长任务做检查点/快照，失败可恢复（呼应 [005-agent从接收需求到完成工作的完整流程](005-agent从接收需求到完成工作的完整流程.md) 的执行-观察循环）；
- **分级执行**：确定性安全命令（`git status`、格式化器）走轻量进程沙箱，LLM 生成代码走容器/微虚拟机，特权操作（如 docker build）留在沙箱外由宿主受控执行。

### 六、面试追问

**追问 1：Seatbelt/bubblewrap 和 Docker 都是沙箱，Claude Code 为什么不用容器？**

容器与 OS 原生沙箱的差异在三点：容器共享宿主内核，隔离强度不高于原生沙箱的命名空间方案，安全上没有代差；容器需要 daemon、镜像拉取和存储驱动，本地毫秒级高频命令执行的启动与管理开销不划算；容器要处理路径映射和网络互通，会破坏「本地开发」的工作流体验。OS 原生沙箱无守护进程、毫秒级生效、可逐路径逐 syscall 精确控制，代价是实现与平台强绑定（三平台三套代码）且部分内核特性受限（如 WSL1 不支持、Ubuntu 24.04 需调 sysctl）。反过来，需要完整环境一致性（依赖、语言版本、系统库）时容器/微虚拟机才是正解——选型看需求是「限制当前环境的进程」还是「提供另一套环境」。

**追问 2：域名白名单模式下，攻击者用 DNS 隧道或 CDN 域前置绕过怎么办？**

DNS 解析不交给沙箱，由宿主代理统一解析后再按 IP 或 SNI 校验，沙箱内对 53 端口无直连；域前置（借 Cloudflare/Akamai 等 CDN 的合法证书与域名托管恶意内容）是白名单模式的固有弱点，Claude Code 文档承认这一点，缓解手段包括：白名单精确到子域、deny 优先、避免宽泛的 CDN 通配、以及实验性的 TLS 终止 MITM 检查（`network.tlsTerminate`）做内容级过滤。彻底方案是敏感任务直接离线沙箱，物理切断出口。

**追问 3：业务必须让 Agent 执行 docker build 这类特权操作，沙箱怎么设计？**

绝不能把 docker.sock 挂进沙箱——那等于把宿主交给沙箱。三条路：其一，特权操作留在沙箱外，由宿主的受控执行器在人工审批后代为执行，结果回传；其二，嵌套隔离，在外层容器/虚拟机里再跑沙箱，Claude Code 的 `enableWeakerNestedSandbox` 即为此设计，前提是外层已有隔离；其三，云端微虚拟机里跑 docker-in-docker，宿主机完全无感知。核心原则是**特权面与模型执行面分离**。

**追问 4：既然微虚拟机最强，为什么还要进程级沙箱？怎么选？**

成本结构不同：进程级沙箱毫秒级、零运维；微虚拟机要编排、要预热池、要按沙箱时长计费。选型按「代码不可信程度 × 宿主资产价值」：可信的确定性命令（版本查询、格式化、单元测试）进程级加命令白名单即可；LLM 即时生成的、可能被注入污染的代码进容器或微虚拟机；高危生产环境统一微虚拟机。折中方案是分级执行：同一次任务里，大部分命令走轻沙箱，只有执行生成代码时才拉起强隔离环境，把强隔离的启动开销摊薄到少数真正危险的调用上。

**追问 5：Agent 自己申请关闭沙箱（逃生舱）怎么办？怎么防 prompt injection 诱导越权？**

逃生舱（如 `dangerouslyDisableSandbox`）必须满足三个条件：走独立的权限审批通道，不因任务进行中而自动放行；可全局禁用（`allowUnsandboxedCommands: false`）；每次申请连同上下文片段进入审计日志。注意 prompt injection 会诱导模型「合理地」申请越权——审批人看到的是模型转述的理由，因此审批界面应展示原始上下文（含可疑的外部内容）而非模型的转述，高危审批还应限频并升级到人工。模型侧本身不应持有修改沙箱配置的工具。

## 参考链接

- [Claude Code Docs: Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing)
- [anthropic-experimental/sandbox-runtime（GitHub）](https://github.com/anthropic-experimental/sandbox-runtime)
- [OpenAI Codex Docs: Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)
- [OpenAI Codex Docs: Agent approvals &amp; security](https://developers.openai.com/codex/agent-approvals-security)
- [E2B Documentation](https://e2b.dev/docs)
- [Firecracker microVM（AWS 开源）](https://firecracker-microvm.github.io/)
- [gVisor：容器安全的用户态内核](https://gvisor.dev/)
- [fhiltscher/awesome-ai-coding-sandboxes（GitHub）](https://github.com/fhiltscher/awesome-ai-coding-sandboxes)
<!-- created: 2026-08-13 20:06:00 -->
<!-- updated: 2026-08-15 22:51:17 -->
