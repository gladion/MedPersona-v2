// public/js/admin.js
const { esc, api, toast } = Common;

const content = document.getElementById('content-area');
let activeTab = 'stats';

function tabsHtml() {
  const tabs = [
    ['stats', 'Statistics'],
    ['doctors', 'Doctors'],
    ['data', 'Case Data & Export']
  ];
  return `<div class="tabs">${tabs.map(([key, label]) =>
    `<button class="tab-btn ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`
  ).join('')}</div>`;
}

async function render() {
  content.innerHTML = `
    <div class="page-header"><div><div class="page-title">Admin Panel</div><div class="page-sub">Research data &amp; system management</div></div></div>
    ${tabsHtml()}
    <div id="tab-body"><div class="empty-note">Loading…</div></div>
  `;
  content.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      render();
    });
  });

  const body = document.getElementById('tab-body');
  try {
    if (activeTab === 'stats') await renderStats(body);
    else if (activeTab === 'doctors') await renderDoctors(body);
    else if (activeTab === 'data') await renderData(body);
  } catch (e) {
    body.innerHTML = `<div class="empty-note">Failed to load: ${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------- Statistics
async function renderStats(body) {
  const stats = await api('/api/admin/stats');

  const statCards = [
    ['Doctors', stats.doctorCount],
    ['Cases', stats.caseCount],
    ['Sessions', stats.sessionCount],
    ['Handled', stats.totals.done],
    ['In review', stats.totals.inReview],
    ['Not handled', stats.totals.notHandled]
  ].map(([label, value]) => `
    <div class="card stat-card"><div class="label">${esc(label)}</div><div class="value">${value}</div></div>
  `).join('');

  const doctorRows = stats.perDoctor.map(d => `
    <tr>
      <td>${esc(d.name)}</td>
      <td>${esc(d.username)}</td>
      <td>${statusChip('done', d.done)}</td>
      <td>${statusChip('in_review', d.inReview)}</td>
      <td>${statusChip('not_handled', d.notHandled)}</td>
    </tr>
  `).join('');

  const caseRows = stats.perCase.map(c => `
    <tr>
      <td>${esc(c.title)}</td>
      <td>${c.sessionCount}</td>
      <td>${c.totalDone} / ${c.totalSlots}</td>
    </tr>
  `).join('');

  body.innerHTML = `
    <div class="stat-grid">${statCards}</div>

    <h3 style="margin-bottom:.6rem">Progress by Doctor</h3>
    <div class="card table-wrap" style="margin-bottom:1.75rem">
      <table>
        <thead><tr><th>Name</th><th>Username</th><th>Handled</th><th>In review</th><th>Not handled</th></tr></thead>
        <tbody>${doctorRows || '<tr><td colspan="5" class="empty-note">No doctors yet.</td></tr>'}</tbody>
      </table>
    </div>

    <h3 style="margin-bottom:.6rem">Progress by Case (reviews completed / total possible)</h3>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Case</th><th>Sessions</th><th>Completed reviews</th></tr></thead>
        <tbody>${caseRows || '<tr><td colspan="3" class="empty-note">No cases loaded yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function statusChip(status, count) {
  const label = status === 'done' ? 'Handled' : status === 'in_review' ? 'In review' : 'Not handled';
  return `<span class="status-badge ${status}"><span class="mark"></span>${count} ${label}</span>`;
}

// ---------------------------------------------------------------- Doctors
async function renderDoctors(body) {
  const { doctors } = await api('/api/admin/doctors');

  const rows = doctors.map(d => `
    <tr data-username="${esc(d.username)}">
      <td class="cell-name">${esc(d.name)}</td>
      <td>${esc(d.username)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm edit-btn">Rename</button>
        <button class="btn btn-danger btn-sm del-btn">Remove</button>
      </td>
    </tr>
  `).join('');

  body.innerHTML = `
    <div class="card pad" style="margin-bottom:1.5rem">
      <h3 style="margin-bottom:1rem">Add Doctor</h3>
      <form id="add-doctor-form" class="form-row">
        <div class="field"><label>Full name</label><input type="text" id="new-doc-name" required placeholder="e.g. Dr. Sarah Cohen"></div>
        <div class="field"><label>Username</label><input type="text" id="new-doc-username" required placeholder="e.g. dr_cohen"></div>
        <button type="submit" class="btn btn-primary">Add Doctor</button>
      </form>
      <div style="font-size:.78rem;color:var(--muted);margin-top:.6rem">All doctors sign in with the same shared password used for the admin account. Doctors cannot see each other's reviews.</div>
    </div>

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Username</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="empty-note">No doctors yet — add one above.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('add-doctor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-doc-name').value.trim();
    const username = document.getElementById('new-doc-username').value.trim();
    if (!name || !username) return;
    try {
      await api('/api/admin/doctors', { method: 'POST', body: JSON.stringify({ name, username }) });
      toast('Doctor added');
      renderDoctors(body);
    } catch (err) {
      toast(err.message, true);
    }
  });

  body.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const username = tr.dataset.username;
      const currentName = tr.querySelector('.cell-name').textContent;
      const newName = window.prompt('New name for ' + username, currentName);
      if (!newName || newName.trim() === currentName) return;
      try {
        await api(`/api/admin/doctors/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ name: newName.trim() }) });
        toast('Doctor updated');
        renderDoctors(body);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  body.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const username = tr.dataset.username;
      if (!window.confirm(`Remove doctor "${username}"? Their saved review data will be kept on disk but they will no longer be able to sign in.`)) return;
      try {
        await api(`/api/admin/doctors/${encodeURIComponent(username)}`, { method: 'DELETE' });
        toast('Doctor removed');
        renderDoctors(body);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// ---------------------------------------------------------------- Case data / export
async function renderData(body) {
  const summary = await api('/api/admin/data-summary');

  body.innerHTML = `
    <div class="card pad" style="margin-bottom:1.5rem">
      <h3 style="margin-bottom:.4rem">Current Case Data</h3>
      <div style="font-size:.88rem;color:var(--muted);margin-bottom:1rem">${summary.caseCount} case(s), ${summary.sessionCount} session(s) currently loaded.</div>

      <div class="upload-drop">
        Upload a MARAK export CSV to (re)load all patient cases and student sessions.<br>
        <strong>Note:</strong> this replaces the currently loaded case/session data. Doctors' saved questionnaire answers are kept separately and are not affected.
        <div><input type="file" id="csv-file" accept=".csv"></div>
        <button class="btn btn-primary" id="upload-btn" style="margin-top:1rem">Upload &amp; Replace Case Data</button>
      </div>
    </div>

    <div class="card pad">
      <h3 style="margin-bottom:.4rem">Export Reviewer Responses</h3>
      <div style="font-size:.88rem;color:var(--muted);margin-bottom:1rem">
        Download all doctors' questionnaire answers as CSV for research analysis. Question indices match the questionnaires
        (VP_1–VP_7, SE_1–SE_5, FE_1–FE_6) plus hints used, session duration, and the AI's original per-category student scores.
        Student email addresses are never included.
      </div>
      <a href="/api/admin/export.csv" class="btn btn-primary" download>⬇ Download CSV</a>
    </div>
  `;

  document.getElementById('upload-btn').addEventListener('click', async () => {
    const fileInput = document.getElementById('csv-file');
    if (!fileInput.files.length) { toast('Please choose a CSV file first', true); return; }
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
      const res = await fetch('/api/admin/upload-csv', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast(`Loaded ${data.sessionCount} sessions across ${data.caseCount} cases`);
      renderData(body);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------------------------------------------------------- Boot
(async function boot() {
  await Common.requireRole('admin');
  Common.bindLogout();
  render();
})();
