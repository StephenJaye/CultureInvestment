import { admin } from './firebase-admin.js';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid;
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const month = new Date().toISOString().slice(0, 7);
  const [plan, usage] = await Promise.all([
    redis.get(`plan:${uid}`),
    redis.get(`usage:${uid}:${month}`),
  ]);

  const currentPlan = plan || 'free';
  const limits = { free: 5, standard: 100, unlimited: null };

  res.json({
    plan: currentPlan,
    usage: parseInt(usage || '0'),
    limit: limits[currentPlan],
  });
}
