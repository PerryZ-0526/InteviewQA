import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';
import { getTask, reconcileTask, abandonTask } from '@/lib/taskManager';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const task = await getTask(params.id);
  if (!task) {
    return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
  }

  const current = (await reconcileTask(params.id)) ?? task;

  let content: string | null = null;
  if (current.status === 'success' && current.resolvedCategory && current.filename) {
    try {
      content = await fs.readFile(
        path.join(PROJECT_ROOT, 'categories', current.resolvedCategory, current.filename),
        'utf-8'
      );
    } catch {}
  }

  return NextResponse.json({
    success: true,
    data: {
      id: current.id,
      status: current.status,
      category: current.resolvedCategory ?? current.category,
      filename: current.filename ?? null,
      filePath:
        current.status === 'success' && current.resolvedCategory && current.filename
          ? `categories/${current.resolvedCategory}/${current.filename}`
          : null,
      content,
      error: current.error ?? null,
      startedAt: current.startedAt,
    },
  });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const task = await getTask(params.id);
  if (!task) {
    return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
  }
  const result = await abandonTask(params.id);
  if (!result) {
    return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    data: { id: result.id, status: result.status, error: result.error ?? null },
  });
}
