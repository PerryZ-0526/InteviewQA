import { NextRequest, NextResponse } from 'next/server';
import { searchFullTextAll, searchFullTextScoped } from '@/lib/fulltextSearch';

// 全文关键字检索接口：
// - GET /api/search-fulltext?q=关键字                 -> 全库检索（分类 + project + 分组 + 外部文档）
// - GET /api/search-fulltext?q=..&scope=category&slug=xx -> 检索某个分类目录
// - GET /api/search-fulltext?q=..&scope=project&slug=xx  -> 检索某个 project 子目录/分组目录
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get('q') || '').trim();
    const scope = req.nextUrl.searchParams.get('scope');
    const slug = (req.nextUrl.searchParams.get('slug') || '').trim();
    if (!q) {
      return NextResponse.json({ success: true, data: [] });
    }
    // 指定范围时必须带 slug
    if ((scope === 'category' || scope === 'project') && !slug) {
      return NextResponse.json({ success: false, error: '缺少 slug 参数' }, { status: 400 });
    }
    const data = scope === 'category' || scope === 'project'
      ? await searchFullTextScoped(scope, slug, q)
      : await searchFullTextAll(q);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
