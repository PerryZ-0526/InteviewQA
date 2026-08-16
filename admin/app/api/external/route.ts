import { NextRequest, NextResponse } from 'next/server';
import { listExternalDocs, addExternalPaths, removeExternalDocById, setExternalDocTitle } from '@/lib/externalDocs';
import { appendLog } from '@/lib/logger';

export async function GET() {
  try {
    const data = await listExternalDocs();
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawPaths = Array.isArray(body.paths) ? body.paths : typeof body.paths === 'string' ? [body.paths] : [];
    if (rawPaths.length === 0) {
      return NextResponse.json({ success: false, error: '请提供至少一个文件或文件夹路径' }, { status:400 });
    }
    const result = await addExternalPaths(rawPaths);
    await appendLog({
      action: 'external_add',
      status: result.failed.length > 0 && result.added.length === 0 ? 'fail' : 'success',
      detail: JSON.stringify({
        added: result.added.length,
        skipped: result.skipped.length,
        failed: result.failed,
      }),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PATCH { id, customTitle } → 设置/清除自命名标题（不改动原文件）
export async function PATCH(req: NextRequest) {
  try {
    const { id, customTitle } = await req.json();
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    }
    const result = await setExternalDocTitle(id, typeof customTitle === 'string' ? customTitle : '');
    if (result === null) {
      return NextResponse.json({ success: false, error: '索引条目不存在' }, { status: 404 });
    }
    await appendLog({
      action: 'external_rename',
      status: 'success',
      detail: JSON.stringify({ path: result.path, customTitle: result.customTitle || '(清除)' }),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    let id: string | null = null;
    const url = new URL(req.url);
    id = url.searchParams.get('id');
    if (!id) {
      try { id = (await req.json()).id; } catch {}
    }
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    }
    const removedPath = await removeExternalDocById(id);
    if (removedPath === null) {
      return NextResponse.json({ success: false, error: '索引条目不存在' }, { status: 404 });
    }
    await appendLog({
      action: 'external_remove',
      status: 'success',
      detail: removedPath,
    });
    return NextResponse.json({ success: true, path: removedPath });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
