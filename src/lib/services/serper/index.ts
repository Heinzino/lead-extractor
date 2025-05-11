import type { SerperPlace, SerperQueryRow, SerperResponse } from './types';
import { serperConfig } from './config';
import { normalizeText, chunk } from './utils';

async function fetchPlaces(row: SerperQueryRow): Promise<{ places: SerperPlace[], creditsUsed: number }> {
    const searchTerm = `${normalizeText(row.query)} in ${normalizeText(row.city)} ${row.zip}`;
    let page = 1;
    const collected: SerperPlace[] = [];
    let creditsUsed = 0;

    while (page <= serperConfig.maxPages) {
        const payload = {
            q: searchTerm,
            location: row.zip,
            ...(page > 1 ? { page } : {})
        };

        try {            
            const response = await fetch('https://google.serper.dev/places', {
                method: 'POST',
                headers: {
                    'X-API-KEY': process.env.SERP_API_KEY || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            creditsUsed++;

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
                console.error(`❌ Error on page ${page}:`, errorData);
                break;
            }

            const data = await response.json() as SerperResponse;
            const places = data.places || [];

            if (!places.length) {
                break;
            }

            for (const place of places) {
                const entry: SerperPlace = {
                    ...place,
                    query: normalizeText(row.query),
                    city: normalizeText(row.city),
                    zip: row.zip,
                    search_term: searchTerm,
                    page: page,
                    is_valid: place.cid ? 'true' : 'false',
                    maps_url: place.cid ? `https://www.google.com/maps?cid=${place.cid}` : ''
                };
                Object.keys(entry).forEach(key => {
                    const value = entry[key];
                    if (typeof value === 'string') {
                        entry[key] = normalizeText(value);
                    }
                });
                collected.push(entry);
            }

            if (places.length < 10) {
                break;
            }

            page++;
        } catch (error) {
            console.error(`❌ Error on page ${page}:`, error);
            break;
        }
    }

    return { places: collected, creditsUsed };
}

export async function runSerper(rows: SerperQueryRow[]): Promise<{ results: SerperPlace[], creditsUsed: number }> {
    const results: SerperPlace[] = [];
    const seenCids = new Set<string>();
    let totalCreditsUsed = 0;
    
    // Limit rows in development mode
    if (process.env.NODE_ENV !== 'production') {
        rows = rows.slice(0, 10);
    }
    
    const chunks = chunk(rows, serperConfig.maxWorkers);

    for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (row: SerperQueryRow) => {
            const { places, creditsUsed } = await fetchPlaces(row);
            totalCreditsUsed += creditsUsed;
            return places;
        });
        const chunkResults = await Promise.all(chunkPromises);
        
        const validResults = chunkResults
            .flat()
            .filter((entry: SerperPlace | null): entry is SerperPlace => entry !== null)
            .filter((place: SerperPlace) => place.cid && !seenCids.has(place.cid));

        results.push(...validResults);
        validResults.forEach((place: SerperPlace) => {
            if (place.cid) {
                seenCids.add(place.cid);
            }
        });

        await new Promise(resolve => setTimeout(resolve, serperConfig.batchDelay));
    }

    return { results, creditsUsed: totalCreditsUsed };
} 