# kafka如何保证顺序消费？

## 题目

Kafka 如何保证消息的顺序消费？哪些环节可能破坏顺序？如果业务要求全局有序应该怎么办？

## 标签

[消息队列](../../tags/消息队列.md)

## 题目导航

← [kafka为什么快？](003-kafka为什么快？.md) | 无 →

## 面试直接答

Kafka 对顺序的保证是**分区内有序**：同一分区内消息按写入顺序存储、按 offset 递增顺序消费，跨分区没有任何顺序保证。要做到顺序消费，生产端需要用业务键把同一实体的消息路由到同一分区、并依赖幂等生产者避免重试乱序，消费端则要保证一个分区同时只被消费组内一个消费者单线程处理。以下从 Broker、生产端、消费端三层展开。

首先看 Broker 层。Kafka 官方文档明确写道：Kafka 只保证分区内记录的全序，不保证跨分区的顺序，而且这个顺序基于 offset 而非时间戳——分区内可能出现时间戳乱序的记录。分区本质上是只追加的日志文件，Broker 按到达顺序给每条消息分配单调递增的 offset，同一分区在物理上由单个 Leader 副本负责写入，天然形成单一写入序列。这是顺序保证的地基：只要消息进了同一个分区，存储层面就是有序的。真正的风险在于生产端和消费端都可能把这个有序性破坏掉。

其次看生产端。风险来自重试与多批次并行发送的组合，官方文档明确指出：开启 retries 而不把 max.in.flight.requests.per.connection 设为 1，可能改变记录顺序——发往同一分区的两个批次，第一个失败重试、第二个先成功，第二个批次的记录就会先出现。解法有两种：保守做法是把 max.in.flight.requests.per.connection 设为 1，同一连接同时只有一个批次在途，重试不可能被后来的批次超越，代价是吞吐和延迟明显变差；更好的做法是启用幂等生产者，Kafka 0.11 引入的 enable.idempotence（KIP-98）给每个生产者分配 PID、给发往每个分区的批次分配单调递增的序列号，Broker 检测到序列号跳号就拒绝乱序批次并让生产者按序重发，因此允许同时有 5 个批次在途仍不丢顺序。自 Kafka 3.0 起（KIP-679），enable.idempotence 与 acks=all 已是默认配置，现代客户端默认就在生产端保序。要注意一个边界：幂等只在单个生产者会话内有效，生产者重启后 PID 变化，重试可能引入重复——重复不是乱序，但要靠消费端幂等兜底。

第三是消息路由。顺序消费的前提是同一业务实体的消息进入同一分区，默认分区器对 key 取哈希后按分区数取模，因此订单流转、账户变更这类场景要用实体 ID 作为消息 key。这里有两个常见坑：一是分区数一旦调整，哈希映射改变，同一 key 会落到新分区，与历史消息的有序性被打破，所以分区数最好提前规划充足，或接受扩容瞬间的局部乱序；二是粘性分区器（KIP-480，Kafka 2.4 起对无 key 消息生效）只是让无 key 消息按批次粘住一个分区以提升批量效率，不提供任何业务顺序保证，不能指望它保序。

最后是消费端。消费组协议保证一个分区在同一时刻只被组内一个消费者消费，这是消费端顺序的前提，但真正的风险在消费者自己的处理逻辑：如果收到消息后丢进线程池异步处理，或先提交 offset 再处理业务，分区内顺序就被打破。正确做法是消费者线程内按 offset 顺序串行处理，处理完成后再提交 offset。还要考虑重平衡：rebalance 时分区被转移，已处理但未提交的消息会被新消费者重新消费产生重复，所以顺序消费必须搭配业务幂等；对顺序敏感的场景可以用 ConsumerRebalanceListener 在分区撤销前保存状态、或在分区分配后用 seek 定位到精确位置继续处理。

边界也要讲清楚。如果业务真的要求全局有序，Kafka 的答案只有一个：单分区 Topic。单分区意味着全序，但吞吐受限于单个分区的写入能力，也丧失了水平扩展。绝大多数业务其实只需要实体级局部有序——订单状态流转、MySQL binlog 同步（按表或主键分区）都是局部有序就足够的例子。跨分区的全局顺序 Kafka 不提供，需要下游自己按业务时间重新排序，例如流处理中用事件时间加 watermark 排序。

总结来说，Kafka 的顺序消费是三层配合的结果：Broker 层提供分区内有序的存储基础，生产端通过 key 路由加幂等生产者保证按序写入，消费端通过单分区单消费者串行处理加幂等保证按序消费。面试时一定要点出「分区内有序、跨分区无序」这条边界——它既是 Kafka 分区并行换取高吞吐的设计代价（详见 [kafka为什么快？](003-kafka为什么快？.md)），也是生产端正确设计 key 的依据。

