import { NextRequest, NextResponse } from 'next/server';
import { appendLog } from '@/lib/logger';
import { createGeneratedQuestion } from '@/lib/questionRepository';
import { isSafePathSegment } from '@/lib/safePath';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const tags: string[] = Array.isArray(body.tags)
      ? body.tags.filter((tag: unknown): tag is string => typeof tag === 'string').map((tag: string) => tag.trim())
      : [];
    const category = slug;

    if (!title) {
      return NextResponse.json({ success: false, error: '标题不能为空' }, { status: 400 });
    }
    if (!isSafePathSegment(category) || tags.some((tag) => !isSafePathSegment(tag))) {
      return NextResponse.json({ success: false, error: '分类或标签名不合法' }, { status: 400 });
    }

    const content = `# ${title}

## 题目

(在此填写题目)

## 标签

## 题目导航

## 面试直接答

(暂无)

## 详细解析

(暂无)
`;
    const created = await createGeneratedQuestion({ category, tags, content });
    appendLog({
      action: 'create_empty',
      status: 'success',
      category: created.category,
      filename: created.filename,
      detail: title,
    });
    return NextResponse.json({ success: true, ...created });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
