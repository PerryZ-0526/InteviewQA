# kafka如何保证消息不丢失？

## 题目

Kafka 如何保证消息不丢失？

## 标签

[Kafka](../../tags/Kafka.md) | [可靠性](../../tags/可靠性.md)

## 题目导航

← [Kafka为什么会出现重复消费，如何处理？](004-kafka为什么会出现重复消费.md) | [kafka如何保证顺序消费](006-kafka如何保证顺序消费.md) →

## 面试直接答

Kafka 保证消息不丢失不是一个开关，而是生产端、Broker 端、消费端三段配置共同拼出的「至少一次」投递语义：生产端用 acks=all 配合幂等重试确保消息确实落入多个副本，Broker 端用多副本 ISR 机制与禁止 unclean 选举确保已确认的消息扛得住节点故障，消费端用「先处理、后提交位移」确保崩溃后可以重放；代价是消息必然可能重复，需要业务幂等兜底，这是该方案的明确适用边界。

生产端的关键是确认机制与重试。acks 参数决定 Broker 何时向生产者确认：acks=0 是发完即忘，消息在网络上丢失对生产者完全无感知；acks=1 只等 leader 落盘即确认，若 leader 在副本同步完成前宕机，已确认的消息同样丢失；acks=all（即 -1）要求 ISR 中所有副本都写入成功才确认，这是不丢的前提。Kafka 3.0 起 acks 默认值已改为 all、幂等默认开启（KIP-679），retries 自 2.1 起默认 Integer.MAX_VALUE，由 delivery.timeout.ms（默认 120 秒）约束重试总时长。幂等生产者为每个生产者分配 PID 并为每条消息分配序列号，Broker 据此丢弃重复批次，使重试不会产生重复消息；Kafka 2.5 的 KIP-360 还修复了日志截断导致生产者状态丢失、进而报 UnknownProducerId 的可靠性问题。生产者还必须处理 send 回调中的异常并做补偿，而不是把失败消息静默吞掉。

Broker 端的不丢靠副本与选举策略。生产环境通常设置 replication.factor=3、min.insync.replicas=2、unclean.leader.election.enable=false。min.insync.replicas 定义 acks=all 时至少要有几个副本确认写入：当 ISR 收缩到低于该值时，Broker 直接拒绝写入并抛出 NotEnoughReplicas 异常，宁可暂时不可写，也不产生「确认了却没落够副本」的消息。unclean.leader.election.enable 控制落后副本能否被选为 leader：一旦允许，ISR 全部故障时落后副本上位，旧 leader 恢复后按新 leader 截断日志，那些曾经被 acks=all 确认的消息就被物理抹掉；该参数自 Kafka 0.11 起默认 false（KIP-106），以牺牲部分可用性换取持久性。消费者的位移保存在 __consumer_offsets 内部主题中，同样受副本机制保护，Broker 故障不会丢失消费进度。

消费端的不丢取决于位移提交时机。默认 enable.auto.commit=true 会每 5 秒、在下一次 poll 之前自动提交位移，如果业务处理较慢或异步执行，就会把尚未处理完的位移提交出去，进程崩溃后这些消息被跳过，这是消费端丢消息最常见的原因。正确做法是关闭自动提交，在业务处理成功之后手动 commitSync 或 commitAsync，提交失败需要重试或记录，不能忽略。rebalance 同样会打断处理，应在 ConsumerRebalanceListener 的 onPartitionsRevoked 回调中提交或保存当前进度。auto.offset.reset=latest 意味着新消费组从最新位置开始，历史消息本就不在保障范围内。先处理后提交带来的是重复消费：处理成功但提交前崩溃，重启后会重放这段消息，因此消费端必须做幂等，例如唯一业务键加去重表，或依赖数据库唯一约束。

总结来说，三层机制拼出的是 at-least-once，这是 Kafka 默认的投递语义；若要进一步消除重复，Kafka 0.11 引入的幂等生产者加事务（KIP-98）可以在 Kafka 内部实现端到端 exactly-once：事务通过事务协调器与 __transaction_state 主题实现跨分区原子写入，消费端用 read_committed 隔离级别过滤未提交数据，KIP-447 又解决了海量分区下生产者 ID 的扩展问题。但即便开启事务，一旦链路涉及 Kafka 之外的数据库等外部系统，精确一次仍需 Outbox 或本地消息表等模式配合——「不丢」最终要放在整条业务链路上统筹设计，而不是指望某一个参数。

## 详细解析

### 一、消息在哪几个环节会丢

