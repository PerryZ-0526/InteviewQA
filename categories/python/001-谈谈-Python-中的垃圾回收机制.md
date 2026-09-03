# ✅谈谈 Python 中的垃圾回收机制

## 题目

谈谈 Python 中的垃圾回收机制。请区分语言语义与 CPython 实现，并说明引用计数、循环 GC、代际模型与常见调优误区。

## 标签

[Python](../../tags/Python.md) | [内存管理](../../tags/内存管理.md)

## 题目导航

← 无 | 无 →

## 面试直接答

> Python 语言规范并未规定唯一的垃圾回收算法，面试语境下默认讨论 CPython

> CPython 以引用计数作为主要内存回收机制，通过分代循环垃圾回收解决引用环问题。
>
> - CPython 主要采用`引用计数`管理对象生命周期，当引用计数降为零时立即回收；但引用计数无法处理`循环引用`，因此又引入`分代垃圾回收机制`，定期检测并清理`相互引用但已不可达的对象`。
> - 分代垃圾回收是 CPython 为处理循环引用设计的机制，它会根据`对象存活时间`把对象划分为不同代，其依据是“大多数对象生命周期很短”，这样可以++减少每次都扫描全部对象的开销++；
> - 引用计数负责及时回收普通对象，分代回收主要补充清理循环引用。

每个 CPython 对象头都带有 `ob_refcnt 引用计数字段`，赋值、传参、容器插入等`引用变更`都经过 Py\_INCREF/Py\_DECREF 增减计数，归零时立即进入 tp\_dealloc 析构路径。

- 优点是<span style="background-color: #fff3cd">回收及时、行为确定</span>，文件句柄等资源在多数场景下随引用归零立刻释放；
- 代价是每次引用变更都要++付出计数操作的开销++，且无法处理自引用或互引的容器环——环内对象互相持有引用，计数永不归零，这部分交给`循环 GC`。

`循环 GC` ++并不会扫描所有对象，<span style="background-color: #fff3cd">只跟踪</span>++`可能形成环的容器对象`——即带 Py\_TPFLAGS\_HAVE\_GC 标志、实现 tp\_traverse 的类型。原子类型的实例不被跟踪，只含原子元素的 tuple、只含原子键值的 dict 也被优化为不跟踪，因为它们不可能参与环，可以用 gc.is\_tracked 验证。算法上，收集器通过 update\_refs 与 subtract\_refs 两遍模拟减去环的内部引用，找出外部不可达的环集合，而不是依赖真实引用计数。

代际模型方面，当前 CPython（3.14.5 及以后）恢复`三代分代收集`：新对象进第 0 代，<span style="background-color: #fff3cd">每次存活晋升一代</span>，第 0 代收集最频繁。默认阈值为 (700, 10, 10)，即`对象分配次数-对象释放次数`超过 700 触发第 0 代收集，第 0 代收集超过 10 次才检查第 1 代，以此类推；gc.collect() 手动触发全量收集并清空部分类型的 free list。

> 1. `存活`：被自己所在代的 GC 检查过一次，而且没被回收
> 2. `threshold0=700`：CPython 会统计++自上次相关收集以来的“对象分配次数减去对象释放次数”++（可以理解成一个`“净增长计数器”`），这个净值超过 700，就考虑触发第 0 代 GC
> 3. 为什么不简单统计“创建了多少对象”？因为如果对象创建后很快就被引用计数机制释放，这种情况下大量对象已经被**引用计数**及时处理，没有必要频繁启动专门解决循环引用的 GC。这个“净分配”设计可以避免很多无意义的 GC。
> 4. `threshold1=10`：第二个 `10` 大致控制第 1 代多久检查一次：如果++从上一次检查第 1 代之后++，第 0 代已经被检查超过 `threshold1=10`次，那么下一次就会连第 1 代一起检查
> 5. `threshold2=10`：**第 2 代的触发逻辑更复杂**。CPython 官方文档也专门说明，最老一代不能简单按照前两代“以此类推”；它<span style="background-color: #fff3cd">还会考虑长期存活对象的比例</span>，以避免第 2 代对象很多时频繁做成本很高的全量扫描。

### 这里必须强调版本差异，这是近年面试的新考点

- 3.13 开发期曾引入`增量循环 GC`，但在 3.13.0rc3 <span style="background-color: #fff3cd">因性能回退被回滚</span>，正式版仍是`三代收集器`；
- 增量方案随后在 3.14.0 重新落地，改为两代模型并移除第 1 代，gc.collect(1) 的含义变成「做一次增量收集」；
- 但 3.14.5（2026 年 5 月）++因生产环境内存压力报告再次回滚++，恢复三代收集器——核心开发者 Tim Peters 定位到增量算法会让垃圾环堆积，单进程滞留超过 9 万个待回收环。

