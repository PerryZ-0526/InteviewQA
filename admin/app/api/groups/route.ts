import { NextRequest, NextResponse } from 'next/server';
import { createGroupSubdir } from '@/lib/fileUtils';
import { isSafePathSegment } from '@/lib/safePath';

export async function POST(req: NextRequest) {
  try {
    const { slug, displayName } = await req.json();
    if (!isSafePathSegment(slug?.trim()) || !displayName?.trim()) {
      return NextResponse.json({ success: false, error: '分组名不合法或显示名为空' }, { status: 400 });
    }
    await createGroupSubdir(slug.trim(), displayName.trim());
    return NextResponse.json({ success: true, slug, displayName });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
