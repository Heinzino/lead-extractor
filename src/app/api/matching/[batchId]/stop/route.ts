import { NextRequest, NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const response = await fetch(
      `${MATCHING_API_URL}/batches/${batchId}/stop`,
      {
        method: 'POST',
        headers: { 'x-api-key': MATCHING_API_KEY },
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Matching API stop error:', error);
    return NextResponse.json(
      { error: 'Failed to stop batch execution' },
      { status: 500 }
    );
  }
}