> 因此代数数量与阈值是实现细节而非语言规范，答题和调参前必须按目标版本核验。

此外，3.13 起提供的`自由线程构建`（PEP 703，3.14 起正式支持）有独立设计：

- 引用计数改为`偏向引用计数`加`延迟引用计数`，帧栈上的引用延迟到 GC 阶段处理，堆类型使用每线程引用计数；
- 循环 GC 退化为单代收集器，且每轮需要两次 stop-the-world 暂停。

---

最后要承认边界：这套机制是 CPython 的实现细节，PyPy 使用分代追踪 GC 而没有引用计数，Jython 依赖 JVM 的 GC。判断「对象何时释放」不能跨实现泛化，资源管理应优先用 with 上下文和显式 close 保证确定性，而不是依赖 GC。

## 详细解析

### 一、引用计数：机制与源码对应

**引用计数**是 CPython 的默认回收机制。`Include/object.h` 中 `PyObject` 结构体的第一个字段就是 `ob_refcnt`（`Py_ssize_t`），所有引用变更都通过 `Py_INCREF`/`Py_DECREF` 宏完成；计数归零后进入 `_Py_Dealloc`，最终调用类型对象的 `tp_dealloc` 释放内存。


| 操作                                   | 引用计数变化         |
| ------------------------------------ | -------------- |
| 赋值、传参、返回值                            | 目标对象 +1        |
| 变量离开作用域、容器删除元素                       | 对象 -1          |
| 容器插入 `list.append` / `dict[key] = v` | 元素/值 +1        |
| `del` 变量                             | 变量指向的对象 -1     |
| `weakref` 创建                         | 不增加（这正是弱引用的意义） |


`sys.getrefcount(obj)` 的返回值比直觉多 1，因为调用时实参本身持有一次临时引用，这是面试常问的细节。

引用计数无法处理环：环内对象互相持有引用，计数永不归零。示例：
```python
import sys, weakref, gc

class Node:
    def __init__(self, name):
        self.name = name
        self.other = None

a = Node("a"); b = Node("b")
a.other = b; b.other = a          # 形成引用环
ra = weakref.ref(a)
del a, b
print(ra() is None)               # False：引用计数没有归零，环还在
gc.collect()
print(ra() is None)               # True：循环 GC 拆解并回收了环
```

**不朽对象**（PEP 683，3.12 起）：运行时全局对象（`None`、`True`、`False`、`Ellipsis`、`NotImplemented`、静态类型、小整数等）的引用计数被设为魔数 `_Py_IMMORTAL_REFCNT`，`Py_INCREF`/`Py_DECREF` 对它们是 no-op，永不参与回收。因此 3.12+ 中 `sys.getrefcount(None)` 返回一个巨大的值而非 0/1 附近的数。

### 二、循环 GC：跟踪范围与收集算法

**循环垃圾收集器**（gcmodule）只跟踪「可能参与环」的容器：类型设置了 `Py_TPFLAGS_HAVE_GC` 标志并实现 `tp_traverse`。以下对象不被跟踪：
```python
import gc

print(gc.is_tracked([]))        # True：list 被跟踪
print(gc.is_tracked(1))         # False：int 是原子类型
print(gc.is_tracked((1, 2)))    # False：只含原子元素的 tuple 不跟踪
print(gc.is_tracked((1, [])))   # True：tuple 含容器，必须跟踪
```

`gc.is_tracked` 文档明确说明：实例含原子类型的一般不被跟踪，而含非原子类型的（容器、自定义对象等）被跟踪；类型特化可以进一步抑制跟踪，例如只含原子键值的 dict。

收集算法不依赖真实引用计数，而是在每个被跟踪对象内部维护模拟计数 `gc_refs`，对应 `Modules/gcmodule.c` 中的四步：
```
对象图（含环）
    │ ① update_refs：把外部引用计数复制到 gc_refs
    ▼
减去环内部引用
    │ ② subtract_refs：遍历各对象的引用，被指对象 gc_refs -1
    ▼
找出不可达环
    │ ③ 从根集合遍历，能到达的标记为存活
    ▼
回收垃圾环
      ④ move_unreachable：gc_refs 为 0 且不可达的对象进入
        unreachable 列表，触发终结，随后 tp_clear 拆环
```

环内对象互相引用，`subtract_refs` 之后 gc\_refs 归零；若环整体从外部不可达，就会被整环回收——这正是引用计数做不到的事。

