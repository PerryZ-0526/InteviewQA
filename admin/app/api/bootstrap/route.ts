import { NextResponse } from 'next/server';
import { listCategories, listProjectDocs, listTags } from '@/lib/fileUtils';
import { listExternalDocs, listExternalGroups } from '@/lib/externalDocs';
import { loadFsrsStore } from '@/lib/fsrsStore';
import { readInbox } from '@/lib/inbox';

export async function GET() {
  try {
    const [categories, tags, projectSubdirs, externalDocs, externalGroups, fsrsStore, inbox] = await Promise.all([
      listCategories(),
      listTags(),
      listProjectDocs(),
      listExternalDocs(),
      listExternalGroups(),
      loadFsrsStore(),
      readInbox(),
    ]);
    const inboxUnchecked = inbox.reduce(
      (sum, batch) => sum + batch.questions.filter((question) => !question.checked).length,
      0,
    );
    return NextResponse.json({
      success: true,
      data: {
        categories,
        tags,
        projectSubdirs,
        externalDocs,
        externalGroups,
        fsrsStore,
        inboxUnchecked,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
