import { NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function POST() {
  try {
    const response = await fetch(`${MATCHING_API_URL}/batches/presign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MATCHING_API_KEY,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Matching API presign error:', error);
    return NextResponse.json(
      { error: 'Failed to get upload URL' },
      { status: 500 }
    );
  }
}
