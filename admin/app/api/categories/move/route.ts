import { NextRequest, NextResponse } from 'next/server';
import { moveCategoryQuestion, categoryExists } from '@/lib/fileUtils';
import { logMove } from '@/lib/logger';
import { remapFsrsKeys } from '@/lib/fsrsStore';

// POST: 跨分类移动一道题目（拖拽落点触发）。
// body: { fromCategory, filename, toCategory, toIndex }
// toIndex 为「移除该题后」目标列表中的 0-based 插入下标（= 列表长度表示追加到末尾），
// 由前端按拖拽落点计算。服务端完成序号重排、index/导航链/标签/链接/侧车的全套联动。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const { fromCategory, filename, toCategory, toIndex } = body || {};

    if (
      typeof fromCategory !== 'string' || !/^[\w.-]+$/.test(fromCategory) ||
      typeof toCategory !== 'string' || !/^[\w.-]+$/.test(toCategory) ||
      typeof filename !== 'string' || !/^\d{3}-.+\.md$/.test(filename) ||
      typeof toIndex !== 'number' || !Number.isInteger(toIndex) || toIndex < 0 || toIndex > 10000
    ) {
      return NextResponse.json({ success: false, error: '参数不合法' }, { status: 400 });
    }

    if (!(await categoryExists(fromCategory))) {
      return NextResponse.json({ success: false, error: `源分类不存在: ${fromCategory}` }, { status: 404 });
    }
    if (!(await categoryExists(toCategory))) {
      return NextResponse.json({ success: false, error: `目标分类不存在: ${toCategory}` }, { status: 404 });
    }

    const result = await moveCategoryQuestion(fromCategory, filename, toCategory, toIndex);
    if (!result.noop) {
      await logMove(
        fromCategory,
        filename,
        `${fromCategory}/${filename} → ${toCategory}/${result.moved.to.filename} @${toIndex}`,
      );
      // 联动改写间隔重复卡片 key：被移动题 + 源/目标分类因重排改名的题
      try {
        const mapping: { from: string; to: string | null }[] = [
          {
            from: `${result.moved.from.category}/${result.moved.from.filename}`,
            to: `${result.moved.to.category}/${result.moved.to.filename}`,
          },
        ];
        for (const [oldF, newF] of Object.entries(result.sourceRenames || {})) {
          mapping.push({ from: `${result.moved.from.category}/${oldF}`, to: `${result.moved.from.category}/${newF}` });
        }
        for (const [oldF, newF] of Object.entries(result.targetRenames || {})) {
          mapping.push({ from: `${result.moved.to.category}/${oldF}`, to: `${result.moved.to.category}/${newF}` });
        }
        await remapFsrsKeys(mapping);
      } catch {}
    }
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || '移动失败' }, { status: 500 });
  }
}
