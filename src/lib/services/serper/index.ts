import type { SerperPlace, SerperQueryRow } from './types';
import { serperConfig } from './config';
import { normalizeText, chunk } from './utils';
import centroidFile from '../../../data/zip-centroids.json';

const MAPS_URL = 'https://api.scraper.tech/searchmaps.php';
const ZOOM = '14';
const centroids = centroidFile as unknown as Record<string, [number, number]>;

function centroidFor(zip: string): [number, number] | undefined {
    return centroids[zip.trim().padStart(5, '0')];
}

function cidOf(place: Record<string, unknown>): string | undefined {
    const businessId = String(place.business_id || '');
    const hex = businessId.includes(':') ? businessId.split(':').pop() || '' : '';
    const digits = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (/^[0-9a-fA-F]+$/.test(digits)) {
        return BigInt(`0x${digits}`).toString(10);
    }
    if (place.cid != null && place.cid !== '') {
        return String(place.cid);
    }
    return undefined;
}

function addressOf(place: Record<string, unknown>): string {
    const name = String(place.name || '');
    let address = String(place.full_address || '');
    if (name && address.toLowerCase().startsWith(name.toLowerCase())) {
        address = address.slice(name.length).replace(/^[\s,]+/, '');
    }
    return address;
}

function mapPlace(raw: Record<string, unknown>, position: number): Record<string, unknown> {
    const types = Array.isArray(raw.types) ? raw.types.map(item => String(item)) : [];
    return {
        title: raw.name ?? '',
        address: addressOf(raw),
        website: raw.website ?? '',
        phoneNumber: raw.phone_number ?? '',
        category: types[0] ?? '',
        rating: raw.rating,
        ratingCount: raw.review_count,
        latitude: raw.latitude,
        longitude: raw.longitude,
        cid: cidOf(raw),
        position
    };
}

export async function searchMapsPage(
    query: string,
    zip: string,
    page = 1
): Promise<{ ok: boolean; places: Record<string, unknown>[] }> {
    const point = centroidFor(zip);
    if (!point) {
        console.error(`No map point for zip ${zip}`);
        return { ok: false, places: [] };
    }

    const params = new URLSearchParams({
        query,
        limit: String(serperConfig.pageSize),
        country: 'us',
        lang: 'en',
        lat: point[0].toFixed(6),
        lng: point[1].toFixed(6),
        offset: String(Math.max(page - 1, 0) * serperConfig.pageSize),
        zoom: ZOOM
    });

    let delay = 1000;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const response = await fetch(`${MAPS_URL}?${params}`, {
                method: 'GET',
                headers: {
                    'Scraper-Key': process.env.SCRAPER_TECH_API_KEY || ''
                }
            });
            const data = await response.json().catch(() => null) as { status?: string; data?: Record<string, unknown>[] } | null;
            if (response.ok && data?.status === 'ok') {
                const rawPlaces = Array.isArray(data.data) ? data.data : [];
                return { ok: true, places: rawPlaces.map((place, index) => mapPlace(place, index + 1)) };
            }

            const retry = response.status === 429 || response.status >= 500 || data?.status === 'failed';
            if (!retry || attempt === 3) {
                console.error('scraper.tech error:', data ?? response.status);
                return { ok: false, places: [] };
            }
        } catch (error) {
            if (attempt === 3) {
                console.error('scraper.tech error:', error);
                return { ok: false, places: [] };
            }
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
        try {
            const { ok, places } = await searchMapsPage(searchTerm, row.zip, page);

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
            console.error(`Error on page ${page}:`, error);
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

    for (const batch of chunks) {
        const chunkPromises = batch.map(async (row: SerperQueryRow) => {
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
