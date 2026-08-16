# 谈谈你对 Redis 架构的理解

## 题目

谈谈你对 Redis 架构的理解。

## 标签

[Redis](../../tags/Redis.md) | [缓存](../../tags/缓存.md) | [数据结构](../../tags/数据结构.md)

## 题目导航

← 无 | 无 →

## 面试直接答

Redis 本质上是一台基于内存的单进程数据结构服务器：事件驱动加 I/O 多路复用支撑单机十万级 QPS，多种紧凑的内部编码压缩内存占用，RDB 与 AOF 双持久化在恢复速度与丢数据窗口之间取平衡，再以主从复制、哨兵、Cluster 三级机制逐层解决高可用与水平扩展。理解 Redis 架构，核心是理解这条围绕「内存快、内存贵、断电即失、单机有上限」四大约束展开的取舍链。

先看单机执行模型。Redis 在 6.0 之前是纯粹的单线程：一个主线程运行事件循环，通过 epoll、kqueue、select 等多路复用接口统一监听所有客户端连接与定时事件，可读事件到达后按序执行命令。单线程快的根因是所有操作都在内存中完成，省去了线程切换与锁竞争的开销，命令天然串行执行，也就天然保证了单条命令的原子性。但单线程是历史选择而非绝对真理，它的真实边界是 O(N) 命令：KEYS、SMEMBERS 这类全量扫描命令在千万级 key 下会阻塞整个事件循环，所有客户端一起卡住。

Redis 6.0 引入的多线程 IO 正是针对该模型中最耗 CPU 的部分——socket 读写与协议解析——做的局部并行。按官方 release notes 的表述，它可以在无法使用 pipeline 的场景下让单实例吞吐翻倍；io-threads 只负责把响应写回 socket、可选地承担请求读取与解析，命令执行仍在单个主线程严格串行，因此数据结构层完全不需要加锁。该特性默认关闭，官方定位是主要对无法 pipeline 的高并发小请求场景有效。

再看数据组织。Redis 对外暴露字符串、哈希、列表、集合、有序集合等类型，对内按数据规模与形态动态选择编码：哈希与小对象用连续内存的 listpack 编码（7.0 起取代 ziplist），纯整数集合用 intset，有序集合在元素较多时切换为跳表加哈希表的组合，字符串则使用预分配冗余空间的 SDS。编码选择本质是内存占用与操作复杂度之间的平衡，OBJECT ENCODING 可以查看一个 key 当前的实际编码，小对象跨过阈值时编码自动转换。

持久化解决内存易失的问题。RDB 是点时间快照：fork 一个子进程，利用写时复制把那一刻的数据集落盘，恢复快、文件紧凑，但两次快照之间的写入会丢，官方文档明确通常要准备丢失最近几分钟的数据。AOF 记录每一条写命令，appendfsync 策略决定刷盘时机：always 每条刷、everysec 每秒刷（默认，最多丢一秒）、no 交给操作系统；文件膨胀后由后台重写生成最小命令集，7.0 起重写产物改为多文件结构——一个 base 文件加若干 incremental 文件加 manifest 清单，解决了旧版本重写期间内存缓冲与双写放大问题。官方建议想达到接近 PostgreSQL 的数据安全级别时两者并用。

单机之上是可用性。主从复制默认异步：主库把写命令作为复制流发给从库，从库用 PSYNC 携带自己的 replication ID 与 offset 请求续传；offset 落在主库 repl-backlog 缓冲区内就做部分重同步，否则全量同步——主库 fork 出 RDB 传给从库再补发缓冲命令。异步复制意味着从库天然有延迟，客户端可用 WAIT 要求 N 个副本确认，官方文档明确这能大幅降低故障时丢写的概率，但不会把系统变成强一致的 CP 系统。

哨兵在主从之上解决自动故障转移。哨兵是独立进程，对主库做心跳，单个哨兵判定不可达只是主观下线 SDOWN，多个哨兵达成 quorum 才算客观下线 ODOWN；quorum 只决定「判定故障」，真正执行切换还要多数派哨兵投票选出 leader，所以两台哨兵 quorum=1 的部署在哨兵所在机器也宕掉时无法完成切换。切换期间旧主可能仍可写，异步复制下脑裂是这类架构的固有风险，常用 min-replicas-to-write 让主库在健康从库过少时拒绝写入，以缩小丢数据窗口。

