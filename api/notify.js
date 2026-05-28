import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Allow Vercel cron calls (GET) or manual triggers with secret
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' });

  try {
    // Fetch tasks from KV
    const tasks = await kv.get('tasks') ?? [];

    // Today's date in Eastern Time
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const dayName = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
    const displayDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });

    // Categorize tasks
    const overdue = tasks.filter(t =>
      t.recurrence === 'none' && t.due && t.due < today && t.status !== 'done'
    );
    const dueToday = tasks.filter(t =>
      t.recurrence === 'none' && t.due && t.due === today && t.status !== 'done'
    );
    const inProgress = tasks.filter(t => t.status === 'in-progress' && !t.paused);
    const recurringDue = tasks.filter(t =>
      t.recurrence !== 'none' && !t.paused && t.due && t.due <= today && t.status !== 'done'
    );

    // Day-based greeting
    const greetings = {
      Monday:    "Happy Monday, Mildred! 🚀 New week, let's make it count.",
      Tuesday:   "Good morning, Mildred! 👋 Let's have a solid Tuesday.",
      Wednesday: "Midweek check-in, Mildred! 💪 You're halfway through.",
      Thursday:  "Morning, Mildred! 🎯 One push to get to Friday.",
      Friday:    "Happy Friday, Mildred! 🎉 Let's close the week strong."
    };

    let blocks = [];

    // Header
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${greetings[dayName] || 'Good morning, Mildred!'}\n*${displayDate}*`
      }
    });

    blocks.push({ type: 'divider' });

    // Overdue
    if (overdue.length > 0) {
      const list = overdue.slice(0, 3).map(t => `• ${t.name}`).join('\n');
      const extra = overdue.length > 3 ? `\n_+${overdue.length - 3} more_` : '';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `⚠️ *Overdue (${overdue.length})*\n${list}${extra}` }
      });
    }

    // Due today
    if (dueToday.length > 0) {
      const list = dueToday.map(t => `• ${t.name}`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `📍 *Due today (${dueToday.length})*\n${list}` }
      });
    }

    // In progress
    if (inProgress.length > 0) {
      const list = inProgress.slice(0, 3).map(t => `• ${t.name}`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `▶️ *In progress*\n${list}` }
      });
    }

    // Recurring due
    if (recurringDue.length > 0) {
      const list = recurringDue.slice(0, 3).map(t => `• ${t.name} _(${t.recurrence})_`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `🔁 *Recurring tasks up today*\n${list}` }
      });
    }

    // All clear
    if (overdue.length === 0 && dueToday.length === 0 && recurringDue.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `✨ *Nothing urgent today* — great time to get ahead or tackle something from your backlog.` }
      });
    } else {
      // Priority question
      const hasMeetings = false; // no calendar access in cron — kept simple
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `💬 *What's your #1 priority this morning?*` }
      });
    }

    blocks.push({ type: 'divider' });

    // Footer with link
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🔗 <https://task-tracker-e4xp.vercel.app|Open Task Tracker>` }
    });

    // Send to Slack
    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks, text: `Daily check-in — ${displayDate}` })
    });

    if (!slackRes.ok) {
      const err = await slackRes.text();
      return res.status(500).json({ error: 'Slack webhook failed', detail: err });
    }

    return res.status(200).json({ ok: true, sent: true, date: today });

  } catch (e) {
    // Fallback: send a plain message if something goes wrong
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Good morning, Mildred! 👋 Check your tasks for the day: https://task-tracker-e4xp.vercel.app`
        })
      });
    } catch (_) {}
    return res.status(500).json({ error: e.message });
  }
}
