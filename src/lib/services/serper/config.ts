import type { SerperConfig } from './types';

export const serperConfig: SerperConfig = {
    maxWorkers: process.env.NODE_ENV === 'production' ? 200 : 5,
    batchDelay: 1100,
    maxPages: process.env.NODE_ENV === 'production' ? Infinity : 1
}; 