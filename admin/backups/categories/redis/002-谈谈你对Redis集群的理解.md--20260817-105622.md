# 谈谈你对 Redis 集群的理解

## 题目

谈谈你对 Redis 集群的理解？请介绍 Redis Cluster 的架构设计、数据分片机制、故障转移流程与一致性保证，并与主从 + 哨兵等方案做对比。

## 标签

[Redis](../../tags/Redis.md) | [缓存](../../tags/缓存.md)

## 题目导航

← [001-Redis分布式锁](001-Redis分布式锁) | 无 →

## 面试直接答

> Redis 集群通常指 Redis Cluster，它是 Redis 官方提供的分布式方案：用 CRC16 将 key 映射到 16384 个哈希槽实现数据分片，节点间通过 gossip 协议去中心化地维护集群状态，主节点故障时由从节点投票选举自动接管，兼顾水平扩展与高可用。它的核心边界是：异步复制决定了它只能提供最终一致、故障转移可能丢写，且跨槽的多 key 操作受限。

理解 Redis 集群，先看`单机 Redis` 的瓶颈：内存容量有上限、单实例处理能力有限、而且它是单点。

业界据此演进出了几条路线。主从复制把数据异步复制到多个副本，解决读扩展和热备份；Sentinel 在复制之上加了一层监控和自动故障转移，解决高可用；但这两条路线里每个节点都持有全量数据，解决不了容量问题。Redis Cluster 则把数据分片和高可用融为一体，是官方推荐的规模化方案，从 Redis 3.0 开始提供。

数据分片是集群的核心，它采用的不是一致性哈希，而是`哈希槽`。

整个集群固定划分 16384 个槽，每个 key 通过 slot = crc16(key) &amp; 16383 映射到唯一槽位，槽再分配到各个主节点。槽是数据迁移和路由的最小单位，key 跟随槽走，加节点时只需要把部分槽迁过去，key 与节点的映射关系不用整体重算。此外还支持 hash tag：如果 key 中含有花括号，只有括号内的部分参与哈希，于是 user:{1001}:name 和 user:{1001}:age 这类 key 会被强制落在同一个槽，从而允许对它们执行 MGET、事务这类要求同槽的操作。为什么是 16384 这个数，官方在集群规范里解释过：gossip 心跳包要携带槽位位图，16384 个槽的位图正好 2KB，而 CRC16 满量程的 65536 个槽需要 8KB，带宽代价太大，16384 又足够分给官方规范中约一千个主节点的设计规模。

架构上 Redis Cluster 是完全`去中心化`的，没有代理层、没有中心协调节点，所有节点两两互联，通过独立的集群总线端口（服务端口加 10000）用二进制协议通信。状态传播靠 gossip：每个节点周期性随机挑选节点发 PING，PING 和 PONG 包里都携带发送者视角下的一部分节点表，以此完成拓扑发现和故障信息扩散。故障检测分两级：一个节点超过 cluster-node-timeout（默认 15 秒）没有响应 PING，会被对方标记为 PFAIL，但这只是单节点的主观怀疑；当多数主节点都报告该节点失联时，才升级为 FAIL 并广播出去，触发故障转移。这种多数确认的设计是为了避免网络分区造成的误判。

故障转移由从节点发起。从节点发现自己的主节点进入 FAIL 状态后，会延迟一段时间再发起选举，延迟大致是 500 毫秒加一个随机值，再加复制偏移排名乘以 1 秒，这样数据最新的从节点最先拉票，避免落后太多的副本上位。选举借鉴了 Raft 的任期思想，但并不是 Raft：候选者广播投票请求，拿到多数主节点投票的从节点成为新主节点。集群里维护 currentEpoch 和 configEpoch 两类逻辑时钟，新主节点会获得一个全局唯一且更大的 configEpoch 来声明槽位归属，其他节点见到更大的 configEpoch 就更新路由表，所以即使分区期间两边各自选出主节点，恢复后也是 epoch 大的一方胜出，集群收敛到一致状态。另外还有副本迁移机制：当一个主节点没有任何从节点时，其他主节点冗余的从节点会自动迁移过去补位，防止出现孤儿主节点。