水平扩展靠 Cluster。整个键空间被划分为 16384 个槽，key 经 CRC16 取模映射到槽，槽再分配给各主节点；官方规范明确 16384 也是主节点数量的理论上限，实际建议的集群规模在一千个节点左右。节点间不依赖中心组件，靠 gossip 协议交换心跳与槽位信息，PFAIL 升级为 FAIL 需要多数主节点确认，故障转移由从节点凭 configEpoch 竞选成为新主。客户端访问错节点会收到 MOVED 或 ASK 重定向；跨槽的多 key 操作不被支持，除非用 hash tag 把相关 key 强制映射到同一个槽。

最后是内存治理。过期键的删除是惰性删除加定期扫描两条腿：访问时检查过期，后台 active expire cycle 周期性抽样清理，6.0 重写了该周期任务使清理更快且开销可调。内存触及 maxmemory 后触发淘汰，共八种策略，LRU 与 LFU 都是近似实现——LRU 默认每次只抽样 5 个 key 挑最旧的淘汰，LFU 自 4.0 引入，用 Morris 概率计数器加衰减周期估计访问频率。底层内存由 jemalloc 分配器管理，碎片率、共享对象的引用计数、4.0 引入的惰性释放共同影响真实内存水位。

把这些层串起来看，Redis 的架构是一条清晰的约束驱动链：内存快，所以单线程加事件循环就足够快；内存贵，所以有编码压缩、抽样淘汰与过期清理；断电易失，所以有 RDB 与 AOF 的组合持久化；单机有上限，所以有主从、哨兵到 Cluster 的递进式分布式方案；而每一步都保留了明确的边界——异步复制的丢数据窗口、单线程的阻塞命令、Cluster 的跨槽限制。面试中把每个机制背后的约束与取舍讲清楚，比背诵参数更有说服力。

## 详细解析

> 版本核验：Redis 7.0（部分机制追溯到 4.0 / 6.0），2026-08-15。以下机制描述均对应官方文档（redis.io / redis-doc 仓库）与源码中的具体文件、配置项。

### 一、整体架构图
```
                         ┌────────────────────────────────┐
   客户端 ──TCP/RESP──>   │           Redis Server          │
                         │  ┌────────────────────────────┐ │
                         │  │ 事件循环 ae.c + epoll/kqueue │ │
                         │  └─────────────┬──────────────┘ │
                         │                │ 命令执行(主线程) │
                         │  ┌─────────────▼──────────────┐ │
                         │  │   数据结构层（编码自适应）    │ │
                         │  │ SDS / hashtable / skiplist  │ │
                         │  │ listpack / intset / quicklist│ │
                         │  └──────┬──────────────┬───────┘ │
                         │         │              │         │
                         │  ┌──────▼──────┐ ┌─────▼──────┐  │
                         │  │ 过期与淘汰   │ │ RDB / AOF  │  │
                         │  └─────────────┘ │ 持久化     │  │
                         │                  └────────────┘  │
                         └───────────┬──────────────────────┘
                                     │ 复制流（默认异步）
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
      ┌───────────┐           ┌───────────┐           ┌───────────┐
      │ Replica   │           │ Sentinel  │           │ Cluster   │
      │ 读写分离   │           │ 故障转移   │           │ 分片扩容   │
      └───────────┘           └───────────┘           └───────────┘
```

### 二、单机执行模型：事件循环与多线程 IO 的边界

事件循环实现在 `ae.c`（aeCreateFileEvent / aeMain），对 epoll、kqueue、select 做了统一抽象；命令分发在 `networking.c` 的 `processCommand`。单线程意味着「读请求 → 执行命令 → 写响应」全在一个线程内完成，锁竞争为零。

6.0 的 Threaded I/O 官方表述（6.0 RC1 release notes 原文）：*"Redis can now optionally use threads to handle I/O, allowing to serve 2 times as much operations per second in a single instance when pipelining cannot be used."* 注意两处边界：其一，`io-threads` 默认值为 1，即默认关闭；其二，redis.conf 注释明确 *"we only use threads for writes, that is to thread the write(2) syscall and transfer the client buffers to the socket"*，读侧与协议解析需另开 `io-threads-do-reads`，而命令执行永远在主线程。所以「Redis 6.0 变成多线程」是常见误读——准确说法是「IO 层可选多线程，执行层保持单线程」。单线程的真正风险点是 O(N) 命令与 bigkey 删除阻塞主线程，对应 4.0 引入的 `UNLINK`（lazyfree，异步释放内存）。

