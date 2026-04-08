import { NextRequest, NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = `${MATCHING_API_URL}/batches`;

    console.log('Matching API POST:', url, 'body keys:', Object.keys(body));

    if (!MATCHING_API_URL) {
      console.error('MATCHING_API_URL is not set');
      return NextResponse.json({ error: 'MATCHING_API_URL not configured' }, { status: 500 });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MATCHING_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    console.log('Matching API response:', response.status, text.substring(0, 500));

    let data;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Matching API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start pipeline' },
      { status: 500 }
    );
  }
}
