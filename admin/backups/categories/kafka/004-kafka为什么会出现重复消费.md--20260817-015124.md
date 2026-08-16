# Kafka为什么会出现重复消费，如何处理？

## 题目

Kafka 为什么会出现重复消费，如何处理？

## 标签

[Kafka](../../tags/Kafka.md)

## 题目导航

← [kafka为什么快？](kafka为什么快？) | 无 →

## 面试直接答

Kafka 的消费者交付语义默认是至少一次（at-least-once），重复消费的根因在于"业务处理"与"位移提交"两个动作无法原子化：消费者在处理完消息但尚未提交 offset 时发生崩溃或再均衡，恢复后会从旧 offset 重新拉取并重复处理同一批消息。因此处理重复消费的正确姿势不是要求 Kafka 保证不重复，而是在消费端实现幂等，再按需用事务收窄语义。

理解重复消费，先要理解 Kafka 的消费位移机制。Kafka 的消息被消费后不会删除，消费者通过向内部主题 __consumer_offsets 提交 offset 来记录消费进度，重启后从上次提交的位置继续。默认配置下 enable.auto.commit 为 true，客户端每 5 秒（auto.commit.interval.ms 默认值为 5000 毫秒）自动提交一次位移。问题在于自动提交的位置与业务实际处理完成的位置之间存在时间差：如果一批消息拉取后处理耗时超过 5 秒，位移可能在业务尚未处理完时就被提交，此时崩溃反而会丢消息；反过来，如果处理已完成而自动提交尚未发生就崩溃，重启后这批消息会被重新消费，形成重复。也就是说自动提交模式下丢消息和重复消费两种风险并存，这也是官方文档将默认语义定为 at-least-once 的原因。

手动提交同样无法根除重复。即使关闭自动提交，在处理成功后调用 commitSync 提交位移，处理成功与提交完成之间依然存在一个窗口：进程在这期间崩溃，位移没有落盘，恢复后从旧 offset 重读，消息被重复处理。这是 at-least-once 语义的必然代价，Kafka 的选择是宁可重复、不可丢失。另一类高频场景是再均衡（rebalance）：消费者组成员增减、分区扩容，或者消费者处理超时（超过 max.poll.interval.ms，默认 5 分钟未调用 poll 会被踢出组），都会触发分区重新分配，新接管的消费者从上次提交的 offset 开始消费，原消费者已处理但未提交的消息会被整个批次重放。由于默认 max.poll.records 一次可拉取 500 条，一次 rebalance 可能造成数百条消息的重复处理。

重复消费的源头还包括生产端。生产者发出消息后若未收到确认会重试，早期版本中 acks 丢失会导致同一条消息在 broker 中写入多次。Kafka 3.0 起通过 KIP-679 默认开启幂等生产者（enable.idempotence=true、acks=all），broker 依据生产者 PID 与消息序列号对重复写入去重，集群内的生产端重复基本被消除。但幂等生产者只解决"写入重复"，不解决"消费重复"，消费者两次拉取同一条消息对 broker 而言是两次独立的读取请求，去重机制并不介入。

处理消费端重复的工程范式是"至少一次 + 幂等消费"。第一层，让消费逻辑本身幂等：业务消息携带唯一键（订单号、事件 ID），落库时依赖数据库唯一约束把重复写入转为冲突或 upsert，重复消息自然退化为空操作；对没有自然唯一键的场景，用 Redis 的 SET NX EX 写入处理标记做去重，TTL 需要覆盖业务处理时长与重试窗口。第二层，收窄重复窗口：关闭自动提交，处理成功后手动提交位移，并在再均衡回调与进程退出钩子中提交在途位移，避免 rebalance 放大重复范围。第三层，对 Kafka 到 Kafka 的流式处理可以开启事务：生产端配置 transactional.id，消费端设置 isolation.level=read_committed，把消费、处理、生产、提交位移放进同一个事务，实现集群内的 exactly-once。

必须明确事务的边界：Kafka 事务只能保证集群内部的原子性，如果消费逻辑写 MySQL、调外部 API，这些副作用依然需要幂等键或数据库约束兜底，事务覆盖不到。总结来说，重复消费是 at-least-once 语义下的正常现象而非 bug，标准的回答结构是：接受至少一次交付，用唯一键与幂等逻辑消化重复，用事务按需收窄到 exactly-once，同时说明每种方案的适用边界。

## 详细解析

### 一、三种交付语义的对比

