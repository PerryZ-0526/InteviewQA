import { NextRequest, NextResponse } from 'next/server';
import { listCategories, createCategory } from '@/lib/fileUtils';
import { isSafePathSegment } from '@/lib/safePath';

export async function GET() {
  try {
    const categories = await listCategories();
    return NextResponse.json({ success: true, data: categories });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { slug, displayName } = await req.json();
    if (!isSafePathSegment(slug?.trim()) || !displayName?.trim()) {
      return NextResponse.json({ success: false, error: '目录名不合法或显示名为空' }, { status: 400 });
    }
    await createCategory(slug.trim(), displayName.trim());
    return NextResponse.json({ success: true, slug, displayName });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
