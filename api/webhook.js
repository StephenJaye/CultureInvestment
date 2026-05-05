import Stripe from 'stripe';
import { Redis } from '@upstash/redis';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e) {
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  const subscription = event.data.object;

  if (['customer.subscription.created', 'customer.subscription.updated'].includes(event.type)) {
    const customerId = subscription.customer;
    const priceId = subscription.items.data[0]?.price.id;
    let plan = 'free';
    if (priceId === process.env.STRIPE_PRICE_STANDARD) plan = 'standard';
    if (priceId === process.env.STRIPE_PRICE_UNLIMITED) plan = 'unlimited';
    const uid = await redis.get(`stripe_uid:${customerId}`);
    if (uid) await redis.set(`plan:${uid}`, plan);
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = subscription.customer;
    const uid = await redis.get(`stripe_uid:${customerId}`);
    if (uid) await redis.set(`plan:${uid}`, 'free');
  }

  res.json({ received: true });
}
