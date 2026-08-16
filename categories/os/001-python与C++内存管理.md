# Python 内存管理与 C++ 内存管理

## 题目

Python 和 C++ 的内存管理机制有什么区别？请从实现和工程边界说明。

## 标签

[Python](../../tags/Python.md) | [C++](../../tags/C++.md) | [内存管理](../../tags/内存管理.md)

## 题目导航

← 无 | [002-从OS底层到语言层的内存管理全景](002-从OS底层到语言层的内存管理全景) →

## 面试直接答

> Python 与 C++ 内存管理的本质区别在<span style="background-color: #fff3cd">回收策略</span>：CPython 用引用计数为主、循环 GC 为辅的运行时回收，C++ 用作用域加 RAII 把资源释放绑定到对象生命周期，边界在于 Python 的语义随解释器实现而变——PyPy 用追踪 GC，而 C++ 的自由换来更高的未定义行为风险。

首先讲 CPython 的实现。对象主要通过引用计数回收：每个对象带引用计数字段，计数归零通常立即析构，容器对象形成的引用环再由循环垃圾收集器处理，并且并非所有对象都被循环 GC 跟踪——只有可能参与环的容器类型会被跟踪。版本细节必须说清楚：Python 3.14.0 到 3.14.4 把循环 GC 改成了增量式，大堆的最大停顿降低了一个数量级，但生产环境出现显著内存压力报告后，3.14.5 起官方回退到 3.13 的分代 GC。所以面试里谈 GC 机制一定要注明目标版本，这也是「实现细节不等于语言保证」的典型例子。

其次讲 CPython 的分配器。小对象——小于等于 512 字节——走 pymalloc，采用 arena、pool、block 三级结构：arena 在 64 位平台是 1 MiB、32 位平台是 256 KiB，通过 mmap 或 VirtualAlloc 从内核取得；pool 服务特定 size class；block 是实际分配单元；超过 512 字节的请求回退到系统 malloc。自由线程构建（PEP 703 在 3.13 引入、PEP 779 在 3.14 正式支持）下默认分配器是 mimalloc 且不能禁用，它用每线程堆实现多数情况下无锁的分配释放，普通构建也可以通过 PYTHONMALLOC=mimalloc 启用。这些阈值和 arena 大小是 CPython 实现细节，其他解释器完全可能用追踪 GC 或 JVM/.NET 式运行时。

第三讲为什么进程 RSS 不随对象释放下降。对象引用归零后语义生命周期结束，但承载它的 block 回到 pool、pool 回到 arena 留给解释器复用，系统 malloc 也可能保留空闲区，只有满足分配器归还条件时页面才还给 OS。所以业务对象下降而 RSS 持平不一定是泄漏，判断泄漏要结合对象数量、tracemalloc、分配器统计和 RSS 趋势多个指标（详见 [002-从OS底层到语言层的内存管理全景](002-从OS底层到语言层的内存管理全景.md) 的分配器层）。还要注意原生扩展绕过 Python 分配路径，NumPy 数组、图像库或 C 扩展自己 malloc 的内存的增长不一定出现在 tracemalloc 里，诊断时要把 Python 堆、原生分配器、映射文件和线程栈分开统计。

第四讲 C++ 一侧。C++ 的核心是存储期和所有权语义：自动存储期对象通过作用域和 RAII 析构，把资源释放绑定到对象生命周期；动态对象用 unique_ptr 表达唯一所有权，shared_ptr 表达共享控制块，weak_ptr 处理非拥有观察和打断引用环。控制块引用计数是原子的，但原子计数不等于被指向对象线程安全，同一个 shared_ptr 变量被多线程非 const 修改仍需同步。C++ 还要求异常安全保证：操作失败后至少不泄漏并保持对象有效，关键事务还要保证强异常安全，失败时状态完全不变。自定义 deleter、allocator 和 placement new 提供精细控制，也把对齐、异常安全和销毁顺序的责任交给开发者，代价是悬空指针、越界、重复释放和未定义行为风险。

第五讲两者的工程边界。两者不是「Python 不可控、C++ 编译期完全决定」的简单二分：CPython 有 gc 模块和 allocator API 可以运行时干预，C++ 也有运行时动态生命周期和异常路径下的析构变化。Python 的代价是对象头、动态类型、引用计数写流量和解释器开销，换来内存安全基线和开发效率，且计数写流量在高频引用变更下会进一步放大；C++ 的代价是安全依赖设计、工具和审查，换来布局、分配器和生命周期的可控性，RAII 对锁、文件和事务句柄这类稀缺资源的确定性释放是引用计数之外的另一条路线。跨语言边界是事故高发区：Python/C++ 扩展必须明确谁拥有引用、何时增减引用计数、GIL 或自由线程下的同步以及异常如何转换，许多「Python 内存泄漏」实质发生在扩展的所有权协议里。工程选型要看延迟、吞吐、安全基线、开发效率和可观测性，而不是只比较是否自动回收。