对客户端而言，集群语义体现在重定向上。请求发到错误节点会收到 MOVED 或 ASK 错误：MOVED 表示槽已经永久归属其他节点，客户端应更新本地路由表再重试；ASK 只出现在槽迁移过程中，是一次性临时重定向，客户端要先发 ASKING 命令再执行原命令，且不更新路由表。主流客户端库如 Jedis、Lettuce、go-redis 都是 smart client，本地缓存槽位映射，通常一次重定向之后就能直连正确的节点。扩容的本质就是槽迁移：新节点加入后执行 reshard，通过 MIGRATE 命令逐 key 迁移，迁移中的槽在源和目标节点同时存在，源节点用 ASK 把请求导向目标，迁移完成后广播新的槽位归属，整个过程服务不中断。

必须讲清一致性边界。主从之间是异步复制，主节点不等待从节点确认就返回客户端，所以主节点宕机时，最近一段时间的写入可能丢失；WAIT 命令可以让客户端阻塞等待指定数量的从节点确认收到，提高故障转移后写入被保留的概率，但官方文档明确说明 WAIT 并不能让 Redis 成为强一致存储，因为强一致还要求故障转移时只能选举持有全部已确认写入的节点，而 Redis 的选举是尽力而为的。另外，集群模式下多 key 命令要求所有 key 在同一个槽，否则返回 CROSSSLOT 错误，Lua 脚本和事务同样受此约束；pipeline 本身可用，smart client 会按节点自动拆分，但跨节点没有原子性；集群只支持 db 0；pub/sub 默认是全局广播，每个节点都会转发，订阅规模大时开销明显，Redis 7 引入的 sharded pub/sub 把频道绑定到槽上缓解了这个问题。

和主从加 Sentinel 相比，Cluster 的根本差异在分片：Sentinel 方案每个节点持有全量数据，容量受单机内存限制，但运维简单、客户端不用感知拓扑；Cluster 适合数据量大、写吞吐要求高、需要水平扩展的场景，代价是运维复杂度和客户端复杂度上升，以及跨槽操作的约束。总结来说，Redis 集群是以哈希槽分片为数据模型、gossip 协议为控制面、类 Raft 选举为高可用手段的最终一致分布式缓存，选型时要重点评估数据量级、跨 key 操作的需求和对一致性缺失的容忍度，强一致诉求的场景应当换用基于多数派提交的存储。

## 详细解析

### 一、架构总览
```
                   ┌────────────────────── Redis Cluster ──────────────────────┐
                   │                                                            │
  client (smart)   │   master A           master B           master C           │
  ───────────────► │  slots 0-5460       slots 5461-10922   slots 10923-16383   │
  本地缓存槽位映射  │      │                   │                   │            │
  MOVED/ASK 重定向  │  replica A1         replica B1         replica C1         │
                   │                                                            │
                   └────────────────────────────────────────────────────────────┘
                        ▲         ▲         ▲         ▲         ▲         ▲
                        └─────────┴─────────┴─────────┴─────────┴─────────┘
                             cluster bus（业务端口 + 10000，二进制协议）
                             消息类型：MEET / PING / PONG / FAIL / UPDATE
```

### 二、数据分片：16384 个哈希槽

每个 key 的落槽算法为 `slot = crc16(key) & 0x3FFF`，其中 crc16 是 XMODEM 变体（多项式 0x1021）。`keyHashSlot()` 位于 `src/cluster.c`，其 hash tag 处理逻辑是：
```c
unsigned int keyHashSlot(char *key, int keylen) {
    int s, e; /* start-end indexes of { and } */

    for (s = 0; s < keylen; s++)
        if (key[s] == '{') break;

    /* 没有 '{'？对整个 key 哈希 */
    if (s == keylen) return crc16(key,keylen) & 0x3FFF;

    /* 找到 '{'，再找配对的 '}' */
    for (e = s+1; e < keylen; e++)
        if (key[e] == '}') break;

    /* 没有 '}' 或 {} 之间为空？对整个 key 哈希 */
    if (e <mark> keylen || e </mark> s+1) return crc16(key,keylen) & 0x3FFF;

    /* 只对 { 和 } 之间的内容哈希（hash tag） */
    return crc16(key+s+1,e-s-1) & 0x3FFF;
}
```