Kafka 官方文档在 Message Delivery Semantics 一节明确定义了消费端的三种语义，差异在于"处理"与"提交 offset"的先后顺序：


| 语义                  | 实现方式                         | 结果           | 典型场景                |
| ------------------- | ---------------------------- | ------------ | ------------------- |
| at-most-once（至多一次）  | 先提交 offset，再处理消息             | 最多一次，崩溃会丢消息  | 日志采集、监控指标等可容忍丢失的场景  |
| at-least-once（至少一次） | 先处理消息，再提交 offset             | 至少一次，崩溃会重复消费 | Kafka 默认语义，绝大多数业务场景 |
| exactly-once（恰好一次）  | 事务 + 幂等生产者 + read\_committed | 集群内恰好一次      | Kafka 到 Kafka 的流式处理 |


三种语义无法同时满足"不丢"和"不重"，因为处理与提交之间必然存在一个无法原子化的窗口，Kafka 默认选择 at-least-once，即优先保证不丢。

### 二、重复消费的根因拆解
```
offset 已提交（不重复）             offset 未提交（重启后重复）
        │                                   ▲
        ▼                                   │
  消费消息 ──► 业务处理 ──► 提交 offset ──► 崩溃点
                          ▲
                    重复消费窗口
                     （处理完成与提交完成之间）
```

**场景一：处理成功、提交前崩溃。** 无论自动提交还是手动提交，业务处理完成到 offset 落盘之间都存在窗口。进程崩溃（OOM、Kill、宕机）后重启，从 \_\_consumer\_offsets 中读取上次提交的位移重新消费，已处理过的消息被再次处理。这是最经典的重复来源，也是 at-least-once 语义的定义本身。

**场景二：自动提交的时间差。** enable.auto.commit=true 时，客户端在 poll 循环中按 auto.commit.interval.ms（默认 5000 毫秒）周期性提交上一批拉取消息的位移。处理耗时长于提交间隔时，位移提交的位置与真实处理进度错位，既可能重复（处理完未提交就崩溃），也可能丢消息（未处理完就被提交，崩溃后跳过）。严格来说，自动提交模式连 at-least-once 都无法保证。

**场景三：再均衡（rebalance）。** 消费者组发生成员变更或分区重分配时，分区的消费权易主，新消费者从上次提交的 offset 开始消费。触发条件包括：新成员加入、成员心跳超时（session.timeout.ms）、处理超时被踢出（两次 poll 间隔超过 max.poll.interval.ms，默认 5 分钟）、分区数变更。原消费者已处理未提交的消息被新消费者整批重放，由于默认 max.poll.records=500，单次重复可达数百条。

**场景四：生产端重试导致消息本身重复。** 生产者发送后未收到确认会重试，若 broker 实际已写入但确认丢失，同一消息被写入多次，所有消费者都会多消费一份。Kafka 3.0 起通过 KIP-679 默认启用幂等生产者：enable.idempotence 默认 true、acks 默认 all，broker 以（producerId, 序列号）为键去重，单分区单会话内的生产端重复被消除。注意一个细节：因配置校验 bug（KAFKA-13598），3.0.0 和 3.1.0 版本中幂等默认值实际未生效，3.0.1、3.1.1、3.2.0 起才真正默认开启。

### 三、幂等消费的工程实现

消费端幂等是处理重复消费的核心手段。Java 客户端的手动提交 + 数据库唯一约束示例：
```java
// 1. 关闭自动提交
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

while (running) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));
    for (ConsumerRecord<String, String> r : records) {
        OrderEvent event = parse(r.value());
        try {
            // 依赖 order_id 唯一索引：重复消息触发冲突，转为空操作
            orderDao.insertWithUniqueKey(event.getOrderId(), event);
        } catch (DuplicateKeyException e) {
            log.info("duplicate order {}, skip", event.getOrderId());
        }
    }
    // 2. 整批处理完成后再提交，缩小重复窗口
    consumer.commitSync();
}
```

对没有自然唯一键的事件，用 Redis 原子命令做去重标记：
```java
String key = "kafka:dedup:" + event.getEventId();
// SET NX EX：原子地"不存在才写入"，天然防止并发重复
Boolean first = redis.setIfAbsent(key, "1", Duration.ofMinutes(30));
if (!Boolean.TRUE.equals(first)) {
    return; // 已处理过，直接跳过
}
process(event);
```

