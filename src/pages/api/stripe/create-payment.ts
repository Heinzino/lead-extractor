import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabase } from '../../../lib/supabase/supabaseClient';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, tokenCount } = req.body;

    if (!amount || !tokenCount) {
      return res.status(400).json({ error: 'Amount and token count are required' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const accessToken = authHeader.replace('Bearer ', '');
    if (!accessToken) {
      return res.status(401).json({ error: 'Invalid authorization header' });
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    
    if (userError || !user) {
      console.error('Auth error:', userError);
      return res.status(401).json({ error: 'Invalid session' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
        userId: user.id,
        tokenCount: tokenCount.toString(),
      },
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return res.status(500).json({ error: 'Error creating payment' });
  }
} 