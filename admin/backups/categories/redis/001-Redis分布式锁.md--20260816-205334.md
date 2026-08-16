# 谈谈你对 Redis 分布式锁的理解

## 题目

谈谈你对 Redis 分布式锁的理解，可以从实现原理、正确用法、常见坑、主从架构下的故障模型、Redlock 算法及其争议、以及与其他分布式锁方案的对比等角度展开。

## 标签

[Redis](../../tags/Redis.md) | [缓存](../../tags/缓存.md)

## 题目导航

← 无 | 无 →

## 面试直接答

> Redis 分布式锁是<span style="background-color: #fff3cd">用 Redis 的单线程原子命令把互斥仲裁上移到共享存储</span>，为多实例部署的服务提供跨进程互斥的机制。
>
> ```
> 核心是 SET key token NX PX 原子加锁、唯一令牌标识持有者、Lua 脚本比较后删除；
> ```
>
> 它的准确定位是 AP 系统上的`效率型互斥工具`，若业务要求「绝不同时执行」的强互斥，必须引入存储层校验等外部兜底，不能把正确性寄托在 Redis 锁上。

首先说为什么需要它。进程内的锁（synchronized、ReentrantLock）作用域是单个 JVM 进程内的线程，服务一旦部署成多个实例，两个请求落在不同实例上，各自加本地锁互不感知，临界区仍然会被并发执行。分布式锁解决的就是这个问题：让所有实例在进入临界区之前，都去问同一个第三方仲裁者——Redis 凭借单线程执行命令的串行化语义，天然适合扮演这个角色。

其次说正确用法。加锁必须用一条命令同时完成「不存在才写入」和「设置过期时间」两个动作：`SET lock:order:1001 {唯一token} NX PX 30000`。NX 保证只有第一个写入成功的客户端拿到锁，PX 保证客户端崩溃后锁能自动过期，二者原子完成；早期 SETNX 加 EXPIRE 的两步写法，客户端在两步之间崩溃就会留下永不过期的锁，把整个业务卡死。token 必须是每个客户端每次获取锁都不同的随机值，它回答了「这把锁是谁的」这个问题——因为释放锁时不能直接 DEL：如果业务执行超过了 TTL，锁已经被自动释放并被别的客户端重新获取，此时盲目 DEL 会把别人的锁删掉。正确做法是把「比较值 + 删除」放进一个 Lua 脚本，脚本在 Redis 内部原子执行，只有当前值仍等于自己的 token 时才删除。Redis 2.6.12 起官方已将 SETNX 标记为废弃，推荐用 SET 带 NX 选项替代。

第三说超时悖论与续期。TTL 设多少是个矛盾：设短了业务没执行完锁就没了，设长了客户端崩溃后其他客户端要等很久才能拿到锁，本质是业务执行时长不可预知。Redisson 的 watchdog 是常见解法：不显式指定 leaseTime 时默认给 30 秒租约，watchdog 每 10 秒（租约的三分之一）把过期时间续回 30 秒，直到 unlock 才取消；实现上锁在 Redis 里是一个 hash 结构，field 是线程标识、value 是重入计数，续期用 hexists 加 pexpire 的 Lua 脚本原子完成，同时天然支持了可重入。注意显式传了 leaseTime 时 watchdog 不会启动。但续期只缓解问题：客户端整体宕机、网络分区、长时间 GC 停顿都会让续期停摆，锁照样过期，所以锁内逻辑依然要短，并且要接受「锁可能提前失效」这个前提。

第四说故障模型与 Redlock。单机 Redis 加主从哨兵还有一个隐蔽的坑：master 上的锁靠异步复制同步到 replica，master 宕机时最新写入可能还没同步过去，哨兵把 replica 提升后，新 master 上根本没有这把锁，另一个客户端立刻就能加锁成功，于是两个客户端同时持锁。Redlock 用 N 个完全独立的 master（官方示例是 5 个）抵抗这种单点故障：客户端用同一个 key 和同一个随机值依次请求所有节点，每个节点只给很小的网络超时（远小于 TTL）；只有拿到超过半数（N/2+1）节点的锁、且总耗时小于锁有效期，才算加锁成功，有效时间还要减去已经消耗的获取时间；失败时必须在所有节点上都执行释放，防止「服务端已写入但响应丢失」造成的孤儿锁。Redlock 还要求崩溃重启的节点在最大 TTL 时间内拒绝服务，否则重启后锁被遗忘，互斥同样失效。

