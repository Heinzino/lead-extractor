import { NextRequest, NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const url = `${MATCHING_API_URL}/batches/${batchId}/results${queryString ? '?' + queryString : ''}`;

    const response = await fetch(url, {
      headers: { 'x-api-key': MATCHING_API_KEY },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Matching API results error:', error);
    return NextResponse.json(
      { error: 'Failed to get batch results' },
      { status: 500 }
    );
  }
}
