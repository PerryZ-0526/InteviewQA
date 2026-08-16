import { NextRequest, NextResponse } from 'next/server';
import { getBacklinks } from '@/lib/wikiLinks';

export async function GET(req: NextRequest) {
  try {
    const kind = req.nextUrl.searchParams.get('kind') || '';
    const category = req.nextUrl.searchParams.get('category') || '';
    const filename = req.nextUrl.searchParams.get('filename') || '';
    if (!kind || !category || !filename) {
      return NextResponse.json({ success: false, error: 'kind/category/filename 必填' }, { status: 400 });
    }
    const backlinks = await getBacklinks(kind, category, filename);
    return NextResponse.json({ success: true, data: backlinks });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