### 三、分代模型与 gc 模块 API

`分代假设`是「大多数对象短命」。当前 CPython（3.14.5+，回滚增量 GC 后）恢复三代模型：
```
分配 → [gen0] ──存活一次──→ [gen1] ──存活一次──→ [gen2]
          ↑ 收集最频繁                        ↑ 收集最不频繁
```

默认阈值 `(700, 10, 10)` 定义在 `Modules/gcmodule.c`（`threshold0/1/2` 初始值）：分配减释放差值超过 700 触发 gen0 收集；gen0 被检查超过 10 次才检查 gen1；gen1 被检查 10 次才检查 gen2。注意收集器统计的是对象数量而非字节数，大量小对象可能高频触发收集。


| gc API                                   | 作用（3.14.5+ 三代模型下）                    |
| ---------------------------------------- | ------------------------------------ |
| `gc.collect()`                           | 全量收集（等效 generation=2），返回回收对象数        |
| `gc.collect(1)`                          | 收集第 1 代（3.14.0–3.14.4 期间语义为「一次增量收集」） |
| `gc.get_threshold()` / `set_threshold()` | 读写 (700, 10, 10) 阈值                  |
| `gc.get_count()` / `get_stats()`         | 各代待收集计数 / 分代统计                       |
| `gc.freeze()`                            | 把当前所有被跟踪对象移入永久代，后续收集完全忽略它们           |
| `gc.disable()` / `enable()`              | 只开关循环 GC，不影响引用计数                     |
| `gc.is_tracked(obj)`                     | 对象当前是否被循环 GC 跟踪                      |
| `gc.DEBUG_SAVEALL`                       | 把本应回收的不可达对象存入 `gc.garbage` 供检查       |
| `gc.garbage`                             | 存放有终结器且无法回收的对象（PEP 442 后很少非空）        |


### 四、版本演进：从三代到增量再到回滚

循环 GC 的代数结构在 3.13–3.14 经历了两次重大变更，是近年高频考点：


| 版本              | 循环 GC 方案         | 代数                         | 关键事件                                                                                             |
| --------------- | ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| ≤ 3.12          | 传统分代收集器          | 3 代（阈值 700,10,10）          | 3.12 引入不朽对象（PEP 683）                                                                             |
| 3.13            | 传统分代收集器          | 3 代                        | 开发期引入增量 GC（gh-115304），**3.13.0rc3 回滚**（2024-10，性能回退）；free-threaded 构建首次实验性提供（PEP 703）            |
| 3.14.0–3.14.4   | 增量 GC（gh-108362） | **2 代**（young/old，移除 gen1） | `gc.collect(1)` 语义变更；最大停顿降低一个数量级；free-threaded 转正（PEP 779）                                       |
| 3.14.5+         | 回滚为传统分代收集器       | 3 代                        | 生产环境内存压力报告：Tim Peters 定位到垃圾环堆积、单进程滞留 9 万+ 环，增量 GC 的 work 计算甚至可能为负；3.15 同样回滚                      |
| 3.14.6（2026-06） | 传统分代收集器          | 3 代                        | 修复版发布，文档标注「Changed in version 3.14.5: generation=1 performs collection of the middle generation」 |


**自由线程构建**（`--disable-gil`，PEP 703）：无 GIL 后引用计数不能直接并发增减，采用**偏向引用计数 + 延迟引用计数**——帧栈上的引用延迟到 GC 处理，堆类型额外维护每线程引用计数数组；循环 GC 改为**单代收集器**，每轮需要两次 stop-the-world 暂停保证一致性。因此同一份代码在常规构建与自由线程构建下的 GC 行为与统计都不同。

### 五、为什么 RSS 不下降：pymalloc 与 free list

对象被回收后 RSS 不降，是因为解释器与分配器把内存留下复用了。小对象（≤512 字节，`SMALL_REQUEST_THRESHOLD`，见 `Objects/obmalloc.c`）走 **pymalloc**：
```
arena（64 位平台 1MiB，32 位 256KiB；mmap 匿名映射向系统申请）
 └── pool（4KiB，与系统页对齐）
      └── block（8 字节对齐的 size class：8/16/24/.../512）
```

