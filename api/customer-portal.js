import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { admin } from './firebase-admin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid;
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const customerId = await redis.get(`stripe_customer:${uid}`);
  if (!customerId) return res.status(404).json({ error: 'No billing account found.' });

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${req.headers.origin || 'https://culture-investment.vercel.app'}`,
  });

  res.json({ url: session.url });
}
