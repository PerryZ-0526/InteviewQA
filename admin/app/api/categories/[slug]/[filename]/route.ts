import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, renumberCategoryAfterDelete } from '@/lib/fileUtils';
import { logDelete, logUpdate } from '@/lib/logger';
import { updateLinkMeta } from '@/lib/wikiLinks';
import { backupBeforeWrite } from '@/lib/backup';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');

// GET: 读取一道题目
export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; filename: string } }
) {
  try {
    const filePath = path.join(CATEGORIES_DIR, params.slug, params.filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return NextResponse.json({ success: true, data: content });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: e.code === 'ENOENT' ? 404 : 500 }
    );
  }
}

// PUT: 更新一道题目
export async function PUT(
  req: NextRequest,
  { params }: { params: { slug: string; filename: string } }
) {
  try {
    const { content } = await req.json();
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }
    const filePath = path.join(CATEGORIES_DIR, params.slug, params.filename);
    await backupBeforeWrite(path.join('categories', params.slug), params.filename, content);
    await fs.writeFile(filePath, content, 'utf-8');
    logUpdate(params.slug, params.filename);
    updateLinkMeta({ kind: 'category', category: params.slug, filename: params.filename }, content);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

// DELETE: 删除一道题目，后续序号整体前移，重建索引与导航
export async function DELETE(
  req: NextRequest,
  { params }: { params: { slug: string; filename: string } }
) {
  try {
    const filePath = path.join(CATEGORIES_DIR, params.slug, params.filename);

    // 1. Delete the file
    await fs.unlink(filePath);

    // 2. Delete associated annotations file if exists
    try {
      const seq = params.filename.match(/^(\d{3})-/)?.[1] || '000';
      const annPath = path.join(CATEGORIES_DIR, params.slug, `${seq}-annotations.json`);
      await fs.unlink(annPath);
    } catch {}

    // 3. 序号重排：后续文件 -1，同步更新文件名、内部引用、索引、标签、wiki 链接、link-meta、导航链
    await renumberCategoryAfterDelete(params.slug, params.filename);

    // 4. 清理标签文件中指向已删除文件的条目
    const tagsDir = path.join(PROJECT_ROOT, 'tags');
    let tagsCleaned = 0;
    try {
      const escaped = params.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 标签文件条目格式：- [标题](../categories/<分类>/<文件名>.md)
      const linkRe = new RegExp(`\\([^)]*\\/${escaped}\\)`);
      const tagFiles = await fs.readdir(tagsDir);
      for (const tagFile of tagFiles) {
        if (!tagFile.endsWith('.md')) continue;
        const tagPath = path.join(tagsDir, tagFile);
        const tagContent = await fs.readFile(tagPath, 'utf-8');
        if (!linkRe.test(tagContent)) continue;
        const cleaned = tagContent
          .split('\n')
          .filter((line) => !linkRe.test(line))
          .join('\n');
        await fs.writeFile(tagPath, cleaned, 'utf-8');
        tagsCleaned++;
      }
    } catch {}

    logDelete(params.slug, params.filename);
    return NextResponse.json({ success: true, tagsCleaned });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}