import { kv } from '@vercel/kv';

// Small shared settings blob — currently just the Slack notifications on/off switch.
// Read by notify.js and ping.js before they send anything; written by the app's
// "🔕 Pause notifications" toggle.
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
    const data = await kv.get('settings') ?? { notificationsPaused: false };
    return res.json(data);
  }

  if (req.method === 'POST') {
    const current = await kv.get('settings') ?? {};
    const updated = { ...current, ...req.body };
    await kv.set('settings', updated);
    return res.json({ ok: true, settings: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
