import { useAuth } from '../context/AuthContext';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase/supabaseClient';
import TokenPurchaseSlider from './TokenPurchaseSlider';

interface UserProfile {
  first_name: string | null;
  last_name: string | null;
  user_tokens: number | null;
}

export default function Settings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('first_name, last_name, user_tokens')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        return;
      }

      setProfile(data);
    } finally {
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handlePurchaseSuccess = useCallback(async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await fetchProfile();
  }, [fetchProfile]);

  return (
    <div className="w-full mx-auto p-4 md:px-6 md:pt-4 md:pb-24">
      <div className="space-y-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Settings</h2>

        {/* Account Information Section */}
        <div className="bg-white shadow-md rounded-2xl p-6 space-y-4">
          <h3 className="text-xl font-semibold text-gray-800">Account Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600">First Name</label>
              <div className="mt-1 text-gray-900">{profile?.first_name || '—'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">Last Name</label>
              <div className="mt-1 text-gray-900">{profile?.last_name || '—'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">Email</label>
              <div className="mt-1 text-gray-900">{user?.email || '—'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">Available Tokens</label>
              <div className="mt-1 text-gray-900">
                {isRefreshing ? (
                  <span className="inline-block animate-pulse">Refreshing...</span>
                ) : (
                  profile?.user_tokens ?? '—'
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Purchase Tokens Section */}
        <div className="bg-white shadow-md rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-gray-800">Purchase Tokens</h3>
          <TokenPurchaseSlider onPurchaseSuccess={handlePurchaseSuccess} />
        </div>
      </div>
    </div>
  );
}
