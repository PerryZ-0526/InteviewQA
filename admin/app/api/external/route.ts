import { NextRequest, NextResponse } from 'next/server';
import { listExternalDocs, listExternalGroups, addExternalPaths, removeExternalDocById } from '@/lib/externalDocs';
import { appendLog } from '@/lib/logger';

export async function GET() {
  try {
    const [data, groups] = await Promise.all([listExternalDocs(), listExternalGroups()]);
    return NextResponse.json({ success: true, data, groups });
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
    // group 可选：从分组内「新增文档」入口添加时，新条目直接加入该分组
    const group = typeof body.group === 'string' ? body.group : '';
    const result = await addExternalPaths(rawPaths, group);
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

// 分组归属与顺序调整统一走 POST /api/external/move（拖拽落点触发）
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
