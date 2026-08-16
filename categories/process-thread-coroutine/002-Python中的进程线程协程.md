# 深入讲讲 Python 中的进程、线程、协程

## 题目

深入讲讲 Python 中的进程、线程、协程？

## 标签

[Python](../../tags/Python.md) | [并发](../../tags/并发.md)

## 题目导航

← [001-进程线程协程的理解](001-进程线程协程的理解.md) | [003-为什么要有线程和协程](003-为什么要有线程和协程.md) →

## 面试直接答

> CPython 并发的核心约束是 **GIL**：同一时刻只有一个线程能执行字节码，所以线程模型只对 IO 密集任务有效，CPU 密集必须走 multiprocessing 多进程；asyncio 用单线程事件循环加协程实现万级并发 IO，绕开了线程与锁的全部开销。Python 3.13 起 free-threaded 构建让无 GIL 成为可选项，3.14 起该构建正式受支持，并引入了 PEP 734 子解释器，这套格局正在被官方逐步改写。

先讲 GIL。**GIL（全局解释器锁）** 是 CPython 解释器级的一把大锁，任何线程执行字节码前必须持有它，因此多线程在纯 Python 代码上无法并行，只会并发——单核轮流跑。GIL 存在的历史原因是 **引用计数**：CPython 的内存管理基于引用计数，`x = y` 这种赋值在字节码层就要修改计数值，如果没有一把全局锁，多线程下的引用计数更新会数据竞争，导致对象被提前释放或内存泄漏。为 GIL 提供配套的是**字节码层面的定期切换**：解释器默认每执行约 5 毫秒（可用 `sys.setswitchinterval` 调整）强制释放一次 GIL，让其他线程有机会获得调度。但要注意，GIL 只保证单条字节码的原子性，`count += 1` 是四条字节码，仍然会丢更新，所以多线程共享状态照样要加 `threading.Lock`。

接着讲线程。`threading` 模块在 IO 密集场景下是有效的：线程执行 `socket.recv`、`time.sleep`、文件读取等阻塞系统调用时，解释器会**主动释放 GIL**，让其他线程运行，所以"十个线程各自等网络响应"确实能并发推进。`concurrent.futures.ThreadPoolExecutor` 是日常首选，比手管线程更安全。线程的坑在共享状态：除了锁，还有 CPython 特有现象——多线程下垃圾回收的分代收集需要先暂停所有线程（STW），大量小对象高频分配时 GC 可能成为瓶颈，这和引用计数机制直接相关，可参考 [001-谈谈 Python 中的垃圾回收机制](../python/001-谈谈-Python-中的垃圾回收机制.md)。

再讲进程。CPU 密集任务在 CPython 里线程无效，唯一正途是 `multiprocessing` 或 `concurrent.futures.ProcessPoolExecutor`：每个进程有独立解释器和独立 GIL，多核真正并行。代价是**进程创建与数据传递的序列化开销**——任务函数和参数必须可 pickle，大数据跨进程传输要序列化加管道拷贝，比线程共享内存贵得多。启动方式有三种：`fork` 利用写时复制瞬间复制父进程内存，但在多线程进程里 fork 有死锁风险（子进程只继承了调用 fork 的那一个线程，其他线程持有的锁状态被冻结）；`spawn` 从干净的解释器重新启动，最安全但最慢；`forkserver` 折中——从一个干净的服务器进程 fork。**Python 3.14 起 Linux 上的默认方式从 fork 改为 forkserver**（macOS 和 Windows 仍是 spawn），这是官方为了规避多线程 fork 死锁问题做的重大默认变更，迁移时最大的坑是：以前 fork 下依赖的"子进程继承父进程内存状态"，forkserver 下不再成立，所有数据都必须可 pickle。

然后讲协程。`asyncio` 是单线程事件循环模型：`async def` 定义协程，`await` 是协作式让出点，事件循环在 IO 等待期间切换到其他协程。因为没有锁、没有线程切换、没有解释器竞争，单个进程能轻松承载上万并发连接，网络服务是它的主场。两个关键边界：第一，协程里绝对不能调用阻塞函数——`requests.get` 或 `time.sleep` 会卡死整个事件循环，阻塞任务必须丢给 `asyncio.to_thread` 或 `loop.run_in_executor`；第二，CPU 密集代码放协程里同样阻塞循环，必须走进程池。

最后讲正在发生的变化。Python 3.13 引入实验性的 **free-threaded 构建**（PEP 703，编译参数 `--disable-gil`），3.14 起转为正式支持特性，以独立二进制 `python3.14t` 发行：单线程性能损失降到 5%~10%，4 线程下多核扩展约 4 倍。注意两点：C 扩展必须声明 `Py_mod_gil` 标记自己 GIL 安全，否则导入时**静默退回全局 GIL 模式**；即使无 GIL，内置容器也不承诺线程安全，锁依然要自己加。同版本还落地了 **PEP 734** 的 `concurrent.interpreters` 模块——同一进程内多个独立解释器，各自持有独立 GIL，通过 channel 传数据，比多进程轻、比多线程隔离性好，适用于插件系统、沙箱和 CPU 并行任务。

