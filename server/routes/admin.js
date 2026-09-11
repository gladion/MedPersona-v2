// server/routes/admin.js
const express = require('express');
const multer = require('multer');
const { stringify } = require('csv-stringify/sync');
const { readJson, writeJson } = require('../utils/store');
const { requireRole } = require('../utils/auth');
const { QUESTIONNAIRES, computeStatus } = require('../utils/questionnaires');
const { parseCsvText } = require('../utils/csvLoader');

const router = express.Router();
router.use(requireRole('admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ---- Doctor management ----------------------------------------------

router.get('/doctors', async (req, res) => {
  try {
    const doctors = await readJson('doctors.json', []);
    res.json({ doctors });
  } catch (err) {
    console.error('[admin] GET /doctors failed:', err);
    res.status(500).json({ error: 'Failed to load doctors' });
  }
});

router.post('/doctors', async (req, res) => {
  try {
    const { username, name } = req.body || {};
    if (!username || !name) {
      return res.status(400).json({ error: 'Username and name are required' });
    }
    const uname = String(username).trim();
    const config = await readJson('config.json', {});
    if (uname.toLowerCase() === String(config.adminUsername || 'admin').toLowerCase()) {
      return res.status(400).json({ error: 'This username is reserved for the administrator' });
    }

    const doctors = await readJson('doctors.json', []);
    if (doctors.some(d => d.username.toLowerCase() === uname.toLowerCase())) {
      return res.status(409).json({ error: 'A doctor with this username already exists' });
    }
    doctors.push({ username: uname, name: String(name).trim() });
    await writeJson('doctors.json', doctors);
    res.json({ ok: true, doctors });
  } catch (err) {
    console.error('[admin] POST /doctors failed:', err);
    res.status(500).json({ error: 'Failed to save doctor' });
  }
});

router.put('/doctors/:username', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const doctors = await readJson('doctors.json', []);
    const doc = doctors.find(d => d.username.toLowerCase() === req.params.username.toLowerCase());
    if (!doc) return res.status(404).json({ error: 'Doctor not found' });
    doc.name = String(name).trim();

    await writeJson('doctors.json', doctors);
    res.json({ ok: true, doctors });
  } catch (err) {
    console.error('[admin] PUT /doctors/:username failed:', err);
    res.status(500).json({ error: 'Failed to update doctor' });
  }
});

router.delete('/doctors/:username', async (req, res) => {
  try {
    const doctors = await readJson('doctors.json', []);
    const next = doctors.filter(d => d.username.toLowerCase() !== req.params.username.toLowerCase());
    if (next.length === doctors.length) return res.status(404).json({ error: 'Doctor not found' });

    await writeJson('doctors.json', next);
    res.json({ ok: true, doctors: next });
  } catch (err) {
    console.error('[admin] DELETE /doctors/:username failed:', err);
    res.status(500).json({ error: 'Failed to remove doctor' });
  }
});

// ---- Case data (CSV) --------------------------------------------------

router.get('/data-summary', async (req, res) => {
  try {
    const data = await readJson('sessions.json', { cases: [], sessions: [] });
    res.json({ caseCount: data.cases.length, sessionCount: data.sessions.length });
  } catch (err) {
    console.error('[admin] GET /data-summary failed:', err);
    res.status(500).json({ error: 'Failed to load data summary' });
  }
});

router.post('/upload-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    let parsed;
    try {
      parsed = parseCsvText(req.file.buffer.toString('utf8'));
    } catch (e) {
      console.error('[admin] CSV parse error:', e);
      return res.status(400).json({ error: 'Could not parse CSV file: ' + e.message });
    }
    if (!parsed.sessions.length) {
      return res.status(400).json({ error: 'No valid session rows found in the file' });
    }

    await writeJson('sessions.json', parsed);
    res.json({ ok: true, caseCount: parsed.cases.length, sessionCount: parsed.sessions.length });
  } catch (err) {
    console.error('[admin] POST /upload-csv failed:', err);
    res.status(500).json({ error: 'Failed to store uploaded data' });
  }
});

// ---- Statistics --------------------------------------------------------

