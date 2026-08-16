import { NextRequest, NextResponse } from 'next/server';
import { resolveWikiLink } from '@/lib/wikiLinks';

export async function POST(req: NextRequest) {
  try {
    const { links } = await req.json();
    if (!Array.isArray(links)) {
      return NextResponse.json({ success: false, error: 'links 必须是数组' }, { status: 400 });
    }
    const results: Record<string, {
      found: boolean;
      status?: string;
      resolvedPath?: string[];
      title?: string;
    }> = {};

    for (const link of links.slice(0, 100)) {
      const [docKey, ...anchors] = String(link).split('#').map(s => s.trim()).filter(Boolean);
      if (!docKey) { results[link] = { found: false }; continue; }
      const r = await resolveWikiLink(docKey, anchors);
      if (!r.doc) { results[link] = { found: false }; continue; }
      results[link] = {
        found: true,
        status: r.resolved?.status || 'ok',
        resolvedPath: r.resolved?.resolvedPath || [],
        title: r.doc.title,
      };
    }
    return NextResponse.json({ success: true, data: results });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
