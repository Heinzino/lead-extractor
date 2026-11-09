import { NextRequest, NextResponse } from 'next/server';
import { searchMapsPage } from '../../../lib/services/serper/index';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { q, location, page } = body;
        const query = location && !String(q).includes(String(location))
            ? `${q} ${location}`
            : q;
        const pageNumber = Number(page) > 1 ? Number(page) : 1;
        const zip = String(location || '').trim();

        const { ok, places } = await searchMapsPage(String(query || ''), zip, pageNumber);
        if (!ok) {
            return NextResponse.json({ message: 'scraper.tech request failed' }, { status: 502 });
        }
        return NextResponse.json({ places, credits: 1 });
    } catch (error) {
        console.error('scraper.tech API error:', error);
        return NextResponse.json(
            { message: 'Internal server error' },
            { status: 500 }
        );
    }
}
