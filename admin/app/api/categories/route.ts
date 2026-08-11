import { NextRequest, NextResponse } from 'next/server';
import { listCategories, createCategory } from '@/lib/fileUtils';

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
    if (!slug?.trim() || !displayName?.trim()) {
      return NextResponse.json({ success: false, error: '目录名和显示名不能为空' }, { status: 400 });
    }
    await createCategory(slug.trim(), displayName.trim());
    return NextResponse.json({ success: true, slug, displayName });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
