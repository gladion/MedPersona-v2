// server/utils/csvLoader.js
// Parses the MARAK export CSV into the internal { cases, sessions } shape.
// IMPORTANT: student emails are intentionally dropped and never stored.

const { parse } = require('csv-parse/sync');
const crypto = require('crypto');

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

// Deterministic, non-reversible short label for a student, derived from user_id.
// Never derived from email, and email is never stored anywhere downstream.
function studentLabelFor(userId) {
  const hash = crypto.createHash('sha256').update(String(userId || '')).digest('hex');
  return 'Student-' + hash.slice(0, 6).toUpperCase();
}

function parseCsvText(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true
  });

  const sessions = [];
  const caseMap = new Map(); // case_uuid -> { case_uuid, title, sessionCount }

  for (const row of records) {
    const caseUuid = (row.case_uuid || '').trim();
    if (!caseUuid) continue;

    const messagesRaw = safeJsonParse(row.messages, []);
    const messages = Array.isArray(messagesRaw)
      ? messagesRaw.map(m => ({
          role: m.role === 'assistant' ? 'patient' : 'student',
          content: m.content || '',
          timestamp: m.timestamp || null
        }))
      : [];

    const reviewRaw = safeJsonParse(row.review, null);
    const reviewInner = reviewRaw && reviewRaw.review ? reviewRaw.review : reviewRaw;

    const categories = (reviewInner && Array.isArray(reviewInner.categories))
      ? reviewInner.categories.map(c => ({
          name: c.name || '',
          score: (c.score !== undefined && c.score !== null) ? Number(c.score) : null,
          good: Array.isArray(c.good) ? c.good : [],
          bad: Array.isArray(c.bad) ? c.bad : []
        }))
      : [];

    const session = {
      id: row.id,
      case_uuid: caseUuid,
      title: row.title || 'Unknown',
      studentDiagnosis: row.diagnosis || '',
      timestamp: row.timestamp || null,
      studentLabel: studentLabelFor(row.user_id),
      messages,
      chat_duration: row.chat_duration ? Number(row.chat_duration) : null,
      hints_used: row.hints_used ? Number(row.hints_used) : 0,
      tests_asked: row.tests_asked || '',
      requested_tests: row.requested_tests || '',
      aiReview: {
        overall_score: (reviewInner && reviewInner.overall_score !== undefined) ? Number(reviewInner.overall_score) : null,
        summary: (reviewInner && reviewInner.summary) || '',
        categories,
        correct_diagnosis: (reviewInner && reviewInner.correct_diagnosis) || ''
      }
    };
    sessions.push(session);

    if (!caseMap.has(caseUuid)) {
      caseMap.set(caseUuid, { case_uuid: caseUuid, title: session.title, sessionCount: 0 });
    }
    caseMap.get(caseUuid).sessionCount += 1;
  }

  // Sort sessions chronologically (oldest first) within each case for a stable list.
  sessions.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  const cases = Array.from(caseMap.values()).sort((a, b) => a.title.localeCompare(b.title));

  return { cases, sessions };
}

module.exports = { parseCsvText, studentLabelFor };
