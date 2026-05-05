import { Redis } from '@upstash/redis';
import { admin } from './firebase-admin.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PLAN_LIMITS = { free: 5, standard: 100, unlimited: null };
const CACHE_TTL = 30 * 24 * 60 * 60;

function repairAndParse(str) {
  try { return JSON.parse(str); } catch(e) {}
  const m = str.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object found in response');
  let s = m[0];
  s = s.replace(/,\s*([\}\]])/g, '$1');
  try { return JSON.parse(s); } catch(e) {}
  s = s.replace(/,?\s*"[^"\\]*"\s*:\s*[^,\}\]]*$/, '');
  s = s.replace(/,\s*([\}\]])/g, '$1');
  const openArr = (s.match(/\[/g)||[]).length - (s.match(/\]/g)||[]).length;
  const openObj = (s.match(/\{/g)||[]).length - (s.match(/\}/g)||[]).length;
  for (let i=0;i<openArr;i++) s += ']';
  for (let i=0;i<openObj;i++) s += '}';
  return JSON.parse(s);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Firebase auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Please sign in to analyze tickers.' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid;
  } catch(e) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  // Check usage limit
  const month = new Date().toISOString().slice(0, 7);
  const [plan, usage] = await Promise.all([
    redis.get(`plan:${uid}`),
    redis.get(`usage:${uid}:${month}`),
  ]);

  const currentPlan = plan || 'free';
  const limit = PLAN_LIMITS[currentPlan];
  const currentUsage = parseInt(usage || '0');

  if (limit !== null && currentUsage >= limit) {
    return res.status(403).json({ error: 'limit_reached', plan: currentPlan, usage: currentUsage, limit });
  }

  const { ticker, ...body } = req.body;
  const cacheKey = ticker ? `ps:${ticker.toUpperCase()}` : null;

  // Check server-side cache
  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        // Still increment usage for cached results
        const usageKey = `usage:${uid}:${month}`;
        await redis.incr(usageKey);
        await redis.expire(usageKey, 60 * 24 * 60 * 60);
        return res.json(cached);
      }
    } catch(e) {
      console.warn('Redis read failed', e);
    }
  }

  // Call Anthropic API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (data.error) return res.status(response.status).json(data);

  const textBlocks = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = textBlocks.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = repairAndParse(clean);
  } catch(e) {
    return res.status(500).json({ error: { message: 'Response was malformed — please try again' } });
  }

  // Cache result and increment usage
  const usageKey = `usage:${uid}:${month}`;
  await Promise.all([
    cacheKey ? redis.set(cacheKey, parsed, { ex: CACHE_TTL }) : Promise.resolve(),
    redis.incr(usageKey),
  ]);
  await redis.expire(usageKey, 60 * 24 * 60 * 60);

  res.json(parsed);
}
