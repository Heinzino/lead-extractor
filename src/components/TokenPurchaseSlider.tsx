import React, { useState, useEffect } from 'react';
import Button from './Button';
import Toast from './Toast';
import { getStripe } from '../lib/stripe';
import { supabase } from '../lib/supabase/supabaseClient';
import { Stripe } from '@stripe/stripe-js';
import PaymentModal from './PaymentModal';

const TOKENS_PER_DOLLAR = 1000;

interface TokenPurchaseSliderProps {
  onPurchaseSuccess?: () => void;
}

const TokenPurchaseSlider: React.FC<TokenPurchaseSliderProps> = ({ onPurchaseSuccess }) => {
  const [tokenCount, setTokenCount] = useState(500);
  const [cost, setCost] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [clientSecret, setClientSecret] = useState('');
  const [stripePromise, setStripePromise] = useState<Stripe | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  useEffect(() => {
    setCost(tokenCount / TOKENS_PER_DOLLAR);
  }, [tokenCount]);

  useEffect(() => {
    const initializeStripe = async () => {
      const stripe = await getStripe();
      setStripePromise(stripe);
    };
    initializeStripe();
  }, []);

  const handlePurchase = async () => {
    try {
      const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw new Error('Failed to get session');
      }
      if (!initialSession) {
        throw new Error('No active session. Please log in to continue.');
      }

      let session = initialSession;
      if (session.expires_at && session.expires_at * 1000 < Date.now()) {
        const { data: { session: newSession }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !newSession) {
          throw new Error('Session expired. Please log in again.');
        }
        session = newSession;
      }

      const response = await fetch('/api/stripe/create-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: cost,
          tokenCount,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment');
      }

      if (!data.clientSecret) {
        throw new Error('No client secret received');
      }

      setClientSecret(data.clientSecret);
      setIsModalOpen(true);
    } catch (error) {
      console.error('Payment error:', error);
      setToastMessage(error instanceof Error ? error.message : 'Payment failed. Please try again.');
      setToastType('error');
      setShowToast(true);
    }
  };

  const handleSuccess = () => {
    setToastMessage('Payment successful! Your tokens have been added to your account.');
    setToastType('success');
    setShowToast(true);
    setClientSecret('');
    setIsModalOpen(false);
    onPurchaseSuccess?.();
  };

  const handleError = (error: string) => {
    setToastMessage(error || 'Payment failed. Please try again.');
    setToastType('error');
    setShowToast(true);
    setIsModalOpen(false);
  };
  
  return (
    <div> 
      {showToast && (
        <Toast 
          message={toastMessage} 
          type={toastType} 
          onClose={() => setShowToast(false)} 
        />
      )}

      <div className="mb-8">
        <div className="flex justify-end mb-2">
          <span className="text-lg font-medium text-sky-400">
            {tokenCount.toLocaleString()}
          </span>
        </div>
        
        <input
          type="range"
          min="100"
          max="100000"
          step="100"
          value={tokenCount}
          onChange={(e) => setTokenCount(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        
        <div className="flex justify-between mt-2">
          <span className="text-xs text-gray-500">100</span>
          <span className="text-xs text-gray-500">100,000</span>
        </div>
      </div>
      
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
        <div className="mb-4 md:mb-0">
          <p className="text-gray-700">Total Cost:</p>
          <p className="text-2xl font-semibold text-gray-900 py-2">${cost.toFixed(2)}</p>
          <p className="text-xs text-gray-500">Rate: {TOKENS_PER_DOLLAR} tokens per $1.00</p>
        </div>
        
        <Button
          text="Purchase Tokens"
          onClick={handlePurchase}
        />
      </div>

      <PaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        clientSecret={clientSecret}
        stripePromise={stripePromise}
        tokenCount={tokenCount}
        cost={cost}
        onSuccess={handleSuccess}
        onError={handleError}
      />
    </div>
  );
};

export default TokenPurchaseSlider;