可以用 `CLUSTER KEYSLOT` 命令验证：`CLUSTER KEYSLOT "user:{1001}:name"` 与 `CLUSTER KEYSLOT "user:{1001}:age"` 返回相同的槽号。

**为什么不直接用一致性哈希**：槽是显式的逻辑抽象层，节点增减只需要迁移整段槽，key 与槽的映射永远不变，不需要维护哈希环和虚拟节点；同时槽位图是定长位图，可以直接塞进 gossip 心跳包随拓扑一起传播。这种「先分片、再复制」的思路与 Kafka 的 partition 设计异曲同工（参见 [003-kafka为什么快？](../kafka/003-kafka%E4%B8%BA%E4%BB%80%E4%B9%88%E5%BF%AB%EF%BC%9F.md)）。


| 维度       | 一致性哈希（如 Twemproxy 的 ketama） | Redis Cluster 哈希槽  |
| -------- | --------------------------- | ------------------ |
| key 定位   | 哈希环 + 虚拟节点                  | CRC16 % 16384 固定槽位 |
| 节点增减     | 影响环上相邻区段，需重算部分映射            | 只迁移整段槽，key 与槽映射不变  |
| 路由信息传播   | 依赖中心组件（proxy / 配置中心）        | 槽位图随 gossip 心跳扩散   |
| 多 key 约束 | 依赖 hash tag 或中心 proxy 调度    | 同槽即可，hash tag 辅助   |


**为什么是 16384 而不是 65536**：gossip 心跳包的包头携带发送者的槽位位图，16384 个槽对应 2KB；若取 CRC16 满量程 65536 则要 8KB，心跳开销放大四倍。官方规范给出的集群设计规模约为 1000 个主节点，16384 个槽的分布与迁移粒度已经足够。槽位数固定且显式，是 Redis 集群一切路由、迁移、故障转移机制的地基。

### 三、客户端路由：MOVED 与 ASK


| 维度      | MOVED              | ASK                 |
| ------- | ------------------ | ------------------- |
| 含义      | 槽已永久归属其他节点         | 槽正在迁移，该 key 已迁到目标节点 |
| 出现时机    | 常态路由错误、迁移完成后的首次访问  | 仅槽迁移过程中             |
| 客户端动作   | 更新本地槽位映射表，向新节点重发命令 | 先发 ASKING，再重发原命令    |
| 是否更新路由表 | 是                  | 否（一次性生效）            |


ASKING 是一次性标志：目标节点处于 IMPORTING 状态时，只对携带 ASKING 标志的客户端「破例」处理该槽请求，处理完即失效，后续请求仍按正式归属返回 MOVED。
```
client                 source（旧主）            target（新主，IMPORTING）
  │  GET key               │                         │
  │───────────────────────►│                         │
  │  -ASK 5461 t:6379     │                         │
  │◄───────────────────────│                         │
  │  ASKING                │                         │
  │─────────────────────────────────────────────────►│
  │  GET key               │                         │
  │─────────────────────────────────────────────────►│
  │  value                 │                         │
  │◄─────────────────────────────────────────────────│
```

### 四、gossip 协议与故障检测

