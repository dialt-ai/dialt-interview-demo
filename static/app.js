import { DialtClient } from 'https://cdn.jsdelivr.net/npm/@dialt/sdk@0.48.1/src/index.js';

const config = await fetch('/api/config').then(response => {
  if (!response.ok) throw new Error('Could not load the interview configuration.');
  return response.json();
});

const answers = {};
const transcript = document.querySelector('#transcript');
const fieldsElement = document.querySelector('#fields');
const statusElement = document.querySelector('#status');
const statusDot = document.querySelector('#status-dot');
const startButton = document.querySelector('#start');
const endButton = document.querySelector('#end');
const setupAlert = document.querySelector('#setup-alert');
let client = null;
let hasTranscript = false;
let endBackstop = null;
const assistantTurns = new Map();

function escapeHtml(value) {
  const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
  return String(value).replace(/[&<>"']/g, character => map[character]);
}

function setStatus(text, kind = 'idle') {
  statusElement.textContent = text;
  statusDot.classList.toggle('active', kind === 'active');
  statusDot.classList.toggle('error', kind === 'error');
}

function renderFields() {
  const required = config.fields.filter(field => field.required !== false);
  const completeCount = required.filter(field => answers[field.key]).length;
  const percent = Math.round((completeCount / required.length) * 100);
  document.querySelector('#progress-count').textContent = `${completeCount} of ${required.length}`;
  document.querySelector('#progress-bar').style.width = `${percent}%`;
  fieldsElement.innerHTML = config.fields.map(field => {
    const answer = answers[field.key];
    const optional = field.required === false ? ' <span class="text-secondary fw-normal">(optional)</span>' : '';
    return `<div class="field-row d-flex gap-3 ${answer ? 'complete' : ''}">
      <span class="field-check" aria-hidden="true">✓</span>
      <div>
        <div class="fw-semibold">${escapeHtml(field.label)}${optional}</div>
        <div class="field-answer">${escapeHtml(answer || field.description)}</div>
      </div>
    </div>`;
  }).join('');
}

function addTurn(role, text, detail = {}, {append = false} = {}) {
  if (typeof text !== 'string' || !text.length || (role === 'user' && !text.trim())) return;
  if (!hasTranscript) {
    transcript.innerHTML = '';
    hasTranscript = true;
  }

  const turnKey = role === 'assistant'
    ? String(detail.turn_id || detail.barge_seq || '')
    : null;
  if (turnKey && assistantTurns.has(turnKey)) {
    const content = assistantTurns.get(turnKey).querySelector('.turn-text');
    content.textContent = append ? `${content.textContent}${text}` : text;
    transcript.scrollTop = transcript.scrollHeight;
    return;
  }

  const turn = document.createElement('div');
  turn.className = `turn ${role}`;
  const label = document.createElement('span');
  label.className = 'turn-label';
  label.textContent = role === 'user' ? 'You' : 'Interviewer';
  const content = document.createElement('span');
  content.className = 'turn-text';
  content.textContent = text;
  turn.append(label, content);
  transcript.append(turn);
  if (turnKey) assistantTurns.set(turnKey, turn);
  transcript.scrollTop = transcript.scrollHeight;
}

function showError(message) {
  setupAlert.textContent = message;
  setupAlert.classList.remove('d-none');
  setStatus('Could not start', 'error');
  startButton.disabled = false;
}

function showMicWarning() {
  setupAlert.textContent = 'Your microphone sounds silent. Check the selected input, hardware mute, and browser or system microphone permissions.';
  setupAlert.classList.remove('d-none');
  setStatus('Microphone seems quiet', 'error');
}

function resetAfterEnd(message = 'Interview ended') {
  if (endBackstop) clearTimeout(endBackstop);
  endBackstop = null;
  client = null;
  setStatus(message);
  endButton.classList.add('d-none');
  startButton.textContent = 'Start a new interview';
  startButton.classList.remove('d-none');
  startButton.disabled = false;
  endButton.disabled = false;
}

async function forceCloseInterview(message = 'Interview ended') {
  const activeClient = client;
  if (!activeClient) return;
  try {
    await activeClient.closeAndWait(2000);
  } catch {
    activeClient.close();
  } finally {
    resetAfterEnd(message);
  }
}

function requestInterviewEnd() {
  if (!client) return;
  endButton.disabled = true;
  setStatus('Wrapping up', 'active');
  client.requestWrapUp('The participant chose to end the interview.');
  endBackstop = setTimeout(() => forceCloseInterview(), 10000);
}

async function startInterview() {
  startButton.disabled = true;
  setupAlert.classList.add('d-none');
  setStatus('Preparing microphone', 'active');
  Object.keys(answers).forEach(key => delete answers[key]);
  assistantTurns.clear();
  hasTranscript = false;
  transcript.innerHTML = '<div class="empty-state">Your conversation will appear here.</div>';
  renderFields();

  try {
    const response = await fetch('/api/session', {method: 'POST'});
    const credential = await response.json();
    if (!response.ok) throw new Error(credential.detail || `Session setup failed (${response.status}).`);

    client = new DialtClient({
      url: credential.ws_url,
      sessionId: credential.session_id,
      apiKey: credential.api_key,
      mode: {
        kind: 'dialt',
        modality: 'voice',
        instructions: config.instructions,
        tools: [config.tool],
        greeting: config.greeting,
        end_call: true,
      },
    });

    client.addEventListener('asr', event => addTurn('user', event.detail.text));
    client.addEventListener('text_delta', event => {
      addTurn('assistant', event.detail.delta, event.detail, {append: true});
    });
    client.addEventListener('utterance', event => addTurn('assistant', event.detail.text, event.detail));
    client.addEventListener('warming_up', () => setStatus('Warming up', 'active'));
    client.addEventListener('listening', () => {
      setupAlert.classList.add('d-none');
      setStatus('Listening', 'active');
    });
    client.addEventListener('recovering', () => setStatus('Reconnecting', 'active'));
    client.addEventListener('failed', event => showError(event.detail?.detail || 'The voice connection failed.'));
    client.addEventListener('error', event => showError(event.detail?.detail || event.detail?.error || 'The voice connection failed.'));
    client.addEventListener('silent_mic', showMicWarning);
    client.addEventListener('working', event => {
      if (event.detail.active) setStatus('Saving interview note', 'active');
      else setStatus('Listening', 'active');
    });
    client.addEventListener('tool_call', event => {
      const {id, name, args} = event.detail;
      if (name !== config.tool.name) return;
      const updates = args.updates;
      const knownFields = new Set(config.fields.map(field => field.key));
      const valid = Array.isArray(updates) && updates.length > 0 && updates.every(update => (
        update
        && knownFields.has(update.field)
        && typeof update.value === 'string'
        && update.value.trim()
      ));
      if (!valid) {
        client.sendToolResult(
          id,
          {error: 'updates must contain known fields with non-empty text values'},
          {outcome: 'failed', verified: false},
        );
        return;
      }

      const recordedFields = [];
      for (const update of updates) {
        answers[update.field] = update.value.trim();
        if (!recordedFields.includes(update.field)) recordedFields.push(update.field);
      }
      const missing = config.required_fields.filter(field => !answers[field]);
      client.sendToolResult(
        id,
        {recorded: recordedFields, missing_required: missing, complete: missing.length === 0},
        {outcome: 'succeeded', verified: true},
      );
      requestAnimationFrame(renderFields);
    });
    client.addEventListener('session_end_requested', () => {
      endButton.disabled = true;
      setStatus('Finishing interview', 'active');
      endBackstop = setTimeout(() => forceCloseInterview('Interview complete'), 10000);
    });
    client.addEventListener('session_end', () => resetAfterEnd('Interview complete'));

    await client.unlockAudio();
    await client.connect();
    await client.startMic();
    setStatus('Listening', 'active');
    startButton.classList.add('d-none');
    endButton.classList.remove('d-none');
  } catch (error) {
    if (client) {
      await client.closeAndWait(2000).catch(() => client.close());
      client = null;
    }
    showError(error.message || 'Could not start the interview.');
  }
}

startButton.addEventListener('click', startInterview);
endButton.addEventListener('click', requestInterviewEnd);
renderFields();

fetch('/api/health')
  .then(response => response.json())
  .then(health => {
    if (!health.configured) {
      setupAlert.textContent = 'Add CONVERSE_API_KEY to .env before starting the interview.';
      setupAlert.classList.remove('d-none');
    }
  })
  .catch(() => {});
