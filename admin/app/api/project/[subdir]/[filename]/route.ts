import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, readProjectDoc, writeProjectDoc, resolveSubdirBase, renumberProjectSubdirAfterDelete } from '@/lib/fileUtils';
import { logUpdateProjectDoc, logDeleteProjectDoc } from '@/lib/logger';
import { updateLinkMeta } from '@/lib/wikiLinks';
import { backupBeforeWrite } from '@/lib/backup';
import { remapFsrsKeys } from '@/lib/fsrsStore';
import { isMarkdownFilename, isSafePathSegment } from '@/lib/safePath';

function hasValidDocumentPath(subdir: string, filename: string): boolean {
  return isSafePathSegment(subdir) && isMarkdownFilename(filename);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ subdir: string; filename: string }> }
) {
  try {
    const { subdir, filename } = await params;
    if (!hasValidDocumentPath(subdir, filename)) {
      return NextResponse.json({ success: false, error: '文档路径不合法' }, { status: 400 });
    }
    const content = await readProjectDoc(subdir, filename);
    if (content === null) {
      return NextResponse.json({ success: false, error: '文档不存在' }, { status: 404 });
    }
    // 返回文件修改时间（供前端生成默认时间元数据）与所属基目录（project/groups）
    const base = await resolveSubdirBase(subdir);
    let mtimeMs: number | null = null;
    try {
      const stat = await fs.stat(path.join(base, subdir, filename));
      mtimeMs = stat.mtimeMs;
    } catch {}
    return NextResponse.json({ success: true, data: content, mtimeMs, base: path.relative(PROJECT_ROOT, base) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ subdir: string; filename: string }> }
) {
  try {
    const { subdir, filename } = await params;
    if (!hasValidDocumentPath(subdir, filename)) {
      return NextResponse.json({ success: false, error: '文档路径不合法' }, { status: 400 });
    }
    const { content } = await req.json();
    if (!content) {
      return NextResponse.json({ success: false, error: 'Content is required' }, { status: 400 });
    }
    const base = await resolveSubdirBase(subdir);
    await backupBeforeWrite(path.join(path.relative(PROJECT_ROOT, base), subdir), filename, content);
    await writeProjectDoc(subdir, filename, content);
    logUpdateProjectDoc(subdir, filename);
    updateLinkMeta({ kind: 'project', category: subdir, filename }, content);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// DELETE: 删除 project/groups 子目录下的一篇文档（联动逻辑与分类删除一致）：
// 删除文件与 annotations 侧车 -> 后续序号整体前移 -> 重建索引与导航链 -> wiki 链接/link-meta 联动
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ subdir: string; filename: string }> }
) {
  try {
    const { subdir, filename } = await params;
    if (!hasValidDocumentPath(subdir, filename)) {
      return NextResponse.json({ success: false, error: '文档路径不合法' }, { status: 400 });
    }
    const base = await resolveSubdirBase(subdir);
    const relBase = path.relative(PROJECT_ROOT, base); // 'project' 或 'groups'
    const dirPath = path.join(base, subdir);
    const filePath = path.join(dirPath, filename);

    // 0. 删除前强制备份（删除类操作无新内容，传空串触发备份，与移动文档口径一致）
    await backupBeforeWrite(path.join(relBase, subdir), filename, '');

    // 1. 删除文件
    await fs.unlink(filePath);

    // 2. 删除关联 annotations 侧车文件
    try {
      const seq = filename.match(/^(\d{3})-/)?.[1] || '000';
      await fs.unlink(path.join(dirPath, `${seq}-annotations.json`));
    } catch {}

    // 3. 序号重排：后续文件 -1，同步更新文件名、内部引用、00-index.md、wiki 链接、link-meta、导航链
    const renameMap = await renumberProjectSubdirAfterDelete(subdir, filename);

    // 4. 联动间隔重复卡片：删除被删文档的卡，重排改名的文档改写 key
    try {
      const mapping: { from: string; to: string | null }[] = [
        { from: `${subdir}/${filename}`, to: null },
      ];
      for (const [oldName, newName] of renameMap.entries()) {
        mapping.push({ from: `${subdir}/${oldName}`, to: `${subdir}/${newName}` });
      }
      await remapFsrsKeys(mapping);
    } catch {}

    logDeleteProjectDoc(subdir, filename);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