- 消息类型：**MEET**（拉新节点入群）、**PING/PONG**（心跳，携带 gossip 段）、**FAIL**（广播客观下线）、**UPDATE**（纠正过期路由）。
- 每个节点记录与其他节点的最后通信时间，PING 随机挑节点发送，且保证半个 node-timeout 内没通信过的节点必被 ping 到。
- **PFAIL → FAIL**：PFAIL 只是主观怀疑；当多数主节点在 2 × node-timeout 内都报告该节点 PFAIL（`FAIL_REPORT_VALIDITY_MULT = 2`，硬编码）时，才升级为 FAIL 并向全网广播。
- **cluster-node-timeout** 默认 15000ms，是故障检测、选举超时等一系列时间参数的基础。
- **cluster-require-full-coverage** 默认 yes：只要有任一槽没有可用主节点，整个集群拒绝写入。注意它与多数派仲裁是两回事——master 挂掉但 failover 成功、槽仍全覆盖，集群就继续可用。
- **cluster-allow-reads-when-down** 默认 no：槽无主时对应读请求也拒绝。

### 五、故障转移与选举

一个从节点发起选举必须同时满足（集群规范原文条件）：主节点处于 FAIL 状态；该主节点持有非零数量的槽；复制链路断开时间不超过 `(node-timeout × cluster-replica-validity-factor) + repl-ping-replica-period`（factor 默认 10），以保证候选者数据足够新鲜——设为 0 表示不考虑新鲜度、可用性优先。
```
replica 检测到 master FAIL
        │
        ▼
延迟 = 500ms + random(0~500ms) + RANK × 1000ms
（RANK 按复制 offset 排名，0 为数据最新的副本）
        │
        ▼
currentEpoch 自增，广播 FAILOVER_AUTH_REQUEST 拉票
        │
        ▼
其他 master 投票条件：目标 master 为 FAIL；
本 epoch 未投过票；请求 epoch ≥ 本地 epoch
        │
        ▼
获得多数 master（N/2+1）ACK → 胜出
        │
        ▼
新 master 获得全局更大的 configEpoch，广播 PONG 宣告槽位归属
        │
        ▼
其余节点按 configEpoch 更新路由；
旧 master 及其余 replica 改向新 master 同步
```

**与 Raft 的关系**：官方规范说明其 epoch 概念类似 Raft 的 term，但选举不是 Raft——没有日志复制、没有多数派提交。


| 维度      | Raft（etcd 等）   | Redis Cluster 选举              |
| ------- | -------------- | ----------------------------- |
| 日志/数据复制 | 多数派提交，落盘       | 异步复制，无提交概念                    |
| 选举资格    | 候选者日志至少与多数派一样新 | 数据新鲜度因子 + 多数投票                |
| 脑裂收敛    | term + 多数派提交   | currentEpoch/configEpoch 更大者胜 |
| 一致性     | 线性一致           | 最终一致，可能丢写                     |


配套机制还有：**手动故障转移** `CLUSTER FAILOVER`（安全切换，等副本追平）、`TAKEOVER`（立即接管，可能丢数据）、`FORCE`（主节点疑似失联时强制）；**副本迁移**由 `cluster-migration-barrier`（默认 1，主节点保留至少 N 个副本才可外借）和 `cluster-allow-replica-migration`（默认 yes）控制。

### 六、一致性模型

主从之间是**异步复制**：主节点写完即返回，副本按复制偏移量追赶，主节点宕机时未同步的写丢失。分区场景下还有「脑裂窗口」：少数派分区中的旧 master 在被多数派判定 FAIL 并完成选举前，仍可能短暂接受写入；分区愈合后它作为 replica 重新接入、丢弃本地多余数据，这些写入永久丢失。

`WAIT numreplicas timeout` 可以让客户端阻塞到至少 N 个副本确认收到写入（返回实际确认数，客户端应检查返回值）。但它不解决「该提升谁」的问题——被提升的副本可能恰好没收到该写入。官方文档的结论是：WAIT 不能使 Redis 成为强一致存储，只降低丢写概率。

