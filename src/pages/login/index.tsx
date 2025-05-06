"use client";
import { useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase/supabaseClient';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
    } else {
      router.push('/');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {errorMsg && <Toast message={errorMsg} />}
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm bg-white/5 backdrop-blur-md p-8 rounded-2xl shadow-lg border border-white/10"
      >
        <h1 className="text-3xl font-semibold text-center mb-6">Welcome Back</h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-6 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-3 font-semibold rounded-lg transition duration-300 flex items-center justify-center
            ${loading ? 'bg-cyan-300 cursor-not-allowed' : 'bg-cyan-400 hover:bg-cyan-300 text-gray-900'}`}
        >
          {loading ? <div className='size-5'><Spinner color="text-gray-900" /></div> : 'Login'}
        </button>
      </form>
    </div>
  );
}
