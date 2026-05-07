const express  = require('express');
const { Pool } = require('pg');
const jwt      = require('jsonwebtoken');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// ── Database connection ───────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Connected to jobs_db');
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
  res.json({ status: 'ok', service: 'job-service' });
});

// ── POST /jobs — create a job posting (employers only) ───────────────────────
app.post('/jobs', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employer')
    return res.status(403).json({ error: 'Only employers can post jobs' });

  const { title, description, company, location, job_type, salary_min, salary_max, skills } = req.body;

  if (!title || !description || !company || !location || !job_type)
    return res.status(400).json({ error: 'title, description, company, location, job_type are required' });

  try {
    const result = await pool.query(
      `INSERT INTO jobs (employer_id, title, description, company, location, job_type, salary_min, salary_max, skills)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, title, description, company, location, job_type, salary_min || null, salary_max || null, skills || null]
    );
    res.status(201).json({ message: 'Job posted successfully', job: result.rows[0] });
  } catch (err) {
    console.error('Post job error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /jobs — list all open jobs (with optional filters) ───────────────────
app.get('/jobs', async (req, res) => {
  const { location, job_type, search } = req.query;
  let query  = `SELECT * FROM jobs WHERE status='open'`;
  const params = [];

  if (location) { params.push(location);        query += ` AND location=$${params.length}`; }
  if (job_type) { params.push(job_type);         query += ` AND job_type=$${params.length}`; }
  if (search)   { params.push(`%${search}%`);   query += ` AND title ILIKE $${params.length}`; }

  query += ' ORDER BY id DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List jobs error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /jobs/:id — get a single job ─────────────────────────────────────────
app.get('/jobs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!result.rows[0])
      return res.status(404).json({ error: 'Job not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get job error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /jobs/:id — update a job (owner employer only) ───────────────────────
app.put('/jobs/:id', authMiddleware, async (req, res) => {
  const { title, description, location, job_type, salary_min, salary_max, skills, status } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
      return res.status(404).json({ error: 'Job not found' });
    if (existing.rows[0].employer_id !== req.user.id)
      return res.status(403).json({ error: 'You can only update your own job postings' });

    const result = await pool.query(
      `UPDATE jobs SET
        title=$1, description=$2, location=$3, job_type=$4,
        salary_min=$5, salary_max=$6, skills=$7, status=$8
       WHERE id=$9 RETURNING *`,
      [
        title       || existing.rows[0].title,
        description || existing.rows[0].description,
        location    || existing.rows[0].location,
        job_type    || existing.rows[0].job_type,
        salary_min  || existing.rows[0].salary_min,
        salary_max  || existing.rows[0].salary_max,
        skills      || existing.rows[0].skills,
        status      || existing.rows[0].status,
        req.params.id
      ]
    );
    res.json({ message: 'Job updated', job: result.rows[0] });
  } catch (err) {
    console.error('Update job error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /jobs/:id — delete a job (owner employer only) ────────────────────
app.delete('/jobs/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
      return res.status(404).json({ error: 'Job not found' });
    if (existing.rows[0].employer_id !== req.user.id)
      return res.status(403).json({ error: 'You can only delete your own job postings' });

    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Job deleted successfully' });
  } catch (err) {
    console.error('Delete job error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[job-service] running on port ${PORT}`);
});