对象释放后 block 回到 pool 的空闲链表，pool 回到 arena；只有整个 arena 完全清空才可能归还系统。部分类型还有 **free list**（如 float），小对象释放后直接挂回类型私有链表。超过 512 字节的请求交给系统分配器，而 glibc 等自身也会保留空闲区。三层叠加，RSS 呈「高水位」形态是正常现象，详见 [001-python与C<u>内存管理</u>](../os/001-python%E4%B8%8EC%3C/u%3E%E5%86%85%E5%AD%98%E7%AE%A1%E7%90%86.md) <u>与 [002-从OS底层到语言层的内存管理全景](../os/002-%E4%BB%8EOS%E5%BA%95%E5%B1%82%E5%88%B0%E8%AF%AD%E8%A8%80%E5%B1%82%E7%9A%84%E5%86%85%E5%AD%98%E7%AE%A1%E7%90%86%E5%85%A8%E6%99%AF.md)。</u>

<u>诊断时用 tracemalloc 对比快照，定位真正被持续持有的内存：</u>
```python
import tracemalloc, gc

class Holder:
    pass

tracemalloc.start()
gc.collect()
snap1 = tracemalloc.take_snapshot()

keep = []
for _ in range(1000):
    h = Holder()
    h.data = bytearray(4096)   # 大对象，走系统分配器，便于观察
    keep.append(h)

snap2 = tracemalloc.take_snapshot()
for stat in snap2.compare_to(snap1, "lineno")[:3]:
    print(f"{stat.size_diff / 1024:.0f} KiB  {stat.traceback.format()[0]}")
```

### <u>六、终结器与引用环：PEP 442 前后的语义</u>

<u>3.4 之前，带</u> `__del__` <u>的对象如果处在环中，收集器无法确定终结顺序，环会被放入</u> `gc.garbage` <u>永久泄漏，且终结器可能被多次调用（zombie 问题）。**PEP 442**（安全对象终结，3.4 起）改变了两点：</u>

- <u>终结器**至多执行一次**，环中的带终结器对象也能被正常回收；</u>
- <u>**复活语义**：终结器执行期间若对象被重新引用（复活），环整体复活，但该对象下次引用归零时**不再调用**</u> `__del__`<u>，直接释放。</u>
```python
import gc

class Res:
    def __init__(self, name):
        self.name = name
    def __del__(self):
        print(f"finalizing {self.name}")

a = Res("a"); b = Res("b")
a.other = b; b.other = a
del a, b
print("before collect")
gc.collect()      # PEP 442：两个终结器各执行一次，环被回收
print("after collect")
```

<u>输出中两个</u> `finalizing` <u>各出现一次，环不会进入</u> `gc.garbage`<u>。因此「有</u> `__del__` <u>的对象不能进环」这条老经验自 3.4 起已过时，但依赖</u> `__del__` <u>做资源释放本身仍应避免（时机不确定、复活副作用难预料），资源管理优先用</u> `with`<u>/</u>`close`<u>。</u>

### <u>七、面试追问</u>

**<u>追问 1：循环 GC 具体怎么找到环里的垃圾？为什么不直接看引用计数？</u>**

<u>直接看计数分不出「环」和「被外部引用的环」。gcmodule 用模拟计数：</u>`update_refs` <u>把外部引用计数复制到</u> `gc_refs`<u>；</u>`subtract_refs` <u>让每个被跟踪容器遍历自己引用的对象并对其</u> `gc_refs` <u>减一，环内部互相引用被抵消，环内对象</u> `gc_refs` <u>归零；随后从根集合（栈、全局变量、注册表等）遍历标记存活，</u>`gc_refs` <u>为 0 且不可达的即垃圾环，进入</u> `move_unreachable` <u>拆解回收。这套算法只对「可能参与环」的被跟踪容器生效，原子对象根本不在图里。</u>

**<u>追问 2：gc.disable() 之后程序更快，能不能直接在生产环境关掉？</u>**

<u>不能无脑关。关闭的只是循环 GC，引用计数照常工作，代价是环永不回收——无环场景下确实省掉扫描开销，Instagram 就曾在预 fork 架构上全站关闭 GC，但他们的前提是经过验证的代码库与配套措施：父进程早期</u> `gc.disable()`<u>、fork 前</u> `gc.freeze()` <u>冻结已跟踪对象避免子进程写时复制、子进程再</u> `gc.enable()`<u>。普通业务代码里第三方库随时可能制造环（缓存、双向链表、异常栈帧），关闭 GC 后内存只涨不跌，出问题极难定位。合理做法是先测量：</u>`gc.get_stats()` <u>看收集耗时占比，再决定是否调阈值而非一刀切关闭。</u>

**<u>追问 3：Python 3.14.0 的增量 GC 不是已经降低停顿了吗，为什么 3.14.5 又回滚？</u>**

