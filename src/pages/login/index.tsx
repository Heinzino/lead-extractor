"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Spinner from '../../components/Spinner';
import Toast from '../../components/Toast';
import { supabase } from '../../lib/supabase/supabaseClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    
    const { success } = router.query;
    if (success === 'registered') {
      setSuccessMsg('Account created successfully! Please check your email for the confirmation link.');
      
      router.replace('/login', undefined, { shallow: true });
    }
  }, [router.query]);

  const validatePassword = (password: string) => {
    const requirements = {
      minLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };

    const errors = [];
    if (!requirements.minLength) errors.push('At least 8 characters');
    if (!requirements.hasUpperCase) errors.push('One uppercase letter');
    if (!requirements.hasLowerCase) errors.push('One lowercase letter');
    if (!requirements.hasNumber) errors.push('One number');
    if (!requirements.hasSpecialChar) errors.push('One special character');

    return {
      isValid: Object.values(requirements).every(Boolean),
      errors,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    if (!isLogin) {
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match');
        setLoading(false);
        return;
      }

      const { isValid, errors } = validatePassword(password);
      if (!isValid) {
        setErrorMsg(`Password requirements: ${errors.join(', ')}`);
        setLoading(false);
        return;
      }

      if (!firstName.trim() || !lastName.trim()) {
        setErrorMsg('First name and last name are required');
        setLoading(false);
        return;
      }
    }

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          ...(isLogin ? {} : { firstName, lastName }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'An error occurred during authentication');
      }

      if (isLogin) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.data.session.access_token,
          refresh_token: data.data.session.refresh_token,
        });

        if (sessionError) {
          throw sessionError;
        }
        router.replace('/');
      } else {
        setSuccessMsg('Account created successfully! Please check your email for the confirmation link.');
        setIsLogin(true);
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setFirstName('');
        setLastName('');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('security purposes') || error.message.includes('seconds')) {
          setErrorMsg('Please wait a minute before trying again.');
        } else if (error.message.includes('Email not confirmed')) {
          setErrorMsg('Please confirm your email before logging in. Check your inbox for the confirmation link.');
        } else {
          setErrorMsg(error.message);
        }
      } else {
        setErrorMsg('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {errorMsg && <Toast message={errorMsg} type="error" />}
      {successMsg && <Toast message={successMsg} type="success" />}
      <div className="w-full max-w-sm bg-white/5 backdrop-blur-md p-8 rounded-2xl shadow-lg border border-white/10">
        <h1 className="text-3xl font-semibold text-center mb-6">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h1>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <>
              <input
                type="text"
                placeholder="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full mb-4 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                required
              />
              <input
                type="text"
                placeholder="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full mb-4 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                required
              />
            </>
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-4 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-4 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            required
          />

          {!isLogin && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full mb-4 px-4 py-3 rounded-lg bg-white/10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              required
            />
          )}

          {!isLogin && (
            <div className="mb-6 text-sm text-gray-300">
              <p className="font-medium mb-2">Password must contain:</p>
              <ul className="list-disc list-inside space-y-1">
                <li className={password.length >= 8 ? 'text-green-400' : ''}>At least 8 characters</li>
                <li className={/[A-Z]/.test(password) ? 'text-green-400' : ''}>One uppercase letter</li>
                <li className={/[a-z]/.test(password) ? 'text-green-400' : ''}>One lowercase letter</li>
                <li className={/[0-9]/.test(password) ? 'text-green-400' : ''}>One number</li>
                <li className={/[!@#$%^&*(),.?":{}|<>]/.test(password) ? 'text-green-400' : ''}>One special character</li>
                <li className={password === confirmPassword && password !== '' ? 'text-green-400' : ''}>Passwords must match</li>
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 font-semibold rounded-lg transition duration-300 flex items-center justify-center
              ${loading ? 'bg-cyan-300 cursor-not-allowed' : 'bg-cyan-400 hover:bg-cyan-300 text-gray-900'}`}
          >
            {loading ? <div className='size-5'><Spinner color="text-gray-900" /></div> : (isLogin ? 'Login' : 'Register')}
          </button>
        </form>

        <button
          onClick={() => {
            setIsLogin(!isLogin);
            setErrorMsg('');
            setPassword('');
            setConfirmPassword('');
            setFirstName('');
            setLastName('');
          }}
          className="w-full mt-4 text-sm text-gray-400 hover:text-white transition-colors"
        >
          {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
        </button>
      </div>
    </div>
  );
}
