import Stripe from 'stripe';
import { admin } from './firebase-admin.js';
import { Redis } from '@upstash/redis';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let uid, email;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email;
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { priceId } = req.body;
  if (!priceId) return res.status(400).json({ error: 'Price ID required' });

  let customerId = await redis.get(`stripe_customer:${uid}`);
  if (!customerId) {
    const customer = await stripe.customers.create({ email, metadata: { uid } });
    customerId = customer.id;
    await redis.set(`stripe_customer:${uid}`, customerId);
    await redis.set(`stripe_uid:${customerId}`, uid);
  }

  const origin = req.headers.origin || 'https://culture-investment.vercel.app';
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${origin}?upgraded=true`,
    cancel_url: `${origin}`,
  });

  res.json({ url: session.url });
}