## 详细解析

### 一、顺序保证的分层模型

Kafka 的顺序消费不是某个开关，而是三层机制配合的结果：

```
生产端                         Broker                      消费端
┌────────────────┐   发送    ┌──────────────────────┐   拉取   ┌────────────────┐
│ ① key 路由      │ ───────► │ 分区0: m1→m2→m3        │ ───────► │ Consumer A     │
│ ② 幂等生产者     │          │ 分区1: m1'→m2'→m3'     │          │ Consumer B     │
│ ③ 重试不改变顺序  │          │ ② 分区内按 offset 有序  │          │ ③ 一分区一消费者 │
└────────────────┘          └──────────────────────┘          │ ④ 单线程串行处理 │
                                                              └────────────────┘
```

### 二、Broker 层：分区内有序是唯一的内建保证

Kafka 官方文档 Introduction 的 Guarantees 一节原文：

> Kafka only provides a total order over records within a partition, not between different partitions in a topic. Per-partition ordering combined with the ability to partition data by key is sufficient for most applications.

官方同时强调这个顺序基于 **offset** 而非时间戳：分区内可能出现时间戳乱序的记录（生产者可以指定任意时间戳，或发生时钟偏移）。

为什么分区内能有序？分区是一个 **append-only 日志**，写入时由分区 Leader 的本地顺序追加保证单调递增的 offset；消费时按 offset 顺序拉取。同一分区同时只会有一个 Leader 接收写入（Kafka 2.4 之前甚至没有多 Leader 的概念），不存在多写入者竞争顺序的问题。这就是顺序保证的地基——但它只覆盖「同一分区」这个范围。

### 三、生产端：重试是如何破坏顺序的

顺序被破坏的第一个环节是生产端。官方文档在 `retries` 配置项的说明中明确警告：

> Allowing retries without setting max.in.flight.requests.per.connection to 1 will potentially change the ordering of records because if two batches are sent to a single partition, and the first fails and is retried but the second succeeds, then the records in the second batch may appear first.

机制如下：

```
批次1(offset 候选位置在前) ──发送──► 失败(网络抖动) ──► 进入重试队列
批次2 ───────────────────────────► 成功，先写入分区
批次1 重试 ───────────────────────► 成功，后写入分区
结果：分区内顺序 = 批次2 在前、批次1 在后 → 乱序
```

原因在于 Kafka 生产者默认允许同一连接上同时有多个未确认的请求在途（`max.in.flight.requests.per.connection` 默认 5），批次发送是异步并行的，重试批次可能被后续批次超越。

**两种保序方案对比：**

| 方案 | 原理 | 吞吐 | 适用情况 |
|---|---|---|---|
| `max.in.flight.requests.per.connection=1` | 同一连接仅一个批次在途，重试不可能被超越 | 低（丧失发送并行度） | 所有版本可用，但不推荐 |
| `enable.idempotence=true` | PID + 序列号，Broker 拒绝乱序批次、生产者按序重发 | 高（允许最多 5 个批次在途） | Kafka 0.11+，3.0+ 默认开启 |

**幂等生产者的工作机制（KIP-98）**：每个生产者实例在初始化时从 Broker 获得唯一的 **PID（producer ID）**，此后发往每个分区的批次都携带单调递增的 **序列号（sequence number）**。Broker 为每个 PID+分区 维护最近收到的序列号：收到重复序列号则丢弃批次（去重）；收到跳号的序列号（如上次是 2、这次是 4）则抛出 `OutOfOrderSequenceException`，生产者按正确顺序重发缺失批次。因此重试既不会造成重复，也不会造成乱序——这就是「幂等 + 保序」双重保证的来源。

**默认值演进**：KIP-98 在 Kafka 0.11 引入幂等生产者，但默认关闭；KIP-679（Kafka 3.0）将 `enable.idempotence` 默认值改为 true、`acks` 默认值改为 all，并规定开启幂等时自动满足 `retries>0`（默认 Integer.MAX_VALUE）且 `max.in.flight.requests.per.connection` 上限为 5。一个值得注意的版本细节：由于配置校验的 bug（KAFKA-13598），3.0.0 和 3.1.0 中若不显式配置，幂等实际上没有默认生效，3.2.0 才修复。面试中提到这个细节能体现对版本行为的真实了解。

**生产端配置示例（Java）：**

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
// Kafka 3.0+ 已是默认值，显式声明以表达顺序意图
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);

