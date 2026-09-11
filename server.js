// server.js
// MedSim Review - entry point.
// Run with: npm install && npm start
// Requires the MONGODB_URI environment variable - see README.md, "Database setup".
// Server listens on process.env.PORT (Render sets this) or 3000 locally.

require('dotenv').config(); // loads MONGODB_URI etc. from a local .env file, if present

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');

const store = require('./server/utils/store');
const { readJson, writeJson } = store;

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// First-run bootstrap: create the config / doctors / responses / sessions
// documents in MongoDB if they don't exist yet, so the app runs with zero
// manual setup beyond providing MONGODB_URI. The shared reviewer/admin
// password lives ONLY in the database - it is never logged and never sent
// to the client.
// ---------------------------------------------------------------------
async function ensureDoc(name, fallback) {
  const existing = await readJson(name, undefined);
  if (existing === undefined) {
    await writeJson(name, fallback);
    console.log(`[bootstrap] Created ${name} with default content.`);
  }
}

async function ensureSeedSessions() {
  const existing = await readJson('sessions.json', undefined);
  if (existing !== undefined) return;

  const seedCsvPath = path.join(__dirname, 'seed-data', 'historyMedPersona2.csv');
  if (fs.existsSync(seedCsvPath)) {
    try {
      const { parseCsvText } = require('./server/utils/csvLoader');
      const csvText = fs.readFileSync(seedCsvPath, 'utf8');
      const parsed = parseCsvText(csvText);
      await writeJson('sessions.json', parsed);
      console.log(`[bootstrap] Seeded ${parsed.sessions.length} sessions across ${parsed.cases.length} cases from bundled CSV.`);
    } catch (e) {
      console.error('[bootstrap] Failed to seed sessions.json from bundled CSV:', e.message);
      await writeJson('sessions.json', { cases: [], sessions: [] });
    }
  } else {
    await writeJson('sessions.json', { cases: [], sessions: [] });
  }
}

async function bootstrap() {
  console.log('[bootstrap] Connecting to MongoDB...');
  await store.connect();

  await ensureDoc('config.json', {
    adminUsername: 'admin',
    sharedPassword: '1234',
    sessionSecret: 'medsim-review-local-secret-change-if-deploying-publicly'
  });
  await ensureDoc('doctors.json', [
    { username: 'dr_cohen', name: 'Dr. Cohen' },
    { username: 'dr_levi', name: 'Dr. Levi' }
  ]);
  await ensureDoc('responses.json', {});
  await ensureSeedSessions();

  const config = await readJson('config.json', {});

  // -------------------------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use(session({
    name: 'medsim.sid',
    secret: config.sessionSecret || 'medsim-fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    }
    // Note: sessions use the default in-memory store, so signing back in
    // is required after a server restart - only the login itself is
    // affected, not any saved case/doctor/questionnaire data, which now
    // lives in MongoDB. Ask if you'd like sessions persisted too
    // (e.g. via connect-mongo).
  }));

  // API routes
  app.use('/api/auth', require('./server/routes/auth'));
  app.use('/api/doctor', require('./server/routes/doctor'));
  app.use('/api/admin', require('./server/routes/admin'));

  // Static frontend
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  // Fallback 404 for unknown API routes
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.listen(PORT, () => {
    console.log(`MedSim Review server listening on port ${PORT}`);
    console.log('Open http://localhost:' + PORT + ' in your browser.');
  });
}

bootstrap().catch((err) => {
  console.error('[bootstrap] Fatal error during startup:', err.message);
  console.error('Make sure MONGODB_URI is set correctly - see README.md, "Database setup".');
  process.exit(1);
});
