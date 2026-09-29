import { NextRequest, NextResponse } from 'next/server';
import { appendLog } from '@/lib/logger';
import { createEmptyCategoryDocument } from '@/lib/questionRepository';
import { isSafePathSegment } from '@/lib/safePath';
import type { DocumentKind } from '@/lib/documentFormat';

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
    if (body.kind !== undefined && body.kind !== 'question' && body.kind !== 'document') {
      return NextResponse.json({ success: false, error: '文档类型不合法' }, { status: 400 });
    }
    const kind: DocumentKind = body.kind === 'document' ? 'document' : 'question';
    const category = slug;

    if (!title) {
      return NextResponse.json({ success: false, error: '标题不能为空' }, { status: 400 });
    }
    if (!isSafePathSegment(category) || tags.some((tag) => !isSafePathSegment(tag))) {
      return NextResponse.json({ success: false, error: '分类或标签名不合法' }, { status: 400 });
    }

    const created = await createEmptyCategoryDocument({ category, title, tags, kind });
    appendLog({
      action: 'create_empty',
      status: 'success',
      category: created.category,
      filename: created.filename,
      detail: `${kind}: ${title}`,
    });
    return NextResponse.json({ success: true, kind, ...created });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
