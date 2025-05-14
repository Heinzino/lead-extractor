import React from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Stripe } from '@stripe/stripe-js';
import Button from './Button';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientSecret: string;
  stripePromise: Stripe | null;
  tokenCount: number;
  cost: number;
  onSuccess: () => void;
  onError: (error: string) => void;
}

const PaymentForm: React.FC<{
  onSuccess: () => void;
  onError: (error: string) => void;
}> = ({ onSuccess, onError }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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
      <div className="mt-8 flex justify-center">
        <Button
          text="Purchase Tokens"
          onClick={() => {}} // Required by Button component
          isLoading={isProcessing}
        />
      </div>
    </form>
  );
};

const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  clientSecret,
  stripePromise,
  tokenCount,
  cost,
  onSuccess,
  onError,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-2xl font-semibold text-gray-900">Purchase Tokens</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-6">
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Tokens:</span>
                <span className="text-lg font-semibold text-gray-900">{tokenCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Cost:</span>
                <span className="text-lg font-semibold text-gray-900">${cost.toFixed(2)}</span>
              </div>
            </div>

            {stripePromise && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  onSuccess={onSuccess}
                  onError={onError}
                />
              </Elements>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal; 