总结：IO 密集低并发用线程，CPU 密集用进程，高并发网络 IO 用 asyncio；free-threading 和子解释器是官方给出的新选项，但在 C 扩展生态全面兼容之前，多进程仍是 CPU 密集任务的稳妥答案。

## 详细解析

### 1. GIL 的工作原理

```
线程 A ──┐                                    ┌── 线程 B
         │ 尝试获取 GIL                        │ 尝试获取 GIL
         ▼                                    ▼
   ┌─────────────────────────────────────────────┐
   │                  GIL（全局解释器锁）            │
   │   同一时刻只有一个线程持有，持有者才能执行字节码   │
   └─────────────────────────────────────────────┘
         ▲
         │ 默认每 5ms（sys.setswitchinterval）强制释放
         │ 或在执行阻塞 IO / time.sleep 时主动释放
         ▼
   解释器主循环（ceval.c）：取字节码 → 执行 → 检查是否让出
```

关键事实：GIL 的释放点只有两类——**定期时间片到期**（5ms 抢占式让出）与**阻塞 IO 调用**（`recv`、`sleep` 等系统调用前后）。纯计算循环没有任何释放点，所以 CPU 密集多线程在 CPython 里几乎退化为串行，甚至因锁竞争比单线程更慢。相关机制在 [001-进程线程协程的理解](001-进程线程协程的理解.md) 的追问 2 中有对应说明。

### 2. 三种模型的可运行对比代码

```python
import asyncio, math, time
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

def cpu_task(n: int) -> float:
    """CPU 密集：求 sqrt 之和"""
    return sum(math.sqrt(i) for i in range(n))

def io_task(url: str) -> int:
    """IO 密集：同步请求"""
    import urllib.request
    with urllib.request.urlopen(url, timeout=5) as r:
        return len(r.read())

# ① CPU 密集：多线程被 GIL 限制，多进程真并行
if __name__ == "__main__":
    N = 3_000_000
    t0 = time.perf_counter()
    for _ in range(4):
        cpu_task(N)                      # 串行基准
    serial = time.perf_counter() - t0

    with ThreadPoolExecutor(4) as ex:    # 线程版 ≈ 串行，甚至更慢
        t0 = time.perf_counter()
        list(ex.map(cpu_task, [N] * 4))
        threaded = time.perf_counter() - t0

    with ProcessPoolExecutor(4) as ex:   # 进程版 ≈ 串行 / 4
        t0 = time.perf_counter()
        list(ex.map(cpu_task, [N] * 4))
        multiproc = time.perf_counter() - t0

    print(f"serial={serial:.2f}s threaded={threaded:.2f}s multiproc={multiproc:.2f}s")

# ② 高并发 IO：asyncio 单线程并发大量请求
async def fetch(session, url: str) -> int:
    async with session.get(url) as r:
        return len(await r.read())

async def main(urls):
    import aiohttp
    async with aiohttp.ClientSession() as session:
        tasks = [asyncio.create_task(fetch(session, u)) for u in urls]
        return await asyncio.gather(*tasks)

# asyncio.run(main(["http://example.com"] * 1000))   # 1000 并发，单线程
```

要点：`ProcessPoolExecutor` 在 3.14 的 Linux 默认 forkserver 下，`cpu_task` 必须是**模块级函数**且可 pickle；闭包、lambda、类实例方法（含不可序列化成员）都会在提交时直接报错——这是 fork 迁移到 forkserver 后最常见的兼容性事故。

### 3. threading / multiprocessing / asyncio 对比表

| 维度 | threading | multiprocessing | asyncio |
|------|-----------|-----------------|---------|
| 并行能力 | 无（GIL），仅并发 | 真并行（多核） | 无，单线程并发 |
| 适用负载 | IO 密集、低并发 | CPU 密集、隔离需求 | 高并发网络 IO |
| 数据共享 | 共享内存 + 锁 | IPC / pickle 序列化 | 单线程共享，无需锁 |
| 创建/通信成本 | 低（µs 级） | 高（进程创建 + 序列化） | 极低（协程对象） |
| 单机可承载数量 | 数千 | 数十 | 数万~十万级 |
| 崩溃隔离 | 无（进程一起挂） | 有 | 无 |
| 主要陷阱 | 数据竞争、死锁 | pickle 失败、启动慢、内存复制 | 阻塞调用卡死事件循环 |
| Python 3.14 变化 | 无 | Linux 默认 forkserver | 无（新增 `asyncio` 与解释器配合选项） |

### 4. 面试追问

**追问 1：GIL 在什么操作上会释放？为什么 IO 密集多线程有效？**