对比 Kafka 的处理方式：Kafka 用 `acks=all` + ISR 机制，限定「同步中的副本」才有资格被选为新 leader，把丢写风险压缩到 ISR 集合内；Redis 集群的选举只看副本新鲜度因子和多数投票，没有 ISR 这种资格集合，丢写窗口更大。详见 [004-kafka如何保证消息不丢失？](../kafka/004-kafka%E5%A6%82%E4%BD%95%E4%BF%9D%E8%AF%81%E6%B6%88%E6%81%AF%E4%B8%8D%E4%B8%A2%E5%A4%B1%EF%BC%9F.md)。

### 七、slot 迁移与扩容缩容
```
1. redis-cli --cluster add-node 把新节点加入集群（内部走 CLUSTER MEET）
2. redis-cli --cluster reshard：
     目标节点对目标槽执行 SETSLOT <slot> IMPORTING <src-id>
     源节点执行 SETSLOT <slot> MIGRATING <dst-id>
3. 逐个 key 执行 MIGRATE（单 key 原子：要么在源、要么在目标）
4. 迁移完成，向所有节点广播 SETSLOT <slot> NODE <dst-id>
```

迁移期间的请求走向：源节点本地还有该 key 则直接服务；没有则返回 ASK 指向目标；目标节点处于 IMPORTING，仅对带 ASKING 标志的请求服务该槽。整个迁移过程在线进行，服务不中断。

两个工程注意点：**MIGRATE 是同步阻塞的**，迁移大 key 会造成源节点延迟尖刺，生产上要先排查 bigkey；由于单 key 迁移原子，中断后槽仍停留在 MIGRATING/IMPORTING 状态，重新发起 reshard 续传即可。缩容流程相反：先把槽全部迁出，再 `CLUSTER FORGET` 下线节点。

### 八、集群模式的使用限制

- 多 key 命令（MGET/MSET/DEL 多 key）要求所有 key 同槽，否则返回 **CROSSSLOT** 错误；事务（MULTI/EXEC/WATCH）同理。
- **Lua 脚本**访问的所有 key 必须落在同一槽（脚本的 KEYS 参数会做检查），跨槽脚本直接报错。
- 集群模式**只支持 db 0**，SELECT 不可用。
- **pub/sub 是全局广播**：发布到任一节点会转发到所有节点，订阅规模大时放大开销明显；Redis 7.0 引入 **sharded pub/sub**（SSUBSCRIBE/SPUBLISH），频道按槽分布，只由持有该槽的节点处理。
- **hash tag 的副作用**：人为把多 key 钉在同一槽，可能造成数据倾斜和热点大 key。
- `READONLY` 允许从副本读，但可能读到旧数据。

### 九、方案对比与选型


| 维度       | 主从 + Sentinel | Redis Cluster       | Twemproxy    | Codis           |
| -------- | ------------- | ------------------- | ------------ | --------------- |
| 分片       | 无，全量数据        | 16384 槽，内置          | ketama 一致性哈希 | 1024 槽          |
| 高可用      | Sentinel 自动切换 | 内置投票选举              | 无（需额外方案）     | 依赖外部组件          |
| 中心组件     | Sentinel 集群   | 无（去中心化）             | proxy（可多实例）  | proxy + ZK/etcd |
| 客户端      | 普通客户端         | smart client        | 普通客户端        | 普通客户端           |
| 跨分片多 key | 无此问题          | 同槽 + hash tag       | 不支持          | 有限支持            |
| 容量上限     | 单机内存          | 线性扩展（约 1000 master） | 线性扩展         | 线性扩展            |
| 维护状态     | 官方维护          | 官方维护                | 社区停滞         | 已停止维护           |


选型结论：数据量单机装得下、只要高可用 → Sentinel；需要分片 + 原生高可用、能接受最终一致 → Cluster；要强一致 → 换用 etcd、TiKV 这类多数派提交的存储。

### 十、面试追问

**追问 1：为什么是 16384 个槽，而不是 65536 或者更少？**

