import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tasks-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-tasks-secret'];
  if (!process.env.TASKS_SECRET || secret !== process.env.TASKS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const data = await kv.get('calendar_today') ?? { events: [], date: null };
    return res.json(data);
  }

  if (req.method === 'POST') {
    await kv.set('calendar_today', req.body);
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
