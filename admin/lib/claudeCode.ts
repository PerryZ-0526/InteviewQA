import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import fssync from 'fs';
import { PROJECT_ROOT } from './fileUtils';

/** 生成任务超时上限（30 分钟），由 taskManager 对账时强制执行 */
export const TASK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 以 detached 方式启动 Claude Code CLI：子进程拥有独立 console（Windows DETACHED_PROCESS），
 * 父服务被 Ctrl+C 或关终端窗口都不会杀死它；stdout/stderr 直写文件，不经过父进程内存。
 * 返回的 ChildProcess 由调用方挂 once('spawn')/once('error') 回调并 unref。
 */
export function spawnClaudeDetached(prompt: string, outputFile: string): ChildProcess {
  const outFd = fssync.openSync(outputFile, 'w');
  try {
    const child = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['ignore', outFd, outFd],
      detached: true,
      windowsHide: true,
    });
    child.unref();
    return child;
  } finally {
    fssync.closeSync(outFd); // 子进程在 CreateProcess 时已继承句柄，父进程可立即关闭
  }
}

/**
 * 调用 Claude Code CLI 生成题目
 * 通过 spawn 执行 claude -p "<prompt>" 命令
 */
export async function callClaudeCode(prompt: string): Promise<{
  success: boolean;
  output: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 立即关闭 stdin，避免 claude CLI 等待管道输入而产生 "no stdin data received" 警告
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Heartbeat: log every 15s to confirm the process is still running
    const heartbeat = setInterval(() => {
      if (child.exitCode === null) {
        console.log('[Claude Code] 仍在运行... (已输出 ' + stdout.length + ' 字符)');
      }
    }, 15000);

    child.on('close', (code: number | null) => {
      clearInterval(heartbeat);
      console.log('[Claude Code] 进程结束, exit code:', code, ', 输出长度:', stdout.length);
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Exit code: ${code}`,
        });
      }
    });

    child.on('error', (err: Error) => {
      resolve({
        success: false,
        output: stdout,
        error: `Failed to spawn claude CLI: ${err.message}`,
      });
    });

    // 超时：1800秒（30分钟，复杂题目需要足够时间撰写+更新索引）
    setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        output: stdout,
        error: '生成超时（30分钟），请简化题目描述或检查 Claude Code 是否正常运行',
      });
    }, 1800000);
  });
}

/**
 * 构建生成题目的 Claude Code prompt
 */
export function buildGeneratePrompt(
  question: string,
  category: string,
  tags: string[],
  extraRequirements?: string,
  includeAnswer = true,
  includeAnalysis = true
): string {
  const tagStr = tags.length > 0
    ? `- 指定标签：${tags.join('、')}`
    : '- 标签：根据题目内容自动判断';

  const categoryStr = category
    ? `- 指定分类：categories/${category}/`
    : '- 分类：根据题目内容自动判断（必要时可新建分类）';

  const extraStr = extraRequirements
    ? `\n- 额外要求：${extraRequirements}\n  （这比 CLAUDE.md 中的默认规范优先级更高）`
    : '';

  const sectionOverride = [];
  if (!includeAnswer) sectionOverride.push('「## 面试直接答」→ 只写 `(暂无)` 占位，不生成内容');
  if (!includeAnalysis) sectionOverride.push('「## 详细解析」→ 只写 `(暂无)` 占位，不生成内容');
  const overrideStr = sectionOverride.length > 0
    ? `\n\n**章节覆盖**（覆盖 CLAUDE.md 的默认要求）：\n${sectionOverride.map(s => `- ${s}`).join('\n')}`
    : '';

  return `在 InteviewQA 项目中新增一道面试真题。

请先调用 interview-qa skill（通过 Skill 工具），按照其中的撰写规范和质量标准来生成内容。

## 题目
${question}
${categoryStr}
${tagStr}${extraStr}${overrideStr}

## 操作
按项目根目录 CLAUDE.md 规范执行全部新增流程（确定序号、创建文件、更新索引、更新标签、更新导航、更新 README、添加时间元数据）。仅生成「## 面试直接答」和「## 详细解析」两个章节，不要生成「## 我的作答」章节。

**并发安全要求**（仓库里可能同时有其他任务在新增题目）：
- 创建新文件前，重新读取目标分类的 00-index.md 确认最新序号；若计划使用的文件名已被占用，顺延到下一个空闲序号。
- 修改任何既有文件（00-index.md、标签文件、README.md、前一题的题目导航）之前，必须先重新读取该文件的最新内容，再在其基础上修改，不要凭记忆覆盖。
完成后输出：FILE_CREATED: categories/<分类>/<文件名>.md（必须与实际写入的文件名一致）`;
}

/**
 * 在生成完成后，找到新创建的文件路径
 */
export async function findNewQuestionFile(
  category: string,
  beforeFiles: string[]
): Promise<string | null> {
  const categoriesDir = path.join(PROJECT_ROOT, 'categories', category);
  const afterFiles = await fs.readdir(categoriesDir);
  const newFiles = afterFiles.filter((f) => !beforeFiles.includes(f) && f.match(/^\d{3}-.+\.md$/));
  return newFiles.length > 0 ? newFiles[0] : null;
}
