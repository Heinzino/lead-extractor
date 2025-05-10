import type { SerperPlace, SerperQueryRow, SerperResponse } from './types';
import { serperConfig } from './config';
import { normalizeText, chunk } from './utils';

async function fetchPlaces(row: SerperQueryRow): Promise<SerperPlace[]> {
    const searchTerm = `${normalizeText(row.query)} in ${normalizeText(row.city)} ${row.zip}`;
    let page = 1;
    const collected: SerperPlace[] = [];

    while (page <= serperConfig.maxPages) {
        const payload = {
            q: searchTerm,
            location: row.zip,
            ...(page > 1 ? { page } : {})
        };

        try {            
            const response = await fetch('/api/serper', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

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

            page++;
        } catch (error) {
            console.error(`❌ Error on page ${page}:`, error);
            break;
        }
    }

    return collected;
}

export async function runSerper(rows: SerperQueryRow[]): Promise<SerperPlace[]> {
    const results: SerperPlace[] = [];
    const seenCids = new Set<string>();
    // LIMITING TO FIRST 10 LINES FOR TEST PURPOSES
    rows = rows.slice(0, 10);
    const chunks = chunk(rows, serperConfig.maxWorkers);

    for (const chunk of chunks) {
        const chunkPromises = chunk.map((row: SerperQueryRow) => fetchPlaces(row));
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

    return results;
} 