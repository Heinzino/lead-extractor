import type { SerperConfig } from './types';

export const serperConfig: SerperConfig = {
    // A LiteScrape key allows 25 calls in flight. Stay under that.
    maxWorkers: process.env.NODE_ENV === 'production' ? 15 : 5,
    batchDelay: 1100,
    maxPages: process.env.NODE_ENV === 'production' ? Infinity : 1,
    pageSize: 20
}; 