一条消息从产生到被业务处理，经过三个环节，每个环节都有独立的丢失场景：
```text
Producer ──send──▶ Broker(leader) ──replicate──▶ Broker(follower×2)
   │                    │                              │
   │ ①acks=0/1          │ ②单副本/磁盘故障              │ ③unclean 选举
   │ 未确认即认为成功    │ 已确认消息随宕机丢失           │ 落后副本上位截断日志
   ▼                    ▼                              ▼
  丢失                  丢失                           丢失

Consumer ◀──poll── Broker ──commit offset──▶ __consumer_offsets
   │
   │ ④先提交位移后处理 / 自动提交把未处理位移提交掉
   ▼
  丢失（崩溃后消息被跳过）
```

1. **生产端**：acks=0 或 acks=1 时，消息只落到 leader 甚至只进了网络缓冲区；生产者崩溃或 leader 故障即丢失。
2. **Broker 端**：单副本（replication.factor=1）时 Broker 宕机数据全丢；允许 unclean 选举时，落后副本当选 leader 会把已确认消息截断。
3. **消费端**：位移提交早于业务处理完成，进程崩溃后重启会从已提交位置继续，中间的消息被跳过。
4. **边界场景**：消息超过保留期（log.retention.hours）被清理、消费组位移过期（offsets.retention.minutes，默认 7 天）后重建消费组、auto.offset.reset=latest 跳过历史数据——这些是设计行为，不属于「可靠投递」的保障范围，但工程上必须知道。

### 二、三种投递语义

Kafka 官方文档将投递语义分为三档，这是理解「不丢」的坐标系（详见 [001-mq概览](001-mq概览.md)「消息投递语义」一节）：


| 语义                  | 典型做法                 | 会丢吗 | 会重吗 | Kafka 实现          |
| ------------------- | -------------------- | --- | --- | ----------------- |
| 最多一次（At Most Once）  | acks=0，或先提交位移再处理     | 可能  | 不会  | 默认自动提交+不检查发送结果    |
| 至少一次（At Least Once） | acks=all+重试，先处理后提交位移 | 不会  | 可能  | 关闭自动提交，手动提交位移     |
| 精确一次（Exactly Once）  | 幂等生产者+事务+业务幂等        | 不会  | 不会  | KIP-98 事务 / 幂等生产者 |


「保证不丢」对应的就是第二档 at-least-once。分布式环境里不存在既绝对不丢、又绝对不重、还完全可用的免费方案，因此工程答案永远是「至少一次 + 幂等」，用业务层的去重把 at-least-once 收敛成「效果上的 exactly-once」。

### 三、生产端：acks 与幂等重试

acks 的三个取值决定了确认时机：


| acks    | 确认时机         | 丢失风险                                                 |
| ------- | ------------ | ---------------------------------------------------- |
| 0       | 不等待确认        | 网络/序列化失败即丢，无感知                                       |
| 1       | leader 落盘即确认 | leader 在副本同步前宕机，消息丢失                                 |
| all（-1） | ISR 全副本落盘才确认 | ISR 收缩到只剩 leader 且 min.insync.replicas=1 时退化为 acks=1 |


生产端推荐配置（Java 客户端）：
```java
Properties props = new Properties();
props.put("bootstrap.servers", "broker1:9092,broker2:9092");
props.put("acks", "all");                       // Kafka 3.0 起已是默认值（KIP-679）
props.put("enable.idempotence", "true");        // 同上，幂等默认开启
props.put("retries", Integer.MAX_VALUE);        // Kafka 2.1 起已是默认值（KIP-91）
props.put("delivery.timeout.ms", 120000);       // 重试总时长上限，真正兜底的是它
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
    producer.send(new ProducerRecord<>("orders", orderId, json), (metadata, e) -> {
        if (e != null) {
            // 必须处理失败：落库补偿 / 告警 / 死信，而不是静默丢弃
            compensate(orderId, e);
        }
    });
}
```

两个关键机制：

- **重试边界**：retries=Integer.MAX\_VALUE 意味着生产者几乎无限重试，delivery.timeout.ms 才是真正的上限——超过该时长仍失败，send 回调会收到最终异常，此时应用必须兜底，否则消息就是丢了。
- **幂等生产者（KIP-98，Kafka 0.11）**：Broker 为每个生产者分配 **PID**，消息携带单调递增的 **序列号**；Broker 收到乱序或重复的序列号时只接受连续的批次、丢弃重复批次，从而保证「重试不产生重复」且「单分区内有序」。注意幂等只覆盖**单分区、单生产者会话**内的去重：生产者重启后 PID 重新分配，旧会话的重复发送无法再被识别（KIP-360 在 2.5 修复了日志截断导致 producer 状态被过早清除的问题，但跨会话去重仍然不成立）。

### 四、Broker 端：副本、ISR 与选举策略

Broker 端不丢的核心是「确认过的消息必须存在于多个物理副本上」，由三个配置共同保证：