第五说这场著名争论。Martin Kleppmann 在 2016 年发文指出 Redlock 依赖时钟与进程调度假设，并不安全：客户端拿到锁后可能被 GC 停顿卡住超过 TTL，锁过期后被别的客户端拿走，而第一个客户端恢复后浑然不觉继续写共享资源，两个客户端并发操作——这个 bug 在 HBase 生产环境真实发生过。他给出的解法是 fencing token：锁服务返回单调递增的令牌，客户端写共享存储时必须携带令牌，存储层拒绝任何小于已见最大令牌的写入。antirez 次日回应认为：如果业务已经有 fencing 兜底，那本来就不需要强锁，Redis 锁只该用于效率型场景；Redlock 只假设各节点时钟走速大致相同（半同步模型），并不要求绝对时间精确；且唯一令牌配合 check-and-set 也能起到类似 fencing 的作用。这场争论的公认结论是：Redlock 比单机锁更抗节点故障，但无法证明绝对互斥，正确性不能寄托在它身上。

最后说方案对比与工程取舍。ZooKeeper、etcd 这类 CP 系统用临时节点加会话租约实现锁：客户端宕机后会话过期、临时节点自动删除，天然具备持有者身份和租约语义，且 etcd 的全局递增 revision、ZK 的 zxid 可以直接充当 fencing token；代价是性能比 Redis 低一到两个数量级，且网络分区时锁服务可能整体不可用——宁可不可用也不脑裂。Redis 锁的定位是高性能、可用性优先的效率型互斥。工程上的结论是：能容忍偶发并发执行的场景——缓存重建、定时任务防重、配合消息幂等做辅助去重（详见 [004-kafka为什么会出现重复消费](../kafka/004-kafka%E4%B8%BA%E4%BB%80%E4%B9%88%E4%BC%9A%E5%87%BA%E7%8E%B0%E9%87%8D%E5%A4%8D%E6%B6%88%E8%B4%B9.md)）——用 Redis 锁非常合适；涉及资金、库存扣减等正确性场景，最终一致性必须由数据库唯一约束、乐观锁版本号这些存储层机制兜底，分布式锁只做第一道过滤。

## 详细解析

> 版本核验：Redis 8.4（2026-08-15 查证）；Redisson 主线源码。

### 一、单机 Redis 锁的演进：从错误写法到正确姿势

**错误写法一：SETNX + EXPIRE 两步非原子。**
```text
SETNX lock:order:1001 1      # 第 1 步
EXPIRE lock:order:1001 30    # 第 2 步
```

客户端在第 1 步和第 2 步之间崩溃（进程被杀、宕机、网络中断），key 永远没有 TTL，其他客户端永远拿不到锁——死锁。这曾经是分布式锁最经典的坑。

**错误写法二：固定值 + 直接 DEL。**
```text
SET lock:order:1001 1 NX PX 30000
...业务执行（可能超过 30 秒）...
DEL lock:order:1001
```

业务执行超过 TTL 后锁自动过期，客户端 B 拿到锁开始执行；此时客户端 A 执行 DEL，把 B 的锁删掉；客户端 C 又能加锁成功——A、B、C 三个客户端同时进入临界区。

**正确姿势：唯一 token 加锁 + Lua 脚本比较释放。**
```text
SET lock:order:1001 {每次随机的token} NX PX 30000
```

释放脚本（官方文档给出的模式，比较值与删除在一条命令内原子完成）：
```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

调用方式：`EVAL <script> 1 lock:order:1001 {token}`。Redis 执行 Lua 脚本期间不会插入其他命令，比较和删除之间不存在竞态窗口。

> 版本注记：`SETNX` 自 Redis 2.6.12 起被官方标记为 deprecated（SET 的 NX 选项可以完全替代它），返回值语义也不同——SETNX 返回整数 1/0，`SET key value NX` 返回 OK/nil。此外 Redis 8.4 引入了原生的 `DELEX key IFEQ token` 命令，可以直接完成原子比较删除，不再必须写 Lua。

各阶段对比：


| 阶段              | 加锁方式                 | 释放方式       | 缺陷                |
| --------------- | -------------------- | ---------- | ----------------- |
| 原始版             | SETNX + EXPIRE       | DEL        | 两步非原子，中间崩溃 → 永久死锁 |
| 优化版             | SET NX PX            | DEL        | 业务超时后 DEL 误删他人锁   |
| 正确版             | SET NX PX + 唯一 token | Lua 比较后删除  | 仍有超时悖论（见第三节）      |
| 原生版（Redis 8.4+） | SET NX PX + 唯一 token | DELEX IFEQ | 同上                |


### 二、整体工作流
```text
客户端A ──SET lock tokenA NX PX 30000──▶ ┌─────────┐
         ◀────────────── OK ────────────── │  Redis  │
