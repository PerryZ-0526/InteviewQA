import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// GET: 读取项目根目录下的静态文件（如图片），严格限制在 PROJECT_ROOT 内
export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const abs = path.resolve(PROJECT_ROOT, ...(params.path || []));
    if (abs === PROJECT_ROOT || !abs.startsWith(PROJECT_ROOT + path.sep)) {
      return NextResponse.json({ success: false, error: '非法路径' }, { status: 400 });
    }
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      return NextResponse.json({ success: false, error: '文件不存在' }, { status: 404 });
    }
    const mime = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    const buf = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: e.code === 'ENOENT' ? 404 : 500 }
    );
  }
}
