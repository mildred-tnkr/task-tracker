import { kv } from '@vercel/kv';

// Hourly Slack "time check" ping — a lighter companion to the 10am /api/notify digest.
//
// Why this exists: Vercel's Hobby plan only allows cron jobs to run once per day, and
// even then the invocation can land anywhere within the scheduled hour (not the exact
// minute). So instead of trying (and failing) to hit exact minutes, this groups tasks
// into hourly buckets and sends one short nudge per hour that actually has something
// due — e.g. an "11am" bucket covers the 11:00/11:15/11:30/11:45 morning tasks.
//
// DST handling: vercel.json schedules THIS endpoint twice per target hour — once at
// the UTC offset for Eastern Daylight Time and once for Eastern Standard Time — always
// passing the same `h` (intended ET hour) query param. Whichever invocation actually
// lands during that ET hour passes the check below and sends; the other silently
// no-ops. That means no manual schedule updates when the clocks change in March/November.
export default async function handler(req, res) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' });

  const targetHour = parseInt(req.query?.h, 10);
  if (Number.isNaN(targetHour)) return res.status(400).json({ error: 'Missing/invalid ?h= target hour (0-23, ET)' });

  try {
    const settings = await kv.get('settings') ?? {};
    if (settings.notificationsPaused) {
      return res.status(200).json({ ok: true, sent: false, reason: 'notifications paused' });
    }

    const tasks = await kv.get('tasks') ?? [];

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const nowHour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }),
      10
    );

    // Wrong-season invocation (the DST twin of the correct one) — no-op quietly.
    if (nowHour !== targetHour) {
      return res.status(200).json({ ok: true, sent: false, reason: 'not the target ET hour', nowHour, targetHour });
    }

    const isExpired = t => t.recurrence !== 'none' && !!t.endDate && t.endDate < todayStr;

    const dueNow = tasks.filter(t => {
      if (t.status === 'done' || t.paused || isExpired(t)) return false;
      if (!t.pingTime) return false;
      const pingHour = parseInt(t.pingTime.split(':')[0], 10);
      if (pingHour !== targetHour) return false;
      if (t.recurrence === 'none') return t.due === todayStr;
      return t.due && t.due <= todayStr; // recurring, due today or stale (not yet logged)
    });

    if (dueNow.length === 0) {
      return res.status(200).json({ ok: true, sent: false, reason: 'nothing due this hour' });
    }

    const hourLabel = new Date(`2000-01-01T${String(targetHour).padStart(2, '0')}:00:00`)
      .toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });

    const list = dueNow
      .sort((a, b) => (a.pingTime || '').localeCompare(b.pingTime || ''))
      .map(t => `• *${t.name}*${t.suggestedTime ? ` — ${t.suggestedTime}` : ''}`)
      .join('\n');

    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Time check — ${hourLabel}`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `🕐 *Around ${hourLabel} ET*\n${list}` }
        }]
      })
    });

    if (!slackRes.ok) {
      const err = await slackRes.text();
      return res.status(500).json({ error: 'Slack webhook failed', detail: err });
    }

    return res.status(200).json({ ok: true, sent: true, count: dueNow.length, hour: targetHour });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
