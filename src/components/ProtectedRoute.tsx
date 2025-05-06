"use client";
import { useRouter } from 'next/router';
import { useEffect, JSX } from 'react';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user === null) {
      router.push('/login');
    }
  }, [user, router]);

  if (!user) return <p>Loading...</p>;

  return children;
}