### 三、数据结构与内部编码

Redis 的「类型」与「编码」是两层概念：类型决定命令语义，编码决定内存布局，编码在阈值处自动切换。7.0 起 ziplist 被 listpack 取代（release notes：*"Replace ziplist with listpack in Hash, List, Zset"*），listpack 修复了 ziplist 级联更新的缺陷。默认阈值（redis.conf 7.0 实测）：


| 类型     | 小对象编码                  | 大对象编码           | 默认切换阈值                                        |
| ------ | ---------------------- | --------------- | --------------------------------------------- |
| string | embstr（≤44 字节）         | raw（SDS）        | 44 字节                                         |
| hash   | listpack               | hashtable       | `hash-max-listpack-entries 512` / value 64 字节 |
| list   | quicklist（listpack 节点） | quicklist       | `list-max-listpack-size -2`（8KB/节点）           |
| set    | intset                 | hashtable       | `set-max-intset-entries 512`（且全为整数）           |
| zset   | listpack               | skiplist + dict | `zset-max-listpack-entries 128`               |


哈希表扩容走**渐进式 rehash**：维护新旧两张表，每次访问顺带搬迁一部分桶，避免一次性搬迁卡住事件循环。zset 大对象用跳表加字典的组合——字典按成员 O(1) 查分值，跳表按分值有序遍历。

**跳表 vs B+ 树**（交叉引用 [001-MySQL的底层数据结构](../mysql/001-MySQL%E7%9A%84%E5%BA%95%E5%B1%82%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84.md)）：


| 维度     | 跳表（Redis zset）        | B+ 树（MySQL InnoDB） |
| ------ | --------------------- | ------------------ |
| 平衡方式   | 概率平衡，插入随机层数，无需旋转      | 分裂/合并维护严格平衡        |
| 实现复杂度  | 低，代码量小                | 高，分裂合并逻辑复杂         |
| 存储介质假设 | 内存，指针跳跃零成本            | 磁盘，页式存储利于顺序 IO     |
| 范围查询   | O(logN) 定位后沿第 0 层链顺序扫 | 叶子链表顺序扫            |
| 写入成本   | 只影响局部节点               | 可能触发页分裂与重平衡        |


结论：Redis 选跳表是「内存 + 实现简单 + 范围查询」的组合最优，而不是跳表绝对优于 B+ 树。

### 四、持久化：RDB、AOF 与 7.0 多文件 AOF


| 维度    | RDB             | AOF（everysec） | 混合（RDB preamble） |
| ----- | --------------- | ------------- | ---------------- |
| 恢复速度  | 快（直接加载二进制）      | 慢（逐条回放命令）     | 快                |
| 丢数据窗口 | 分钟级（取决于 save 点） | 最多 1 秒        | 最多 1 秒           |
| 文件体积  | 紧凑              | 较大            | 接近 RDB           |
| 实现机制  | fork + COW 快照   | 命令追加 + 后台重写   | AOF 文件以 RDB 开头   |


RDB 依赖 fork 的**写时复制**：子进程与父进程共享页表，父进程写脏页时才复制。实例越大，fork 本身耗时越长（官方文档指出大数据集下可能阻塞数百毫秒到一秒），写流量越大 COW 复制的内存越多。AOF 重写同样 fork 出子进程，旧版本（&lt;7.0）父进程在重写期间把新写命令缓冲在内存、重写完成后再追加，带来内存开销与双写；7.0 的 **Multi-Part AOF** 改为「子进程写 base 文件 + 父进程写 incremental 文件 + manifest 原子切换」，消除了这个问题。三种 `appendfsync` 策略的语义是：`always` 每条命令后 fsync（组提交优化）、`everysec` 后台线程每秒 fsync（默认，官方文档原话 *"you can only lose one second worth of writes"*）、`no` 完全交给内核（Linux 通常约 30 秒刷一次）。与 Kafka 的持久化设计对比（交叉引用 [003-kafka为什么快？](../kafka/003-kafka%E4%B8%BA%E4%BB%80%E4%B9%88%E5%BF%AB%EF%BC%9F.md)）：两者都利用顺序追加写，但 Kafka 依赖页缓存加零拷贝服务于读路径，Redis 的 AOF 只服务于启动恢复，读路径始终在内存。

### 五、主从复制与哨兵

