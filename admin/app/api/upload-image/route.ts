import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '@/lib/fileUtils';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MAX_SIZE = 10 * 1024 * 1024;

// POST: 上传图片到文档所在目录的 images/ 子目录（multipart: file, dir）
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const dir = String(form.get('dir') || '').replace(/[\\/]+$/, '');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '缺少图片文件' }, { status: 400 });
    }
    if (!dir) {
      return NextResponse.json({ success: false, error: '缺少文档目录' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, error: '图片超过 10MB 限制' }, { status: 400 });
    }

    // 目录校验：必须位于项目根目录内的真实目录
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

    const ext = path.extname(file.name || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ success: false, error: '不支持的图片格式' }, { status: 400 });
    }

    const imagesDir = path.join(absDir, 'images');
    await fs.mkdir(imagesDir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    await fs.writeFile(path.join(imagesDir, name), Buffer.from(await file.arrayBuffer()));

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
