const express   = require('express');
const { LogoTap } = require('../db');

const router = express.Router();

// ── POST /api/analytics/logo ────────────────────────────────────────────────
// Body: { brand, deviceId, event: 'tap' }
router.post('/logo', async (req, res) => {
  const { brand, deviceId } = req.body || {};
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
    await record.increment('taps');
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

module.exports = router;
