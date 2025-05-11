import { NextRequest, NextResponse } from 'next/server';

const ENDPOINT = "https://google.serper.dev/places";
const MAX_RETRIES = 3;
const RETRY_DELAY = 500;
const RATE_LIMIT = process.env.NODE_ENV === 'production' ? 200 : 5;
const RATE_LIMIT_WINDOW = 1100;

let tokens = RATE_LIMIT;
let lastRefill = Date.now();

async function waitForToken(): Promise<void> {
    const now = Date.now();
    const timePassed = now - lastRefill;
    const newTokens = Math.floor(timePassed / RATE_LIMIT_WINDOW * RATE_LIMIT);
    
    if (newTokens > 0) {
        tokens = Math.min(RATE_LIMIT, tokens + newTokens);
        lastRefill = now;
    }

    if (tokens <= 0) {
        const waitTime = RATE_LIMIT_WINDOW - (now - lastRefill);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return waitForToken();
    }

    tokens--;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    try {
        await waitForToken();
        const response = await fetch(url, options);
        
    
        if (response.status >= 500 && retries > 0) {
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

        const response = await fetchWithRetry(ENDPOINT, {
            method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERP_API_KEY || '',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q,
                location,
                ...(page ? { page } : {})
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Serper API error:', error);
            return NextResponse.json(error, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Serper API error:', error);
        return NextResponse.json(
            { message: 'Internal server error' },
            { status: 500 }
        );
    }
} 