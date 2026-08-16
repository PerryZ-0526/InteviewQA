import { NextRequest, NextResponse } from 'next/server';
import { searchAllDocs } from '@/lib/wikiLinks';

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') || '';
    if (!q.trim()) {
      return NextResponse.json({ success: true, data: [] });
    }
    const docs = await searchAllDocs(q.trim());
    return NextResponse.json({ success: true, data: docs });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
