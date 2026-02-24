const express  = require('express');
const { Score, LogoTap } = require('../db');

const router = express.Router();

// ── Basic auth ────────────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASS || 'admin123';
  const header    = req.headers.authorization || '';

  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Arcade Arena Admin"');
    return res.status(401).send('Authentication required');
  }

  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  if (user !== validUser || pass !== validPass) {
    res.set('WWW-Authenticate', 'Basic realm="Arcade Arena Admin"');
    return res.status(401).send('Invalid credentials');
  }
  next();
});

// ── GET /admin ─────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const players = await Score.findAll({ order: [['score', 'DESC']] });
    const tapRows = await LogoTap.findAll();

    const tapTotals = {};
    tapRows.forEach((r) => { tapTotals[r.brand] = (tapTotals[r.brand] || 0) + r.taps; });

    const totalPlayers      = players.length;
    const withContact       = players.filter((p) => p.contact).length;
    const avgScore          = totalPlayers > 0
      ? Math.round(players.reduce((s, p) => s + p.score, 0) / totalPlayers) : 0;
    const topScore          = players[0]?.score ?? 0;
    const totalTaps         = Object.values(tapTotals).reduce((s, v) => s + v, 0);

    res.send(html({ players, tapTotals, totalPlayers, withContact, avgScore, topScore, totalTaps }));
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
});

// ── GET /admin/export ─────────────────────────────────────────────────────
router.get('/export', async (_req, res) => {
  try {
    const players = await Score.findAll({ order: [['score', 'DESC']] });
    const rows = [
      ['Rank', 'Player', 'Score', 'Contact', 'Mode', 'Device ID', 'Joined'].join(','),
      ...players.map((p, i) => [
        i + 1,
        `"${p.playerName}"`,
        p.score,
        `"${p.contact || ''}"`,
        p.mode,
        `"${p.deviceId}"`,
        `"${new Date(p.createdAt).toISOString()}"`,
      ].join(',')),
    ];
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="arcade-arena-players.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    res.status(500).send('Export failed: ' + err.message);
  }
});