复制的核心机制（官方 replication 文档）：每个主库有 **replication ID**（标记数据集的「历史」）与 **offset**（复制流字节偏移）；从库断线重连后发 `PSYNC <id> <offset>`，主库若在 `repl-backlog-size`（默认 1MB）的环形缓冲区内能找到该偏移则增量补发，否则全量同步（主库 fork RDB + 缓冲期间写命令）。主库持有双 replication ID：故障转移后提升的从库把旧 ID 降为 secondary ID，使其他从库能对新主做部分重同步，避免全量同步。

哨兵的关键区分（官方 sentinel 文档）：**quorum 只用于判定故障**（多少个哨兵认为主库不可达），**执行切换需要多数派哨兵投票**。官方文档原话：*"the quorum is only used to detect the failure. In order to actually perform a failover, one of the Sentinels need to be elected leader ... with the vote of the majority of the Sentinel processes"*。因此哨兵部署奇数台、多数派可达是硬约束。脑裂场景：主库网络分区但仍可写，哨兵侧完成切换，分区恢复后旧主数据被覆盖；缩小损失的配置是 `min-replicas-to-write 1`（从库过少时主库拒绝写入）配合 `min-replicas-max-lag`。

### 六、Cluster：分片与去中心化

官方 cluster spec 的关键事实：键空间被划分为 **16384 个哈希槽**，`HASH_SLOT = CRC16(key) mod 16384`（CRC16 采用 XMODEM 变体）；spec 明确 16384 是主节点数量的理论上限，*"the suggested max size of nodes is on the order of \~ 1000 nodes"*。选 16384 的工程权衡（作者 antirez 在社区的解释）：gossip 心跳包要携带节点槽位位图，16384 位恰好 2KB，在「心跳包体积」与「足够的分片粒度」之间取平衡。

**hash tag 示例**（把多个 key 钉在同一槽，支持多 key 操作）：
```
redis-cli -c SET user:{1001}:name "zhao"
redis-cli -c SET user:{1001}:age  "28"
redis-cli -c MGET user:{1001}:name user:{1001}:age   # 同一槽，允许
```

**MOVED 与 ASK 的区别**：槽已确定迁移完成时返回 `MOVED 127.0.0.1:7001`，客户端应更新本地槽映射，后续请求直连新节点；槽正在迁移中时返回 `ASK`，是一次性重定向，客户端下次仍访问原节点。故障检测走 gossip：节点间每秒互发 ping/pong 心跳（携带随机节点的状态信息），本节点判定某节点不可达仅为 **PFAIL**，需多数主节点在 `NODE_TIMEOUT * 2` 内共同确认才升级为 **FAIL** 并广播；从节点检测到主节点 FAIL 后发起选举，胜者凭更大的 **configEpoch** 接管槽位。这种去中心化设计没有元数据中心，代价是集群状态是最终一致的，网络分区期间可能出现短期的视图不一致。

### 七、过期与淘汰

过期键删除是**惰性 + 定期**双保险：命令访问 key 时先检查过期时间（`expireIfNeeded`），后台 `activeExpireCycle` 周期性从过期字典抽样扫描，6.0 重写了该周期任务（release notes：*"The Redis active expire cycle was rewritten for much faster eviction of keys that are already expired. Now the effort is tunable."*）。过期与淘汰是两回事：过期只针对设了 TTL 的 key，淘汰在 `maxmemory` 触发时按策略执行。八种策略中最常用的两组：`allkeys-lru/lfu` 面向纯缓存场景（官方建议拿不准就用 `allkeys-lru`，因其符合典型的幂律访问分布），`volatile-*` 面向「缓存 + 持久 key」混合场景，且在没有符合条件（设了 TTL）的 key 时退化为 `noeviction` 直接报错。LRU 是**近似实现**：每次从全库抽样 `maxmemory-samples`（默认 5）个 key 淘汰其中最旧的，官方文档说明在幂律分布下与精确 LRU 的差距极小；LFU（4.0+）用 **Morris 概率计数器**（每对象几 bit）加衰减周期估计访问频率，能适应访问模式随时间漂移的场景。

### 八、内存管理

