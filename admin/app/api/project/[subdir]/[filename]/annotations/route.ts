import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolveSubdirBase } from '@/lib/fileUtils';
import { appendLog } from '@/lib/logger';

async function annotationPath(subdir: string, filename: string): Promise<string> {
  const base = await resolveSubdirBase(subdir);
  const seq = filename.match(/^(\d{3})-/)?.[1] || '000';
  return path.join(base, subdir, `${seq}-annotations.json`);
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
  { params }: { params: { subdir: string; filename: string } }
) {
  try {
    const filePath = await annotationPath(params.subdir, params.filename);
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
  { params }: { params: { subdir: string; filename: string } }
) {
  try {
    const { annotations } = await req.json();
    if (!Array.isArray(annotations)) {
      return NextResponse.json({ success: false, error: 'Invalid annotations' }, { status: 400 });
    }
    const filePath = await annotationPath(params.subdir, params.filename);
    await fs.writeFile(filePath, JSON.stringify(annotations, null, 2), 'utf-8');
    appendLog({ action: 'annotation_update', status: 'success', category: params.subdir, filename: params.filename, detail: `${annotations.length} 条批注` });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
