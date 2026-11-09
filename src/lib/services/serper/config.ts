import type { SerperConfig } from './types';

export const serperConfig: SerperConfig = {
    // 80 in flight did about 21 requests/second with the median still at 3 seconds.
    // 60 stays at or under the 20/second rate that held. 500 in flight did not go faster.
    maxWorkers: process.env.NODE_ENV === 'production' ? 60 : 5,
    batchDelay: 200,
    // A zip view tops out near 200 places. Three pages covers that and then stops.
    maxPages: process.env.NODE_ENV === 'production' ? 3 : 1,
    pageSize: 200
}; 