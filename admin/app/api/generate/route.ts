import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { PROJECT_ROOT } from '@/lib/fileUtils';
import { spawnClaudeDetached, buildGeneratePrompt } from '@/lib/claudeCode';
import { logCreateStart } from '@/lib/logger';
import {
  TASKS_DIR,
  createTaskFile,
  writeTask,
  getTask,
  listRunningTasks,
  reconcileAllRunning,
  failTaskNow,
  takeSnapshot,
  normalizeQuestionKey,
  type GenTask,
} from '@/lib/taskManager';

export async function POST(req: NextRequest) {
  let question = '';
  let category = '';
  try {
    const body = await req.json();
    question = body.question || '';
    category = body.category || '';
    const tags = body.tags || [];
    const extraRequirements = body.extraRequirements || '';
    const includeAnswer = body.includeAnswer !== false;
    const includeAnalysis = body.includeAnalysis !== false;

    if (!question || !question.trim()) {
      return NextResponse.json(
        { success: false, error: '题目内容不能为空' },
        { status: 400 }
      );
    }

    // 先对账：清掉过期/已死任务，避免卡死任务挡住新提交
    await reconcileAllRunning();

    // 双提交防护（服务端权威，F5/重复点击均拦截）：只拦截相同题目+分类的重复提交，不同题目允许并发生成
    const dupKey = normalizeQuestionKey(question.trim());
    if ((await listRunningTasks()).some(
      (t) => normalizeQuestionKey(t.question) === dupKey && (t.category || '') === (category || '')
    )) {
      return NextResponse.json(
        { success: false, error: '该题目已在生成中，请勿重复提交' },
        { status: 409 }
      );
    }

    if (category) {
      try {
        await fs.access(path.join(PROJECT_ROOT, 'categories', category));
      } catch {
        console.log(`分类 "${category}" 不存在，Claude Code 将自动创建`);
      }
    }

    const id = randomUUID();
    const snapshot = await takeSnapshot(category);
    const prompt = buildGeneratePrompt(question.trim(), category, tags, extraRequirements.trim(), includeAnswer, includeAnalysis);

    const task: GenTask = {
      id,
      question: question.trim(),
      category,
      tags,
      extraRequirements: extraRequirements.trim(),
      includeAnswer,
      includeAnalysis,
      pid: null,
      startedAt: Date.now(),
      outputFile: path.join(TASKS_DIR, id + '.out'),
      snapshot,
      status: 'running',
    };

    // 任务文件先于日志写入：保证 running 日志行必有 taskId，对账可定位
    await createTaskFile(task);
    await logCreateStart(category, question.trim(), id);

    console.log('=== 提交 Claude Code 生成任务 ===');
    console.log('taskId:', id);
    console.log('题目:', question);
    console.log('分类:', category || '(自动判断)');
    console.log('标签:', tags.length > 0 ? tags.join(', ') : '(自动判断)');

    const child = spawnClaudeDetached(prompt, task.outputFile);

    child.once('spawn', async () => {
      const current = await getTask(id);
      if (current) {
        current.pid = child.pid ?? null;
        await writeTask(current);
      }
    });

    child.once('error', async (err: Error) => {
      console.error('Claude Code 启动失败:', err.message);
      await failTaskNow(id, `启动 claude CLI 失败: ${err.message}`);
    });

    return NextResponse.json({ success: true, taskId: id }, { status: 202 });
  } catch (e: any) {
    console.error('生成接口异常:', e);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
