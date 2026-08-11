import { NextResponse } from 'next/server';
import { listTags } from '@/lib/fileUtils';

export async function GET() {
  try {
    const tags = await listTags();
    return NextResponse.json({ success: true, data: tags });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
