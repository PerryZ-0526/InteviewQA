import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { readLogs, appendLog } from '@/lib/logger';
import { PROJECT_ROOT } from '@/lib/fileUtils';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const logs = await readLogs(Math.min(limit, 200), offset);
    return NextResponse.json({ success: true, data: logs });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await appendLog(body);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await fs.writeFile(path.join(PROJECT_ROOT, 'admin', 'logs.jsonl'), '', 'utf-8');
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
