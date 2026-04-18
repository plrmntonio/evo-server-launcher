'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const zlib = require('zlib');

const app = express();

// ─── Load config.json ─────────────────────────────────────────────────────────
const LAUNCHER_CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadLauncherConfig() {
  if (!fs.existsSync(LAUNCHER_CONFIG_PATH)) {
    console.error(`[ERROR] config.json not found at ${LAUNCHER_CONFIG_PATH}`);
    process.exit(1);
  }
  try { return JSON.parse(fs.readFileSync(LAUNCHER_CONFIG_PATH, 'utf8')); }
  catch (e) { console.error(`[ERROR] config.json parse error: ${e.message}`); process.exit(1); }
}

function saveLauncherConfig(cfg) {
  fs.writeFileSync(LAUNCHER_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

let launcherCfg = loadLauncherConfig();
const PORT          = launcherCfg.webPort || 3000;
const EXE_PATH      = () => loadLauncherConfig().executablePath || '';
const SERVER_COUNT  = () => Math.max(1, parseInt(loadLauncherConfig().serverCount) || 1);
const SERVER_SUFFIX = () => loadLauncherConfig().serverSuffix || '';

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}
function isValidSession(token) {
  if (!token || !sessions.has(token)) return false;
  const s = sessions.get(token);
  if (Date.now() - s.createdAt > SESSION_TTL_MS) { sessions.delete(token); return false; }
  return true;
}

// ─── Multi-server process state ───────────────────────────────────────────────
// serverId is 1-based integer
const serverProcesses = new Map(); // serverId -> ChildProcess
const serverLogs = new Map();      // serverId -> [{time,text,type}]
const MAX_LOGS = 500;

function getServerLogs(sid) {
  if (!serverLogs.has(sid)) serverLogs.set(sid, []);
  return serverLogs.get(sid);
}
function addLog(sid, text, type = 'info') {
  const logs = getServerLogs(sid);
  logs.push({ time: new Date().toISOString(), text, type });
  if (logs.length > MAX_LOGS) logs.shift();
}

// ─── Settings paths ───────────────────────────────────────────────────────────
const SETTINGS_DIR = path.join(os.homedir(), 'ACE');

function ensureDirs() {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function settingsPath(sid) {
  return path.join(SETTINGS_DIR, `server_${sid}.json`);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

function requireAuth(req, res, next) {
  if (!isValidSession(req.headers['x-auth-token'])) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Auth (public) ────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const cfg = loadLauncherConfig();
  if (req.body.password === cfg.adminPassword) return res.json({ ok: true, token: createSession() });
  return res.status(403).json({ error: 'Wrong password' });
});

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(req.headers['x-auth-token']);
  res.json({ ok: true });
});

app.use('/api', requireAuth);

// ─── Default settings for a server ───────────────────────────────────────────
function defaultSettings(sid) {
  return {
    serverName: `EVO Server ${sid}`,
    maxPlayers: 8,
    maxPlayersLimit: 40,
    tcpPort: 9700 + (sid - 1) * 100,
    udpPort: 9700 + (sid - 1) * 100,
    httpPort: 8080 + (sid - 1),
    isCycleEnabled: true,
    driverPassword: '',
    spectatorPassword: '',
    adminPassword: '',
    entryListPath: '',
    resultsPath: '',
    selectedServerTypeValue: 'MultiplayerServerListSessionType_RANKED',
    Event: {
      selectedSessionTypeValue: 'GameModeType_PRACTICE',
      selectedTrackValue: '',
      selectedWeatherTypeValue: 'GameModeSelectionWeatherType_CLEAR',
      selectedWeatherBehaviorValue: 'GameModeSelectionWeatherBehaviour_STATIC',
      selectedInitialGripValue: 'InitialGrip_GREEN'
    },
    Sessions: {
      PracticeSession:   { name:'Practice',   isVisible:true,  duration:0, length:1200, hour:16, minute:0, timeMultiplierIndex:0, maxWaitToBox:10, overtimeWaitingNextSession:10, minWaitingForPlayers:10, maxWaitingForPlayers:30 },
      QualifyingSession: { name:'Qualifying',  isVisible:false, duration:0, length:600,  hour:16, minute:0, timeMultiplierIndex:0, maxWaitToBox:10, overtimeWaitingNextSession:10, minWaitingForPlayers:10, maxWaitingForPlayers:30 },
      WarmupSession:     { name:'Warmup',      isVisible:false, duration:0, length:300,  hour:16, minute:0, timeMultiplierIndex:0, maxWaitToBox:10, overtimeWaitingNextSession:10, minWaitingForPlayers:10, maxWaitingForPlayers:30 },
      RaceSession:       { name:'Race',        isVisible:false, duration:0, length:20,   hour:16, minute:0, timeMultiplierIndex:0, maxWaitToBox:10, overtimeWaitingNextSession:10, minWaitingForPlayers:10, maxWaitingForPlayers:30 }
    }
  };
}

