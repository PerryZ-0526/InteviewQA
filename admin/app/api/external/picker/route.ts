import { NextRequest, NextResponse } from 'next/server';
import { pickExternalFiles, pickExternalFolder } from '@/lib/nativePicker';

// POST { mode: 'file' | 'folder' } → 弹出本机资源管理器对话框，返回所选路径
export async function POST(req: NextRequest) {
  try {
    const { mode } = await req.json();
    if (mode !== 'file' && mode !== 'folder') {
      return NextResponse.json({ success: false, error: 'mode 必须是 file 或 folder' }, { status: 400 });
    }
    const result = mode === 'folder' ? await pickExternalFolder() : await pickExternalFiles();
    return NextResponse.json({ success: true, cancelled: result.cancelled, paths: result.paths });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: `无法弹出系统对话框（${e.message}），请手动粘贴路径` },
      { status: 500 }
    );
  }
}
