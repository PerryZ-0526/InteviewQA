import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, readProjectDoc, writeProjectDoc } from '@/lib/fileUtils';

export async function GET(
  _req: NextRequest,
  { params }: { params: { subdir: string; filename: string } }
) {
  try {
    const content = await readProjectDoc(params.subdir, params.filename);
    if (content === null) {
      return NextResponse.json({ success: false, error: '文档不存在' }, { status: 404 });
    }
    // 返回文件修改时间，供前端生成默认时间元数据
    let mtimeMs: number | null = null;
    try {
      const stat = await fs.stat(path.join(PROJECT_ROOT, 'project', params.subdir, params.filename));
      mtimeMs = stat.mtimeMs;
    } catch {}
    return NextResponse.json({ success: true, data: content, mtimeMs });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { subdir: string; filename: string } }
) {
  try {
    const { content } = await req.json();
    if (!content) {
      return NextResponse.json({ success: false, error: 'Content is required' }, { status: 400 });
    }
    await writeProjectDoc(params.subdir, params.filename, content);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
