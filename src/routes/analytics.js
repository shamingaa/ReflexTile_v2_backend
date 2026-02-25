const express   = require('express');
const { LogoTap, sequelize } = require('../db');

const router = express.Router();

// ── POST /api/analytics/logo ────────────────────────────────────────────────
// Body: { brand, deviceId, taps: N }   — idempotent: sets to MAX(existing, N)
// Legacy body: { brand, deviceId, event: 'tap' } — still increments by 1
router.post('/logo', async (req, res) => {
  const { brand, deviceId, taps } = req.body || {};
  if (!brand || typeof brand !== 'string') {
    return res.status(400).json({ error: 'brand is required' });
  }
  const normalizedBrand    = brand.trim().slice(0, 32);
  const normalizedDeviceId = (deviceId || 'unknown').trim().slice(0, 64);
  try {
    const [record] = await LogoTap.findOrCreate({
      where:    { brand: normalizedBrand, deviceId: normalizedDeviceId },
      defaults: { taps: 0 },
    });
    if (typeof taps === 'number' && taps > 0) {
      // Idempotent upsert: safe to retry — won't double-count
      if (record.taps < taps) await record.update({ taps });
    } else {
      // Legacy increment (backward compat)
      await record.increment('taps');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to log tap', err);
    res.status(500).json({ error: 'Failed to log tap' });
  }
});

// ── GET /api/analytics/logo ─────────────────────────────────────────────────
// Returns total taps per brand across all devices
router.get('/logo', async (_req, res) => {
  try {
    const rows = await LogoTap.findAll();
    const totals = {};
    rows.forEach((r) => {
      totals[r.brand] = (totals[r.brand] || 0) + r.taps;
    });
    res.json(totals);
  } catch (err) {
    console.error('Failed to get taps', err);
    res.status(500).json({ error: 'Failed to get taps' });
  }
});

// ── GET /api/analytics/logo/leaderboard ─────────────────────────────────────
// Returns top 20 players ranked by total sponsor tile taps
router.get('/logo/leaderboard', async (_req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        MAX(s.player_name)                                                   AS playerName,
        SUM(lt.taps)                                                         AS totalTaps,
        SUM(CASE WHEN lt.brand = 'Tuberway' THEN lt.taps ELSE 0 END)        AS tuberwayTaps,
        SUM(CASE WHEN lt.brand = '1Percent' THEN lt.taps ELSE 0 END)        AS percentTaps
      FROM logo_taps lt
      INNER JOIN scores s ON lt.device_id = s.device_id
      GROUP BY lt.device_id
      ORDER BY totalTaps DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    console.error('Failed to load tap leaderboard', err);
    res.status(500).json({ error: 'Failed to load tap leaderboard' });
  }
});

module.exports = router;