再均衡场景下还需在分区撤销回调中提交在途位移，避免易主后重复放大：
```java
consumer.subscribe(topics, new ConsumerRebalanceListener() {
    @Override
    public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
        consumer.commitSync(); // 分区被夺走前提交已处理的位移
    }
});
```

### 四、Kafka 事务与 exactly-once 的边界

对"消费 Kafka → 处理 → 写回 Kafka"的流式处理，事务可以实现集群内 exactly-once：
```
Consumer ──poll──► 业务处理 ──send──► Producer
   ▲                                    │
   │        同一个事务（transactional.id）│
   └────── 原子提交输入 offset ◄─────────┘

下游消费者 isolation.level=read_committed：
  broker 用 LSO（Last Stable Offset）屏蔽未提交与已中止事务的消息，
  遇到未决事务时消费者阻塞等待，直到事务提交或中止。
```

事务的本质是把"输入 offset"与"输出消息"放进同一个原子提交单元：处理中途崩溃则事务中止，输入 offset 回退、输出消息对下游不可见，恢复后从头重放，下游恰好消费一次。Kafka Streams 的 processing.guarantee=exactly\_once\_v2 即自动完成这套配置。

但事务的边界止于集群内部：若消费逻辑的副作用是写 MySQL、调外部 API，事务无法回滚这些外部系统的状态，跨系统 exactly-once 只能靠"业务幂等键 + 数据库约束"或 Outbox 模式实现，Kafka 事务解决不了。

### 五、面试追问

**追问一：自动提交模式下为什么会丢消息，不是说默认是 at-least-once 吗？**

自动提交在 poll 时提交的是上一批消息的位移。若上一批消息处理耗时超过 auto.commit.interval.ms（5 秒），位移会在消息尚未处理完时就被提交，此刻崩溃则这批消息永远不会被重新消费，表现为丢消息。所以自动提交实际是"at-most-once 与 at-least-once 之间的不确定语义"，关键业务必须关闭自动提交并手动控制提交时机。官方文档对三种语义的划分正是基于提交先后的理论模型，而自动提交的周期特性打破了"先处理、后提交"的前提。

**追问二：生产端已经默认开启幂等生产者了，为什么还有重复消费？**

两者解决的维度不同。幂等生产者以（producerId, 序列号）去重，作用域是"同一次发送在网络重试中产生的多次写入"，防止 broker 里出现两条相同消息。而消费端重复是"同一条消息被消费者读了两次"——对 broker 来说这是两次独立的 fetch 请求，幂等生产者并不介入读取路径。只要 at-least-once 的提交语义存在，消费端重复就与生产端幂等无关，必须在消费侧独立解决。

**追问三：用 Redis 做幂等去重，TTL 设置多久？Redis 挂了怎么办？**

TTL 必须大于"业务处理时长 + 重试与再均衡可能引入的最大延迟"，一般取 24 小时或按幂等键的业务有效期设定，过短会导致窗口外的重复穿透。Redis 故障时应降级而非放大风险：正确性不能依赖 Redis，数据库唯一约束（与业务数据同库同事务）才是兜底，Redis 只作为前置快速过滤层，挂了就跳过过滤、靠数据库约束拦截，宁可多查一次数据库也不能让重复生效。

**追问四：能不能做到"消费 Kafka → 写 MySQL"的端到端 exactly-once？**

靠 Kafka 事务做不到，事务边界止于集群内部。可行方案是组合：业务消息携带全局唯一键，MySQL 唯一约束保证重复消息只有一次生效，消费逻辑做成幂等 upsert；或者用 Outbox 模式，把"业务落库"和"发消息"放进同一个数据库本地事务，再由中继进程投递，保证两者一致。跨系统的 exactly-once 本质是"幂等 + 事务"的组合，不存在单一机制能覆盖所有外部副作用。

### 六、参考链接

- [Kafka Documentation - Message Delivery Semantics](https://kafka.apache.org/documentation/#semantics)
- [Kafka Documentation - Consumer Configs](https://kafka.apache.org/documentation/#consumerconfigs)
- [KIP-679: Producer will enable the strongest delivery guarantee by default](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679%3A+Producer+will+enable+the+strongest+delivery+guarantee+by+default)
- [KAFKA-13598: Idempotence producer is not enabled by default if not set explicitly](https://issues.apache.org/jira/browse/KAFKA-13598)
- [Confluent Developer - Kafka Transactions](https://developer.confluent.io/courses/architecture/transactions/)


<!-- created: 2026-08-13 19:06:15 -->
<!-- updated: 2026-08-14 01:10:44 -->
