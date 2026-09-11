# MedSim Review

A web application built for a joint Technion Faculty of Medicine / Faculty of
Education research project supporting the **MARAK** course (Introduction to
Clinical Medicine). It gives physician reviewers a secure dashboard to read
through medical students' conversations with an AI-simulated virtual patient
and to complete structured research questionnaires about each session.

---

## 1. What this system does

- **Doctors** log in and see a list of **patient cases** (virtual patients).
  Opening a case shows every **student session** recorded for it, each
  marked with a status:
  - 🟢 **Handled** — all three questionnaires are complete
  - 🟡 **In review** — some answers saved, not yet complete
  - ⚫ **Not handled** — nothing saved yet
- Opening a session shows the virtual patient's details, then the full
  chat transcript between the student and the virtual patient
  (**without** the AI's grade, so the doctor isn't anchored by it).
- Below the transcript are three questionnaires:
  1. **Virtual Patient (VP)** — 7 Likert-scale items + an optional open
     question, click-to-select only (no sliders, no free typing of scores).
  2. **Student Evaluation (SE)** — 5 categories scored 1–10, click-to-select.
  3. Once **both** VP and SE are fully answered, the **AI-generated
     feedback** for that session is revealed, and **Questionnaire 3
     (Feedback Evaluation / FE)** unlocks — 6 Likert items + an optional
     open question.
- Every click is **auto-saved to the server immediately** — nothing is lost
  if the browser is closed mid-review, and doctors can leave and resume a
  session at any time.
- **Doctors never see each other's answers or progress.**
- Student email addresses are **never stored or displayed** anywhere in the
  app or in any export.

- **Admins** (username `admin`) get a separate panel to:
  - View overall statistics (completion by doctor, by case)
  - Add / rename / remove doctor accounts (name + username)
  - Upload a new MARAK export CSV to (re)load all cases and sessions
  - Download all doctors' questionnaire answers as a single CSV for
    research analysis

Everything is stored in **MongoDB** (a free Atlas cluster works great — see
§3 below). This is what keeps the data safe on Render: Render's free web
services have an *ephemeral* filesystem, so anything written to local disk
is lost every time the service spins down, restarts, or redeploys. Using an
external database means your doctors' accounts, the loaded cases, and every
saved questionnaire answer survive all of that.

---

## 2. Logging in

There is a single shared password for **everyone** (doctors and admin):

```
1234
```

- Admin username: `admin`
- Two demo doctor accounts are created automatically the first time the
  server runs: `dr_cohen` and `dr_levi` (add/remove/rename real accounts
  from the Admin panel).

The password is stored only in the database (see §3) and is never sent to
the browser, logged to the console, or shown on the login page.

---

## 3. Database setup (MongoDB Atlas — free, ~2 minutes, no credit card)

The app needs one environment variable, `MONGODB_URI`, pointing at a
MongoDB database. Atlas's free tier (M0) is a good fit: it's free
**forever** (not a trial), and 512 MB is far more than this app needs.

1. Go to <https://www.mongodb.com/cloud/atlas/register> and create a free
   account.
2. Create a new **free (M0) cluster** — accept the defaults, pick any
   region close to you.
3. **Create a database user:** in the left sidebar, go to *Database Access*
   → *Add New Database User*. Choose a username/password (autogenerate is
   fine — just save it somewhere).
4. **Allow network access:** in *Network Access* → *Add IP Address*, choose
   **Allow Access from Anywhere** (`0.0.0.0/0`). This is the simplest
   option since Render's outbound IPs aren't fixed on the free plan; Atlas
   still requires the correct username/password to connect.
5. **Get your connection string:** go to your cluster → *Connect* →
   *Drivers*, copy the string that looks like:
   ```
   mongodb+srv://<username>:<password>@<cluster-url>/?retryWrites=true&w=majority
   ```
   Replace `<username>` and `<password>` with the database user you
   created (not your Atlas login).
6. Set that string as the `MONGODB_URI` environment variable — see §4
   (local) or §5 (Render).

You do **not** need to create any database, collection, or schema by hand
— the app creates everything it needs automatically on first launch.

---

## 4. Running the project locally