## 详细解析

> 版本核验：2026-08-16 查证 CPython 3.14 官方文档（c-api/memory.html、library/gc.html、whatsnew/3.14.html）与 cppreference。GC 行为按 3.14.5+ 描述。

### 一、CPython 三层内存结构
```text
┌─────────────────────────────────────────┐
│ 1. Python 对象层                          │  引用计数 · 对象头 · 类型协议 · 循环 GC
├─────────────────────────────────────────┤
│ 2. Python 内存分配器层                     │  pymalloc：≤512B，arena/pool/block
│                                         │  自由线程构建：mimalloc（每线程堆）
├─────────────────────────────────────────┤
│ 3. OS/系统分配器层                         │  malloc · mmap · VirtualAlloc
└─────────────────────────────────────────┘
```

### 二、pymalloc 关键参数（官方文档值）


| 参数              | 值                         | 出处                                        |
| --------------- | ------------------------- | ----------------------------------------- |
| 小对象阈值           | 小于等于 512 字节               | c-api/memory.html「The pymalloc allocator」 |
| arena 大小        | 64 位 1 MiB / 32 位 256 KiB | 同上                                        |
| 超过阈值的回退         | PyMem\_RawMalloc          | 同上                                        |
| 自由线程默认分配器       | mimalloc，3.13 起，不能禁用      | 同上（Changed in version 3.13）               |
| 普通构建启用 mimalloc | PYTHONMALLOC=mimalloc     | 同上                                        |
| 自由线程单线程性能代价     | 约 5\~10%                  | whatsnew/3.14.html                        |


### 三、循环 GC 的版本史（3.14 的实际变化）

Python 3.14.0\~3.14.4 把循环 GC 改为**增量式**，官方说明大堆最大停顿降低一个数量级以上；但由于生产环境的大量内存压力报告，**3.14.5 起回退到 3.13 的分代 GC**。这带来三个面试要点：第一，GC 行为在同一 minor 版本内都可能变化，回答必须带版本；第二，「降低停顿」和「控制内存」是 GC 设计的两难，增量 GC 用吞吐换停顿，在生产内存压力下被证明不划算；第三，引用计数的即时回收不受影响，变化只涉及循环检测部分。3.13 起 CPython 还内置了 mimalloc 库，自由线程构建以它作为必选分配器。

引用计数与追踪 GC 对比：


| 维度   | 引用计数（CPython）  | 追踪 GC（PyPy/JVM/.NET） |
| ---- | -------------- | -------------------- |
| 释放时机 | 计数归零通常即时       | GC 周期批量回收            |
| 停顿特征 | 无全局停顿，析构可级联    | Stop-the-world 或并发标记 |
| 引用环  | 无法处理，需循环 GC 补充 | 天然处理                 |
| 主要开销 | 每次引用变更的计数写流量   | 遍历活对象 + 写屏障          |


### 四、C++ 所有权代码示例
```cpp
#include <memory>
#include <vector>

struct Node {
    std::vector<std::shared_ptr<Node>> children;
    std::weak_ptr<Node> parent;      // 弱引用打断父子环
};

void ownership_example() {
    std::unique_ptr<Node> root = std::make_unique<Node>(); // 唯一所有权
    auto child = std::make_shared<Node>();                 // 控制块 refcount = 1
    child->parent = std::weak_ptr<Node>();                 // weak_ptr 不增加计数
    if (auto sp = child->parent.lock()) { /* 提升成功才使用 */ }
}   // root 随作用域析构；child 计数归零后释放对象与控制块
```

智能指针对比：


| 类型          | 所有权语义 | 典型用途       | 注意事项                          |
| ----------- | ----- | ---------- | ----------------------------- |
| unique\_ptr | 唯一    | 工厂返回、容器内对象 | 只移动不复制                        |
| shared\_ptr | 共享控制块 | 共享生命周期     | 环用 weak\_ptr 打断；原子计数 ≠ 对象线程安全 |
| weak\_ptr   | 非拥有观察 | 缓存、回调、断环   | lock() 可能为空，需判空               |
| 裸指针         | 无所有权  | 非拥有引用      | 接口必须写清生命周期契约                  |


### 五、引用计数的工程后果与诊断

引用变更带来运行时写流量开销，析构还可能级联执行用户代码（**del**）；对象释放「通常及时」不能用作文件和锁的正确性协议，跨实现更不能依赖。循环 GC 只补充处理环，也不负责发现所有原生资源泄漏。

