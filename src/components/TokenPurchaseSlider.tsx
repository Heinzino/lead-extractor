import React, { useState, useEffect, FormEvent } from 'react';
import Button from './Button';
import Toast from './Toast';
import { getStripe } from '../lib/stripe';
import { supabase } from '../lib/supabase/supabaseClient';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Stripe } from '@stripe/stripe-js';

const TOKENS_PER_DOLLAR = 1000;

interface PaymentFormProps {
  onSuccess: () => void;
  onError: (error: string) => void;
}

const PaymentForm: React.FC<PaymentFormProps> = ({ onSuccess, onError }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/settings`,
        },
        redirect: 'if_required',
      });

      if (error) {
        onError(error.message || 'Payment failed');
      } else {
        onSuccess();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <PaymentElement />
      <Button
        text="Purchase Tokens"
        onClick={() => {}} // Required by Button component
        isLoading={isProcessing}
      />
    </form>
  );
};

const TokenPurchaseSlider = () => {
  const [tokenCount, setTokenCount] = useState(500);
  const [cost, setCost] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [clientSecret, setClientSecret] = useState('');
  const [stripePromise, setStripePromise] = useState<Stripe | null>(null);
  
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
      // Get a fresh session
      const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw new Error('Failed to get session');
      }
      if (!initialSession) {
        throw new Error('No active session. Please log in to continue.');
      }

      // Refresh the session if needed
      let session = initialSession;
      if (session.expires_at && session.expires_at * 1000 < Date.now()) {
        const { data: { session: newSession }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !newSession) {
          throw new Error('Session expired. Please log in again.');
        }
        session = newSession;
      }

      // Create payment intent
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
  };

  const handleError = (error: string) => {
    setToastMessage(error || 'Payment failed. Please try again.');
    setToastType('error');
    setShowToast(true);
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
        
        {!clientSecret ? (
          <Button
            text="Continue to Payment"
            onClick={handlePurchase}
          />
        ) : (
          <div className="w-full">
            {stripePromise && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  onSuccess={handleSuccess}
                  onError={handleError}
                />
              </Elements>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenPurchaseSlider;