// ── Competition state ─────────────────────────────────────────────────────────
// Persisted to competition.json so it survives server restarts.
// Default: open = true (scores accepted). Admin can close/reopen via /admin.

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'competition.json');
const DEFAULTS   = { open: true, startedAt: null, endedAt: null };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (err) { console.error('[competition] Failed to save state:', err.message); }
}

let _state = load();

module.exports = {
  getState : () => ({ ..._state }),
  open() {
    _state = { open: true,  startedAt: Date.now(),     endedAt: null };
    save(_state);
    console.log('[competition] Opened');
  },
  close() {
    _state = { open: false, startedAt: _state.startedAt, endedAt: Date.now() };
    save(_state);
    console.log('[competition] Closed');
  },
};
