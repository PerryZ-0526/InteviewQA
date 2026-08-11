import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';
import { callClaudeCode, buildGeneratePrompt } from '@/lib/claudeCode';
import { logCreate, logCreateStart } from '@/lib/logger';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');

export async function POST(req: NextRequest) {
  let question = '';
  let category = '';
  try {
    const body = await req.json();
    question = body.question || '';
    category = body.category || '';
    const tags = body.tags || [];
    const extraRequirements = body.extraRequirements || '';
    const includeAnswer = body.includeAnswer !== false;
    const includeAnalysis = body.includeAnalysis !== false;

    // 校验
    if (!question || !question.trim()) {
      return NextResponse.json(
        { success: false, error: '题目内容不能为空' },
        { status: 400 }
      );
    }

    // 如果指定了分类，验证其存在（只是提示，不阻止）
    if (category) {
      try {
        await fs.access(path.join(CATEGORIES_DIR, category));
      } catch {
        // 分类不存在时会由 Claude Code 新建，不需要报错
        console.log(`分类 "${category}" 不存在，Claude Code 将自动创建`);
      }
    }

    // 立即记录：开始生成
    logCreateStart(category, question.trim());

    // 记录所有分类的现有文件，用于之后发现新文件
    const snapshot = await takeSnapshot(category);

    // 构建 prompt 并调用 Claude Code
    const prompt = buildGeneratePrompt(question.trim(), category, tags, extraRequirements.trim(), includeAnswer, includeAnalysis);
    console.log('=== 调用 Claude Code 生成题目 ===');
    console.log('题目:', question);
    console.log('分类:', category || '(自动判断)');
    console.log('标签:', tags.length > 0 ? tags.join(', ') : '(自动判断)');

    const result = await callClaudeCode(prompt);

    if (!result.success) {
      console.error('Claude Code 调用失败:', result.error);
      logCreate(false, category || '', '', question.trim(), result.error || '超时/失败');
      return NextResponse.json(
        {
          success: false,
          error: result.error || '生成失败',
          output: result.output.slice(-1000),
        },
        { status: 500 }
      );
    }

    // 尝试从输出中解析 FILE_CREATED 标记
    const markerMatch = result.output.match(/FILE_CREATED:\s*(.+\.md)/);
    let newCategory = category;
    let newFilename: string | null = null;

    if (markerMatch) {
      const fullPath = markerMatch[1].trim();
      // 路径格式: categories/<分类>/<文件名>.md
      const parts = fullPath.replace(/\\/g, '/').split('/');
      newCategory = parts[1] || category;
      newFilename = parts[2] || null;
    }

    // 如果没找到标记，对比快照找新文件
    if (!newFilename) {
      const found = await findNewFileFromSnapshot(snapshot, newCategory);
      if (found) {
        newCategory = found.category;
        newFilename = found.filename;
      }
    }

    if (!newFilename) {
      return NextResponse.json(
        {
          success: false,
          error: '未检测到新生成的文件',
          output: result.output.slice(-1500),
        },
        { status: 500 }
      );
    }

    // 读取新文件内容
    const filePath = path.join(CATEGORIES_DIR, newCategory, newFilename);
    const content = await fs.readFile(filePath, 'utf-8');

    logCreate(true, newCategory, newFilename, question.trim());
    return NextResponse.json({
      success: true,
      filePath: `categories/${newCategory}/${newFilename}`,
      filename: newFilename,
      category: newCategory,
      content,
    });
  } catch (e: any) {
    console.error('生成接口异常:', e);
    logCreate(false, category || '', '', question.trim(), e.message);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

/** 记录分类目录的当前文件状态 */
async function takeSnapshot(specificCategory: string) {
  const snapshot: Record<string, string[]> = {};

  if (specificCategory) {
    try {
      const files = await fs.readdir(path.join(CATEGORIES_DIR, specificCategory));
      snapshot[specificCategory] = files.filter((f) => f.match(/^\d{3}-.+\.md$/));
    } catch {}
  } else {
    // 扫描所有分类
    const entries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const files = await fs.readdir(path.join(CATEGORIES_DIR, entry.name));
      snapshot[entry.name] = files.filter((f) => f.match(/^\d{3}-.+\.md$/));
    }
  }

  return snapshot;
}

/** 对比快照找到新文件 */
async function findNewFileFromSnapshot(
  snapshot: Record<string, string[]>,
  preferredCategory: string
): Promise<{ category: string; filename: string } | null> {
  // 先检查优先分类
  const categories = [preferredCategory, ...Object.keys(snapshot)].filter(
    (c, i, arr) => c && arr.indexOf(c) === i
  );

  for (const cat of categories) {
    try {
      const newFiles = await fs.readdir(path.join(CATEGORIES_DIR, cat));
      const mdFiles = newFiles.filter((f) => f.match(/^\d{3}-.+\.md$/));
      const oldFiles = snapshot[cat] || [];
      const added = mdFiles.filter((f) => !oldFiles.includes(f));
      if (added.length > 0) {
        return { category: cat, filename: added[0] };
      }
    } catch {}
  }

  // 检查是否有全新的分类目录
  const allEntries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true });
  for (const entry of allEntries) {
    if (!entry.isDirectory() || snapshot[entry.name]) continue;
    const files = await fs.readdir(path.join(CATEGORIES_DIR, entry.name));
    const mdFiles = files.filter((f) => f.match(/^\d{3}-.+\.md$/));
    if (mdFiles.length > 0) {
      return { category: entry.name, filename: mdFiles[0] };
    }
  }

  return null;
}