两类释放点：其一，解释器主循环的**定期切换**，默认每 5 毫秒（`sys.getswitchinterval()`）强制释放一次，实现"伪公平"；其二，**阻塞系统调用**——CPython 在执行 `socket.recv`、`select`、`time.sleep`、部分文件 IO 前通过 `Py_BEGIN_ALLOW_THREADS` 释放 GIL，IO 返回后重新获取。C 扩展同样可以手动释放 GIL 执行耗时操作。IO 密集多线程有效正是因为：线程大部分时间在"释放 GIL 等 IO"状态，多个线程的等待时间重叠，真正的瓶颈是网络/磁盘而不是 CPU 执行。而纯计算循环从不触发这两类释放点，多线程自然无收益。

**追问 2：Python 3.14 为什么把 Linux 默认启动方式从 fork 改成 forkserver？迁移时要注意什么？**

直接原因是**多线程进程 fork 的死锁风险**：fork 只把"调用 fork 的线程"复制进子进程，其他线程凭空消失，它们持有的锁永远没人释放；若子进程再调用 `threading.Lock` 或日志模块，可能直接死锁，Python 3.12 起对此场景已发出弃用警告。`spawn` 安全但启动慢（重新导入所有模块），`forkserver` 从长期存活的**单线程干净进程** fork，启动速度接近 fork 且无锁污染，官方因此在 3.14 将其设为 Linux 默认。迁移要点：任务与参数必须可 pickle（`multiprocessing.get_context("fork")` 可显式退回旧行为）；子进程不再继承父进程的模块级状态和类变量；进程池应在 `if __name__ == "__main__":` 保护下创建。

**追问 3：asyncio 里的"并发"和"并行"区别？为什么协程里不能有阻塞调用？**

并发是"任务交替推进"，并行是"任务同时执行"。asyncio 是单线程的：任意时刻只有一个协程在跑字节码，`await` 是显式的协作式让出点——协程 A 发起 IO 后 `await` 挂起，事件循环调度协程 B，IO 完成后循环再把 A 唤醒续跑。如果协程内部调用了 `requests.get` 这种同步阻塞函数，事件循环在函数返回前完全失去控制权，其他协程、定时器、信号处理全部冻结，整个服务表现为单点卡死。解决办法是把阻塞调用丢给线程池：`await asyncio.to_thread(requests.get, url)`，或者使用 aiohttp、httpx 等原生异步库。CPU 密集同理，应提交到 `ProcessPoolExecutor` 再 `await`。

**追问 4：free-threaded Python（3.14t）上线后，多线程的代码还要加锁吗？**

要。GIL 的移除改变的是"同一时刻只能一个线程执行字节码"这一约束，并不带来**任何线程安全契约**——官方文档明确声明，即使在 free-threaded 构建下，`dict`、`list` 等内置容器也不保证并发读写安全，数据竞争、死锁问题与 C++ 多线程无异，`threading.Lock` 照加。另一个隐蔽陷阱：若进程导入了**未声明 `Py_mod_gil` 的 C 扩展**，解释器会静默为整个进程重新启用 GIL，多核并行收益瞬间消失且无任何报错；排查手段是运行时检查 `sys._is_gil_enabled()`。此外 free-threaded 与实验性 JIT 不兼容，NumPy、pandas 等主库已适配，但大量小扩展尚未声明。

**追问 5：PEP 734 的子解释器和多进程、多线程相比，定位是什么？**

`concurrent.interpreters` 在**同一进程内**创建多个解释器实例，各自有独立的 GIL、独立模块状态和全局变量，天然规避了 GIL 的全局性——不需要 pickle（channel 传对象时仍是拷贝，但可用 `memoryview` 共享内存），创建成本毫秒级、远低于进程。相比多线程它有真实并行与状态隔离，相比多进程它轻量且共享进程资源，但**隔离是解释器级的，不是内存保护级的**：一个解释器段错误整个进程崩溃，所以文档不建议在其中运行不可信代码。适用场景是插件系统、语言服务器、以及需要并行的 CPU 任务（配合 `InterpreterPoolExecutor`）。

## 参考链接

- [Global interpreter lock — Python 官方词汇表](https://docs.python.org/3/glossary.html#term-global-interpreter-lock)
- [What's New In Python 3.14（multiprocessing 默认启动方式、free-threading 转正）](https://docs.python.org/3.14/whatsnew/3.14.html)
- [PEP 703 — Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/)
- [PEP 734 — Multiple Interpreters in the Standard Library](https://peps.python.org/pep-0734/)
- [multiprocessing — Contexts and start methods（官方文档）](https://docs.python.org/3/library/multiprocessing.html#contexts-and-start-methods)
- [asyncio — Coroutines and Tasks（官方文档）](https://docs.python.org/3/library/asyncio-task.html)
- [concurrent.futures — 线程池与进程池（官方文档）](https://docs.python.org/3/library/concurrent.futures.html)

<!-- created: 2026-08-16 00:07:12 -->
<!-- updated: 2026-08-16 00:07:12 -->
