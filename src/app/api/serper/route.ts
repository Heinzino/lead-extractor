import { NextRequest, NextResponse } from 'next/server';

const ENDPOINT = "https://api.litescrape.com/api/google/maps";
const PAGE_SIZE = 20;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    try {
        const response = await fetch(url, options);
        
        if ((response.status === 429 || response.status >= 500) && retries > 0) {
            const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1);
        }
        
        return response;
    } catch (error) {
        if (retries > 0) {
            const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { q, location, page } = body;
        const query = location && !String(q).includes(String(location))
            ? `${q} ${location}`
            : q;
        const pageNumber = Number(page) > 1 ? Number(page) : 1;

        const response = await fetchWithRetry(ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.LITESCRAPE_API_KEY || ''}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: query,
                type: 'search',
                hl: 'en',
                gl: 'us',
                ...(pageNumber > 1 ? { start: (pageNumber - 1) * PAGE_SIZE } : {})
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('LiteScrape API error:', error);
            return NextResponse.json(error, { status: response.status });
        }

        const data = await response.json();
        const places = Array.isArray(data.local_results) ? data.local_results.map((raw: Record<string, unknown>) => {
            const gps = (raw.gps_coordinates || {}) as { latitude?: number; longitude?: number };
            const cid = raw.data_cid ?? raw.cid;
            return {
                title: raw.title ?? '',
                address: raw.address ?? '',
                website: raw.website ?? '',
                phoneNumber: raw.phone ?? raw.phoneNumber ?? '',
                category: raw.type ?? raw.category ?? '',
                rating: raw.rating,
                ratingCount: raw.reviews ?? raw.ratingCount,
                latitude: raw.latitude ?? gps.latitude,
                longitude: raw.longitude ?? gps.longitude,
                cid: cid == null ? undefined : String(cid),
                position: raw.position
            };
        }) : [];
        return NextResponse.json({ places, credits: data.billed === false ? 0 : 1 });
    } catch (error) {
        console.error('LiteScrape API error:', error);
        return NextResponse.json(
            { message: 'Internal server error' },
            { status: 500 }
        );
    }
} 