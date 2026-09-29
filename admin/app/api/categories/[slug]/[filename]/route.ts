import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getQuestionNavigation, PROJECT_ROOT, renumberCategoryAfterDelete } from '@/lib/fileUtils';
import { logDelete, logUpdate } from '@/lib/logger';
import { updateLinkMeta } from '@/lib/wikiLinks';
import { backupBeforeWrite } from '@/lib/backup';
import { remapFsrsKeys } from '@/lib/fsrsStore';
import { isMarkdownFilename, isSafePathSegment, resolveInside } from '@/lib/safePath';
import {
  categoryDocumentKind,
  isV2Markdown,
  strictCategoryDocumentKind,
} from '@/lib/documentFormat';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');

function questionPath(slug: string, filename: string): string {
  if (!isSafePathSegment(slug) || !isMarkdownFilename(filename)) {
    throw new Error('题目路径不合法');
  }
  return resolveInside(CATEGORIES_DIR, slug, filename);
}

// GET: 读取一道题目
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; filename: string }> }
) {
  try {
    const { slug, filename } = await params;
    const filePath = questionPath(slug, filename);
    const [content, navigation] = await Promise.all([
      fs.readFile(filePath, 'utf-8'),
      getQuestionNavigation(slug, filename),
    ]);
    return NextResponse.json({
      success: true,
      data: content,
      kind: categoryDocumentKind(content),
      navigation,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: e.message === '题目路径不合法' ? 400 : e.code === 'ENOENT' ? 404 : 500 }
    );
  }
}

// PUT: 更新一道题目
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; filename: string }> }
) {
  try {
    const { slug, filename } = await params;
    const { content } = await req.json();
    if (typeof content !== 'string' || !content) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }
    const filePath = questionPath(slug, filename);
    const currentContent = await fs.readFile(filePath, 'utf-8');
    const currentKind = strictCategoryDocumentKind(currentContent);
    const nextKind = strictCategoryDocumentKind(content);
    if (isV2Markdown(currentContent) && !isV2Markdown(content)) {
      return NextResponse.json(
        { success: false, error: '文档已迁移到 v2，请刷新页面后再编辑' },
        { status: 409 },
      );
    }
    if (currentKind && !nextKind) {
      return NextResponse.json(
        { success: false, error: '分类文档必须保持合法的 kind 与 body_schema，请刷新页面后再编辑' },
        { status: 409 },
      );
    }
    const converted = currentKind !== null && nextKind !== null && currentKind !== nextKind;
    await backupBeforeWrite(path.join('categories', slug), filename, content, { force: converted });
    await fs.writeFile(filePath, content, 'utf-8');
    if (converted && nextKind === 'document') {
      await remapFsrsKeys([{ from: `${slug}/${filename}`, to: null }]);
    }
    logUpdate(slug, filename);
    updateLinkMeta({ kind: 'category', category: slug, filename }, content);
    return NextResponse.json({ success: true, kind: nextKind || categoryDocumentKind(content), converted });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: e.message === '题目路径不合法' ? 400 : 500 }
    );
  }
}

// DELETE: 删除一道题目，后续序号整体前移，重建索引与导航
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; filename: string }> }
) {
  try {
    const { slug, filename } = await params;
    const filePath = questionPath(slug, filename);

    // 1. Delete the file
    await fs.unlink(filePath);

    // 2. Delete associated annotations file if exists
    try {
      const seq = filename.match(/^(\d{3})-/)?.[1] || '000';
      const annPath = path.join(CATEGORIES_DIR, slug, `${seq}-annotations.json`);
      await fs.unlink(annPath);
    } catch {}

    // 3. 序号重排：后续文件 -1，同步更新文件名、内部引用、索引、标签、wiki 链接、link-meta、导航链
    const renameMap = await renumberCategoryAfterDelete(slug, filename);

    // 3.5 联动间隔重复卡片：删除被删题的卡，重排改名的题改写 key
    try {
      const mapping: { from: string; to: string | null }[] = [
        { from: `${slug}/${filename}`, to: null },
      ];
      for (const [oldName, newName] of renameMap.entries()) {
        mapping.push({ from: `${slug}/${oldName}`, to: `${slug}/${newName}` });
      }
      await remapFsrsKeys(mapping);
    } catch {}

    // 4. 清理标签文件中指向已删除文件的条目
    const tagsDir = path.join(PROJECT_ROOT, 'tags');
    let tagsCleaned = 0;
    try {
      const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    logDelete(slug, filename);
    return NextResponse.json({ success: true, tagsCleaned });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: e.message === '题目路径不合法' ? 400 : 500 }
    );
  }
}
