'use client';
import { useEffect, JSX } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  console.log('user', user);

  useEffect(() => {
    if (!loading && user === null) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) return <p>Loading...</p>;

  return children;
}
