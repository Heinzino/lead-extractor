import { NextRequest, NextResponse } from 'next/server';

const MATCHING_API_URL = process.env.MATCHING_API_URL || '';
const MATCHING_API_KEY = process.env.MATCHING_API_KEY || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const filename = request.nextUrl.searchParams.get('filename') || `${batchId}.csv`;

    // Get presigned S3 URL from matching API
    const apiResponse = await fetch(
      `${MATCHING_API_URL}/batches/${batchId}/results/download`,
      {
        headers: { 'x-api-key': MATCHING_API_KEY },
      }
    );

    const data = await apiResponse.json();

    if (!apiResponse.ok || !data.download_url) {
      return NextResponse.json(data, { status: apiResponse.status });
    }

    // Proxy the S3 file through our server to avoid CORS issues
    const fileResponse = await fetch(data.download_url);
    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch file from storage' },
        { status: 502 }
      );
    }

    const fileBuffer = await fileResponse.arrayBuffer();

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Matching API download error:', error);
    return NextResponse.json(
      { error: 'Failed to get download URL' },
      { status: 500 }
    );
  }
}