function loadSettings(sid) {
  ensureDirs();
  const fp = settingsPath(sid);
  if (fs.existsSync(fp)) {
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const def = defaultSettings(sid);
      return {
        ...def, ...raw,
        Event:    { ...def.Event,    ...raw.Event },
        Sessions: {
          PracticeSession:   { ...def.Sessions.PracticeSession,   ...raw.Sessions?.PracticeSession },
          QualifyingSession: { ...def.Sessions.QualifyingSession, ...raw.Sessions?.QualifyingSession },
          WarmupSession:     { ...def.Sessions.WarmupSession,     ...raw.Sessions?.WarmupSession },
          RaceSession:       { ...def.Sessions.RaceSession,       ...raw.Sessions?.RaceSession }
        }
      };
    } catch (e) { console.error(`Failed to load settings for server ${sid}:`, e.message); }
  }
  return defaultSettings(sid);
}

function saveSettings(sid, s) {
  ensureDirs();
  fs.writeFileSync(settingsPath(sid), JSON.stringify(s, null, 2), 'utf8');
}

// ─── Compression ──────────────────────────────────────────────────────────────
function jsonToCompressedBase64(jsonStr) {
  const inputBuf = Buffer.from(jsonStr, 'utf8');
  const compressed = zlib.deflateSync(inputBuf, { level: zlib.constants.Z_BEST_COMPRESSION });
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeInt32BE(inputBuf.length, 0);
  return Buffer.concat([lenBuf, compressed]).toString('base64');
}

// ─── Config/Season builders ───────────────────────────────────────────────────
function buildConfigJson(settings) {
  const exePath = EXE_PATH();
  let allowedCars = [];
  if (exePath) {
    try {
      const cars = JSON.parse(fs.readFileSync(path.join(path.dirname(exePath), 'cars.json'), 'utf8'));
      allowedCars = (cars.cars || []).filter(c => c.is_selected)
        .map(c => ({ car_name: c.name, ballast: Math.round(c.ballast || 0), restrictor: parseFloat(c.restrictor || 0) }));
    } catch {}
  }
  return {
    server_tcp_listener_port: settings.tcpPort,
    server_udp_listener_port: settings.udpPort,
    server_tcp_internal_port: settings.tcpPort,
    server_udp_internal_port: settings.udpPort,
    server_http_port:         settings.httpPort,
    server_name:              SERVER_SUFFIX() ? `${settings.serverName} - ${SERVER_SUFFIX()}` : settings.serverName,
    max_players:              settings.maxPlayers,
    cycle:                    settings.isCycleEnabled,
    allowed_cars_list_full:   allowedCars,
    driver_password:          settings.driverPassword,
    spectator_password:       settings.spectatorPassword,
    admin_password:           settings.adminPassword,
    type:                     settings.selectedServerTypeValue,
    entry_list_path:          settings.entryListPath,
    results_path:             settings.resultsPath
  };
}

const TM_VALUES = [1, 2, 4, 8, 16, 32, 64, 128];

