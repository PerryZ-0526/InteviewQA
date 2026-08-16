import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MAX_SIZE = 10 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

// POST: 将剪贴板图片导入到文档 images/ 目录，两种来源二选一：
// - localPath: 剪贴板 HTML 中的本地路径（file:///），浏览器读不了本地文件，由后端代为复制
// - remoteUrl: 剪贴板 HTML 中的远程图片，浏览器端 fetch 受 CORS 限制，由后端代为拉取
export async function POST(req: NextRequest) {
  try {
    const { dir, localPath, remoteUrl } = await req.json();
    if (!dir || (!localPath && !remoteUrl)) {
      return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
    }

    const absDir = path.resolve(PROJECT_ROOT, dir);
    if (absDir === PROJECT_ROOT || !absDir.startsWith(PROJECT_ROOT + path.sep)) {
      return NextResponse.json({ success: false, error: '非法目录' }, { status: 400 });
    }
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) throw new Error();
    } catch {
      return NextResponse.json({ success: false, error: '目录不存在' }, { status: 400 });
    }

    let ext = '';
    let buf: Buffer;
    if (localPath) {
      ext = path.extname(localPath).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ success: false, error: '不支持的图片格式' }, { status: 400 });
      }
      const stat = await fs.stat(localPath);
      if (!stat.isFile() || stat.size > MAX_SIZE) {
        return NextResponse.json({ success: false, error: '图片文件不可用' }, { status: 400 });
      }
      buf = await fs.readFile(localPath);
    } else {
      const res = await fetch(remoteUrl);
      if (!res.ok) {
        return NextResponse.json({ success: false, error: '远程图片拉取失败' }, { status: 400 });
      }
      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
      ext = MIME_EXT[contentType] || path.extname(new URL(remoteUrl).pathname).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ success: false, error: '不支持的图片格式' }, { status: 400 });
      }
      buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_SIZE) {
        return NextResponse.json({ success: false, error: '图片超过 10MB 限制' }, { status: 400 });
      }
    }

    const imagesDir = path.join(absDir, 'images');
    await fs.mkdir(imagesDir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    await fs.writeFile(path.join(imagesDir, name), buf);

    const rawPath = `${dir.split('/').filter(Boolean).map(encodeURIComponent).join('/')}/images/${name}`;
    return NextResponse.json({
      success: true,
      src: `images/${name}`,
      url: `/api/raw/${rawPath}`,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