<u>增量 GC（gh-108362）把全量收集拆成小块，最大停顿降了一个数量级，但把「及时回收」换成了「延迟回收」：年轻代收集不再必然伴随对老年代的同步推进，垃圾环可以长期滞留。生产环境报告大量内存压力后，Tim Peters 在官方论坛分析指出，某些工作负载下增量收集器的 work 计算会失真甚至变为负值，导致收集不触发，单进程滞留超过 9 万个待回收环。3.14.5（2026 年 5 月）决定回滚到 3.13 式三代收集器，3.15 同样回滚。这题的核心启示是：GC 调优是停顿与内存占用的权衡，且具体行为必须绑定小版本验证。</u>

**<u>追问 4：引用环在自由线程构建（no-GIL）下还能靠引用计数回收吗？</u>**

<u>引用计数的形态变了。PEP 703 规定自由线程构建使用偏向引用计数加延迟引用计数：大多数引用变更仍是原子增减，但帧栈（局部变量、求值栈）上的引用被延迟处理——对象被标记为「延迟引用」时引用计数加一作为占位，GC 计算</u> `gc_refs` <u>时跳过这类引用，回收时统一结算；堆类型（heap type）另用每线程引用计数数组，真实计数是三者之和。循环 GC 相应退化为单代收集器，且因为要暂停所有线程获得一致快照，每轮收集有两次 stop-the-world 暂停。所以「引用计数即时回收」在自由线程构建下不再是严格保证。</u>

**<u>追问 5：除了 CPython，其他 Python 实现的垃圾回收有什么不同？为什么不能跨实现泛化？</u>**

<u>Python 语言规范只保证「对象在不可达后会被回收、终结器至多一次（PEP 442 进入语言规范）」这类语义，不规定算法。PyPy 用增量式分代追踪 GC，完全没有引用计数，</u>`__del__` <u>时机和 CPython 不同；Jython/IronPython 分别托管给 JVM 与 .NET GC；MicroPython 默认只做引用计数加可选的 mark-sweep。所以「引用计数回收」是 CPython 实现细节，写跨实现代码时资源释放必须显式化（with/close），不能依赖 CPython 的即时回收时机。</u>

### <u>八、跨实现边界小结</u>


| <u>实现</u>          | <u>主要 GC 机制</u>             | <u>引用计数</u> |
| ------------------ | --------------------------- | ----------- |
| <u>CPython</u>     | <u>引用计数 + 三代循环 GC</u>       | <u>有</u>    |
| <u>PyPy</u>        | <u>增量式分代追踪 GC</u>           | <u>无</u>    |
| <u>Jython</u>      | <u>JVM GC</u>               | <u>无</u>    |
| <u>IronPython</u>  | <u>.NET GC</u>              | <u>无</u>    |
| <u>MicroPython</u> | <u>引用计数 + 可选 mark-sweep</u> | <u>有</u>    |



## 参考链接

- [gc — Garbage Collector interface（Python 3.14 官方文档）](https://docs.python.org/3.14/library/gc.html)
- [What's New In Python 3.14（增量 GC 与回滚说明）](https://docs.python.org/3.14/whatsnew/3.14.html)
- [Python 3.14.5 is here, with a new (old) garbage collector!（Python 官方论坛回滚讨论）](https://discuss.python.org/t/python-3-14-5-is-here-with-a-new-old-garbage-collector/107304)
- [Improving incremental gc（Tim Peters 对垃圾环堆积的分析）](https://discuss.python.org/t/improving-incremental-gc/107067)
- [Python 3.13.0rc3 Release（3.13 增量 GC 回滚公告）](https://www.python.org/downloads/release/python-3130rc3/)
- [Python 3.14.6 Release](https://www.python.org/downloads/release/python-3146/)
- [PEP 683 – Immortal Objects, Using a Fixed Refcount](https://peps.python.org/pep-0683/)
- [PEP 703 – Making the Global Interpreter Lock Optional in CPython（延迟引用计数与单代 GC）](https://peps.python.org/pep-0703/)
- [PEP 442 – Safe object finalization](https://peps.python.org/pep-0442/)
- [CPython 源码 Modules/gcmodule.c（阈值默认值与收集算法）](https://github.com/python/cpython/blob/main/Modules/gcmodule.c)
- [CPython 源码 Objects/obmalloc.c（pymalloc：arena/pool/block 与 512 字节阈值）](https://github.com/python/cpython/blob/main/Objects/obmalloc.c)
- [Memory Management（C-API 文档：arena 大小 64 位 1MiB / 32 位 256KiB）](https://docs.python.org/3.14/c-api/memory.html)
- [tracemalloc — Trace memory allocations（官方文档）](https://docs.python.org/3.14/library/tracemalloc.html)


<!-- created: 2026-08-15 23:40:32 -->
<!-- updated: 2026-09-02 16:42:02 -->