| 配置                             | 默认值                   | 推荐值   | 作用                |
| ------------------------------ | --------------------- | ----- | ----------------- |
| replication.factor             | 1（自动建主题）              | 3     | 每个分区的副本总数         |
| min.insync.replicas            | 1                     | 2     | acks=all 时最少确认副本数 |
| unclean.leader.election.enable | false（0.11 起，KIP-106） | false | 是否允许落后副本当选 leader |
```text
Partition-0
├─ Broker1: leader     ◀── 写入 + 确认
├─ Broker2: follower   ◀── 同步，ISR 成员
└─ Broker3: follower   ◀── 同步，ISR 成员（此时宕机则退出 ISR）

ISR = {leader, follower2, follower3}，acks=all 需要三者全部落盘
min.insync.replicas=2：ISR 收缩到 1 时拒绝写入（NotEnoughReplicasException）
```

三个容易被忽视的细节：

- **min.insync.replicas 默认 1**：即使配了 acks=all，ISR 只剩 leader 时写入照样成功，可靠性退化成 acks=1。设成 2 之后，ISR 不足时写入直接失败，这是「宁可不可写也不丢」的显式取舍。
- **自动创建主题只有 1 个副本**：default.replication.factor=1，靠自动建主题上线的 topic 天生不满足不丢要求，必须在建主题时显式指定副本数。
- **unclean 选举的后果**：Kafka 0.11 之前默认允许落后副本当选 leader（KIP-106 将其改为 false），一旦发生，旧 leader 恢复后需要追上并截断本地日志，被 acks=all 确认过的消息被物理删除——这是「已确认仍丢失」的典型路径，所以生产环境必须保持 false。

### 五、消费端：位移提交时机

消费端的丢失几乎全部来自「位移提交早于处理完成」。默认行为：
```text
enable.auto.commit=true（默认）
  → 每 auto.commit.interval.ms（默认 5 秒）、在下一次 poll() 之前
  → 自动提交上次 poll 返回的最大位移

风险：poll 之后业务异步处理中，自动提交已把「未处理完」的位移提交掉
      → 进程崩溃 → 重启从已提交位置继续 → 中间消息被跳过
```

正确姿势是关闭自动提交、处理成功后再提交：
```java
props.put("enable.auto.commit", "false");

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    try {
        for (ConsumerRecord<String, String> r : records) {
            process(r);              // 业务处理，必须幂等
        }
        consumer.commitSync();      // 全部处理成功后才提交
    } catch (Exception e) {
        // 处理失败或提交失败：不提交，下次 poll 重新拉取这段消息重放
    }
}
```

配套要点：

- **提交失败要处理**：commitSync 抛异常时不能忽略，否则位移停留在旧位置，重启后重复消费（不丢，但重）；常见做法是重试提交或记录待补偿。
- **rebalance 打断**：分区被撤销（partition revoked）时正在处理的批次可能来不及提交，应在 ConsumerRebalanceListener.onPartitionsRevoked 中提交或持久化当前进度，避免新消费者重复处理甚至产生业务冲突。
- **位移过期**：消费组长期不活跃，\_\_consumer\_offsets 中的位移超过 offsets.retention.minutes（默认 7 天）被清理，重启后按 auto.offset.reset 重新定位，latest 会跳过期间的历史消息。

消费端的结论与 [002-kafka的常见使用场景](002-kafka的常见使用场景.md)「可靠传递与故障恢复」一致：先处理后提交换来的是重复而非丢失，重复交给幂等解决。

### 六、Exactly-Once：幂等生产者 + 事务

在「不丢」之上消除重复，Kafka 的路线是 KIP-98（0.11）引入的两层机制：
```text
第一层：幂等生产者（enable.idempotence=true）
  单分区内：PID + 序列号 → 重试去重、保持顺序

第二层：事务（transactional.id）
  跨分区原子写入 + consume-process-produce 原子性
  事务协调器 + __transaction_state 主题记录事务状态
  消费端 isolation.level=read_committed 过滤未提交消息
```
```java
props.put("transactional.id", "order-tx-01");   // 稳定的唯一 ID
producer.initTransactions();
producer.beginTransaction();
try {
    producer.send(new ProducerRecord<>("topic-a", key, v1));
    producer.send(new ProducerRecord<>("topic-b", key, v2));
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
}
```

演进脉络：KIP-98 要求每个生产者实例持有全局唯一的 transactionalId，海量分区场景下 ID 成为扩展瓶颈；KIP-447（2.5）引入 epoch 隔离机制，允许同一 transactionalId 被多个实例共享，崩溃恢复时旧实例被 fence 掉，事务状态得以安全接管。Kafka Streams 的 processing.guarantee=exactly\_once\_v2 即构建在这套机制之上。

