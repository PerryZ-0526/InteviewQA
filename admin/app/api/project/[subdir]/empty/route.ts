import { NextRequest, NextResponse } from 'next/server';
import { getProjectMaxSequence, createProjectDocFile } from '@/lib/fileUtils';
import { logCreateProjectDoc } from '@/lib/logger';
import { isSafePathSegment } from '@/lib/safePath';

function slugify(title: string): string {
  return title.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '-').trim();
}

function pad(n: number): string { return String(n).padStart(3, '0'); }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ subdir: string }> }
) {
  try {
    const { subdir } = await params;
    const { title } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ success: false, error: '标题不能为空' }, { status: 400 });
    }
    if (!isSafePathSegment(subdir)) {
      return NextResponse.json({ success: false, error: '子目录名不合法' }, { status: 400 });
    }
    const seq = await getProjectMaxSequence(subdir);
    const filename = `${pad(seq + 1)}-${slugify(title.trim())}.md`;

    await createProjectDocFile(subdir, filename, title.trim());
    logCreateProjectDoc(subdir, filename, title.trim());
    return NextResponse.json({ success: true, subdir, filename, title: title.trim() });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
