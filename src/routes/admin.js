const express      = require('express');
const { Score, LogoTap, sequelize } = require('../db');
const competition  = require('../competition');

const router = express.Router();

// ── Basic auth ────────────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASS || 'admin123';
  const header    = req.headers.authorization || '';

  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Reflex Tile Admin"');
    return res.status(401).send('Authentication required');
  }

  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  if (user !== validUser || pass !== validPass) {
    res.set('WWW-Authenticate', 'Basic realm="Reflex Tile Admin"');
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
    const playedPlayers     = players.filter((p) => p.score > 0);
    const avgScore          = playedPlayers.length > 0
      ? Math.round(playedPlayers.reduce((s, p) => s + p.score, 0) / playedPlayers.length) : 0;
    const topScore          = players[0]?.score ?? 0;
    const totalTaps         = Object.values(tapTotals).reduce((s, v) => s + v, 0);
    const totalPlays        = players.reduce((s, p) => s + (p.playCount || 0), 0);
    const avgPlays          = totalPlayers > 0
      ? Math.round((totalPlays / totalPlayers) * 10) / 10 : 0;

    // Top tappers via raw join
    let topTappers = [];
    try {
      const [rows] = await sequelize.query(`
        SELECT
          MAX(s.player_name) AS playerName,
          SUM(lt.taps) AS totalTaps,
          SUM(CASE WHEN lt.brand = 'Tuberway' THEN lt.taps ELSE 0 END) AS tuberwayTaps,
          SUM(CASE WHEN lt.brand = '1Percent' THEN lt.taps ELSE 0 END) AS percentTaps
        FROM logo_taps lt
        INNER JOIN scores s ON lt.device_id = s.device_id
        GROUP BY lt.device_id
        ORDER BY totalTaps DESC
        LIMIT 3
      `);
      topTappers = rows;
    } catch { /* non-fatal */ }

    res.send(html({ players, tapTotals, topTappers, totalPlayers, withContact, avgScore, topScore, totalTaps, totalPlays, avgPlays, compState: competition.getState() }));
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
});

// ── GET /admin/export ─────────────────────────────────────────────────────
router.get('/export', async (_req, res) => {
  try {
    const players = await Score.findAll({ order: [['score', 'DESC']] });
    // csvEsc: wraps in quotes and escapes internal quotes per RFC 4180
    const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [
      ['Rank', 'Player', 'Score', 'Plays', 'Contact', 'Mode', 'Device ID', 'Joined'].join(','),
      ...players.map((p, i) => [
        i + 1,
        csvEsc(p.playerName),
        p.score,
        p.playCount || 0,
        csvEsc(p.contact || ''),
        p.mode,
        csvEsc(p.deviceId),
        csvEsc(new Date(p.createdAt).toISOString()),
      ].join(',')),
    ];
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="reflex-tile-players.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    res.status(500).send('Export failed: ' + err.message);
  }
});

