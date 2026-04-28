import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ticker, ...body } = req.body;
  const cacheKey = ticker ? `ps:${ticker.toUpperCase()}` : null;

  // Check server-side cache
  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(cached);
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
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (data.error) {
    return res.status(response.status).json(data);
  }

  // Parse ticker data from response text blocks
  const textBlocks = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = textBlocks.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = repairAndParse(clean);
  } catch(e) {
    return res.status(500).json({ error: { message: 'Response was malformed — please try again' } });
  }

  // Store in Redis with 30-day TTL
  if (cacheKey) {
    try {
      await redis.set(cacheKey, parsed, { ex: CACHE_TTL });
    } catch(e) {
      console.warn('Redis write failed', e);
    }
  }

  res.json(parsed);
}
