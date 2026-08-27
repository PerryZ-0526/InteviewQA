import { NextRequest, NextResponse } from 'next/server';
import { loadFsrsStore, saveFsrsStore, type FsrsStore } from '@/lib/fsrsStore';

// GET: 读取全部间隔重复卡片状态
export async function GET() {
  try {
    const store = await loadFsrsStore();
    return NextResponse.json({ success: true, data: store });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PUT: 全量覆盖（客户端持有完整 store，评分后整体写回；单用户本地工具，无锁）
export async function PUT(req: NextRequest) {
  try {
    const store = (await req.json()) as FsrsStore;
    if (!store || typeof store.cards !== 'object' || store.cards === null) {
      return NextResponse.json({ success: false, error: 'Invalid store shape' }, { status: 400 });
    }
    await saveFsrsStore({ version: store.version ?? 1, cards: store.cards });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
