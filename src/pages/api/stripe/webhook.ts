import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase/supabaseClient';
import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body as Stripe.Event;

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const userId = paymentIntent.metadata.userId;
      const tokenCount = parseInt(paymentIntent.metadata.tokenCount);

      if (!userId || !tokenCount) {
        throw new Error('Missing userId or tokenCount in payment metadata');
      }

      const { data: userData, error: fetchError } = await supabase
        .from('users')
        .select('user_tokens')
        .eq('id', userId)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      const currentTokens = userData.user_tokens || 0;
      const newTokens = currentTokens + tokenCount;

      const { error: updateError } = await supabase
        .from('users')
        .update({ user_tokens: newTokens })
        .eq('id', userId);

      if (updateError) {
        throw updateError;
      }

      console.log(`Successfully updated tokens for user ${userId}. Added ${tokenCount} tokens. New balance: ${newTokens}`);
      return res.status(200).json({ received: true });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
} 