诊断要把三件事分开：**Python 对象**是否增长（gc 对象数量、tracemalloc 分配栈）、**原生分配器**是否增长（malloc 统计）、**RSS 与工作集**是否匹配。原生扩展（NumPy、图像库、C 扩展）的分配不走 Python 路径，tracemalloc 看不到，这是最常见的「看起来是 Python 泄漏」误判来源。Python 侧更完整的 GC 机制讨论见 [001-谈谈-Python-中的垃圾回收机制](../python/001-%E8%B0%88%E8%B0%88-Python-%E4%B8%AD%E7%9A%84%E5%9E%83%E5%9C%BE%E5%9B%9E%E6%94%B6%E6%9C%BA%E5%88%B6.md)。

### 六、面试追问

**追问一：CPython 引用计数是即时回收，为什么还要循环 GC？哪些对象会被跟踪？**

引用计数无法回收引用环——两个容器互相引用时计数永不归零，对象和其持有的原生资源都无法释放。所以循环 GC 只跟踪「可能参与环」的容器类型（list、dict、set、自定义类实例等），int、str 这类不可变标量不参与跟踪，这也解释了为什么 gc.get\_objects() 看不到它们。gc.disable() 只是停止环检测，计数归零的即时回收仍在工作，环会一直积累。另外「即时回收」不能当作正确性协议：环中对象的 **del** 何时执行甚至是否执行都不保证（PEP 442 之后才可预测一些），PyPy 用追踪 GC 根本没有引用计数，跨实现的代码不能依赖释放时机。

**追问二：为什么对象都释放了，进程 RSS 还是不降？如何判断是不是泄漏？**

分三层看。CPython 对象释放后 block 回到 pool、pool 回到 arena 供解释器复用，pymalloc 不会主动把整个 arena 还给系统——只要 arena 里还有活对象，1 MiB 就整块驻留，大量尺寸交错的对象会加剧这种碎片化驻留。系统 malloc 层同样可能保留空闲页。真正还给 OS 需要整块 arena 空闲且分配器策略允许归还。判断泄漏要四路并进：业务对象数量是否持续增长、tracemalloc 的分配栈是否单调增加、原生分配器统计、RSS 趋势与工作集对比；还要排除原生扩展——它们的内存不走 Python 分配路径，tracemalloc 看不到。

**追问三：shared\_ptr 的控制块是原子计数的，为什么还说 shared\_ptr 不一定线程安全？**

控制块的引用计数用原子操作保证「并发拷贝不同的 shared\_ptr 对象」安全，但被指向的对象本身没有任何同步，多线程同时读写同一个 T 仍然是数据竞争；更隐蔽的是「同一个 shared\_ptr 变量」被两个线程同时拷贝或重置是未定义行为，因为那是在并发读写同一个指针成员，必须加锁或用 C++20 的 atomic 特化。weak\_ptr::lock 原子的只是计数和过期判断，返回的 shared\_ptr 指向的对象仍需自己的同步。一句话：计数安全、对象安全、变量安全是三个层次。

**追问四：CPython 有 gc 和分配器 API，C++ 也有运行时动态生命周期，为什么「Python 不可控、C++ 编译期完全决定」是错的？**

CPython 侧，gc.set\_threshold 调分代阈值、gc.freeze 把对象移出 GC 扫描、PYTHONMALLOC 切换分配器、tracemalloc 定位分配栈，都是运行时干预手段。C++ 侧，new 的对象存活期完全由运行时决定，shared\_ptr 的释放时机依赖引用关系而非编译期，异常路径也会在运行时改变哪些对象被析构。更准确的表述是：Python 把回收策略内置进运行时并暴露配置面，C++ 把回收策略交给代码表达（RAII、智能指针、自定义分配器），两者都有运行时成分，只是默认值和责任归属不同。真正的工程区别在可预测性——C++ 的对象布局、析构时序和分配路径确定性强，Python 侧受解释器策略和版本行为影响更大。

### 七、参考链接

- [CPython Memory Management（pymalloc 阈值、arena、mimalloc）](https://docs.python.org/3/c-api/memory.html)
- [gc — 垃圾收集器接口](https://docs.python.org/3/library/gc.html)
- [Python 3.14 What's New（增量 GC 与 3.14.5 回退、自由线程）](https://docs.python.org/3.14/whatsnew/3.14.html)
- [Python 3.13 What's New（内置 mimalloc）](https://docs.python.org/3.13/whatsnew/3.13.html)
- [mimalloc — Microsoft](https://github.com/microsoft/mimalloc)
- [cppreference: std::shared\_ptr（线程安全注记）](https://en.cppreference.com/w/cpp/memory/shared_ptr)
- [cppreference: RAII](https://en.cppreference.com/w/cpp/language/raii)


<!-- created: 2026-08-03 16:14:18 -->
<!-- updated: 2026-08-16 00:37:33 -->
