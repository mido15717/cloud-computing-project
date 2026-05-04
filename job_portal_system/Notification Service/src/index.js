const express    = require('express');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3004;  

app.use(express.json());

// ── Email transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

// ── POST /notify/application-submitted ───────────────────────────────────────
// Called by Application Service when a new application is submitted
app.post('/notify/application-submitted', async (req, res) => {
  const { seeker_name, seeker_email, job_title, company } = req.body;

  if (!seeker_email || !job_title)
    return res.status(400).json({ error: 'seeker_email and job_title are required' });

  try {
    await transporter.sendMail({
      from: `"Job Portal" <${process.env.SMTP_USER}>`,
      to: seeker_email,
      subject: `Application received — ${job_title}`,
      text: `Hi ${seeker_name},\n\nYour application for "${job_title}" at ${company} has been received.\n\nWe will get back to you soon.\n\nJob Portal Team`
    });

    console.log(`Sent application confirmation to ${seeker_email}`);
    res.json({ message: 'Notification sent successfully' });

  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ── POST /notify/status-updated ───────────────────────────────────────────────
// Called by Application Service when application status changes
app.post('/notify/status-updated', async (req, res) => {
  const { seeker_name, seeker_email, job_title, new_status } = req.body;

  if (!seeker_email || !job_title || !new_status)
    return res.status(400).json({ error: 'seeker_email, job_title, new_status are required' });

  const statusMessages = {
    reviewed: 'Your application is being reviewed.',
    accepted: ' Congratulations! Your application has been accepted.',
    rejected: 'Unfortunately your application was not selected this time.'
  };

  try {
    await transporter.sendMail({
      from: `"Job Portal" <${process.env.SMTP_USER}>`,
      to: seeker_email,
      subject: `Application update — ${job_title}`,
      text: `Hi ${seeker_name},\n\n${statusMessages[new_status] || `Your application status is now: ${new_status}`}\n\nJob: ${job_title}\n\nJob Portal Team`
    });

    console.log(`Sent status update to ${seeker_email} — ${new_status}`);
    res.json({ message: 'Notification sent successfully' });

  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[notification-service] running on port ${PORT}`);
});
