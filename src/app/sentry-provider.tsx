'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function SentryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Initialize Sentry on the client side
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: 1.0,
        debug: false,
      });
    }
  }, []);

  return <>{children}</>;
} 