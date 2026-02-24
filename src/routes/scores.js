const express = require('express');
const { Op }   = require('sequelize');
const { Score } = require('../db');

const router = express.Router();

// ── Simple in-memory rate limiter: max 1 submission per device per 5s ────────
const lastSubmit = new Map();
const RATE_LIMIT_MS = 5_000;
function isRateLimited(deviceId) {
  const now  = Date.now();
  const last = lastSubmit.get(deviceId) || 0;
  if (now - last < RATE_LIMIT_MS) return true;
  lastSubmit.set(deviceId, now);
  // Prune old entries every 500 submissions
  if (lastSubmit.size > 500) {
    const cutoff = now - 60_000;
    for (const [k, v] of lastSubmit) { if (v < cutoff) lastSubmit.delete(k); }
  }
  return false;
}

// ── GET /api/scores ────────────────────────────────────────────────────────
// Query params:
//   mode   = 'solo' | 'versus'         (optional filter)
//   period = 'week'                    (optional — last 7 days by updatedAt)
//   limit  = number  default 500       (max 1000)
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const { mode, period } = req.query;
    const where = {};

    if (mode && ['solo', 'versus'].includes(mode)) {
      where.mode = mode;
    }

    if (period === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      where.updatedAt = { [Op.gte]: weekAgo };
    }

    const scores = await Score.findAll({
      where,
      order: [
        ['score',      'DESC'],
        ['created_at', 'ASC'],
      ],
      limit,
    });

    res.json(scores);
  } catch (err) {
    console.error('Failed to list scores', err);
    res.status(500).json({ error: 'Failed to load scores' });
  }
});

// ── GET /api/scores/recent ─────────────────────────────────────────────────
router.get('/recent', async (_req, res) => {
  try {
    const scores = await Score.findAll({
      order: [['created_at', 'DESC']],
      limit: 20,
    });
    res.json(scores);
  } catch (err) {
    console.error('Failed to list recent scores', err);
    res.status(500).json({ error: 'Failed to load scores' });
  }
});

// ── POST /api/scores ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { playerName, score, mode, deviceId, contact } = req.body || {};
  try {
    if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
      return res.status(400).json({ error: 'playerName is required' });
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    if (typeof score !== 'number' || Number.isNaN(score) || score < 0) {
      return res.status(400).json({ error: 'score must be a positive number' });
    }
    // Anti-cheat: reject impossibly high scores
    if (score > 9999) {
      console.warn(`[anti-cheat] Rejected score ${score} from device ${String(deviceId).slice(0, 8)}`);
      return res.status(400).json({ error: 'score_invalid' });
    }

    const normalizedName    = playerName.trim().slice(0, 32);
    const normalizedMode    = mode === 'versus' ? 'versus' : 'solo';
    const id                = deviceId.trim().slice(0, 64);
    const normalizedContact = contact ? String(contact).trim().slice(0, 128) : null;

    if (isRateLimited(id)) {
      return res.status(429).json({ error: 'Too many requests — wait a moment.' });
    }

    // Check if this name is already claimed by a different device
    const taken = await Score.findOne({ where: { playerName: normalizedName } });
    if (taken && taken.deviceId !== id) {
      return res.status(409).json({ error: 'name_taken' });
    }

    const existing = await Score.findOne({ where: { deviceId: id, mode: normalizedMode } });

    if (existing) {
      const newHigh = Math.max(existing.score, Math.round(score));
      const updated = await existing.update({
        score: newHigh,
        playerName: normalizedName,
        ...(normalizedContact !== null && { contact: normalizedContact }),
      });
      return res.json(updated);
    }

    const created = await Score.create({
      deviceId:   id,
      playerName: normalizedName,
      score:      Math.round(score),
      mode:       normalizedMode,
      contact:    normalizedContact,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to store score', err);
    res.status(500).json({ error: 'Failed to store score' });
  }
});

module.exports = router;
