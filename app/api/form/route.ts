import { NextResponse } from 'next/server';
import { getFormFields } from '@/lib/formConfig';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const fields = await getFormFields();
    return NextResponse.json({ fields }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
