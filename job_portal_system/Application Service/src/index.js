const express  = require('express');
const { Pool } = require('pg');
const jwt      = require('jsonwebtoken');
const amqp     = require('amqplib');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());

// ── Database connection ───────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Connected to apps_db');
    release();
  }
});

// ── RabbitMQ connection ───────────────────────────────────────────────────────
let channel = null;
const EXCHANGE = 'job_portal';

async function connectRabbitMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672');
    channel    = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    console.log('Connected to RabbitMQ');
    conn.on('error', () => {
      channel = null;
      setTimeout(connectRabbitMQ, 5000);
    });
  } catch (err) {
    console.error('RabbitMQ connection failed:', err.message);
    setTimeout(connectRabbitMQ, 5000);
  }
}

// ── Publish event to RabbitMQ ─────────────────────────────────────────────────
function publishEvent(routingKey, payload) {
  if (!channel) {
    console.warn('RabbitMQ not connected:', routingKey);
    return;
  }
  try {
    channel.publish(
      EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true }
    );
    console.log(`Event published: ${routingKey}`);
  } catch (err) {
    console.error('Failed to publish event:', err.message);
  }
}

// ── Middleware: verify JWT token ──────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'application-service',
    rabbitmq: channel ? 'connected' : 'disconnected'
  });
});

// ── POST /applications ────────────────────────────────────────────────────────
app.post('/applications', authMiddleware, async (req, res) => {
  if (req.user.role !== 'seeker')
    return res.status(403).json({ error: 'Only seekers can apply for jobs' });

  const { job_id, cover_letter, job_title, company } = req.body;

  if (!job_id)
    return res.status(400).json({ error: 'job_id is required' });

  try {
    const result = await pool.query(
      `INSERT INTO applications (job_id, seeker_id, cover_letter)
       VALUES ($1,$2,$3) RETURNING *`,
      [job_id, req.user.id, cover_letter || null]
    );

    await pool.query(
      `INSERT INTO application_status_history (application_id, old_status, new_status, changed_by)
       VALUES ($1, NULL, 'pending', $2)`,
      [result.rows[0].id, req.user.id]
    );

    // ── Publish to RabbitMQ — Notification Service will store in-app alert ────
    publishEvent('application.submitted', {
      application_id: result.rows[0].id,
      seeker_id:      req.user.id,       // used by Notification Service to route alert
      job_title,
      company
    });

    res.status(201).json({ message: 'Application submitted', application: result.rows[0] });

  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'You have already applied for this job' });
    console.error('Apply error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /applications ─────────────────────────────────────────────────────────
app.get('/applications', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'seeker') {
      result = await pool.query(
        'SELECT * FROM applications WHERE seeker_id=$1 ORDER BY id DESC',
        [req.user.id]
      );
    } else {
      const { job_id } = req.query;
      if (!job_id)
        return res.status(400).json({ error: 'job_id query param required for employers' });
      result = await pool.query(
        'SELECT * FROM applications WHERE job_id=$1 ORDER BY id DESC',
        [job_id]
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('List applications error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /applications/:id ─────────────────────────────────────────────────────
app.get('/applications/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM applications WHERE id=$1', [req.params.id]
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'Application not found' });
    if (req.user.role === 'seeker' && result.rows[0].seeker_id !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get application error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /applications/:id/status ───────────────────────────────────────────
app.patch('/applications/:id/status', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employer')
    return res.status(403).json({ error: 'Only employers can update application status' });

  const { status, job_title } = req.body;
  const validStatuses = ['pending', 'reviewed', 'accepted', 'rejected'];
  if (!status || !validStatuses.includes(status))
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });

  try {
    const existing = await pool.query(
      'SELECT * FROM applications WHERE id=$1', [req.params.id]
    );
    if (!existing.rows[0])
      return res.status(404).json({ error: 'Application not found' });

    const old_status = existing.rows[0].status;

    const result = await pool.query(
      `UPDATE applications SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );

    await pool.query(
      `INSERT INTO application_status_history (application_id, old_status, new_status, changed_by)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, old_status, status, req.user.id]
    );

    // ── Publish to RabbitMQ — routes alert to the seeker ─────────────────────
    publishEvent('application.updated', {
      application_id: req.params.id,
      seeker_id:      existing.rows[0].seeker_id,  // route to correct seeker
      job_title,
      new_status:     status
    });

    res.json({ message: 'Status updated', application: result.rows[0] });

  } catch (err) {
    console.error('Update status error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /applications/:id/history ────────────────────────────────────────────
app.get('/applications/:id/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM application_status_history WHERE application_id=$1 ORDER BY id ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
connectRabbitMQ();
app.listen(PORT, () => {
  console.log(`[application-service] running on port ${PORT}`);
});