try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
    // 同一 orderId 的消息被哈希到同一分区，保证实体级局部有序
    producer.send(new ProducerRecord<>("orders", orderId, event));
}
```

### 四、路由层：key 决定消息进入哪个分区

默认分区器（`DefaultPartitioner`）对 key 做 murmur2 哈希后按分区数取模；不指定 key 时使用粘性分区（KIP-480，Kafka 2.4+）：随机选一个分区并持续把消息批进同一个批次，批次满或 `linger.ms` 到期后再轮换到下一个分区。

顺序设计上有两个要点：

- **必须为需要保序的消息指定 key**。无 key 消息由粘性分区器随机轮换分区，跨分区顺序无保证。
- **`UniformStickyPartitioner` 会忽略 key**。如果显式把 `partitioner.class` 配成 `UniformStickyPartitioner`，同 key 的消息不再保证进同一分区，官方 API 文档对此有明确警告——需要保序的业务绝不能配这个分区器。

另外，自定义 `Partitioner` 可以实现更灵活的路由（如按业务规则指定分区号），但**分区数一旦变化，取模映射随之改变**：同一 key 的新消息会落到新分区，与历史消息的相对顺序被打破。所以顺序敏感的业务要么提前规划足够的分区数，要么接受扩容窗口期的局部乱序，要么在扩容时通过停写、双写迁移等手段控制。

### 五、消费端：单消费者 + 单线程 + 顺序提交

**消费组协议**保证：同一消费组内，一个分区同时只分配给一个消费者（不同消费组之间互不影响，各自独立消费全量消息）。这是消费端保序的结构性前提。

消费者的处理逻辑是乱序的主要来源，常见错误有：

1. 收到消息后丢进线程池异步处理——同分区消息被并发处理，顺序不可控；
2. 先提交 offset 再处理业务——提交后崩溃，重启会跳过未处理消息；
3. 手动 seek 到任意位置继续消费，破坏 offset 连续性。

正确姿势是「串行处理 + 后提交 offset」：单线程内按 poll 返回的 offset 顺序处理完一批消息，再提交 offset。代价是 at-least-once 语义——提交前崩溃会重复消费已处理的消息，因此顺序消费必须搭配**业务幂等**（唯一键去重表、状态机校验等）。

**重平衡问题**：rebalance 发生时分区被转移到新消费者，旧消费者「已处理未提交」的消息会被重新消费（重复），顺序本身在单个分区内依然成立，但业务状态可能被重复推进。应对手段：

- 使用 `ConsumerRebalanceListener`，在 `onPartitionsRevoked` 中同步提交 offset、保存业务状态；在 `onPartitionsAssigned` 中从外部存储读取状态并用 `seek` 定位；
- 采用协作式重平衡（CooperativeStickyAssignor，KIP-429，Kafka 2.4 引入、3.0 起成为默认分配器），只迁移真正需要移动的分区，减少「所有分区全部停摆」的重平衡抖动。

**消费端代码示例（Java）：**

```java
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-consumer-group");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false); // 手动提交