内存分配使用 **jemalloc**（源码 `zmalloc.c` 对 libc malloc 与 jemalloc 做了封装），jemalloc 的 arena 与 size class 设计（交叉引用 [002-从OS底层到语言层的内存管理全景](../os/002-%E4%BB%8EOS%E5%BA%95%E5%B1%82%E5%88%B0%E8%AF%AD%E8%A8%80%E5%B1%82%E7%9A%84%E5%86%85%E5%AD%98%E7%AE%A1%E7%90%86%E5%85%A8%E6%99%AF.md)）能显著降低碎片；`INFO memory` 里的 `mem_fragmentation_ratio` 反映碎片率，大于 1.5 时需要关注。两个容易被忽视的机制：一是**共享对象**——0 到 9999 的整数对象在启动时预创建、引用计数共享，所以小整数 key 几乎不占额外内存；二是 4.0 引入的 **lazyfree**——`UNLINK`、`FLUSHALL ASYNC` 等把大对象释放放到后台线程，避免删除 bigkey 阻塞主线程。

### 九、面试追问

**追问一：为什么 zset 用跳表而不是红黑树？** 三个理由：范围查询天然高效（第 0 层是有序链表，定位后顺序遍历即可，红黑树需要中序遍历）；实现简单，插入只影响局部节点，红黑树要处理旋转与染色；概率平衡在纯内存场景下足够稳定，且 Redis 的历史实现者更看重可维护性。反过来说，跳表指针冗余多、缓存局部性差，放磁盘场景必输给 B+ 树，这恰好印证了「数据结构选型跟着存储介质走」（见第三节对比表）。

**追问二：主从 + 哨兵能保证数据不丢吗？** 不能。异步复制下，主库返回客户端成功后才异步发给从库，主库宕机的瞬间，尚未传输的写入就丢了——官方文档明确 WAIT 只是「大幅降低」丢失概率，*"does not turn a set of Redis instances into a CP system"*。量化的丢数据窗口 = 主库 AOF 刷盘间隔（everysec 下 1 秒）与复制延迟的最大值。要更强保证只能上 Raft 类强一致存储（如 etcd），或业务层容忍。这个边界是 Redis 架构定位决定的：它首先是缓存与高性能存储，不是强一致数据库。

**追问三：6.0 多线程 IO 之后，说「Redis 是单线程的」还成立吗？** 命令执行层面依然成立。io-threads 只并行化 socket 写（可选读与解析），执行与数据结构修改严格单线程，所以锁模型没有变化。官方定位也克制：release notes 说的是「无法 pipeline 时吞吐翻倍」，且默认关闭——如果 CPU 瓶颈在命令执行本身（如复杂聚合），多线程 IO 毫无帮助。可以反问场景：你要解决的瓶颈是网络收发还是命令计算。

**追问四：为什么是 16384 个槽，而不是 65536 或 1024？** 官方 spec 只给出「16384 是主节点数理论上限、建议 \~1000」的事实；数量选择是作者 antirez 的工程权衡：gossip 心跳包携带节点槽位位图，16384 位 = 2KB，与心跳包常见大小匹配，再大包体积膨胀、再小分片粒度不足。这也解释了为什么官方不推荐把集群扩到几千节点——不是槽不够，而是 gossip 消息量（每节点每秒向随机节点 ping）与全互联维护成本随节点数上升。

**追问五：过期键的删除和 maxmemory 淘汰是什么关系？** 触发条件不同：过期只针对带 TTL 的 key、到点即删（惰性 + 定期）；淘汰只在内存触及 maxmemory 时发生，按策略挑选牺牲者，与 key 是否带 TTL 无关（allkeys-\* 策略）。一个反直觉的细节：`volatile-lru` 在「没有任何 key 带 TTL」时等价于 `noeviction`——内存满了直接拒绝写入而不是随便删数据，官方文档明确了这个退化行为。实践上纯缓存用 `allkeys-lru` 还能省掉 TTL 字段本身的内存。

### 十、参考链接

- [Redis persistence（官方文档）](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis replication（官方文档）](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Redis Sentinel（官方文档）](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis Cluster Specification（官方规范）](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Key eviction（官方文档，redis-doc 仓库）](https://raw.githubusercontent.com/redis/redis-doc/master/docs/reference/eviction/index.md)
- [Redis 6.0 Release Notes（Threaded I/O 官方说明）](https://raw.githubusercontent.com/redis/redis/6.0/00-RELEASENOTES)
- [Redis 7.0 Release Notes（listpack 取代 ziplist、Multi-Part AOF）](https://raw.githubusercontent.com/redis/redis/7.0/00-RELEASENOTES)
- [redis.conf 7.0（编码阈值与 io-threads 默认值）](https://raw.githubusercontent.com/redis/redis/7.0/redis.conf)


<!-- created: 2026-08-15 19:52:49 -->
<!-- updated: 2026-08-15 22:15:02 -->
