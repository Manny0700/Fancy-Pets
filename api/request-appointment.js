// /api/request-appointment.js
// Vercel serverless function — receives appointment requests from the website
// and emails them to the shop using Resend.
//
// Required env vars (set in Vercel → Settings → Environment Variables):
//   RESEND_API_KEY  — your Resend API key
//
// Destination email is hardcoded below. Update DESTINATION_EMAIL if it changes.

const DESTINATION_EMAIL = 'fancypetsfl@gmail.com';
const FROM_EMAIL = 'Fancy Pets Website <onboarding@resend.dev>';

// Simple per-IP rate limiter (in-memory, resets when function cold-starts).
const recentSubmissions = new Map();
const RATE_LIMIT_MS = 5000; // 5 seconds between submissions per IP

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validate(data) {
  const errors = [];
  const required = ['name', 'phone', 'dogName', 'breed', 'service'];
  for (const field of required) {
    if (!data[field] || String(data[field]).trim().length === 0) {
      errors.push(`Missing: ${field}`);
    }
  }
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v.length > 500) {
      errors.push(`${k} is too long`);
    }
  }
  const validServices = ['Grooming', 'Daycare', 'Boarding', 'Not sure'];
  if (data.service && !validServices.includes(data.service)) {
    errors.push('Invalid service type');
  }
  return errors;
}

function buildEmailHtml(d) {
  const isBoarding = d.service === 'Boarding';
  const addons = Array.isArray(d.addons) ? d.addons : [];

  const rows = [
    ['Name', d.name],
    ['Phone', d.phone],
    ['Dog\'s name', d.dogName],
    ['Breed', d.breed],
    ['Service requested', d.service],
  ];

  if (isBoarding) {
    rows.push(['Check-in date', d.checkIn || '—']);
    rows.push(['Check-out date', d.checkOut || '—']);
  } else {
    rows.push(['Preferred date', d.preferredDate || '—']);
    rows.push(['Time of day', d.timeOfDay || '—']);
  }

  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;width:170px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #eee;color:#1a1612;font-size:15px;">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const addonsHtml = isBoarding && addons.length > 0
    ? `<div style="margin-top:24px;padding:16px 20px;background:#f8f1e2;border-left:3px solid #3d6b3d;">
         <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#3d6b3d;font-weight:600;margin-bottom:8px;">Add-on services requested</div>
         <ul style="margin:0;padding-left:18px;color:#1a1612;font-size:14px;line-height:1.7;">
           ${addons.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
         </ul>
       </div>`
    : '';

  const notesHtml = d.notes && d.notes.trim()
    ? `<div style="margin-top:24px;padding:16px 20px;background:#fdfaf2;border:1px solid #eee;">
         <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#666;font-weight:600;margin-bottom:8px;">Anything else?</div>
         <div style="color:#1a1612;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(d.notes)}</div>
       </div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f4ede0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fdfaf2;border:1px solid #ddd;">
    <div style="padding:24px 28px;background:#1a1612;color:#f4ede0;">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.7;margin-bottom:6px;">New Appointment Request</div>
      <div style="font-size:24px;font-weight:500;letter-spacing:-0.01em;">${escapeHtml(d.dogName)} · ${escapeHtml(d.service)}</div>
    </div>
    <div style="padding:8px 12px;">
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
      ${addonsHtml}
      ${notesHtml}
    </div>
    <div style="padding:16px 28px;background:#ebe1ce;color:#5a4f42;font-size:12px;text-align:center;">
      Submitted ${escapeHtml(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }))} ET
    </div>
  </div>
</body>
</html>`;
}

function buildEmailText(d) {
  const isBoarding = d.service === 'Boarding';
  const lines = [
    `NEW APPOINTMENT REQUEST`,
    `========================`,
    ``,
    `Name:        ${d.name}`,
    `Phone:       ${d.phone}`,
    `Dog's name:  ${d.dogName}`,
    `Breed:       ${d.breed}`,
    `Service:     ${d.service}`,
  ];
  if (isBoarding) {
    lines.push(`Check-in:    ${d.checkIn || '—'}`);
    lines.push(`Check-out:   ${d.checkOut || '—'}`);
    if (Array.isArray(d.addons) && d.addons.length > 0) {
      lines.push(``);
      lines.push(`Add-on services:`);
      d.addons.forEach(a => lines.push(`  - ${a}`));
    }
  } else {
    lines.push(`Preferred:   ${d.preferredDate || '—'} (${d.timeOfDay || '—'})`);
  }
  if (d.notes && d.notes.trim()) {
    lines.push(``);
    lines.push(`Notes:`);
    lines.push(d.notes);
  }
  lines.push(``);
  lines.push(`Submitted ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const lastSubmit = recentSubmissions.get(ip);
  if (lastSubmit && now - lastSubmit < RATE_LIMIT_MS) {
    return res.status(429).json({ error: 'Please wait a moment before submitting again.' });
  }
  recentSubmissions.set(ip, now);

  if (recentSubmissions.size > 1000) {
    for (const [k, t] of recentSubmissions) {
      if (now - t > 60000) recentSubmissions.delete(k);
    }
  }

  const data = req.body || {};

  // Honeypot
  if (data.website && String(data.website).trim().length > 0) {
    return res.status(200).json({ ok: true });
  }

  const errors = validate(data);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Invalid submission', details: errors });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  try {
    const subject = `🐾 New request from ${data.name} · ${data.dogName} (${data.service})`;
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [DESTINATION_EMAIL],
        reply_to: data.email && data.email.includes('@') ? data.email : undefined,
        subject,
        html: buildEmailHtml(data),
        text: buildEmailText(data),
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend error:', resendRes.status, errBody);
      return res.status(502).json({ error: 'Could not send email' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Send failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}