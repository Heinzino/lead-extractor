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

    if (!apiResponse.ok || data.status !== 'READY' || !data.download_url) {
      return NextResponse.json(data, { status: apiResponse.status });
    }

    // Proxy the S3 file through our server to avoid CORS issues.
    // Stream the body straight through — never buffer the whole CSV in
    // memory (exports for large batches are 100+ MB).
    const fileResponse = await fetch(data.download_url);
    if (!fileResponse.ok || !fileResponse.body) {
      return NextResponse.json(
        { error: 'Failed to fetch file from storage' },
        { status: 502 }
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    };
    const contentLength = fileResponse.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;

    return new NextResponse(fileResponse.body, { headers });
  } catch (error) {
    console.error('Matching API download error:', error);
    return NextResponse.json(
      { error: 'Failed to get download URL' },
      { status: 500 }
    );
  }
}