// ── HTML template ─────────────────────────────────────────────────────────
function html({ players, tapTotals, totalPlayers, withContact, avgScore, topScore, totalTaps }) {
  const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;

  const rows = players.map((p, i) => `
    <tr class="${p.contact ? 'has-contact' : ''} ${i < 3 ? 'top3' : ''}">
      <td class="rank">${medal(i)}</td>
      <td class="name">${esc(p.playerName)}</td>
      <td class="score">${p.score.toLocaleString()}</td>
      <td class="contact">${p.contact ? `<span class="contact-tag">${esc(p.contact)}</span>` : '<span class="no-contact">—</span>'}</td>
      <td><span class="mode-badge mode-${p.mode}">${p.mode}</span></td>
      <td class="muted">${new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td class="muted device">${p.deviceId.slice(0, 8)}…</td>
    </tr>`).join('');

  const brandCards = ['Tuberway', '1Percent'].map((brand) => `
    <div class="brand-card">
      <p class="brand-name">${brand}</p>
      <p class="brand-count">${(tapTotals[brand] || 0).toLocaleString()}</p>
      <p class="brand-label">tile taps</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arcade Arena — Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:      #080b11;
      --panel:   #0d1017;
      --border:  rgba(255,255,255,0.07);
      --accent:  #7cf3c5;
      --accent2: #5ad1ff;
      --gold:    #ffd700;
      --danger:  #ff5f6d;
      --muted:   #6b7a8d;
      --text:    #e8f0ff;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
    a { color: var(--accent); text-decoration: none; }

    /* ── Layout ── */
    .page { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }

    /* ── Header ── */
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; flex-wrap: wrap; gap: 12px; }
    .header-left { display: flex; flex-direction: column; gap: 2px; }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent); font-weight: 700; }
    .header h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.4px; }
    .header-right { display: flex; gap: 10px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; text-decoration: none; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--accent); color: #041017; }
    .btn-ghost   { background: rgba(255,255,255,0.06); color: var(--text); border: 1px solid var(--border); }

    /* ── Stats grid ── */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
    .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 600; }
    .stat-value { font-size: 30px; font-weight: 900; color: var(--accent); line-height: 1.1; margin-top: 4px; letter-spacing: -1px; }
    .stat-sub   { font-size: 11px; color: var(--muted); margin-top: 2px; }

    /* ── Section ── */
    .section { margin-bottom: 28px; }
    .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-weight: 700; margin-bottom: 12px; }

    /* ── Brand cards ── */
    .brand-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .brand-card { background: var(--panel); border: 1px solid rgba(255,215,0,0.2); border-radius: 14px; padding: 16px 22px; min-width: 140px; }
    .brand-name  { font-size: 13px; font-weight: 800; color: var(--gold); margin-bottom: 6px; }
    .brand-count { font-size: 32px; font-weight: 900; color: var(--text); line-height: 1; }
    .brand-label { font-size: 11px; color: var(--muted); margin-top: 2px; }

    /* ── Table ── */
    .table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
    .table-controls { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); gap: 12px; flex-wrap: wrap; }
    .table-controls input {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 13px;
      width: 220px;
      outline: none;
    }
    .table-controls input:focus { border-color: rgba(124,243,197,0.4); }
    .contact-count { font-size: 12px; color: var(--muted); }
    .contact-count span { color: var(--accent); font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; border-bottom: 1px solid var(--border); white-space: nowrap; }
    td { padding: 11px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr.has-contact { background: rgba(124,243,197,0.03); }
    tr.top3 td.rank { font-size: 18px; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    td.rank  { font-size: 13px; font-weight: 700; color: var(--muted); min-width: 42px; }
    td.name  { font-weight: 700; font-size: 14px; }
    td.score { font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; font-size: 15px; }
    td.muted { color: var(--muted); font-size: 12px; }
    td.device { font-family: monospace; font-size: 11px; }
    .contact-tag { background: rgba(124,243,197,0.1); color: var(--accent); border: 1px solid rgba(124,243,197,0.25); border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
    .no-contact  { color: var(--muted); }
    .mode-badge  { padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .mode-solo   { background: rgba(90,209,255,0.1); color: var(--accent2); }
    .mode-versus { background: rgba(255,95,109,0.1); color: #ff5f6d; }

    /* ── Footer ── */
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <p class="eyebrow">Competition Dashboard</p>
        <h1>Arcade Arena Admin</h1>
      </div>
      <div class="header-right">
        <button class="btn btn-ghost" onclick="location.reload()">↻ Refresh</button>
        <a class="btn btn-primary" href="/admin/export">⬇ Export CSV</a>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <p class="stat-label">Total Players</p>
        <p class="stat-value">${totalPlayers.toLocaleString()}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">With Contact</p>
        <p class="stat-value">${withContact.toLocaleString()}</p>
        <p class="stat-sub">${totalPlayers > 0 ? Math.round((withContact / totalPlayers) * 100) : 0}% of players</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Top Score</p>
        <p class="stat-value">${topScore.toLocaleString()}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Avg Score</p>
        <p class="stat-value">${avgScore.toLocaleString()}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Logo Taps</p>
        <p class="stat-value">${totalTaps.toLocaleString()}</p>
        <p class="stat-sub">across all sponsors</p>
      </div>
    </div>

    <!-- Brand analytics -->
    <div class="section">
      <p class="section-title">Sponsor Engagement</p>
      <div class="brand-row">
        ${brandCards}
      </div>
    </div>

    <!-- Players table -->
    <div class="section">
      <p class="section-title">Players — ${totalPlayers.toLocaleString()} total</p>
      <div class="table-wrap">
        <div class="table-controls">
          <input type="text" id="search" placeholder="Search player or contact…" oninput="filterTable(this.value)" />
          <p class="contact-count"><span>${withContact.toLocaleString()}</span> / ${totalPlayers.toLocaleString()} players have contact info</p>
        </div>
        <div style="overflow-x:auto">
          <table id="players-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Score</th>
                <th>Contact</th>
                <th>Mode</th>
                <th>Joined</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody id="table-body">
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <p class="footer">Arcade Arena Admin &nbsp;·&nbsp; Powered by Tuberway &amp; 1Percent &nbsp;·&nbsp; ${new Date().toLocaleString()}</p>
  </div>

  <script>
    function filterTable(q) {
      const rows = document.querySelectorAll('#table-body tr');
      const s = q.toLowerCase();
      rows.forEach(function(row) {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(s) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
