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

export interface SerperConfig {
    maxWorkers: number;
    batchDelay: number;
    maxPages: number;
} 