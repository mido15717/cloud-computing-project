const express   = require('express');
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// ── Database connection ───────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Test DB connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to users_db');
    release();
  }
});

// ── Middleware: verify JWT token ──────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1]; // Bearer <token>
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-management-service' });
});

// ── POST /auth/register ───────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body;

  // Basic validation
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: 'name, email, password, role are required' });

  if (!['seeker', 'employer'].includes(role))
    return res.status(400).json({ error: 'role must be seeker or employer' });

  try {
    // Check email not already taken
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role',
      [name, email, hash, role]
    );

    res.status(201).json({ message: 'User registered successfully', user: result.rows[0] });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user   = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ message: 'Login successful', token, role: user.role, id: user.id });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /profile/:id ──────────────────────────────────────────────────────────
app.get('/profile/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id=$1',
      [req.params.id]
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'User not found' });

    res.json(result.rows[0]);

  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /profile/:id ──────────────────────────────────────────────────────────
app.put('/profile/:id', authMiddleware, async (req, res) => {
  // Users can only update their own profile
  if (parseInt(req.params.id) !== req.user.id)
    return res.status(403).json({ error: 'You can only update your own profile' });

  const { name } = req.body;
  if (!name)
    return res.status(400).json({ error: 'name is required' });

  try {
    const result = await pool.query(
      'UPDATE users SET name=$1 WHERE id=$2 RETURNING id, name, email, role',
      [name, req.params.id]
    );
    res.json({ message: 'Profile updated', user: result.rows[0] });

  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /users ────────────────────────────────────────────────────────────────
// Internal endpoint — used by other services to look up users
app.get('/users', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, role FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error('Users list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`[user-management-service] running on port ${PORT}`);
});

// ── Install kubectl ───────────────────────────────────────────────────────────
// curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
// sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
// kubectl version --client
// curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
// sudo install minikube-linux-amd64 /usr/local/bin/minikube
// minikube version