// ── POST /admin/competition/open ───────────────────────────────────────────
router.post('/competition/open', (req, res) => {
  try {
    competition.open();
    res.json({ ok: true });
  } catch (err) {
    console.error('[competition] Error opening:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/competition/close ──────────────────────────────────────────
router.post('/competition/close', (req, res) => {
  try {
    competition.close();
    res.json({ ok: true });
  } catch (err) {
    console.error('[competition] Error closing:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── HTML template ─────────────────────────────────────────────────────────
function html({ players, tapTotals, topTappers, totalPlayers, withContact, avgScore, topScore, totalTaps, totalPlays, avgPlays, compState }) {
  const medal = (i) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`;
  const podiumClass = (i) => ['gold', 'silver', 'bronze'][i] ?? '';

  // ── Player rows ──
  const rows = players.map((p, i) => `
    <tr class="${p.contact ? 'has-contact' : ''} ${i < 3 ? 'top3' : ''}">
      <td class="rank">${medal(i)}</td>
      <td class="name">${esc(p.playerName)}</td>
      <td class="score">${p.score.toLocaleString()}</td>
      <td class="plays">${(p.playCount || 0).toLocaleString()}</td>
      <td>${p.contact ? `<span class="contact-tag">${esc(p.contact)}</span>` : '<span class="no-contact">—</span>'}</td>
      <td><span class="mode-badge mode-${p.mode}">${p.mode}</span></td>
      <td class="muted">${new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td class="muted device">${p.deviceId.slice(0, 8)}…</td>
    </tr>`).join('');

  // ── Tap champions podium ──
  const rankLabel = (i) => ['1st', '2nd', '3rd'][i] ?? `${i + 1}th`;

  const podiumCards = [0, 1, 2].map((i) => {
    const t = topTappers[i];
    if (!t) {
      return `<div class="podium-empty"><span>—</span></div>`;
    }
    const tuberway = Number(t.tuberwayTaps || 0);
    const percent  = Number(t.percentTaps  || 0);
    return `
      <div class="podium-card ${podiumClass(i)}">
        <p class="podium-rank">${rankLabel(i)}</p>
        <p class="podium-medal">${medal(i)}</p>
        <p class="podium-name">${esc(t.playerName)}</p>
        <p class="podium-total">${Number(t.totalTaps).toLocaleString()}</p>
        <p class="podium-tap-label">total taps</p>
        <div class="podium-breakdown">
          ${tuberway > 0 ? `<span>Tuberway &nbsp;${tuberway.toLocaleString()}</span>` : ''}
          ${percent  > 0 ? `<span>1Percent &nbsp;${percent.toLocaleString()}</span>`  : ''}
        </div>
      </div>`;
  }).join('');

  const podiumHtml = topTappers.length === 0
    ? '<p class="empty-state">No tap data recorded yet.</p>'
    : `<div class="podium-grid">${podiumCards}</div>`;

  // ── Sponsor cards ──
  const sponsorCards = ['Tuberway', '1Percent'].map((brand) => `
    <div class="sponsor-card">
      <p class="sponsor-brand">${brand}</p>
      <p class="sponsor-count">${(tapTotals[brand] || 0).toLocaleString()}</p>
      <p class="sponsor-label">tile taps</p>
    </div>`).join('');

  const contactRate = totalPlayers > 0 ? Math.round((withContact / totalPlayers) * 100) : 0;

  // ── Competition banner ──
  const fmtTime = (ts) => ts
    ? new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
  const compBanner = compState.open
    ? `<div class="comp-banner comp-open">
        <div class="comp-left">
          <div class="comp-dot"></div>
          <div>
            <p class="comp-title">Competition is open</p>
            <p class="comp-meta">${compState.startedAt ? `Opened ${fmtTime(compState.startedAt)}` : 'Accepting score submissions'}</p>
          </div>
        </div>
        <button class="btn btn-red" onclick="toggleComp('close', this)">Close Competition</button>
      </div>`
    : `<div class="comp-banner comp-closed">
        <div class="comp-left">
          <div class="comp-dot"></div>
          <div>
            <p class="comp-title">Competition is closed</p>
            <p class="comp-meta">${compState.endedAt ? `Closed ${fmtTime(compState.endedAt)}` : 'Score submissions paused'}${compState.startedAt ? ` · Opened ${fmtTime(compState.startedAt)}` : ''}</p>
          </div>
        </div>
        <button class="btn btn-green" onclick="toggleComp('open', this)">Open Competition</button>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arcade Arena — Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:      #121212;
      --surface: #1c1c1c;
      --raised:  #222222;
      --border:  #323232;
      --text:    #ededed;
      --text2:   #909090;
      --text3:   #525252;
      --blue:    #60a5fa;
      --green:   #4ade80;
      --red:     #f87171;
      --amber:   #fbbf24;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px; line-height: 1.6;
    }

    /* ── Topbar ── */
    .topbar {
      position: sticky; top: 0; z-index: 100;
      background: #181818;
      border-bottom: 1px solid var(--border);
      height: 56px;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 28px;
    }
    .topbar-left { display: flex; align-items: center; gap: 10px; }
    .brand-mark {
      width: 28px; height: 28px; border-radius: 6px;
      background: #2a2a2a; border: 1px solid #3a3a3a;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0;
    }
    .topbar-name { font-size: 14px; font-weight: 700; color: var(--text); }
    .topbar-sep  { color: var(--text3); }
    .topbar-sub  { font-size: 13px; color: var(--text2); }
    .topbar-actions { display: flex; gap: 8px; align-items: center; }
    .btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 14px; border-radius: 7px;
      font-size: 13px; font-weight: 500;
      cursor: pointer; text-decoration: none;
      font-family: inherit; transition: background 0.12s;
      border: 1px solid var(--border);
      background: var(--surface); color: var(--text2);
    }
    .btn:hover { background: var(--raised); color: var(--text); }
    .btn-white  { background: #ededed; color: #111; border-color: #ededed; font-weight: 600; }
    .btn-white:hover  { background: #fff; color: #000; }
    .btn-red    { background: #2a1414; color: var(--red);   border-color: #4a2020; }
    .btn-red:hover    { background: #331818; }
    .btn-green  { background: #142a1a; color: var(--green); border-color: #1e4a28; }
    .btn-green:hover  { background: #183220; }

    /* ── Page ── */
    .page { max-width: 1140px; margin: 0 auto; padding: 32px 24px 80px; }

    /* ── Page header ── */
    .page-hdr { margin-bottom: 28px; }
    .page-hdr h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
    .page-hdr p  { font-size: 13px; color: var(--text2); margin-top: 3px; }

    /* ── Competition banner ── */
    .comp-banner {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-radius: 10px; margin-bottom: 28px;
      background: var(--surface); border: 1px solid var(--border);
      gap: 14px; flex-wrap: wrap;
    }
    .comp-left  { display: flex; align-items: center; gap: 12px; }
    .comp-dot   { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; }
    .comp-open   .comp-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
    .comp-closed .comp-dot { background: var(--red); }
    .comp-title { font-size: 15px; font-weight: 600; }
    .comp-meta  { font-size: 12px; color: var(--text2); margin-top: 2px; }

    /* ── Stats grid ── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px; margin-bottom: 36px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px 20px 16px;
    }
    .stat-label {
      font-size: 12px; color: var(--text2); font-weight: 400;
    }
    .stat-value {
      font-size: 32px; font-weight: 700; line-height: 1.1;
      margin-top: 6px; letter-spacing: -1px;
      font-variant-numeric: tabular-nums; color: var(--text);
    }
    .stat-card.hl .stat-value { color: var(--blue); }
    .stat-sub { font-size: 11px; color: var(--text3); margin-top: 4px; }

    /* ── Section header ── */
    .sec-hdr {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 14px;
      font-size: 13px; font-weight: 600; color: var(--text);
    }
    .sec-hdr .badge {
      font-size: 11px; font-weight: 400; color: var(--text3);
      background: var(--raised); border: 1px solid var(--border);
      padding: 1px 8px; border-radius: 4px;
    }
    .sec-divider { height: 1px; background: var(--border); margin: 32px 0; }

    /* ── Sponsor cards ── */
    .sponsor-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 32px; }
    .sponsor-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 20px 26px; min-width: 170px;
    }
    .sponsor-brand { font-size: 11px; color: var(--text2); font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
    .sponsor-count { font-size: 36px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -1.5px; }
    .sponsor-label { font-size: 12px; color: var(--text3); margin-top: 4px; }

    /* ── Tap Champions ── */
    .podium-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
    .podium-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 24px 20px 20px;
      display: flex; flex-direction: column; align-items: center; text-align: center;
    }
    .podium-card.gold   { border-top: 2px solid #d4a843; }
    .podium-card.silver { border-top: 2px solid #9ca3af; }
    .podium-card.bronze { border-top: 2px solid #a87954; }
    .podium-empty {
      background: var(--surface); border: 1px dashed var(--border);
      border-radius: 10px; display: flex; align-items: center; justify-content: center;
      min-height: 150px; color: var(--text3); font-size: 18px;
    }
    .podium-rank      { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text3); margin-bottom: 8px; }
    .podium-medal     { font-size: 30px; line-height: 1; margin-bottom: 10px; }
    .podium-name      { font-size: 17px; font-weight: 700; margin-bottom: 10px; word-break: break-word; }
    .podium-total     { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
    .podium-tap-label { font-size: 12px; color: var(--text2); margin-top: 3px; margin-bottom: 14px; }
    .podium-breakdown { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text2); }
    .empty-state { color: var(--text3); font-size: 13px; margin-bottom: 8px; }

    /* ── Table ── */
    .table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .table-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 13px 18px; border-bottom: 1px solid var(--border);
      background: var(--surface); gap: 12px; flex-wrap: wrap;
    }
    .search-box { position: relative; display: inline-flex; align-items: center; }
    .search-icon { position: absolute; left: 10px; color: var(--text3); pointer-events: none; }
    .search-input {
      background: var(--raised); border: 1px solid var(--border);
      color: var(--text); padding: 7px 12px 7px 32px;
      border-radius: 7px; font-size: 13px; width: 225px;
      outline: none; font-family: inherit; transition: border-color 0.15s;
    }
    .search-input:focus { border-color: #4a4a4a; }
    .search-input::placeholder { color: var(--text3); }
    .contact-stat { font-size: 12px; color: var(--text2); }
    .contact-stat strong { color: var(--text); font-weight: 600; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); }
    thead th {
      text-align: left; padding: 10px 18px;
      font-size: 11px; color: var(--text2); font-weight: 500;
      border-bottom: 1px solid var(--border); white-space: nowrap;
    }
    tbody td { padding: 12px 18px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--raised); }
    td.rank  { font-size: 12px; color: var(--text3); min-width: 44px; font-variant-numeric: tabular-nums; }
    tr.top3 td.rank { font-size: 18px; }
    td.name  { font-weight: 600; font-size: 14px; }
    td.score { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--blue); }
    td.plays { font-variant-numeric: tabular-nums; color: var(--text2); font-weight: 600; }
    td.muted { color: var(--text2); font-size: 12px; }
    td.device { font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace; font-size: 11px; color: var(--text3); }
    .contact-tag {
      display: inline-block; background: var(--raised);
      border: 1px solid var(--border); border-radius: 5px;
      padding: 2px 9px; font-size: 12px; color: var(--text);
    }
    .no-contact { color: var(--text3); }
    .mode-badge {
      display: inline-block; padding: 2px 8px; border-radius: 5px;
      font-size: 11px; font-weight: 500;
      background: var(--raised); color: var(--text2); border: 1px solid var(--border);
    }

    /* ── Footer ── */
    .footer {
      margin-top: 48px; padding-top: 20px;
      border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--text3);
    }
  </style>
</head>
<body>

  <!-- Topbar -->
  <nav class="topbar">
    <div class="topbar-left">
      <div class="brand-mark">⚡</div>
      <span class="topbar-name">Arcade Arena</span>
      <span class="topbar-sep">&thinsp;/&thinsp;</span>
      <span class="topbar-sub">Admin</span>
    </div>
    <div class="topbar-actions">
      <button class="btn" onclick="location.reload()">↻ Refresh</button>
      <a class="btn btn-white" href="/admin/export">↓ Export CSV</a>
    </div>
  </nav>

  <div class="page">

    <!-- Page header -->
    <div class="page-hdr">
      <h2>Dashboard</h2>
      <p>Updated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
    </div>

    <!-- Competition control -->
    ${compBanner}

    <!-- Stats grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <p class="stat-label">Total Players</p>
        <p class="stat-value">${totalPlayers.toLocaleString()}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">With Contact</p>
        <p class="stat-value">${withContact.toLocaleString()}</p>
        <p class="stat-sub">${contactRate}% of total</p>
      </div>
      <div class="stat-card hl">
        <p class="stat-label">Top Score</p>
        <p class="stat-value">${topScore.toLocaleString()}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Avg Score</p>
        <p class="stat-value">${avgScore.toLocaleString()}</p>
        <p class="stat-sub">played players only</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Sponsor Taps</p>
        <p class="stat-value">${totalTaps.toLocaleString()}</p>
        <p class="stat-sub">all brands</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Total Plays</p>
        <p class="stat-value">${totalPlays.toLocaleString()}</p>
        <p class="stat-sub">game sessions</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Avg Games / Player</p>
        <p class="stat-value">${avgPlays.toLocaleString()}</p>
        <p class="stat-sub">per registered player</p>
      </div>
    </div>

    <!-- Sponsor Engagement -->
    <p class="sec-hdr">Sponsor Engagement</p>
    <div class="sponsor-row">
      ${sponsorCards}
    </div>

    <!-- Tap Champions -->
    <p class="sec-hdr">Tap Champions <span class="badge">Top 3</span></p>
    ${podiumHtml}

    <div class="sec-divider"></div>

    <!-- Players table -->
    <p class="sec-hdr">All Players <span class="badge">${totalPlayers.toLocaleString()}</span></p>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="search-box">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="search-input" type="text" id="search" placeholder="Search player or contact…" oninput="filterTable(this.value)" />
        </div>
        <p class="contact-stat"><strong>${withContact.toLocaleString()}</strong> of ${totalPlayers.toLocaleString()} players have contact info</p>
      </div>
      <div style="overflow-x:auto">
        <table id="players-table">
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Score</th><th>Plays</th>
              <th>Contact</th><th>Mode</th><th>Joined</th><th>Device</th>
            </tr>
          </thead>
          <tbody id="table-body">${rows}</tbody>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <span>Arcade Arena Admin</span>
      <span>Powered by Tuberway &amp; 1Percent</span>
    </div>

  </div>

  <script>
    function filterTable(q) {
      const rows = document.querySelectorAll('#table-body tr');
      const s = q.toLowerCase();
      rows.forEach(function(r) {
        r.style.display = r.textContent.toLowerCase().includes(s) ? '' : 'none';
      });
    }

    async function toggleComp(action, btn) {
      if (action === 'close' && !confirm('Close the competition? Players will not be able to submit scores until you reopen it.')) return;
      btn.disabled = true;
      btn.textContent = action === 'close' ? 'Closing…' : 'Opening…';
      try {
        const r = await fetch('/admin/competition/' + action, { method: 'POST' });
        const data = await r.json();
        if (r.ok && data.ok) {
          location.reload();
        } else {
          alert('Error: ' + (data.error || r.status));
          btn.disabled = false;
          btn.textContent = action === 'close' ? 'Close Competition' : 'Open Competition';
        }
      } catch (e) {
        alert('Network error — please try again.');
        btn.disabled = false;
        btn.textContent = action === 'close' ? 'Close Competition' : 'Open Competition';
      }
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
