import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';
import { logDelete, logUpdate } from '@/lib/logger';

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
    await fs.writeFile(filePath, content, 'utf-8');
    logUpdate(params.slug, params.filename);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

// DELETE: 删除一道题目，同时更新索引和导航
export async function DELETE(
  req: NextRequest,
  { params }: { params: { slug: string; filename: string } }
) {
  try {
    const filePath = path.join(CATEGORIES_DIR, params.slug, params.filename);

    // 1. Delete the file
    await fs.unlink(filePath);

    // 1.5 Delete associated annotations file if exists
    try {
      const seq = params.filename.match(/^(\d{3})-/)?.[1] || '000';
      const annPath = path.join(CATEGORIES_DIR, params.slug, `${seq}-annotations.json`);
      await fs.unlink(annPath);
    } catch {}

    // 2. Update 00-index.md — remove the entry for this file
    const indexPath = path.join(CATEGORIES_DIR, params.slug, '00-index.md');
    try {
      let indexContent = await fs.readFile(indexPath, 'utf-8');
      // Remove lines that reference the deleted filename
      indexContent = indexContent
        .split('\n')
        .filter((line) => !line.includes(`(${params.filename})`))
        .join('\n');
      await fs.writeFile(indexPath, indexContent, 'utf-8');
    } catch {}

    // 3. Update 00-index.md — renumber remaining entries if needed (optional, skip for now)

    // 4. Clean up tag files — remove references to the deleted file
    const tagsDir = path.join(PROJECT_ROOT, 'tags');
    try {
      const tagFiles = await fs.readdir(tagsDir);
      for (const tagFile of tagFiles) {
        if (!tagFile.endsWith('.md')) continue;
        const tagPath = path.join(tagsDir, tagFile);
        let tagContent = await fs.readFile(tagPath, 'utf-8');
        if (tagContent.includes(`(${params.filename})`)) {
          tagContent = tagContent
            .split('\n')
            .filter((line) => !line.includes(`(${params.filename})`))
            .join('\n');
          await fs.writeFile(tagPath, tagContent, 'utf-8');
        }
      }
    } catch {}

    // 5. Update navigation — fix prev/next links in the deleted file's neighbors
    try {
      // Determine the sequence number of the deleted file (e.g., "003" from "003-xxx.md")
      const seqMatch = params.filename.match(/^(\d{3})-/);
      if (seqMatch) {
        const currentSeq = parseInt(seqMatch[1], 10);
        const categoryDir = path.join(CATEGORIES_DIR, params.slug);
        const allFiles = await fs.readdir(categoryDir);
        const mdFiles = allFiles
          .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
          .sort();

        // Find the previous file (largest seq < currentSeq)
        let prevFile: string | null = null;
        let nextFile: string | null = null;
        for (const f of mdFiles) {
          const m = f.match(/^(\d{3})-/);
          if (!m) continue;
          const seq = parseInt(m[1], 10);
          if (seq < currentSeq) prevFile = f;
          if (seq > currentSeq && !nextFile) nextFile = f;
        }

        // Update prev file's "下一题" link to point to nextFile
        if (prevFile) {
          const prevPath = path.join(categoryDir, prevFile);
          let prevContent = await fs.readFile(prevPath, 'utf-8');
          if (nextFile) {
            const nextTitle = nextFile.replace(/^\d{3}-/, '').replace(/\.md$/, '');
            prevContent = prevContent.replace(
              /\|\s*\[.+\]\(.+\)\s*→/,
              `| [${nextTitle}](${nextFile}) →`
            );
          } else {
            prevContent = prevContent.replace(
              /\|\s*\[.+\]\(.+\)\s*→/,
              '| 无 →'
            );
          }
          await fs.writeFile(prevPath, prevContent, 'utf-8');
        }

        // Update next file's "上一题" link to point to prevFile
        if (nextFile) {
          const nextPath = path.join(categoryDir, nextFile);
          let nextContent = await fs.readFile(nextPath, 'utf-8');
          if (prevFile) {
            const prevTitle = prevFile.replace(/^\d{3}-/, '').replace(/\.md$/, '');
            nextContent = nextContent.replace(
              /←\s*\[.+\]\(.+\)/,
              `← [${prevTitle}](${prevFile})`
            );
          } else {
            nextContent = nextContent.replace(
              /←\s*\[.+\]\(.+\)/,
              '← 无'
            );
          }
          await fs.writeFile(nextPath, nextContent, 'utf-8');
        }
      }
    } catch {}

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}