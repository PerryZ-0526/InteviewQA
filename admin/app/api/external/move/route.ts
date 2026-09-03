import { NextRequest, NextResponse } from 'next/server';
import { moveExternalDoc } from '@/lib/externalDocs';
import { appendLog } from '@/lib/logger';

// POST: 在外部文档分组之间/内部移动条目（拖拽落点触发）。
// body: { id, group, toIndex }
// group 为空字符串表示未分组；toIndex 为「移除该条目后」目标分组中的 0-based
// 插入下标（= 分组内条目数表示追加到末尾），由前端按拖拽落点计算。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const { id, group, toIndex } = body || {};
    if (
      typeof id !== 'string' || !id ||
      typeof group !== 'string' ||
      typeof toIndex !== 'number' || !Number.isInteger(toIndex) || toIndex < 0 || toIndex > 10000
    ) {
      return NextResponse.json({ success: false, error: '参数不合法' }, { status: 400 });
    }

    const result = await moveExternalDoc(id, group, toIndex);
    if (!result.noop) {
      await appendLog({
        action: 'external_move',
        status: 'success',
        detail: JSON.stringify({ id, group: group || '(未分组)', toIndex }),
      });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || '移动失败' }, { status: 500 });
  }
}
