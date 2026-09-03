import { NextRequest, NextResponse } from 'next/server';
import { listExternalGroups, createExternalGroup, renameExternalGroup, deleteExternalGroup } from '@/lib/externalDocs';
import { appendLog } from '@/lib/logger';

// GET → 分组名列表（注册顺序）
export async function GET() {
  try {
    const groups = await listExternalGroups();
    return NextResponse.json({ success: true, data: groups });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// POST { name } → 新建分组
export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: '分组名不能为空' }, { status: 400 });
    }
    const groups = await createExternalGroup(name);
    await appendLog({
      action: 'external_group_create',
      status: 'success',
      detail: name.trim(),
    });
    return NextResponse.json({ success: true, data: groups });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}

// PATCH { oldName, newName } → 重命名分组（条目同步迁移）
export async function PATCH(req: NextRequest) {
  try {
    const { oldName, newName } = await req.json();
    if (typeof oldName !== 'string' || typeof newName !== 'string' || !oldName.trim() || !newName.trim()) {
      return NextResponse.json({ success: false, error: '缺少 oldName 或 newName' }, { status: 400 });
    }
    const groups = await renameExternalGroup(oldName, newName);
    await appendLog({
      action: 'external_group_rename',
      status: 'success',
      detail: JSON.stringify({ from: oldName.trim(), to: newName.trim() }),
    });
    return NextResponse.json({ success: true, data: groups });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}

// DELETE ?name= → 删除分组（组内条目回到未分组，索引与文件均不动）
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    let name = url.searchParams.get('name');
    if (!name) {
      try { name = (await req.json()).name; } catch {}
    }
    if (!name) {
      return NextResponse.json({ success: false, error: '缺少 name' }, { status: 400 });
    }
    const { groups, movedCount } = await deleteExternalGroup(name);
    await appendLog({
      action: 'external_group_delete',
      status: 'success',
      detail: JSON.stringify({ group: name.trim(), movedToUngrouped: movedCount }),
    });
    return NextResponse.json({ success: true, data: groups, movedCount });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}
