import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, readProjectDoc, writeProjectDoc, resolveSubdirBase } from '@/lib/fileUtils';
import { logUpdateProjectDoc } from '@/lib/logger';
import { updateLinkMeta } from '@/lib/wikiLinks';
import { backupBeforeWrite } from '@/lib/backup';

export async function GET(
  _req: NextRequest,
  { params }: { params: { subdir: string; filename: string } }
) {
  try {
    const content = await readProjectDoc(params.subdir, params.filename);
    if (content === null) {
      return NextResponse.json({ success: false, error: '文档不存在' }, { status: 404 });
    }
    // 返回文件修改时间（供前端生成默认时间元数据）与所属基目录（project/groups）
    const base = await resolveSubdirBase(params.subdir);
    let mtimeMs: number | null = null;
    try {
      const stat = await fs.stat(path.join(base, params.subdir, params.filename));
      mtimeMs = stat.mtimeMs;
    } catch {}
    return NextResponse.json({ success: true, data: content, mtimeMs, base: path.relative(PROJECT_ROOT, base) });
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
    const base = await resolveSubdirBase(params.subdir);
    await backupBeforeWrite(path.join(path.relative(PROJECT_ROOT, base), params.subdir), params.filename, content);
    await writeProjectDoc(params.subdir, params.filename, content);
    logUpdateProjectDoc(params.subdir, params.filename);
    updateLinkMeta({ kind: 'project', category: params.subdir, filename: params.filename }, content);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