try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
    consumer.subscribe(Collections.singletonList("orders"), new ConsumerRebalanceListener() {
        @Override
        public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
            consumer.commitSync(); // 分区被撤销前同步提交，避免重复范围扩大
        }

        @Override
        public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
            // 可从外部存储恢复状态，并用 consumer.seek(tp, offset) 精确定位
        }
    });

    while (running) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
        for (ConsumerRecord<String, String> record : records) {
            processInOrder(record); // 单线程串行处理，禁止丢线程池
        }
        consumer.commitSync(); // 处理完成后再提交 offset
    }
}
```

### 六、全局有序 vs 局部有序的取舍

| 需求 | 方案 | 顺序范围 | 吞吐 | 典型场景 |
|---|---|---|---|---|
| 全局有序 | 单分区 Topic | 全序 | 低，受单分区写入上限约束 | 对账流水、严格串行的状态机 |
| 实体级有序 | 多分区 + 实体 ID 作 key | 同 key 局部有序 | 高，随分区水平扩展 | 订单状态流转、binlog 按主键同步 |
| 无需有序 | 多分区 + 无 key | 无序 | 最高 | 日志、埋点、监控数据 |

跨分区全局有序 Kafka 不提供，流处理场景（如 Flink）通常按事件时间 + watermark 在消费后重新排序，或干脆将全局有序需求下沉为「单分区 + 单消费者」。设计时应先问：顺序的粒度到底是全局还是实体级——绝大多数业务是后者。

### 七、与其他 MQ 的顺序保证对比

- **RocketMQ**：提供专门的 FIFO 顺序消息类型（MessageGroup / ShardingKey），同组消息路由到同一 MessageQueue 并按序投递；官方文档同样要求单一生产者串行发送、消费者按「接收-处理-回复」路径顺序消费，且顺序消息重试次数受限，防止单条消息阻塞整个队列。与 Kafka 思路一致，只是把「key→分区」封装成了更显式的产品能力（详见 [mq概览](001-mq概览.md)）。
- **RabbitMQ**：单队列单消费者天然 FIFO，但队列级吞吐扩展困难，且消费者 ack 失败重投递会破坏顺序。

Kafka 的特点是把顺序保证的粒度（分区）与水平扩展的粒度（分区）统一起来，让业务通过 key 设计自己决定顺序边界，这与它的分区并行架构（详见 [kafka为什么快？](003-kafka为什么快？.md)）是一体两面。

### 八、面试追问

**追问 1：幂等生产者为什么能保序？它等于 exactly-once 吗？**

幂等生产者给每个发往分区的批次分配单调递增的序列号，Broker 按 PID+分区 维护已接收的最大序列号。收到跳号批次说明中间批次丢失或还在重试，Broker 抛出 OutOfOrderSequenceException 拒绝写入，生产者按序补齐重发后才继续推进。所以幂等保证的是「单分区、单生产者会话内」的保序与去重。它不等于 exactly-once：跨分区原子性和跨会话（生产者重启后 PID 变化）的重复无法覆盖，端到端 exactly-once 需要事务性生产者（KIP-98 的事务部分）或 Kafka Streams 的 EOS（KIP-129）配合。

**追问 2：重平衡发生时，顺序和重复问题怎么处理？**

重平衡本身不破坏分区内 offset 顺序，破坏的是业务连续性：已处理未提交的消息被新消费者重放，产生重复。处理手段：消费端坚持 at-least-once + 业务幂等；用 ConsumerRebalanceListener 在撤销前同步提交并保存业务状态、分配后 seek 恢复；用 CooperativeStickyAssignor（KIP-429）减少不必要的分区迁移。若面试官继续追问 Kafka Streams 如何处理——它用本地状态存储 + 变更日志（changelog）+ 事务性提交实现重平衡后的精确恢复。

**追问 3：分区数扩容后，同一个 key 的消息还有序吗？**

没有。默认分区器是 hash(key) % 分区数，分区数变化后映射改变，同一 key 的新消息进入新分区，与仍在旧分区的历史消息之间失去相对顺序。应对：提前规划足量分区；或扩容时先停写、消费完旧分区再恢复；或接受「扩容时间点前后各成一段有序」的业务现实——多数业务场景（如订单状态流转）可以容忍这个窗口。

**追问 4：消费端想提高吞吐，能多线程消费一个分区吗？**

直接对单分区内消息开线程池并发处理会乱序。可行的替代方案：一是分区数 = 线程数，每线程独立消费一个分区（保持「一分区一消费者线程」的映射）；二是单线程拉取后按 key 二次分发到多个处理线程，但必须保证同 key 消息进入同一线程且线程内串行处理，本质是把顺序粒度从分区细化到 key。

**追问 5：消息不带 key 就完全无法保序吗？**

粘性分区器只保证「无 key 消息在批次维度上聚合到同一分区」，不保证业务顺序；无 key 消息跨批次轮换分区，顺序无保证。如果消息确实没有天然 key，可以显式指定 partition 号（`ProducerRecord` 指定分区）把需要有序的消息固定发到同一分区，或从消息体中提取业务标识（如用户 ID、设备 ID）合成 key。

### 参考链接

- [Kafka 官方文档 - Introduction（Guarantees 一节）](https://kafka.apache.org/documentation/#introduction)
- [Kafka 官方文档 - Producer Configs（retries / max.in.flight.requests.per.connection / enable.idempotence）](https://kafka.apache.org/documentation/#producerconfigs)
- [KIP-98: Exactly Once Delivery and Transactional Messaging](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)
- [KIP-679: Producer will enable the strongest delivery guarantee by default](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679%3A+Producer+will+enable+the+strongest+delivery+guarantee+by+default)
- [KAFKA-13598: idempotence producer is not enabled by default if not set explicitly](https://issues.apache.org/jira/browse/KAFKA-13598)
- [KIP-480: Sticky Partitioner](https://cwiki.apache.org/confluence/display/KAFKA/KIP-480%3A+Sticky+Partitioner)
- [KIP-429: Kafka Consumer Incremental Rebalance Protocol](https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=115528973)
- [RocketMQ 官方文档 - FIFO 顺序消息](https://rocketmq.apache.org/docs/featureBehavior/03fifomessage/)

<!-- created: 2026-08-13 19:11:48 -->
<!-- updated: 2026-08-13 19:11:48 -->
