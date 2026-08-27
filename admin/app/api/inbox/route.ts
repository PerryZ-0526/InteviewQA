import { NextRequest, NextResponse } from 'next/server';
import { readInbox, appendInboxBatch, writeInbox, InboxBatch } from '@/lib/inbox';

// GET: 读取全部批次（时间正序，前端自行倒序展示最新批次在最上）与待处理数
export async function GET() {
  try {
    const batches = await readInbox();
    const unchecked = batches.reduce(
      (sum, b) => sum + b.questions.filter((q) => !q.checked).length,
      0
    );
    return NextResponse.json({ success: true, data: { batches, unchecked } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// POST: 追加一批新题目（questions 为按换行拆好的题目文本数组）
export async function POST(req: NextRequest) {
  try {
    const { questions } = await req.json();
    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({ success: false, error: '题目列表不能为空' }, { status: 400 });
    }
    const cleaned = questions
      .map((q: unknown) => String(q ?? '').trim())
      .filter(Boolean);
    if (cleaned.length === 0) {
      return NextResponse.json({ success: false, error: '题目内容为空' }, { status: 400 });
    }
    const batches = await appendInboxBatch(cleaned);
    return NextResponse.json({ success: true, data: { batches, added: cleaned.length } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PUT: 全量覆写批次结构（前端勾选状态切换后回写）
export async function PUT(req: NextRequest) {
  try {
    const { batches } = await req.json();
    if (!Array.isArray(batches)) {
      return NextResponse.json({ success: false, error: '参数错误' }, { status: 400 });
    }
    // 校验并规整客户端回传的结构
    const normalized: InboxBatch[] = (batches as any[])
      .map((b) => ({
        time: String(b?.time || '').trim(),
        questions: Array.isArray(b?.questions)
          ? b.questions
              .map((q: any) => ({ text: String(q?.text ?? '').trim(), checked: !!q?.checked }))
              .filter((q: { text: string }) => q.text)
          : [],
      }))
      .filter((b) => b.time && b.questions.length > 0);
    await writeInbox(normalized);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
