import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' });

  try {
    const tasks = await kv.get('tasks') ?? [];

    // Eastern Time date helpers
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const dayName = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
    const displayDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });

    function fmtDate(dateStr) {
      if (!dateStr) return null;
      const d = new Date(dateStr + 'T00:00:00');
      const diff = Math.round((d - new Date(today + 'T00:00:00')) / 86400000);
      if (diff < -1) return `${Math.abs(diff)} days ago`;
      if (diff === -1) return 'yesterday';
      if (diff === 0) return 'today';
      if (diff === 1) return 'tomorrow';
      if (diff < 7) return `in ${diff} days`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // A recurring task whose endDate has passed is treated like paused — it stops
    // surfacing in the digest but isn't deleted (e.g. "Agents Testing" through Jul 31).
    const isExpired = t => t.recurrence !== 'none' && !!t.endDate && t.endDate < today;

    // --- Section 0: Overdue (one-time tasks past their deadline) ---
    const overdue = tasks.filter(t =>
      t.recurrence === 'none' && t.due && t.due < today && t.status !== 'done' && !t.paused
    ).sort((a, b) => a.due.localeCompare(b.due));

    // --- Section 1: Due today (recurring + one-time) ---
    const dueToday = tasks.filter(t => {
      if (t.status === 'done' || t.paused || isExpired(t)) return false;
      if (t.recurrence === 'none') return t.due === today;
      // Recurring: due date is today or overdue (not yet logged today)
      return t.due && t.due <= today;
    });

    // --- Section 2: Open one-time tasks with deadlines ---
    const openOnetime = tasks.filter(t =>
      t.recurrence === 'none' &&
      t.status !== 'done' &&
      !t.paused
    ).sort((a, b) => {
      // Sort: overdue first, then by due date, then no date last
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });

    // --- Section 3: In-progress tasks ---
    const inProgress = tasks.filter(t => t.status === 'in-progress' && !t.paused && !isExpired(t));

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
      text: { type: 'mrkdwn', text: `${greetings[dayName] || 'Good morning, Mildred!'}\n*${displayDate}*` }
    });

    // Section 0 — Overdue
    if (overdue.length > 0) {
      const list = overdue.map(t => `• ${t.name} — _${fmtDate(t.due)}_`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `⚠️ *Overdue — ${overdue.length} task${overdue.length !== 1 ? 's' : ''}*\n${list}` }
      });
      blocks.push({ type: 'divider' });
    }

    // Section 1 — Due today
    if (dueToday.length > 0) {
      // Sort by suggested time where available so the digest reads like an hourly agenda
      const sortedDueToday = [...dueToday].sort((a, b) => {
        if (!a.suggestedTime && !b.suggestedTime) return 0;
        if (!a.suggestedTime) return 1;
        if (!b.suggestedTime) return -1;
        return a.suggestedTime.localeCompare(b.suggestedTime);
      });
      const list = sortedDueToday.map(t => {
        const tag = t.recurrence !== 'none' ? ` _(${t.recurrence})_` : '';
        const time = t.suggestedTime ? ` — 🕐 ${t.suggestedTime}` : '';
        return `• ${t.name}${tag}${time}`;
      }).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `📍 *Due today — ${dueToday.length} task${dueToday.length !== 1 ? 's' : ''}*\n${list}` }
      });
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `📍 *Due today* — nothing scheduled, you're ahead!` }
      });
    }

    blocks.push({ type: 'divider' });

    // Section 2 — Open one-time tasks
    if (openOnetime.length > 0) {
      const list = openOnetime.map(t => {
        if (!t.due) return `• ${t.name} — _no deadline_`;
        const rel = fmtDate(t.due);
        const isOverdue = t.due < today;
        return `• ${t.name} — ${isOverdue ? `⚠️ _${rel}_` : `_${rel}_`}`;
      }).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `📋 *Open tasks — ${openOnetime.length}*\n${list}` }
      });
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `📋 *Open tasks* — all clear! ✨` }
      });
    }

    blocks.push({ type: 'divider' });

    // Section 3 — In progress
    if (inProgress.length > 0) {
      const list = inProgress.map(t => {
        const subs = t.subtasks || [];
        const subNote = subs.length > 0
          ? ` _(${subs.filter(s => s.done).length}/${subs.length} subtasks)_`
          : '';
        return `• ${t.name}${subNote}`;
      }).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `▶️ *In progress — ${inProgress.length}*\n${list}` }
      });
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `▶️ *In progress* — nothing started yet today.` }
      });
    }

    blocks.push({ type: 'divider' });

    // Footer
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