客户端B ──SET lock tokenB NX PX 30000──▶ └─────────┘
         ◀────────────── nil（未拿到锁，重试或放弃）
         
客户端A ──EVAL(值等于tokenA才DEL)──▶ Redis   释放锁
客户端B ──SET lock tokenB NX PX 30000──▶ Redis   拿到锁
```

### 三、主从架构下的锁丢失：Redlock 的动机

单机 Redis 有单点风险，常见做法是主从 + 哨兵，但异步复制会破坏互斥：
```text
客户端1 ──SET lock token1 NX PX 30000──▶ Master（写入成功，尚未复制）
客户端1 认为自己持锁
Master 宕机 ──▶ 哨兵提升 Replica 为新 Master（lock key 不存在）
客户端2 ──SET lock token2 NX PX 30000──▶ 新 Master（写入成功）
→ 客户端1、客户端2 同时认为自己持有同一把锁
```

有人会问：用 `WAIT 1 1000` 强制 master 等待至少 1 个副本确认再返回，能不能解决？只能缩小窗口，不能根除：副本的确认代表「命令已在副本内存中应用」，不保证已持久化（副本重启仍可能丢失），也不保证该副本一定会被提升为新 master；官方文档明确 WAIT 不是强一致机制，只是尽力而为的同步。只要复制是异步的，锁丢失的窗口就存在，这正是 Redlock 用 N 个独立 master 取代主从结构的动机。

### 四、Redlock 算法

由 Redis 作者 antirez 在官方文档 *Distributed Locks with Redis* 中提出。假设有 N 个完全独立的 Redis master（示例为 5 个），互相之间没有复制和集群关系，部署在不同机器/机房。

加锁伪代码：
```text
func Acquire(key, token, ttl):
    start = now()
    acquired = 0
    for node in nodes:                       # 5 个独立 master
        if SET key token NX PX ttl on node:  # 单节点请求超时 5~50ms，远小于 ttl
            acquired++
        else:
            continue                         # 该节点失败或超时，立即放弃
    elapsed = now() - start
    if acquired >= N/2 + 1 and elapsed < ttl:
        return true, ttl - elapsed           # 成功，有效期为剩余时间
    else:
        for node in nodes:                   # 释放所有节点（包括认为失败的）
            EVAL(unlock_script, key, token)
        return false