但必须明确边界：**事务的 exactly-once 只覆盖 Kafka 内部**。「消费消息 → 写 MySQL → 提交位移」这条链路中，MySQL 的写入无法与位移提交放进同一个 Kafka 事务，Kafka 无法替你保证外部系统的原子性；此时需要 Transactional Outbox（业务数据与待发消息同库同事务）或消费端幂等把语义补齐。

### 七、面试追问

**追问 1：配了 acks=all 是不是就一定不丢了？**

不是。三个坑：其一，min.insync.replicas 默认 1，ISR 收缩到只剩 leader 时 acks=all 退化为 acks=1，leader 宕机照样丢已确认消息，必须显式设 ≥2 并接受「ISR 不足时写入失败」的可用性代价；其二，自动创建的主题 replication.factor=1，根本没有副本；其三，acks=all 只保证 Broker 确认，生产者在拿到确认前崩溃、或 send 回调里的最终失败没被处理，消息仍会丢。

**追问 2：幂等生产者能跨重启去重吗？**

不能。幂等依赖 PID + 序列号，PID 在生产者重启后通过 InitProducerId 重新分配，Broker 端旧 PID 的状态有保留期限，过期后无法识别旧会话的重发。因此「发送成功但确认丢失、重启后重发」的场景会产生重复，跨会话的精确一次只能靠事务（transactionalId + epoch fencing）或业务幂等兜底。

**追问 3：既然 Kafka 事务能 exactly-once，为什么业务还要做幂等？**

因为事务边界止于 Kafka。read\_committed 保证消费者看不到未提交消息、跨分区写入原子，但无法覆盖外部数据库等系统；「写库 + 提交位移」的原子性必须由 Outbox 或本地消息表解决。另外事务有成本：transaction.timeout.ms（默认 60 秒）限制长事务、事务协调器是额外依赖，滥用事务会拖累吞吐，因此大多数业务链路仍是「at-least-once + 幂等」。

**追问 4：关闭自动提交、先处理后提交，还有哪些场景会丢消息？**

还有三类：第一，rebalance 时分区被撤销，处理中的批次未提交且新消费者从旧位置消费，如果业务在 onPartitionsRevoked 里错误地提交了「已拉取未处理」的位移，消息会被跳过；第二，提交动作本身失败被忽略，位移停在旧位置只是重复，但若错误地把位移向前跳（如 seek 或提交了错误的 offset）则直接跳过消息；第三，位移在 \_\_consumer\_offsets 中过期被清理，重启后按 auto.offset.reset=latest 重新定位，历史消息不再投递。

**追问 5：「不丢」和「不重」为什么不能同时免费获得？**

因为确认与重试本身就是重复的来源：生产端网络分区时，Broker 已写入但确认包丢失，生产者重试必然产生重复；消费端处理成功但提交前崩溃，重启重放必然重复。要去重就需要跨节点的协调状态（PID、事务日志、去重表），这些状态本身有成本和故障模式。所以工程上的标准答案是「至少一次 + 幂等」，把可靠性问题转化为可重复执行的问题，这也与 [001-mq概览](001-mq概览.md) 中「提高可靠性通常会带来消息重复问题」的结论一致。

### 参考链接

- [Kafka 官方文档 - Producer Configs](https://kafka.apache.org/documentation/#producerconfigs)
- [Kafka 官方文档 - Broker Configs](https://kafka.apache.org/documentation/#brokerconfigs)
- [Kafka 官方文档 - Message Delivery Semantics](https://kafka.apache.org/documentation/#semantics)
- [KIP-98 - Exactly Once Delivery and Transactional Messaging](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)
- [KIP-679 - Producer will enable the strongest delivery guarantee by default](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679%3A+Producer+will+enable+the+strongest+delivery+guarantee+by+default)
- [KIP-91 - Provide Intuitive User Timeouts in The Producer](https://cwiki.apache.org/confluence/display/KAFKA/KIP-91+Provide+Intuitive+User+Timeouts+in+The+Producer)
- [KIP-106 - Change Default unclean.leader.election.enabled from True to False](https://cwiki.apache.org/confluence/display/KAFKA/KIP-106+-+Change+Default+unclean.leader.election.enabled+from+True+to+False)
- [KIP-360 - Improve reliability of idempotent producer](https://cwiki.apache.org/confluence/display/KAFKA/KIP-360+-+Improve+reliability+of+idempotent+producer)
- [KIP-447 - Producer scalability for exactly once semantics](https://cwiki.apache.org/confluence/display/KAFKA/KIP-447+-+Producer+scalability+for+exactly+once+semantics)


<!-- created: 2026-08-13 19:11:55 -->
<!-- updated: 2026-08-20 12:29:01 -->
