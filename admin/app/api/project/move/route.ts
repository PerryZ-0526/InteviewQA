import { NextRequest, NextResponse } from 'next/server';
import { moveProjectDoc } from '@/lib/fileUtils';
import { logMoveProjectDoc } from '@/lib/logger';
import { remapFsrsKeys } from '@/lib/fsrsStore';

// POST: 在 project 与 groups 的子目录之间移动文档，两者不与分类文档互通。
// body: { fromSubdir, filename, toSubdir, toIndex }
export async function POST(req: NextRequest) {
  try {
    const { fromSubdir, filename, toSubdir, toIndex } = await req.json();
    if (!fromSubdir || !filename || !toSubdir || !Number.isFinite(toIndex)) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
    }

    const result = await moveProjectDoc(fromSubdir, filename, toSubdir, toIndex);
    if (!result.noop) {
      await logMoveProjectDoc(
        fromSubdir,
        filename,
        `${fromSubdir}/${filename} → ${toSubdir}/${result.moved.to.filename} @${toIndex}`,
      );

      // 联动改写可能存在的间隔重复卡片 key。
      try {
        const mapping: { from: string; to: string | null }[] = [
          {
            from: `${result.moved.from.category}/${result.moved.from.filename}`,
            to: `${result.moved.to.category}/${result.moved.to.filename}`,
          },
        ];
        for (const [oldFilename, newFilename] of Object.entries(result.sourceRenames)) {
          mapping.push({
            from: `${result.moved.from.category}/${oldFilename}`,
            to: `${result.moved.from.category}/${newFilename}`,
          });
        }
        for (const [oldFilename, newFilename] of Object.entries(result.targetRenames)) {
          mapping.push({
            from: `${result.moved.to.category}/${oldFilename}`,
            to: `${result.moved.to.category}/${newFilename}`,
          });
        }
        await remapFsrsKeys(mapping);
      } catch {}
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
