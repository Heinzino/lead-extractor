import { NextRequest, NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;

    const apiResponse = await fetch(
      `${MATCHING_API_URL}/batches/${batchId}/results/download`,
      { headers: { 'x-api-key': MATCHING_API_KEY } }
    );
    const data = await apiResponse.json();

    if (!apiResponse.ok || data.status !== 'READY' || !data.download_url) {
      return NextResponse.json(data, { status: apiResponse.status });
    }

    return NextResponse.redirect(data.download_url, 302);
  } catch (error) {
    console.error('Matching API download error:', error);
    return NextResponse.json(
      { error: 'Failed to get download URL' },
      { status: 500 }
    );
  }
}
