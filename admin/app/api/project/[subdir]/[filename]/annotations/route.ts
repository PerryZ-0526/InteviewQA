import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { resolveSubdirBase } from '@/lib/fileUtils';
import { appendLog } from '@/lib/logger';
import { isMarkdownFilename, isSafePathSegment, resolveInside } from '@/lib/safePath';

async function annotationPath(subdir: string, filename: string): Promise<string> {
  if (!isSafePathSegment(subdir) || !isMarkdownFilename(filename)) {
    throw new Error('文档路径不合法');
  }
  const base = await resolveSubdirBase(subdir);
  const seq = filename.match(/^(\d{3})-/)?.[1] || '000';
  return resolveInside(base, subdir, `${seq}-annotations.json`);
}

interface Annotation {
  id: string;
  quote: string;
  text: string;
  createdAt: string;
}

// GET: read annotations
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ subdir: string; filename: string }> }
) {
  try {
    const { subdir, filename } = await params;
    const filePath = await annotationPath(subdir, filename);
    const raw = await fs.readFile(filePath, 'utf-8');
    const annotations = JSON.parse(raw);
    return NextResponse.json({ success: true, data: annotations });
  } catch {
    return NextResponse.json({ success: true, data: [] });
  }
}

// PUT: save annotations
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ subdir: string; filename: string }> }
) {
  try {
    const { subdir, filename } = await params;
    const { annotations } = await req.json();
    if (!Array.isArray(annotations)) {
      return NextResponse.json({ success: false, error: 'Invalid annotations' }, { status: 400 });
    }
    const filePath = await annotationPath(subdir, filename);
    await fs.writeFile(filePath, JSON.stringify(annotations, null, 2), 'utf-8');
    appendLog({ action: 'annotation_update', status: 'success', category: subdir, filename, detail: `${annotations.length} 条批注` });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