router.get('/stats', async (req, res) => {
  try {
    const { cases, sessions } = await readJson('sessions.json', { cases: [], sessions: [] });
    const doctors = await readJson('doctors.json', []);
    const responses = await readJson('responses.json', {});

    let done = 0, inReview = 0, notHandled = 0;
    const perDoctor = doctors.map(d => {
      const mine = responses[d.username] || {};
      let dDone = 0, dInReview = 0, dNotHandled = 0;
      sessions.forEach(s => {
        const { status } = computeStatus(mine[s.id]);
        if (status === 'done') { dDone++; done++; }
        else if (status === 'in_review') { dInReview++; inReview++; }
        else { dNotHandled++; notHandled++; }
      });
      return { username: d.username, name: d.name, done: dDone, inReview: dInReview, notHandled: dNotHandled };
    });

    const perCase = cases.map(c => {
      const caseSessionIds = sessions.filter(s => s.case_uuid === c.case_uuid).map(s => s.id);
      let totalDone = 0;
      doctors.forEach(d => {
        const mine = responses[d.username] || {};
        caseSessionIds.forEach(id => {
          if (computeStatus(mine[id]).status === 'done') totalDone++;
        });
      });
      const totalSlots = caseSessionIds.length * doctors.length;
      return { case_uuid: c.case_uuid, title: c.title, sessionCount: c.sessionCount, totalSlots, totalDone };
    });

    res.json({
      doctorCount: doctors.length,
      caseCount: cases.length,
      sessionCount: sessions.length,
      totals: { done, inReview, notHandled },
      perDoctor,
      perCase
    });
  } catch (err) {
    console.error('[admin] GET /stats failed:', err);
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

// ---- Export collected reviewer data as CSV -----------------------------

router.get('/export.csv', async (req, res) => {
  try {
    const { sessions } = await readJson('sessions.json', { cases: [], sessions: [] });
    const doctors = await readJson('doctors.json', []);
    const responses = await readJson('responses.json', {});

    const vpIds = QUESTIONNAIRES.VP.items.map(i => i.id);
    const seIds = QUESTIONNAIRES.SE.items.map(i => i.id);
    const feIds = QUESTIONNAIRES.FE.items.map(i => i.id);

    const header = [
      'doctor_username', 'doctor_name',
      'case_uuid', 'case_title', 'session_id', 'session_timestamp', 'student_label',
      ...vpIds, 'VP_open',
      ...seIds,
      ...feIds, 'FE_open',
      'status',
      'hints_used', 'chat_duration_seconds', 'student_diagnosis',
      'ai_overall_score',
      'ai_score_diagnostic_accuracy', 'ai_score_question_quality', 'ai_score_clinical_reasoning',
      'ai_score_communication', 'ai_score_time_management'
    ];

    const catScore = (session, name) => {
      const c = (session.aiReview.categories || []).find(x => x.name.toLowerCase() === name.toLowerCase());
      return c ? c.score : '';
    };

    const rows = [];
    doctors.forEach(d => {
      const mine = responses[d.username] || {};
      sessions.forEach(s => {
        const rec = mine[s.id];
        if (!rec) return; // only export sessions the doctor actually touched
        const { status } = computeStatus(rec);
        const vp = (rec.VP && rec.VP.answers) || {};
        const se = (rec.SE && rec.SE.answers) || {};
        const fe = (rec.FE && rec.FE.answers) || {};

        rows.push([
          d.username, d.name,
          s.case_uuid, s.title, s.id, s.timestamp || '', s.studentLabel,
          ...vpIds.map(id => vp[id] ?? ''),
          (rec.VP && rec.VP.openText) || '',
          ...seIds.map(id => se[id] ?? ''),
          ...feIds.map(id => fe[id] ?? ''),
          (rec.FE && rec.FE.openText) || '',
          status,
          s.hints_used ?? '', s.chat_duration ?? '', s.studentDiagnosis || '',
          s.aiReview.overall_score ?? '',
          catScore(s, 'Diagnostic Accuracy'),
          catScore(s, 'Question Quality'),
          catScore(s, 'Clinical Reasoning'),
          catScore(s, 'Communication'),
          catScore(s, 'Time Management')
        ]);
      });
    });

    const csv = stringify([header, ...rows]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="medsim_reviewer_responses_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[admin] GET /export.csv failed:', err);
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

module.exports = router;
