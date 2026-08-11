import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';
import { formatDateTime } from '@/lib/markdown';
import { appendLog } from '@/lib/logger';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const TAGS_DIR = path.join(PROJECT_ROOT, 'tags');
const README_PATH = path.join(PROJECT_ROOT, 'README.md');

function slugify(title: string): string {
  return title
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

async function getMaxSeq(category: string): Promise<number> {
  const dir = path.join(CATEGORIES_DIR, category);
  try {
    const files = await fs.readdir(dir);
    let max = 0;
    for (const f of files) {
      const m = f.match(/^(\d{3})-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  } catch { return 0; }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { title, tags } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ success: false, error: '标题不能为空' }, { status: 400 });
    }
    const category = params.slug;
    const catDir = path.join(CATEGORIES_DIR, category);

    // Ensure category exists
    await fs.mkdir(catDir, { recursive: true });
    const indexPath = path.join(catDir, '00-index.md');
    try { await fs.access(indexPath); } catch {
      await fs.writeFile(indexPath, `# ${category} - 题目索引\n\n## 题目列表\n\n`, 'utf-8');
    }

    // Determine sequence
    const seq = await getMaxSeq(category);
    const nextSeq = seq + 1;
    const filename = `${pad(nextSeq)}-${slugify(title)}.md`;
    const filePath = path.join(catDir, filename);

    // Build empty template
    const now = formatDateTime(new Date());
    const tagLinks = (tags || []).map((t: string) => `[${t}](../../tags/${t}.md)`).join(' | ') || '[TODO](../../tags/TODO.md)';

    // Find previous question for nav
    let prevFile = '';
    let prevTitle = '';
    try {
      const files = (await fs.readdir(catDir))
        .filter(f => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
        .sort();
      prevFile = files[files.length - 1] || '';
      if (prevFile) {
        prevTitle = prevFile.replace(/^\d{3}-/, '').replace(/\.md$/, '');
      }
    } catch {}

    const prevLink = prevFile ? `← [${prevTitle}](${prevFile})` : '← 无';

    const content = `# ${title.trim()}

## 题目

(在此填写题目)

## 标签

${tagLinks}

## 题目导航

${prevLink} | 无 →

## 面试直接答

(暂无)

## 详细解析

(暂无)

<!-- created: ${now} -->
<!-- updated: ${now} -->
`;

    await fs.writeFile(filePath, content, 'utf-8');

    // Update 00-index.md
    try {
      let idx = await fs.readFile(indexPath, 'utf-8');
      const brief = title.trim().slice(0, 30);
      idx = idx.trimEnd() + `\n- [${title.trim()}](${filename}) - ${brief}\n`;
      await fs.writeFile(indexPath, idx, 'utf-8');
    } catch {}

    // Update nav of previous last question
    if (prevFile) {
      try {
        const prevPath = path.join(catDir, prevFile);
        let prevContent = await fs.readFile(prevPath, 'utf-8');
        prevContent = prevContent.replace(/\|\s*无\s*→/, `| [${title.trim()}](${filename}) →`);
        await fs.writeFile(prevPath, prevContent, 'utf-8');
      } catch {}
    }

    // Update tag files
    if (tags?.length) {
      for (const tag of tags) {
        const tagPath = path.join(TAGS_DIR, `${tag}.md`);
        try {
          let tagContent = await fs.readFile(tagPath, 'utf-8');
          tagContent = tagContent.trimEnd() + `\n- [${title.trim()}](../categories/${category}/${filename})\n`;
          await fs.writeFile(tagPath, tagContent, 'utf-8');
        } catch {
          await fs.writeFile(tagPath, `# ${tag}\n\n## 相关题目\n\n- [${title.trim()}](../categories/${category}/${filename})\n`, 'utf-8');
        }
      }
    }

    // Update README if new category (check if category section exists)
    try {
      let readme = await fs.readFile(README_PATH, 'utf-8');
      if (!readme.includes(`[${category}]`)) {
        const marker = '## 分类';
        const idx = readme.indexOf(marker);
        if (idx > 0) {
          const before = readme.slice(0, idx + marker.length);
          const after = readme.slice(idx + marker.length);
          readme = before + '\n\n### 新增\n\n- [${category}](categories/${category}/00-index.md)\n' + after;
          await fs.writeFile(README_PATH, readme, 'utf-8');
        }
      }
    } catch {}

    appendLog({ action: 'create_empty', status: 'success', category, filename, detail: title.trim() });
    return NextResponse.json({ success: true, filename, category, content });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
