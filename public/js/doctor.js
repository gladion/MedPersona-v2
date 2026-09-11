// public/js/doctor.js
const { esc, api, toast, fmtDate, fmtDuration } = Common;

const content = document.getElementById('content-area');
let QDEFS = null; // questionnaire schema, fetched once

function statusLabel(s) {
  return s === 'done' ? 'Handled' : s === 'in_review' ? 'In review' : 'Not handled';
}

function statusBadge(s) {
  return `<span class="status-badge ${s}"><span class="mark"></span>${statusLabel(s)}</span>`;
}

// ---------------------------------------------------------------- Router
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'cases' && parts[1] && parts[2] === 'sessions' && parts[3]) {
    return { view: 'session', caseUuid: parts[1], sessionId: parts[3] };
  }
  if (parts[0] === 'cases' && parts[1]) {
    return { view: 'case', caseUuid: parts[1] };
  }
  return { view: 'cases' };
}

async function render() {
  if (!QDEFS) {
    QDEFS = (await api('/api/doctor/questionnaires')).questionnaires;
  }
  const route = parseHash();
  try {
    if (route.view === 'cases') return renderCases();
    if (route.view === 'case') return renderCaseSessions(route.caseUuid);
    if (route.view === 'session') return renderSession(route.caseUuid, route.sessionId);
  } catch (e) {
    content.innerHTML = `<div class="empty-note">Something went wrong: ${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- Cases list
async function renderCases() {
  content.innerHTML = `<div class="empty-note">Loading cases…</div>`;
  const { cases } = await api('/api/doctor/cases');

  if (!cases.length) {
    content.innerHTML = `<div class="page-header"><div class="page-title">Patient Cases</div></div>
      <div class="empty-note">No cases are loaded yet. Please contact your administrator.</div>`;
    return;
  }

  const cards = cases.map(c => `
    <div class="case-card" onclick="window.location.hash='#/cases/${encodeURIComponent(c.case_uuid)}'">
      <div class="avatar">${esc(initials(c.title))}</div>
      <div class="name">${esc(c.title)}</div>
      <div class="count">${c.sessionCount} session${c.sessionCount !== 1 ? 's' : ''}</div>
      <div class="progress-dots">
        <span class="dot green"></span>${c.progress.done}
        <span class="dot yellow"></span>${c.progress.inReview}
        <span class="dot black"></span>${c.progress.notHandled}
      </div>
    </div>
  `).join('');

  content.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Patient Cases</div><div class="page-sub">Select a case to review its student sessions</div></div>
    </div>
    <div class="case-grid">${cards}</div>
  `;
}

function initials(name) {
  return name.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/i, '').trim().slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------- Session list for one case
async function renderCaseSessions(caseUuid) {
  content.innerHTML = `<div class="empty-note">Loading sessions…</div>`;
  const { case: caseInfo, sessions } = await api(`/api/doctor/cases/${encodeURIComponent(caseUuid)}/sessions`);

  const rows = sessions.map(s => `
    <tr class="row-clickable" onclick="window.location.hash='#/cases/${encodeURIComponent(caseUuid)}/sessions/${encodeURIComponent(s.id)}'">
      <td>${esc(s.studentLabel)}</td>
      <td>${fmtDate(s.timestamp)}</td>
      <td>${statusBadge(s.status)}</td>
    </tr>
  `).join('');

  content.innerHTML = `
    <div class="breadcrumb" onclick="window.location.hash='#/cases'">← Patient Cases / <span>${esc(caseInfo.title)}</span></div>
    <div class="page-header">
      <div><div class="page-title">${esc(caseInfo.title)}</div><div class="page-sub">${sessions.length} student session${sessions.length !== 1 ? 's' : ''}</div></div>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Student</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="empty-note">No sessions.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------- Session detail
async function renderSession(caseUuid, sessionId) {
  content.innerHTML = `<div class="empty-note">Loading session…</div>`;
  const data = await api(`/api/doctor/sessions/${encodeURIComponent(sessionId)}`);
  renderSessionView(caseUuid, data);
}

function renderSessionView(caseUuid, data) {
  const { session, answers, status, feedbackUnlocked, aiReview, sessionMeta } = data;

  const messagesHtml = session.messages.map(m => `
    <div class="msg ${m.role === 'student' ? 'student' : 'patient'}">
      <div>
        <div class="who">${m.role === 'student' ? 'Student' : session.title}</div>
        <div class="bubble">${esc(m.content)}</div>
      </div>
    </div>
  `).join('');

  content.innerHTML = `
    <div class="breadcrumb" onclick="window.location.hash='#/cases/${encodeURIComponent(caseUuid)}'">← ${esc(session.title)} sessions / <span>${esc(session.studentLabel)}</span></div>

    <div class="patient-banner">
      <div class="avatar">🧑‍⚕️</div>
      <div>
        <div class="pname">Virtual Patient: ${esc(session.title)}</div>
        <div class="pmeta">Session date: ${fmtDate(session.timestamp)} &middot; Reviewed by you: ${statusLabel(status)}</div>
      </div>
    </div>

    <div class="section-title"><span class="badge-num">💬</span> Student–Patient Conversation</div>
    <div class="chat-box">${messagesHtml || '<div class="empty-note">No conversation recorded.</div>'}</div>

    <div id="quest-area"></div>
  `;

  mountQuestionnaires(session.id, answers, feedbackUnlocked, aiReview, sessionMeta);
}

// ---------------------------------------------------------------- Questionnaires
function mountQuestionnaires(sessionId, initialAnswers, feedbackUnlocked, aiReview, sessionMeta) {
  const area = document.getElementById('quest-area');

  const state = {
    VP: (initialAnswers.VP && { ...initialAnswers.VP.answers }) || {},
    SE: (initialAnswers.SE && { ...initialAnswers.SE.answers }) || {},
    FE: (initialAnswers.FE && { ...initialAnswers.FE.answers }) || {}
  };
  const openState = {
    VP: (initialAnswers.VP && initialAnswers.VP.openText) || '',
    FE: (initialAnswers.FE && initialAnswers.FE.openText) || ''
  };
  let unlocked = feedbackUnlocked;
  let review = aiReview;
  let meta = sessionMeta;

  function itemOptionsHtml(section, item, def) {
    const val = state[section][item.id];
    return `<div class="optrow ${def.type === 'score10' ? 'score10' : ''}">` +
      def.options.map(o => `
        <button type="button" class="opt-btn ${val === o.value ? 'selected' : ''}"
          data-section="${section}" data-item="${item.id}" data-value="${o.value}">${esc(o.label)}</button>
      `).join('') + `</div>`;
  }

  function sectionHtml(sectionKey, num) {
    const def = QDEFS[sectionKey];
    const itemsHtml = def.items.map(item => `
      <div class="qitem">
        <div class="qtext">${esc(item.text)}</div>
        ${itemOptionsHtml(sectionKey, item, def)}
      </div>
    `).join('');

    const openHtml = def.openText ? `
      <div class="open-text-wrap">
        <label>${esc(def.openText.label)}</label>
        <textarea data-open="${sectionKey}" placeholder="Optional — type any notes here…">${esc(openState[sectionKey] || '')}</textarea>
      </div>
    ` : '';

    return `
      <div class="card qcard" id="qcard-${sectionKey}">
        <div class="qtitle"><span class="section-title-inline"><span class="badge-num" style="display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--blue);color:#fff;align-items:center;justify-content:center;font-size:.75rem;margin-right:.4rem;">${num}</span>${esc(def.title)}</span></div>
        <div class="qinstructions">${esc(def.instructions)}</div>
        ${itemsHtml}
        ${openHtml}
        <div class="autosave-note" id="autosave-${sectionKey}">Answers save automatically as you click.</div>
      </div>
    `;
  }

  function feedbackHtml() {
    if (!unlocked) {
      return `<div class="card locked-card">
        <div class="lock-icon">🔒</div>
        AI-generated feedback will appear here once Questionnaires 1 and 2 are complete.
      </div>`;
    }
    const cats = (review.categories || []).map(c => `
      <div class="review-cat">
        <div class="cname"><span>${esc(c.name)}</span><span>${c.score ?? '—'}/10</span></div>
        ${c.good && c.good.length ? `<ul class="good">${c.good.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
        ${c.bad && c.bad.length ? `<ul class="bad">${c.bad.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>
    `).join('');

    return `
      <div class="card review-card">
        <div class="rscore">Overall AI Score: ${review.overall_score ?? '—'}/10</div>
        <div style="font-size:.88rem;margin-bottom:.5rem">${esc(review.summary || '')}</div>
        ${cats}
        <div class="review-meta">
          <div>Hints used: <strong>${meta ? meta.hints_used : '—'}</strong></div>
          <div>Session duration: <strong>${meta ? fmtDuration(meta.chat_duration) : '—'}</strong></div>
          <div>Student's stated diagnosis: <strong>${meta ? esc(meta.studentDiagnosis || '—') : '—'}</strong></div>
          ${review.correct_diagnosis ? `<div>Reference diagnosis: <strong>${esc(review.correct_diagnosis)}</strong></div>` : ''}
        </div>
      </div>
    `;
  }

  function questionnaire3Html() {
    if (!unlocked) {
      return `<div class="card locked-card">
        <div class="lock-icon">🔒</div>
        Questionnaire 3 unlocks after Questionnaires 1 and 2 are complete.
      </div>`;
    }
    return sectionHtml('FE', 3);
  }

  function fullHtml() {
    return `
      <div class="section-title"><span class="badge-num">📝</span> Reviewer Questionnaires</div>
      ${sectionHtml('VP', 1)}
      ${sectionHtml('SE', 2)}
      <div class="section-title"><span class="badge-num">🤖</span> AI-Generated Feedback</div>
      ${feedbackHtml()}
      <div class="section-title"><span class="badge-num">📝</span> Questionnaire 3</div>
      ${questionnaire3Html()}
    `;
  }

  area.innerHTML = fullHtml();
  bindHandlers();

  function bindHandlers() {
    area.querySelectorAll('.opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        const itemId = btn.dataset.item;
        const value = Number(btn.dataset.value);
        state[section][itemId] = value;
        // update UI selection within this item's row only
        btn.parentElement.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        saveSection(section);
      });
    });

    area.querySelectorAll('textarea[data-open]').forEach(ta => {
      let t;
      ta.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const section = ta.dataset.open;
          openState[section] = ta.value;
          saveSection(section);
        }, 500);
      });
    });
  }

  let saveTimers = {};
  function saveSection(section) {
    const noteEl = document.getElementById(`autosave-${section}`);
    if (noteEl) { noteEl.textContent = 'Saving…'; noteEl.classList.remove('saved'); }

    clearTimeout(saveTimers[section]);
    saveTimers[section] = setTimeout(async () => {
      try {
        const res = await api(`/api/doctor/sessions/${encodeURIComponent(sessionId)}/answers`, {
          method: 'POST',
          body: JSON.stringify({
            section,
            answers: state[section],
            openText: openState[section]
          })
        });
        if (noteEl) { noteEl.textContent = 'Saved ✓'; noteEl.classList.add('saved'); }

        const wasUnlocked = unlocked;
        unlocked = res.feedbackUnlocked;
        review = res.aiReview;
        meta = res.sessionMeta;

        // Re-render the feedback + Q3 blocks if unlock state just changed,
        // or if we just saved something inside Q3 (to keep textarea focus stable we only
        // re-render sections that actually need it).
        if (!wasUnlocked && unlocked) {
          rerenderFeedbackAndQ3();
          toast('Questionnaires 1 & 2 complete — feedback unlocked');
        }
      } catch (e) {
        if (noteEl) { noteEl.textContent = 'Save failed — please try again'; }
        toast(e.message, true);
      }
    }, 150);
  }

  function rerenderFeedbackAndQ3() {
    // Re-render the whole questionnaire area now that feedback/Q3 unlocked.
    // Cheap enough, and all answers are preserved in `state`/`openState`.
    area.innerHTML = fullHtml();
    bindHandlers();
  }
}

// ---------------------------------------------------------------- Boot
(async function boot() {
  await Common.requireRole('doctor');
  Common.bindLogout();
  if (!window.location.hash) window.location.hash = '#/cases';
  render();
})();