答：16384 是带宽与粒度的折中。gossip 心跳包的包头要携带发送者的槽位位图，16384 个槽对应 2KB；如果采用 CRC16 满量程的 65536 则要 8KB，心跳开销放大四倍。官方规范给出的集群设计规模是约 1000 个主节点，16384 个槽平均每个节点约 16 个槽，迁移和均衡的粒度已经足够；再少（如 8192）只省 1KB，收益有限而分布更粗。槽数固定且显式的另一个好处是位图可以随心跳传播，路由信息收敛不需要额外协调。

**追问 2：集群的选举为什么不是 Raft？照搬 Raft 会怎样？**

答：Redis Cluster 只借鉴了 Raft 的任期思想，用 configEpoch 标识槽位归属的代次。它没有 Raft 的日志复制与多数派提交：主从是异步复制，副本数据天然可能落后，因此「选举数据最新的节点」只能靠复制偏移排名和新鲜度因子近似实现，无法给出 Raft 式「包含全部已提交条目」的强保证。照搬 Raft 意味着写要等多数派副本确认，直接牺牲 Redis 的核心卖点——低延迟写，所以官方明确承认集群的故障转移是尽力而为。这也解释了为什么 WAIT 不能带来强一致：它只保证「数据到了几个副本」，不解决「选举谁」的问题。

**追问 3：集群脑裂时会发生什么？数据会怎样？**

答：分区后，少数派一侧的旧 master 不会立即停写——它要等多数派完成 FAIL 判定和选举。选举本身需要多数 master 投票，所以少数派一侧无法选出新主，集群的写服务最终随多数派一侧收敛；但旧 master 在被判定 FAIL 前接受的写入，在分区愈合后会随它降级为 replica 而丢失。多数派一侧选出的新主会拿到更大的 configEpoch，愈合时两边对比 epoch，旧主让位并重新同步，不会出现两个主节点长期并存服务同一槽。要缩小丢写窗口可以调小 cluster-node-timeout，但过小会增加网络抖动导致的误判和频繁切换。

**追问 4：slot 迁移期间，客户端会观察到什么？迁移挂了怎么办？**

答：客户端会观察到两类行为：迁到一半的槽上，源节点对已迁走的 key 返回 ASK，客户端发 ASKING 后到目标节点取数；对仍在源的 key 正常返回。MIGRATE 单 key 是原子的，所以不存在「半个 key」的中间态；迁移中断后槽停留在 MIGRATING/IMPORTING 状态，重新发起 reshard 会从断点继续。真正的风险是大 key：MIGRATE 同步阻塞，迁移大 key 会让源节点产生延迟尖刺，所以迁移前要先用 redis-cli --bigkeys 排查。

**追问 5：既然可能丢写，什么业务能上 Redis Cluster？什么业务不能？**

答：能上的：缓存、计数器、排行榜、会话等可重建或可容忍少量丢失的数据，配合 TTL 使用。不能上的：订单、账户余额这类要求强一致的核心数据，以及依赖跨 key 事务（例如库存扣减同时改多个 key 且要求原子）的场景——除非用 hash tag 把相关 key 钉在同一槽。若业务既要分片又要强一致，应当换用基于多数派提交的存储，Redis Cluster 的定位从来不是强一致数据库。

### 参考链接

- [Redis Cluster specification（官方集群规范）](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Scale with Redis Cluster（官方集群扩容教程）](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [Redis replication（官方复制文档，异步复制与一致性说明）](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [WAIT command（官方命令文档）](https://redis.io/docs/latest/commands/wait/)
- [Redis 7.2 redis.conf（默认配置与参数注释）](https://github.com/redis/redis/blob/7.2/redis.conf)
- [src/cluster.c（keyHashSlot、故障检测与选举实现）](https://github.com/redis/redis/blob/7.2/src/cluster.c)
- [src/cluster.h（CLUSTER\_SLOTS=16384、默认超时常量）](https://github.com/redis/redis/blob/7.2/src/cluster.h)


<!-- created: 2026-08-15 19:47:43 -->
<!-- updated: 2026-08-17 10:45:39 -->
