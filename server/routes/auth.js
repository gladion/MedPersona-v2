// server/routes/auth.js
const express = require('express');
const { readJson } = require('../utils/store');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const config = await readJson('config.json', {});
    const doctors = await readJson('doctors.json', []);
    const uname = String(username).trim();

    if (password !== config.sharedPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (uname.toLowerCase() === String(config.adminUsername || 'admin').toLowerCase()) {
      req.session.user = { username: config.adminUsername, name: 'Administrator', role: 'admin' };
      return res.json({ user: req.session.user });
    }

    const doctor = doctors.find(d => d.username.toLowerCase() === uname.toLowerCase());
    if (!doctor) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.user = { username: doctor.username, name: doctor.name, role: 'doctor' };
    res.json({ user: req.session.user });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'Login failed - please try again' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('medsim.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: req.session.user });
});

module.exports = router;
