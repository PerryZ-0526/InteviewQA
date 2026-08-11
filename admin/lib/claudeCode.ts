import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { PROJECT_ROOT } from './fileUtils';

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

    // 超时：600秒（10分钟，复杂题目需要足够时间撰写+更新索引）
    setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        output: stdout,
        error: '生成超时（10分钟），请简化题目描述或检查 Claude Code 是否正常运行',
      });
    }, 600000);
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
完成后输出：FILE_CREATED: categories/<分类>/<文件名>.md`;
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
