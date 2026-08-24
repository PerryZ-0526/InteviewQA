# Python中的进程、线程、协程

## 题目

(在此填写题目)

## 标签

[TODO](../../tags/TODO.md)

## 题目导航

← [Python的语言特点](Python的语言特点) | 无 →

## 面试直接答

Python 中的进程、线程和协程本质上是**三个不同层级的并发执行方式**。我通常从“资源隔离程度、调度者、切换成本以及适用场景”来区分它们。

进程是操作系统进行资源分配和隔离的重要单位。不同进程拥有相对独立的虚拟地址空间，一个进程正常情况下不能直接访问另一个进程的内存。因此进程隔离性最好，一个进程崩溃通常不会直接破坏另一个进程，但创建和上下文切换的成本也比较高。进程之间如果需要交换数据，要通过管道、共享内存、消息队列、Socket 等进程间通信方式。在 Python 中可以通过 `multiprocessing` 创建多个进程。

线程则存在于进程内部。同一个进程中的线程共享代码段、堆内存和打开的文件等资源，但每个线程拥有自己的栈、寄存器状态等执行上下文。因此线程之间通信比较方便，直接访问共享变量即可，但也正因为共享内存，会产生竞态条件，需要锁、信号量等同步机制保证线程安全。

Python 线程还有一个必须讲到的概念，就是 CPython 中的 **GIL，全局解释器锁**。传统 CPython 中，同一个解释器进程内通常只有一个线程能够同时执行 Python 字节码，所以对于大量纯 Python 计算，例如循环进行复杂数学运算，开多个线程通常无法真正利用多个 CPU 核。但对于网络请求、数据库访问、磁盘 I/O 这样的 I/O 密集型任务，线程在等待 I/O 时可以让其他线程执行，所以多线程仍然非常适合。

协程比线程更轻量。协程不是操作系统直接调度的执行单位，而主要由程序运行时和事件循环进行调度。在 Python 中最典型的方式是 `asyncio + async/await`。一个协程运行到 `await` 时，如果当前任务需要等待网络或其他异步 I/O，它会主动让出执行权，事件循环再去运行其他协程。等对应 I/O 完成后，再恢复这个协程。

因此线程和协程一个非常关键的区别是：**线程切换主要由操作系统调度，而协程切换更多是用户态的协作式调度。** 协程通常不需要像线程那样频繁进入操作系统内核进行上下文切换，所以能够以较低成本维护成千上万个并发任务。这也是 FastAPI、aiohttp 等高并发网络服务大量使用异步协程的原因。

不过协程并不等于并行。例如一个事件循环里运行一万个协程，并不意味着一万个任务同时使用 CPU。如果某个协程执行一个长时间的纯 CPU 循环，并且一直不 `await`，那么它会阻塞整个事件循环。因此协程最适合的是**高并发 I/O 密集型场景，而不是 CPU 密集型计算**。

如果让我做工程上的选择，我通常会按照任务性质判断：对于计算密集型任务，例如图像处理、大量 Python 数值计算，可以考虑多进程，或者直接交给 PyTorch、NumPy 这类底层并行计算库；对于数量不是特别大的阻塞式 I/O，可以使用线程池；对于大量网络连接、HTTP 请求、数据库异步访问，则更适合协程。例如在一个邮箱 Agent 中同时请求几十封邮件内容，这种场景就非常适合 `asyncio`，如果第三方 SDK 本身只有同步接口，也可以通过线程池包装阻塞操作。

**核心概念补充：并发不等于并行。** 并发表示一段时间内可以推进多个任务，例如一个任务等待网络时执行另一个任务；并行表示同一时刻真的有多个任务在不同 CPU 核上执行。协程主要解决高效并发，线程在 Python 中适合 I/O 并发，而多进程更容易实现 Python 层面的 CPU 并行。

因此这三者可以概括为：**进程隔离最强、成本最高，适合 CPU 并行；线程共享进程资源、成本居中，适合阻塞式 I/O；协程最轻量，通过事件循环和主动让出执行权实现大规模 I/O 并发。实际工程里并不是三选一，而经常是“多进程 + 每进程事件循环 + 必要时线程池”的组合。**