### Requirements
- [Node.js](https://nodejs.org) version 18 or later (includes `npm`)
- A MongoDB connection string (see §3)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Provide your database connection string
cp .env.example .env
# then edit .env and paste your MONGODB_URI

# 3. Start the server
npm start
```

Then open **http://localhost:3000** in your browser.

That's it — **no manual file or database editing is required.** On first
launch the server automatically connects to MongoDB and creates:
- the shared config (admin username + password)
- two demo doctor accounts
- the cases/sessions collection, seeded from the bundled CSV
  (`seed-data/historyMedPersona2.csv`) so the app has real cases to review
  right away

You can change the port with the `PORT` environment variable, e.g.
`PORT=8080 npm start`.

---

## 5. Deploying to Render

1. Push this project to a GitHub repository (see §7).
2. In Render, create a **New Web Service** from that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Render sets `PORT` automatically — the server already reads it via
   `process.env.PORT`, so no changes are needed there.
6. **Add the environment variable:** in the service's *Environment* tab,
   add `MONGODB_URI` with the connection string from §3. (Do this instead
   of committing a `.env` file — `.env` is gitignored on purpose.)
7. Deploy. The first request may take a little longer (Free services
   spin up in about a minute if they'd gone idle), after which the app
   connects to MongoDB and bootstraps itself exactly like a local run.

### Why this solves the data-loss problem
Render's Free web services have an **ephemeral filesystem** — any file
written to local disk is lost every time the service spins down (after
15 minutes idle), restarts, or redeploys. Since this app now stores
everything in MongoDB Atlas instead of local files, none of that affects
your data — Atlas is a separate, always-on service. The only thing that
resets on a Render restart is the **login session** (doctors/admin just
need to sign in again); no case data, doctor accounts, or questionnaire
answers are ever kept only on Render's disk.

*(Note: Render also offers its own free Postgres and free Key Value
add-ons, but the free Postgres expires 30 days after creation and the
free Key Value plan doesn't persist to disk at all — neither is a good
fit for a multi-week research study, which is why this app uses an
external Atlas cluster instead.)*

---

## 6. Project structure

```
medsim-review/
├── server.js                  # entry point: connects to MongoDB, bootstraps data, starts Express
├── package.json
├── .env.example                # template for your local MONGODB_URI (copy to .env)
├── seed-data/
│   └── historyMedPersona2.csv # bundled CSV used to seed data on first run
├── server/
│   ├── routes/
│   │   ├── auth.js            # login / logout / current user
│   │   ├── doctor.js          # cases, sessions, autosave answers
│   │   └── admin.js           # doctor management, stats, CSV upload/export
│   └── utils/
│       ├── store.js           # MongoDB-backed read/write (queued per document)
│       ├── auth.js            # session-based auth middleware
│       ├── csvLoader.js       # CSV → cases/sessions parser
│       └── questionnaires.js  # single source of truth for all 3 questionnaires
└── public/                    # static frontend (vanilla HTML/CSS/JS, no build step)
    ├── login.html
    ├── doctor.html / js/doctor.js
    ├── admin.html  / js/admin.js
    ├── js/common.js
    └── css/style.css
```

All persistent data (config, doctor accounts, cases/sessions, and every
questionnaire answer) lives in a single MongoDB collection called
`kvstore`, as four documents keyed `config.json`, `doctors.json`,
`sessions.json`, and `responses.json` — one per logical "file" the app
used to keep on disk. There's no local `data/` folder anymore.

---

## 7. Publishing to GitHub

```bash
git init
git add .
git commit -m "Initial commit: MedSim Review"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

The `.gitignore` excludes `node_modules/` and `.env` (so your database
credentials are never committed). Anyone who clones the repo just needs
their own `MONGODB_URI` (§3–§4) to run it — the app bootstraps its own
data on first launch either way.

---

## 8. CSV formats

### Input: cases/sessions CSV (uploaded by admin, or bundled seed file)
Expected columns (as produced by the MARAK export): `id, user_id, messages,
diagnosis, timestamp, title, review, score, chat_duration, tests_asked,
requested_tests, hints_used, case_uuid, email`.

- `email` is read and then **discarded** — it is never written to disk or
  exposed via the API.
- `messages` and `review` are JSON strings (chat transcript and AI
  grading, respectively).
- Uploading a new CSV **replaces** all cases/sessions; existing doctors'
  saved answers are kept separately and are unaffected.

### Output: reviewer responses CSV (downloaded by admin)
One row per doctor × session that has at least one saved answer. Columns:

```
doctor_username, doctor_name, case_uuid, case_title, session_id,
session_timestamp, student_label,
VP_1..VP_7, VP_open,
SE_1..SE_5,
FE_1..FE_6, FE_open,
status,
hints_used, chat_duration_seconds, student_diagnosis,
ai_overall_score,
ai_score_diagnostic_accuracy, ai_score_question_quality,
ai_score_clinical_reasoning, ai_score_communication, ai_score_time_management
```

Question indices exactly match the three questionnaires, so the export can
be joined directly against the questionnaire text for analysis.
`student_label` is an anonymized identifier (not the student's email).

---

## 9. Notes on design choices

- **Click-only inputs:** every questionnaire answer (including the 1–10
  student-evaluation scores) is a button group, not a slider or free-text
  number field. This guarantees Questionnaire 3 cannot silently unlock
  before the doctor has deliberately answered every item in Questionnaires
  1 and 2.
- **Progressive reveal:** the AI's feedback and score are hidden until
  both Questionnaire 1 and 2 are fully answered, so the doctor's own
  judgment isn't influenced by the AI's grading beforehand.
- **Per-doctor isolation:** all questionnaire answers and statuses are
  keyed by `(doctor username, session id)`, so doctors only ever see and
  affect their own progress.
- **No client-side secrets:** the shared password lives only in the
  database, read on the server side only.
- **Login sessions are not persisted to the database on purpose** — they
  use Express's in-memory session store, so a server restart just requires
  signing in again. Everything doctors and the admin have actually saved
  (accounts, cases, questionnaire answers) lives in MongoDB and is
  unaffected. If you'd like sessions to survive restarts too (e.g. so
  nobody ever needs to re-login), this can be added with `connect-mongo` —
  just ask.
