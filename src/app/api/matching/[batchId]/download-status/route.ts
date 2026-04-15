import { NextRequest, NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const retry = request.nextUrl.searchParams.get('retry');
    const qs = retry ? '?retry=1' : '';

    const apiResponse = await fetch(
      `${MATCHING_API_URL}/batches/${batchId}/results/download${qs}`,
      { headers: { 'x-api-key': MATCHING_API_KEY } }
    );
    const data = await apiResponse.json();
    return NextResponse.json(data, { status: apiResponse.status });
  } catch (error) {
    console.error('Matching API download-status error:', error);
    return NextResponse.json(
      { status: 'FAILED', error: 'Status check failed' },
      { status: 500 }
    );
  }
}
