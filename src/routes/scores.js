const express  = require('express');
const crypto   = require('crypto');
const { Op }   = require('sequelize');
const { Score } = require('../db');

const router = express.Router();

// ── Simple in-memory rate limiter: max 1 submission per device per 5s ────────
const lastSubmit = new Map();
const RATE_LIMIT_MS = 25_000; // min real game duration ≈ 28s
function isRateLimited(deviceId) {
  const now  = Date.now();
  const last = lastSubmit.get(deviceId) || 0;
  if (now - last < RATE_LIMIT_MS) return true;
  lastSubmit.set(deviceId, now);
  // Prune old entries every 500 submissions
  if (lastSubmit.size > 500) {
    const cutoff = now - RATE_LIMIT_MS - 5_000;
    for (const [k, v] of lastSubmit) { if (v < cutoff) lastSubmit.delete(k); }
  }
  return false;
}

// ── Game session store ───────────────────────────────────────────────────────
// A session token is minted server-side when each game starts and consumed
// (single-use) when the score is submitted. This prevents:
//   • Forged scores injected directly into the API
//   • Scores injected into the localStorage offline queue
//   • Replaying old submissions
const SESSION_TTL   = 30 * 60 * 1000; // 30 min — covers offline queue drain window
const SESSION_GRACE =  2 * 60 * 1000; //  2 min — idempotent-retry window after use

const sessionStore = new Map(); // sessionId → { deviceId, issuedAt, usedAt }

// Prune expired sessions every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL - SESSION_GRACE;
  for (const [id, s] of sessionStore) {
    if (s.issuedAt < cutoff) sessionStore.delete(id);
  }
}, 10 * 60 * 1000);

// ── POST /api/scores/session ───────────────────────────────────────────────
// Called by the client at game-start. Returns a one-time session token.
router.post('/session', (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ error: 'deviceId required' });
  }
  const id        = deviceId.trim().slice(0, 64);
  const sessionId = crypto.randomBytes(16).toString('hex');
  sessionStore.set(sessionId, { deviceId: id, issuedAt: Date.now(), usedAt: null });
  res.json({ sessionId });
});

// ── GET /api/scores ────────────────────────────────────────────────────────
// Query params:
//   mode   = 'solo' | 'versus'         (optional filter)
//   period = 'week'                    (optional — last 7 days by updatedAt)
//   limit  = number  default 500       (max 1000)
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const { mode, period } = req.query;
    const where = { score: { [Op.gt]: 0 } };

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

// ── POST /api/scores/register ──────────────────────────────────────────────
// Registers a player immediately on name entry (score = 0 placeholder).
// Called before a game is played so the admin sees all sign-ups in the DB.
router.post('/register', async (req, res) => {
  const { playerName, deviceId, contact } = req.body || {};
  try {
    if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
      return res.status(400).json({ error: 'playerName is required' });
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const normalizedName    = playerName.trim().slice(0, 32);
    const id                = deviceId.trim().slice(0, 64);
    const normalizedContact = contact ? String(contact).trim().slice(0, 128) : null;

    // Check if the name is already taken by a different device
    const taken = await Score.findOne({ where: { playerName: normalizedName } });
    if (taken && taken.deviceId !== id) {
      return res.status(409).json({ error: 'name_taken' });
    }

    // Check if the contact is already used by a different device
    if (normalizedContact) {
      const contactTaken = await Score.findOne({ where: { contact: normalizedContact } });
      if (contactTaken && contactTaken.deviceId !== id) {
        return res.status(409).json({ error: 'contact_taken' });
      }
    }

    // Update any existing record for this device, or create a placeholder
    const existing = await Score.findOne({ where: { deviceId: id } });
    if (existing) {
      const updates = { playerName: normalizedName };
      if (normalizedContact !== null) updates.contact = normalizedContact;
      const updated = await existing.update(updates);
      return res.json(updated);
    }

    const created = await Score.create({
      deviceId:   id,
      playerName: normalizedName,
      score:      0,
      mode:       'solo',
      contact:    normalizedContact,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to register player', err);
    res.status(500).json({ error: 'Failed to register player' });
  }
});

// ── POST /api/scores ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { playerName, score, mode, deviceId, contact, sessionId } = req.body || {};
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

    // ── Session token validation ───────────────────────────────────────────
    // Every legitimate score comes with a server-issued one-time token.
    if (!sessionId || typeof sessionId !== 'string') {
      console.warn(`[security] Score rejected — no session token from device ${id.slice(0, 8)}`);
      return res.status(403).json({ error: 'session_required' });
    }
    const session = sessionStore.get(sessionId);
    if (!session) {
      console.warn(`[security] Score rejected — unknown session from device ${id.slice(0, 8)}`);
      return res.status(403).json({ error: 'session_invalid' });
    }
    if (session.deviceId !== id) {
      console.warn(`[security] Score rejected — session device mismatch (${id.slice(0, 8)})`);
      return res.status(403).json({ error: 'session_device_mismatch' });
    }
    const now = Date.now();
    if (now - session.issuedAt > SESSION_TTL) {
      sessionStore.delete(sessionId);
      return res.status(403).json({ error: 'session_expired' });
    }
    if (session.usedAt) {
      // Grace period: if the same device retries within 2 min (e.g. response was lost),
      // return the current DB record so the client considers it done.
      if (now - session.usedAt < SESSION_GRACE) {
        const existing = await Score.findOne({ where: { deviceId: id } });
        return existing ? res.json(existing) : res.json({ ok: true, reused: true });
      }
      return res.status(403).json({ error: 'session_used' });
    }
    // ─────────────────────────────────────────────────────────────────────

    if (isRateLimited(id)) {
      return res.status(429).json({ error: 'Too many requests — wait a moment.' });
    }
    // Consume the session (single-use) — done after rate-limit check so a
    // rate-limited rejection does not burn the token.
    session.usedAt = now;
    sessionStore.set(sessionId, session);

    // Check if this name is already claimed by a different device
    const taken = await Score.findOne({ where: { playerName: normalizedName } });
    if (taken && taken.deviceId !== id) {
      return res.status(409).json({ error: 'name_taken' });
    }

    // Check if the contact is already used by a different device
    if (normalizedContact) {
      const contactTaken = await Score.findOne({ where: { contact: normalizedContact } });
      if (contactTaken && contactTaken.deviceId !== id) {
        return res.status(409).json({ error: 'contact_taken' });
      }
    }

    const existing = await Score.findOne({ where: { deviceId: id, mode: normalizedMode } });

    if (existing) {
      const newHigh = Math.max(existing.score, Math.round(score));
      const updated = await existing.update({
        score:      newHigh,
        playerName: normalizedName,
        playCount:  (existing.playCount || 0) + 1,
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
      playCount:  1,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('Failed to store score', err);
    res.status(500).json({ error: 'Failed to store score' });
  }
});

module.exports = router;
