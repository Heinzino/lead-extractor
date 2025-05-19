import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: "https://545818e46431303b3d64f7eb5498b529@o4509113143459840.ingest.us.sentry.io/4509339156152320",
  tracesSampleRate: 1.0,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
}); 