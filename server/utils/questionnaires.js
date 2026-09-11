// server/utils/questionnaires.js
// Single source of truth for the three reviewer questionnaires.
// Used both to render the forms on the client and to check completeness
// on the server (which drives session status + when the AI feedback /
// next questionnaire unlock).

const LIKERT_5 = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' }
];

const SCORE_10 = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

const QUESTIONNAIRES = {
  VP: {
    key: 'VP',
    title: 'Questionnaire 1 \u2014 Virtual Patient (VP)',
    instructions: "Please indicate your level of agreement with the following statements regarding the virtual patient.",
    type: 'likert5',
    options: LIKERT_5,
    items: [
      { id: 'VP_1', text: 'The virtual patient responded coherently and consistently' },
      { id: 'VP_2', text: "The virtual patient's responses were appropriate for the conversation" },
      { id: 'VP_3', text: 'The virtual patient behaved in a way that felt realistic' },
      { id: 'VP_4', text: "The virtual patient's responses reflected the information the student provided" },
      { id: 'VP_5', text: 'The virtual patient does not understand the emotional experience of real patients' },
      { id: 'VP_6', text: "The virtual patient understands the situation from the patient's perspective" },
      { id: 'VP_7', text: 'The virtual patient understands the meaning behind what was said' }
    ],
    openText: { id: 'VP_open', label: "Open-ended question: Were there any specific issues with the virtual patient's behavior?" }
  },
  SE: {
    key: 'SE',
    title: 'Questionnaire 2 \u2014 Student Evaluation (SE)',
    instructions: "Rate the student's performance in the interaction across the following categories.",
    type: 'score10',
    options: SCORE_10,
    items: [
      { id: 'SE_1', text: 'Diagnosis accuracy' },
      { id: 'SE_2', text: 'Question Quality' },
      { id: 'SE_3', text: 'Clinical Reasoning' },
      { id: 'SE_4', text: 'Communication' },
      { id: 'SE_5', text: 'Time management' }
    ],
    openText: null
  },
  FE: {
    key: 'FE',
    title: 'Questionnaire 3 \u2014 Feedback Evaluation',
    instructions: 'Please indicate your level of agreement with the following statements regarding the feedback received by the student.',
    type: 'likert5',
    options: LIKERT_5,
    items: [
      { id: 'FE_1', text: "The feedback was relevant to the student's interaction with the virtual patient" },
      { id: 'FE_2', text: 'The feedback provided helpful suggestions for improvement' },
      { id: 'FE_3', text: 'The feedback was too general to be useful' },
      { id: 'FE_4', text: 'The feedback did not reflect what actually happened during the interaction' },
      { id: 'FE_5', text: "The feedback did not understand important parts of the student's and the virtual patient's interaction" },
      { id: 'FE_6', text: "The feedback reflected the key aspects of the student's interaction with the virtual patient" }
    ],
    openText: { id: 'FE_open', label: 'Open-ended question: Were there any specific issues with the AI generated feedback?' }
  }
};

const ORDER = ['VP', 'SE', 'FE'];

// A questionnaire is "complete" once every scored item has a value.
// The open-ended text is optional and does not block completion.
function isSectionComplete(sectionKey, answers) {
  const def = QUESTIONNAIRES[sectionKey];
  if (!def) return false;
  if (!answers) return false;
  return def.items.every(item => {
    const v = answers[item.id];
    return v !== undefined && v !== null && v !== '';
  });
}

// Overall status for one doctor/session pair.
function computeStatus(responseRecord) {
  const r = responseRecord || {};
  const vpDone = isSectionComplete('VP', r.VP && r.VP.answers);
  const seDone = isSectionComplete('SE', r.SE && r.SE.answers);
  const feDone = isSectionComplete('FE', r.FE && r.FE.answers);

  const anyStarted =
    (r.VP && r.VP.answers && Object.keys(r.VP.answers).length > 0) ||
    (r.SE && r.SE.answers && Object.keys(r.SE.answers).length > 0) ||
    (r.FE && r.FE.answers && Object.keys(r.FE.answers).length > 0);

  let status = 'not_handled';
  if (vpDone && seDone && feDone) status = 'done';
  else if (anyStarted) status = 'in_review';

  return { status, vpDone, seDone, feDone, feedbackUnlocked: vpDone && seDone };
}

module.exports = { QUESTIONNAIRES, ORDER, isSectionComplete, computeStatus };