function buildSeasonJson(settings) {
  const e  = settings.Event;
  const ss = settings.Sessions;
  const tp = (e.selectedTrackValue || '').split('|');
  if (tp.length < 4) return null;
  const tod = s => ({ year:2024, month:8, day:15, hour:s.hour, minute:s.minute, second:0, time_multiplier: TM_VALUES[s.timeMultiplierIndex] || 1 });
  const gc = {};
  const p = ss.PracticeSession, q = ss.QualifyingSession, w = ss.WarmupSession, r = ss.RaceSession;
  if (p.isVisible) { gc.practice_duration=p.length; gc.practice_time_of_day=tod(p); gc.practice_overtime_waiting_next_session=p.overtimeWaitingNextSession; gc.practice_max_wait_to_box=p.maxWaitToBox; }
  if (q.isVisible) { gc.qualify_duration=q.length;  gc.qualify_time_of_day=tod(q);  gc.qualify_overtime_waiting_next_session=q.overtimeWaitingNextSession;  gc.qualify_max_wait_to_box=q.maxWaitToBox;  }
  if (w.isVisible) { gc.warmup_duration=w.length;   gc.warmup_time_of_day=tod(w);   gc.warmup_overtime_waiting_next_session=w.overtimeWaitingNextSession;   gc.warmup_max_wait_to_box=w.maxWaitToBox;   }
  if (r.isVisible) {
    gc.race_duration=r.length;
    gc.race_duration_type = r.duration===1 ? 'GameModeSelectionDuration_LAPS' : 'GameModeSelectionDuration_TIME';
    gc.race_time_of_day=tod(r); gc.race_overtime_waiting_next_session=r.overtimeWaitingNextSession; gc.race_max_wait_to_box=r.maxWaitToBox;
    gc.min_waiting_for_players=r.minWaitingForPlayers; gc.max_waiting_for_players=r.maxWaitingForPlayers;
  }
  return {
    game_type: e.selectedSessionTypeValue,
    event: { track:tp[0], layout:tp[1], event_name:tp[2], track_length:parseInt(tp[3],10) },
    export_json: false, game_config: gc,
    weather_type: e.selectedWeatherTypeValue,
    weather_behaviour: e.selectedWeatherBehaviorValue,
    initial_grip: e.selectedInitialGripValue
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseSid(req, res) {
  const sid = parseInt(req.params.sid || req.body?.sid || 1);
  const count = SERVER_COUNT();
  if (isNaN(sid) || sid < 1 || sid > count) {
    res.status(400).json({ error: `Invalid server id. Must be 1-${count}.` });
    return null;
  }
  return sid;
}

// ─── API ──────────────────────────────────────────────────────────────────────

// Launcher info
app.get('/api/launcher-info', (req, res) => {
  const cfg = loadLauncherConfig();
  const count = Math.max(1, parseInt(cfg.serverCount) || 1);
  const servers = [];
  for (let i = 1; i <= count; i++) {
    const s = loadSettings(i);
    servers.push({ id: i, name: s.serverName, running: serverProcesses.has(i), pid: serverProcesses.get(i)?.pid ?? null });
  }
  res.json({ executablePath: cfg.executablePath, exeName: cfg.executablePath ? path.basename(cfg.executablePath) : null, language: cfg.language || 'en', serverCount: count, serverSuffix: cfg.serverSuffix || '', servers });
});

// Change password
app.post('/api/auth/change-password', (req, res) => {
  const cfg = loadLauncherConfig();
  const { oldPassword, newPassword } = req.body;
  if (oldPassword !== cfg.adminPassword) return res.status(403).json({ error: 'Old password is wrong' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password too short (min 4 chars)' });
  cfg.adminPassword = newPassword;
  saveLauncherConfig(cfg);
  // Invalidate all sessions
  sessions.clear();
  res.json({ ok: true });
});

// Settings per server
app.get('/api/servers/:sid/settings', (req, res) => {
  const sid = parseSid(req, res); if (!sid) return;
  res.json(loadSettings(sid));
});

app.post('/api/servers/:sid/settings', (req, res) => {
  const sid = parseSid(req, res); if (!sid) return;
  saveSettings(sid, req.body);
  res.json({ ok: true });
});

// Assets (shared across all servers)
app.get('/api/assets', (req, res) => {
  const exePath = EXE_PATH();
  if (!exePath) return res.json({ cars: [], tracks_practice: [], tracks_race: [] });
  const dir = path.dirname(exePath);
  let cars = [], tp = [], tr = [];
  try { cars = JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars || []; } catch {}
  try { tp   = JSON.parse(fs.readFileSync(path.join(dir, 'events_practice.json'), 'utf8')).events || []; } catch {}
  try { tr   = JSON.parse(fs.readFileSync(path.join(dir, 'events_race_weekend.json'), 'utf8')).events || []; } catch {}
  res.json({ cars, tracks_practice: tp, tracks_race: tr });
});

app.post('/api/assets/cars', (req, res) => {
  const exePath = EXE_PATH();
  if (!exePath) return res.status(400).json({ error: 'No exe path in config.json' });
  try {
    fs.writeFileSync(path.join(path.dirname(exePath), 'cars.json'), JSON.stringify({ cars: req.body.cars }, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Preview
app.get('/api/servers/:sid/preview', (req, res) => {
  const sid = parseSid(req, res); if (!sid) return;
  const settings = loadSettings(sid);
  const config = buildConfigJson(settings);
  const season = buildSeasonJson(settings);
  const exePath = EXE_PATH();
  let cmd = null;
  if (season && exePath) {
    cmd = `"${exePath}" -serverconfig ${jsonToCompressedBase64(JSON.stringify(config))} -seasondefinition ${jsonToCompressedBase64(JSON.stringify(season))}`;
  }
  res.json({ config: JSON.stringify(config, null, 2), season: season ? JSON.stringify(season, null, 2) : null, cmd });
});

// Start server
app.post('/api/servers/:sid/start', (req, res) => {
  const sid = parseSid(req, res); if (!sid) return;
  if (serverProcesses.has(sid)) return res.status(409).json({ error: 'Server already running' });
  const exePath = EXE_PATH();
  if (!exePath || !fs.existsSync(exePath)) return res.status(400).json({ error: 'executablePath in config.json is not set or not found.' });

  const settings = loadSettings(sid);
  const configJson = buildConfigJson(settings);
  const seasonJson = buildSeasonJson(settings);
  if (!seasonJson) return res.status(400).json({ error: 'No track selected.' });

  const args = ['-serverconfig', jsonToCompressedBase64(JSON.stringify(configJson)), '-seasondefinition', jsonToCompressedBase64(JSON.stringify(seasonJson))];

  addLog(sid, `Starting server ${sid}: ${exePath}`, 'info');
  addLog(sid, `TCP=${settings.tcpPort} UDP=${settings.udpPort} HTTP=${settings.httpPort}`, 'info');

  const isWindows = process.platform === 'win32';
  const spawnCmd  = isWindows ? exePath : 'wine';
  const spawnArgs = isWindows ? args : [exePath, ...args];

  const proc = spawn(spawnCmd, spawnArgs, { cwd: path.dirname(exePath), detached: false, ...(isWindows && { windowsHide: false }) });
  serverProcesses.set(sid, proc);

  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => addLog(sid, l, 'stdout')));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => addLog(sid, l, 'stderr')));
  proc.on('exit', (code, signal) => { addLog(sid, `Exited (code=${code}, signal=${signal})`, 'info'); serverProcesses.delete(sid); });
  proc.on('error', err => { addLog(sid, `Failed to start: ${err.message}`, 'error'); serverProcesses.delete(sid); });

  res.json({ ok: true, pid: proc.pid });
});

// Stop server
app.post('/api/servers/:sid/stop', (req, res) => {
  const sid = parseSid(req, res); if (!sid) return;
  const proc = serverProcesses.get(sid);
  if (!proc) return res.status(404).json({ error: 'Server not running' });
  proc.kill('SIGTERM');
  setTimeout(() => { if (serverProcesses.has(sid)) serverProcesses.get(sid)?.kill(); }, 3000);
  res.json({ ok: true });
});

// Status all servers
app.get('/api/servers/status', (req, res) => {
  const count = SERVER_COUNT();
  const result = [];
  for (let i = 1; i <= count; i++) {
    result.push({ id: i, running: serverProcesses.has(i), pid: serverProcesses.get(i)?.pid ?? null });
  }
  res.json(result);
});

// Logs per server
app.get('/api/servers/:sid/logs', (req, res) => {
  const sid = parseSid(req, res); if (!sid) return;
  const since = parseInt(req.query.since || '0', 10);
  res.json(getServerLogs(sid).slice(since));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const cfg = loadLauncherConfig();
  console.log(`\n🚀 EVO Server Launcher`);
  console.log(`   Web UI      : http://localhost:${PORT}`);
  console.log(`   Executable  : ${cfg.executablePath || '(not set)'}`);
  console.log(`   Servers     : ${Math.max(1, parseInt(cfg.serverCount)||1)}`);
  console.log(`   Password    : ${'*'.repeat((cfg.adminPassword||'').length)}`);
  console.log(`\n   Press Ctrl+C to stop.\n`);
});
