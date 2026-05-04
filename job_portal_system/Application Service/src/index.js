const express  = require('express');
const { Pool } = require('pg');
const jwt      = require('jsonwebtoken');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());

// ── Database connection ───────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to apps_db');
    release();
  }
});

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
  res.json({ status: 'ok', service: 'application-service' });
});

// ── POST /applications — submit a job application (seekers only) ──────────────
app.post('/applications', authMiddleware, async (req, res) => {
  if (req.user.role !== 'seeker')
    return res.status(403).json({ error: 'Only seekers can apply for jobs' });

  const { job_id, cover_letter } = req.body;

  if (!job_id)
    return res.status(400).json({ error: 'job_id is required' });

  try {
    // fixed: no timestamps in schema so no updated_at in INSERT
    const result = await pool.query(
      `INSERT INTO applications (job_id, seeker_id, cover_letter)
       VALUES ($1,$2,$3) RETURNING *`,
      [job_id, req.user.id, cover_letter || null]
    );

    // Log initial status in history
    await pool.query(
      `INSERT INTO application_status_history (application_id, old_status, new_status, changed_by)
       VALUES ($1, NULL, 'pending', $2)`,
      [result.rows[0].id, req.user.id]
    );

    res.status(201).json({ message: 'Application submitted', application: result.rows[0] });

  } catch (err) {
    // Handle duplicate application
    if (err.code === '23505')
      return res.status(409).json({ error: 'You have already applied for this job' });
    console.error('Apply error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /applications — get all applications (filtered by role) ───────────────
app.get('/applications', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'seeker') {
      // Seekers see only their own applications
      result = await pool.query(
        'SELECT * FROM applications WHERE seeker_id=$1 ORDER BY id DESC',
        [req.user.id]
      );
    } else {
      // Employers see applications for a specific job
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

// ── GET /applications/:id — get a single application ─────────────────────────
app.get('/applications/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM applications WHERE id=$1',
      [req.params.id]
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'Application not found' });

    // Seekers can only view their own
    if (req.user.role === 'seeker' && result.rows[0].seeker_id !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get application error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /applications/:id/status — update status (employers only) ───────────
app.patch('/applications/:id/status', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employer')
    return res.status(403).json({ error: 'Only employers can update application status' });

  const { status } = req.body;
  const validStatuses = ['pending', 'reviewed', 'accepted', 'rejected'];
  if (!status || !validStatuses.includes(status))
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });

  try {
    const existing = await pool.query(
      'SELECT * FROM applications WHERE id=$1',
      [req.params.id]
    );
    if (!existing.rows[0])
      return res.status(404).json({ error: 'Application not found' });

    const old_status = existing.rows[0].status;

    // fixed: no updated_at column in schema
    const result = await pool.query(
      `UPDATE applications SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );

    // Log status change in history
    await pool.query(
      `INSERT INTO application_status_history (application_id, old_status, new_status, changed_by)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, old_status, status, req.user.id]
    );

    res.json({ message: 'Status updated', application: result.rows[0] });

  } catch (err) {
    console.error('Update status error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /applications/:id/history — get status history ───────────────────────
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

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[application-service] running on port ${PORT}`);
});