```

关键设计点：

- **过半即成功**：任意两个成功集合必有交集，最多一个客户端能拿到过半节点的锁，这是互斥的投票基础。
- **耗时校验**：拿到过半锁但总耗时已经超过 TTL 时视为失败，因为此时部分节点上的锁可能已过期，互斥不再成立。
- **全量释放**：对「响应丢失但服务端已写入」的节点也要释放，否则留下孤儿锁阻塞后续客户端。
- **崩溃恢复约束**：节点重启后必须在最大 TTL 时间内拒绝服务（或启用 fsync=always 的 AOF），否则重启丢失锁记录、提前放行新客户端，互斥失效。
- **时钟漂移余量**：官方规范在计算有效时间时要求为各节点时钟漂移留出余量，漂移大小由运维环境估计。

### 五、Redisson 的 watchdog 与可重入实现（源码级）

Redisson 是 Java 生态最常用的 Redis 客户端，其锁实现值得作为源码级范例。

**默认租约**：`org.redisson.config.Config` 中 `private long lockWatchdogTimeout = 30 * 1000;`——默认 30 秒，可通过 `setLockWatchdogTimeout` 调整。**仅在未显式指定 leaseTime 时生效**。

**初始化**：`RedissonLock` 构造器中 `this.internalLockLeaseTime = getServiceManager().getCfg().getLockWatchdogTimeout();`。

**加锁分支**：`tryAcquireOnceAsync` 中，`leaseTime > 0` 时按用户指定时间加锁且**不启动看门狗**；否则按 `internalLockLeaseTime`（30s）加锁，成功后调用 `scheduleExpirationRenewal(threadId)` 启动续期。

**续期调度**：`RedissonBaseLock.renewExpiration` 中的定时任务（基于 Netty HashedWheelTimer）以 `internalLockLeaseTime / 3`（默认 10 秒）为周期递归执行，通过 Lua 脚本检查锁 hash 中自己的 field 是否仍存在（hexists），存在则 pexpire 重置为 30 秒；锁已不存在、线程被中断或 Redis 异常时调用 `cancelExpirationRenewal` 取消续期。全局静态 `EXPIRATION_RENEWAL_MAP` 记录每个锁名对应的续期任务，重入时只追加线程 ID、不重复创建定时任务。

**可重入**：锁在 Redis 中是一个 hash，key 为锁名，field 为「连接 ID:线程 ID」，value 为重入计数。加锁 Lua 脚本对 field 做 hincrby 计数并 pexpire；释放时计数减一，减到零才真正删除 key。同一个线程重入多少次都不需要重新抢锁，也不会误释放。

**局限**：watchdog 依赖客户端进程存活与网络可达。客户端宕机、GC 停顿超过 30 秒或网络分区期间，续期停摆，锁照样过期——所以看门狗解决的是「业务时长不确定」而不是「互斥绝对可靠」。

### 六、Kleppmann 与 antirez 之争：Redlock 安全吗

2016 年 2 月 8 日，Martin Kleppmann（《数据密集型应用系统设计》作者）发表 *How to do distributed locking*，指出任何依赖租约的分布式锁都有根本性缺陷。次日 antirez 发表 *Is Redlock safe?* 回应。这是分布式系统领域最著名的工程争论之一，面试答出双方论据是重要加分项。

**Kleppmann 的 GC 停顿场景**：
```text
客户端1 ──加锁成功（TTL=30s）──▶ Redis
客户端1 ──GC 停顿 40s（锁已过期）──
客户端2 ──加锁成功──▶ Redis ──写共享存储──▶ 存储
客户端1 恢复，继续写共享存储
→ 两个客户端并发写，互斥失效（HBase 曾因此发生生产事故）
```

注意「写之前先检查锁是否仍属于自己」也救不了：停顿可能恰好发生在检查之后、写入之前。**根本解法是 fencing token**：锁服务返回单调递增的令牌，写共享存储时携带令牌，存储层拒绝任何小于已见最大令牌的写入：
```text
锁服务 ──锁 + token=33──▶ 客户端1（随后停顿，锁过期）
锁服务 ──锁 + token=34──▶ 客户端2 ──写(token=34)──▶ 存储（记录 maxToken=34）
客户端1 恢复 ──写(token=33)──▶ 存储 ✗ 拒绝（33 < 34）
```

令牌必须**单调递增**而非随机 UUID：存储层无法区分一个没见过的 UUID 属于新持有者还是停顿后恢复的旧客户端。ZK 的 zxid、etcd 的 revision 天然满足这个要求；Redlock 的随机 token 不满足。

**Kleppmann 的时钟跳跃场景**（5 节点）：客户端1 拿到 A、B、C 三节点锁；C 的时钟向前跳导致锁提前过期；客户端2 拿到 C、D、E 三节点锁；两个客户端同时认为自己持锁。结论是 Redlock 的安全性依赖时钟，而好的分布式算法（Paxos、Raft）的安全性不应依赖任何时序假设——时序失效最多影响活性（liveness），绝不能影响安全性（safety）。

**antirez 的三点回应**：

1. 如果业务已经有 fencing 机制兜底互斥，那强锁本身就不必要，一个弱锁（只降低并发概率）就够了——Redlock 面向的正是效率型场景。
2. Redlock 只假设**半同步模型**：各节点时钟走速大致相同（如 5 秒的计量误差在 10% 以内），不要求绝对时间精确、不要求消息延迟有界；时钟跳跃属于运维事故（人工改时钟、ntpd 大步跳变），应当通过运维规范（平滑校时）消除。
3. 唯一 token 配合 check-and-set（操作共享资源前把状态置为 token，写回时校验 token 未变）可以达到与 fencing 类似的效果，且不要求锁服务提供强一致存储。他同时承认 Redis 应改用操作系统的单调时钟 API。

**公认结论**：Redlock 比单机/主从锁更抗节点故障，但其安全性依赖时钟与进程调度假设，无法证明绝对互斥；效率型场景可用，正确性场景必须引入 fencing 或存储层校验。社区（含 HN 讨论）普遍认为 antirez 的回应没有正面解决 GC 停顿场景，fencing token 才是正确性场景的正解。

双方论点对比：


| 论点            | Kleppmann               | antirez                          |
| ------------- | ----------------------- | -------------------------------- |
| 锁的用途          | 区分效率锁与正确性锁              | 认同该区分，Redlock 就是效率锁              |
| 客户端停顿         | 停顿超过 TTL 必然互斥失效，任何租约锁无解 | 未正面回应，强调唯一 token 的 check-and-set |
| 时钟假设          | 安全性不得依赖时钟               | 半同步模型足够，时钟跳跃是运维事故                |
| fencing token | 正确性场景必须，须单调递增           | 有 fencing 就不需要强锁；唯一 token 可替代    |
| 共同点           | —                       | 双方都同意 Redis 应改用单调时钟 API          |


### 七、主流分布式锁方案对比


| 方案                  | 一致性模型       | 性能         | 自动释放        | fencing 支持    | 主要失效场景                   |
| ------------------- | ----------- | ---------- | ----------- | ------------- | ------------------------ |
| Redis 单机（SET NX PX） | AP          | 极高（微秒级）    | TTL         | 需自建           | 节点宕机丢锁；主从切换丢锁            |
| Redlock             | 无强一致证明      | 高（N 次网络往返） | TTL         | 需自建           | 时钟跳跃、GC 停顿、节点重启未延迟       |
| ZooKeeper           | CP（ZAB 过半写） | 低（毫秒级）     | 会话过期删临时节点   | zxid 天然递增     | 客户端 GC 致会话过期误判；分区时锁服务不可用 |
| etcd                | CP（Raft）    | 低-中        | 租约（lease）过期 | revision 天然递增 | 同上                       |
| DB 唯一约束 / 乐观锁版本号    | 依赖 DB 事务    | 中          | 事务回滚        | 版本号天然递增       | 依赖 DB 可用性                |


需要强调：**ZK/etcd 的锁同样解决不了客户端停顿问题**——客户端 GC 停顿时会话/租约过期，另一个客户端拿到锁，停顿的客户端恢复后依然可能继续操作。ZK 比 Redis 强在「锁服务本身不会脑裂」（两个客户端不可能都从锁服务成功拿到锁），但 fencing 的需求对任何租约型锁都是通用的。所以正确性场景的完整方案是「CP 锁服务 + fencing token + 存储层校验」，而不是把 ZK 锁当作银弹。

### 八、Redis 8.4 的原生命令支持

Redis 8.4（GA 于 2025 年 11 月，PR #14435 随 8.4-RC1 引入）新增了原子字符串命令：

- `DELEX key IFEQ match-value`：值完全相等才删除，即原子比较删除（CAD），可直接替代释放锁的 Lua 脚本；
- `SET key value IFEQ match-value`：比较交换（CAS）语义的 SET 扩展。

对分布式锁的意义是：加锁、释放都从「Lua 脚本」退化为单条原生命令，省去脚本维护和 EVALSHA 缓存管理。Spring Integration 的 `RedisLockRegistry` 已集成 DELEX，并在连接旧版本 Redis 时降级为 warn/info 日志提示。需要注意 DELEX 要求 Redis 8.4+，存量集群升级前仍以 Lua 脚本为准。

### 九、面试追问

**追问一：业务执行超过 TTL 且没有续期机制，会发生什么？如何根治？**

锁过期后被其他客户端获取，原客户端继续执行，两个客户端并发进入临界区；更糟的是原客户端执行完还会（在正确实现下）因 token 不匹配而释放失败，它自己却不知道互斥已经失效。根治分三层：第一，锁内逻辑做短，把重活移出临界区；第二，用 watchdog 续期覆盖「正常但慢」的执行，但要接受续期在宕机/分区时停摆；第三，正确性场景下让共享资源的存储层做最终仲裁——唯一约束、版本号 CAS、fencing token，锁只负责降低冲突概率。任何依赖 TTL 的锁，客户端都必须按「锁随时可能失效」来设计业务。

**追问二：Redlock 具体在什么时序下会失效？**

两类经典时序。其一，客户端 GC 停顿：客户端1 在 5 个节点上拿到 3 票成功，随后停顿超过 TTL，客户端2 拿到另一组 3 票（或同组节点的锁在过期后被再次写入），两者都认为自己持锁——Redlock 的耗时校验只能发现「获取过程中」的停顿，管不了获取之后的停顿。其二，时钟跳跃：客户端1 拿到 A、B、C 三票后，C 的时钟向前跳导致锁提前过期，客户端2 拿到 C、D、E 三票，两个多数派没有交集。核心是 Redlock 的安全性依赖时钟，而时钟跳跃、GC 停顿在现实系统中必然存在。

**追问三：ZooKeeper 的锁就绝对安全吗？为什么还说要 fencing？**

不安全，ZK 解决的是另一个层面的问题。ZK 锁的互斥保证是「锁服务侧」的：临时顺序节点 + 会话，ZK 集群过半写成功才会话生效，脑裂时不会出现两个客户端都从锁服务拿到锁。但「客户端侧」的停顿问题依然存在：客户端 GC 停顿超过会话超时，ZK 判定会话过期、删除临时节点，另一个客户端拿到锁；停顿的客户端恢复后照样会继续操作共享资源。所以即使用 ZK，正确性场景依然需要 fencing token 或存储层校验，ZK 的优势只是天然提供单调递增的 zxid 作为 token。反过来看，如果存储层已经支持 fencing 校验，锁本身用 Redis 还是 ZK 就只剩性能与可用性的取舍——这正是 antirez 的核心反驳。

**追问四：可重入锁为什么 Redis 原生命令实现不了，Redisson 是怎么做的？**

可重入要求「同一个持有者再次加锁时计数加一并刷新 TTL」，这需要先判断当前持有者是否是自己、再决定是新建还是计数，本质是读改写复合语义，单条 SET 命令表达不了；用多条命令（GET + SET）又破坏了原子性。Redisson 的解法是把锁建模成 Redis hash：key 为锁名，field 为「连接 ID:线程 ID」，value 为重入计数，加锁/释放都用一条 Lua 脚本完成 hincrby/hexists 判断 + pexpire 续期，脚本内原子，于是可重入与续期同时解决。这也解释了为什么 Redis 官方只给「正确用法」而不给「完整锁库」——可重入、续期、公平性这些能力都需要客户端库在原子脚本之上叠加实现。

**追问五：Redis 宕机了锁服务怎么办？业务还能不能继续？**

分两层回答。可用性层面：分布式锁服务本身应该高可用（主从哨兵、Redlock 多节点），但任何锁服务都可能整体不可用——此时正确的策略是「快速失败而非放大风险」：拿不到锁的请求按业务语义决定是直接报错、排队重试还是降级执行，绝不能跳过锁硬执行，否则锁服务故障直接演变成互斥失效。正确性层面：如果业务对互斥的要求是硬性的，锁服务不可用时正确做法是拒绝进入临界区（宁可不可用也不错误执行），这恰恰是 CP 锁服务的取舍逻辑；如果只是效率型防重，可以评估短暂降级（如配合数据库唯一约束继续过滤，参考 [004-kafka为什么会出现重复消费](../kafka/004-kafka%E4%B8%BA%E4%BB%80%E4%B9%88%E4%BC%9A%E5%87%BA%E7%8E%B0%E9%87%8D%E5%A4%8D%E6%B6%88%E8%B4%B9.md) 中幂等去重的降级思路）。锁服务的 SLA 设计永远要和业务对互斥失效的容忍度对齐。

### 十、参考链接

- [Redis SET 命令文档（NX/EX/PX 选项）](https://redis.io/docs/latest/commands/set/)
- [Redis SETNX 命令文档（标记为 deprecated）](https://redis.io/docs/latest/commands/setnx/)
- [Distributed Locks with Redis（Redlock 官方规范）](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [How to do distributed locking — Martin Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Is Redlock safe? — antirez](https://antirez.com/news/101)
- [Redisson Config.java（lockWatchdogTimeout 定义）](https://github.com/redisson/redisson/blob/master/redisson/src/main/java/org/redisson/config/Config.java)
- [Redisson RedissonLock.java / RedissonBaseLock.java（watchdog 续期实现）](https://github.com/redisson/redisson/blob/master/redisson/src/main/java/org/redisson/RedissonLock.java)
- [Redis 8.4.0 Release Notes（DELEX 命令）](https://github.com/redis/redis/releases/tag/8.4.0)


<!-- created: 2026-08-15 19:45:34 -->
<!-- updated: 2026-08-15 23:38:05 -->
