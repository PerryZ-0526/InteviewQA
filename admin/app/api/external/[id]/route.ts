import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readExternalDocById, writeExternalDocById } from '@/lib/externalDocs';
import { appendLog } from '@/lib/logger';
import { backupBeforeWriteAt } from '@/lib/backup';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await readExternalDocById(params.id);
    if (result === null) {
      return NextResponse.json({ success: false, error: '索引条目不存在' }, { status: 404 });
    }
    if (result.missing) {
      return NextResponse.json({ success: false, error: '文件已移动、重命名或删除', path: result.path }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result.content, path: result.path, mtimeMs: result.mtimeMs });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { content } = await req.json();
    if (typeof content !== 'string') {
      return NextResponse.json({ success: false, error: 'Content is required' }, { status: 400 });
    }
    // 外部文档可能位于仓库外，按路径 hash 归档到 backups/external/<id>/
    const current = await readExternalDocById(params.id);
    if (current && !current.missing) {
      await backupBeforeWriteAt(current.path, path.join('external', params.id), path.basename(current.path), content);
    }
    const result = await writeExternalDocById(params.id, content);
    if (!result.ok && !result.missing) {
      return NextResponse.json({ success: false, error: '索引条目不存在' }, { status: 404 });
    }
    if (result.missing) {
      return NextResponse.json({ success: false, error: '文件已移动、重命名或删除', path: result.path }, { status: 404 });
    }
    await appendLog({
      action: 'external_update',
      status: 'success',
      category: 'external',
      filename: result.path,
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
