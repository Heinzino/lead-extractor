export interface SerperPlace {
    query: string;
    city: string;
    zip: string;
    search_term: string;
    page: number;
    cid?: string;
    is_valid?: string;
    maps_url?: string;
    [key: string]: unknown;
}

export interface SerperQueryRow {
    query: string;
    city: string;
    zip: string;
    search_term?: string;
}

export interface SerperResponse {
    places: SerperPlace[];
}


const MAX_WORKERS = 5;
const BATCH_DELAY = 1000;
const MAX_PAGES = 1;


function normalizeText(text: string): string {
    return text.toLowerCase().trim();
}

function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function fetchPlaces(row: SerperQueryRow): Promise<SerperPlace[]> {
    const searchTerm = `${normalizeText(row.query)} in ${normalizeText(row.city)} ${row.zip}`;
    let page = 1;
    const collected: SerperPlace[] = [];

    while (page <= MAX_PAGES) {
        const payload = {
            q: searchTerm,
            location: row.zip,
            ...(page > 1 ? { page } : {})
        };

        try {
            console.log(`Fetching '${searchTerm}', page ${page}/${MAX_PAGES}...`);
            
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
                console.log(`No more places found for: ${searchTerm}`);
                break;
            }

            console.log(`→ Page ${page} returned ${places.length} places`);

            for (const place of places) {
                const entry: SerperPlace = {
                    ...place,
                    query: normalizeText(row.query),
                    city: normalizeText(row.city),
                    zip: row.zip,
                    search_term: searchTerm,
                    page: page
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
    const chunks = chunk(rows, MAX_WORKERS);

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

        
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }

    return results;
} 