## 示例代码

**CPU 密集 → 多进程；普通阻塞 I/O → 多线程；大量异步 I/O → 协程。**

### 1. Python 多进程：CPU 密集型任务

比如同时处理多个大型计算任务：
```python
from multiprocessing import Pool

def calculate(data):
    # 大量 CPU 计算
    return heavy_compute(data)

if __name__ == "__main__":
    tasks = [data1, data2, data3, data4]

    with Pool(processes=4) as pool:
        results = pool.map(calculate, tasks)
```

这里大致可以理解成：
```text
主进程
 ├── 进程1 → CPU核心1 → calculate(data1)
 ├── 进程2 → CPU核心2 → calculate(data2)
 ├── 进程3 → CPU核心3 → calculate(data3)
 └── 进程4 → CPU核心4 → calculate(data4)
```

每个进程有相对独立的地址空间，可以真正利用多个 CPU 核，因此适合纯 Python 的计算密集型任务。([Python documentation](https://docs.python.org/3/library/multiprocessing.html?utm_source=chatgpt.com "multiprocessing — Process-based parallelism"))

### 2. Python 多线程：阻塞式 I/O

比如同时调用多个外部 HTTP 接口：
```python
from concurrent.futures import ThreadPoolExecutor

def request_api(url):
    # 同步阻塞式网络请求
    return requests.get(url)

urls = [url1, url2, url3, url4]

with ThreadPoolExecutor(max_workers=4) as pool:
    results = pool.map(request_api, urls)
```

执行过程可以理解为：
```text
线程1：发送请求A → 等待网络 --------→ 收到结果
线程2：    发送请求B → 等待网络 ----→ 收到结果
线程3：        发送请求C → 等待网络 → 收到结果
```

虽然传统 CPython 中多个线程不能同时大量执行 Python 字节码，但网络等待期间线程可以交替工作，因此 I/O 密集场景仍然能明显提高吞吐量。([Python documentation](https://docs.python.org/3/library/threading.html?utm_source=chatgpt.com "threading — Thread-based parallelism — Python 3.14.6 ..."))

### 3. Python 多协程：大量异步 I/O

如果 HTTP 库本身支持异步，可以进一步使用协程：
```python
import asyncio

async def request_api(url):
    result = await async_http_get(url)
    return result

async def main():
    tasks = [
        request_api(url1),
        request_api(url2),
        request_api(url3),
        request_api(url4)
    ]

    results = await asyncio.gather(*tasks)

asyncio.run(main())
```

它的运行逻辑更像：
```text
协程A：发送请求 → await ───────────→ 恢复执行
                       ↓
协程B：发送请求 → await ───────→ 恢复执行
                       ↓
协程C：发送请求 → await ───→ 恢复执行
                       ↓
                  Event Loop
```

重点是：`await` **不是“等待在那里什么都不做”，而是告诉事件循环：当前任务暂时执行不了，可以先去运行其他任务。** `asyncio` 的事件循环正是整个异步执行机制的核心。([Python documentation](https://docs.python.org/3/library/asyncio-eventloop.html?utm_source=chatgpt.com "Event loop — Python 3.14.6 documentation"))

面试时最好再补一句容易加分的区别：

> **进程和线程的调度主体主要是操作系统，而协程主要由程序运行时的事件循环进行用户态调度；协程解决的是高并发，不等于多核并行。**

例如一个 `asyncio` 事件循环里即使有 1 万个协程，通常也还是一个线程在执行 Python 代码。它之所以能处理大量请求，是因为网络任务大部分时间都在等待，协程通过 `await` 把这些等待时间利用了起来。([Python documentation](https://docs.python.org/3/library/asyncio-eventloop.html?utm_source=chatgpt.com "Event loop — Python 3.14.6 documentation"))<!-- created: 2026-08-17 17:51:55 -->
<!-- updated: 2026-08-17 18:22:32 -->
