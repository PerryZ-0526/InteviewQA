import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const HISTORY_FILE = path.join(PROJECT_ROOT, 'admin', 'ai-history.jsonl');

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8').catch(() => '');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    entries.reverse();
    return NextResponse.json({ success: true, data: entries.slice(0, limit) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
