const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const { DataTypes }           = require('sequelize');
const { connect, sequelize }  = require('./db');
const scoreRoutes     = require('./routes/scores');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes     = require('./routes/admin');
const competition     = require('./competition');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim());

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow mobile apps / curl
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`Blocked CORS origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
});

app.use(express.json());
app.use(morgan('dev'));

// Admin routes are same-origin server-rendered pages — no CORS needed.
// API routes are called cross-origin from the client — CORS required.
app.use('/admin', adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', now: new Date().toISOString() });
});

app.get('/api/competition', corsMiddleware, (_req, res) => {
  res.json(competition.getState());
});

app.use('/api/scores',    corsMiddleware, scoreRoutes);
app.use('/api/analytics', corsMiddleware, analyticsRoutes);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 4000;

// Explicitly add new columns to existing tables — safer than alter:true with ENUMs
const runMigrations = async () => {
  const qi = sequelize.getQueryInterface();
  try {
    const cols = await qi.describeTable('scores');
    if (!cols.contact) {
      await qi.addColumn('scores', 'contact', {
        type: DataTypes.STRING(128),
        allowNull: true,
        defaultValue: null,
      });
      console.log('[migration] Added contact column to scores');
    }
    if (!cols.play_count) {
      await qi.addColumn('scores', 'play_count', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      console.log('[migration] Added play_count column to scores');
    }
  } catch (err) {
    // Table doesn't exist yet — sync() will create it with the column already defined
    console.log('[migration] scores table not ready, skipping:', err.message);
  }
};

const start = async () => {
  try {
    await connect();
    const syncOnBoot = process.env.SYNC_ON_BOOT !== 'false';
    if (syncOnBoot) {
      await sequelize.sync();    // creates new tables (logo_taps etc.)
      await runMigrations();     // adds new columns to existing tables
      console.log('Database synced');
    }
    app.listen(port, () => {
      console.log(`Reflex Tile server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
};

start();
