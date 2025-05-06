import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { AuthProvider } from '../context/AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';
import '@/styles/globals.css';

const noAuthRequired = ['/login'];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isPublic = noAuthRequired.includes(router.pathname);

  return (
    <AuthProvider>
      {isPublic ? (
        <Component {...pageProps} />
      ) : (
        <ProtectedRoute>
          <Component {...pageProps} />
        </ProtectedRoute>
      )}
    </AuthProvider>
  );
}
