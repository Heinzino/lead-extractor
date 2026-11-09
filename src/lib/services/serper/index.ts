import type { SerperPlace, SerperQueryRow } from './types';
import { serperConfig } from './config';
import { normalizeText, chunk } from './utils';

const MAPS_URL = 'https://api.litescrape.com/api/google/maps';

function mapPlace(raw: Record<string, unknown>): Record<string, unknown> {
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
}

async function fetchMaps(payload: Record<string, unknown>): Promise<{ ok: boolean; places: Record<string, unknown>[] }> {
    let delay = 1000;
    for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(MAPS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.LITESCRAPE_API_KEY || ''}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json() as { local_results?: Record<string, unknown>[] };
            const rawPlaces = Array.isArray(data.local_results) ? data.local_results : [];
            return { ok: true, places: rawPlaces.map(mapPlace) };
        }

        const retry = response.status === 429 || response.status >= 500;
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        if (!retry || attempt === 3) {
            console.error(`❌ LiteScrape error:`, errorData);
            return { ok: false, places: [] };
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 20000);
    }
    return { ok: false, places: [] };
}

async function fetchPlaces(row: SerperQueryRow): Promise<{ places: SerperPlace[], creditsUsed: number }> {
    const searchTerm = `${normalizeText(row.query)} in ${normalizeText(row.city)} ${row.zip}`;
    let page = 1;
    const collected: SerperPlace[] = [];
    let creditsUsed = 0;

    while (page <= serperConfig.maxPages) {
        const payload: Record<string, unknown> = {
            q: searchTerm,
            type: 'search',
            hl: 'en',
            gl: 'us',
            ...(page > 1 ? { start: (page - 1) * serperConfig.pageSize } : {})
        };

        try {
            const { ok, places } = await fetchMaps(payload);

            if (!ok) {
                break;
            }

            creditsUsed++;

            if (!places.length) {
                break;
            }

            for (const place of places) {
                const cid = typeof place.cid === 'string' ? place.cid : '';
                const entry: SerperPlace = {
                    ...place,
                    query: normalizeText(row.query),
                    city: normalizeText(row.city),
                    zip: row.zip,
                    search_term: searchTerm,
                    page: page,
                    is_valid: cid ? 'true' : 'false',
                    maps_url: cid ? `https://www.google.com/maps?cid=${cid}` : '',
                    cid: cid ? `'${cid}` : undefined
                };
                Object.keys(entry).forEach(key => {
                    const value = entry[key];
                    if (typeof value === 'string') {
                        entry[key] = normalizeText(value);
                    }
                });
                collected.push(entry);
            }

            if (places.length < serperConfig.pageSize) {
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
    
    if (process.env.NODE_ENV !== 'production') {
        rows = rows.slice(0, 10);
    }
    
    const validRows = rows.filter(row => {
        const hasMeaningfulContent = (value: string): boolean => {
            const lettersOnly = value.replace(/[^a-zA-Z]/g, '');
            return lettersOnly.length > 0;
        };
        return hasMeaningfulContent(row.query) && hasMeaningfulContent(row.city) && !!row.zip;
    });
    
    if (validRows.length === 0) {
        console.warn('No valid rows found after filtering.');
        return { results: [], creditsUsed: 0 };
    }
    
    const chunks = chunk(validRows, serperConfig.maxWorkers);

    for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (row: SerperQueryRow) => {
            const { places, creditsUsed } = await fetchPlaces(row);
            totalCreditsUsed += creditsUsed;
            return places;
        });
        const chunkResults = await Promise.all(chunkPromises);
        
        chunkResults
            .flat()
            .filter((entry: SerperPlace | null): entry is SerperPlace => entry !== null)
            .forEach((place: SerperPlace) => {
                if (place.cid && !seenCids.has(place.cid)) {
                    seenCids.add(place.cid);
                    results.push(place);
                }
            });

        await new Promise(resolve => setTimeout(resolve, serperConfig.batchDelay));
    }

    return { results, creditsUsed: totalCreditsUsed };
} 