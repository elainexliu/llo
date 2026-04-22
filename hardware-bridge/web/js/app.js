import {
  KNOB_DEFS,
  knobValues,
  histories,
  callOpenAI,
  pushExchange,
} from './filter-engine.js';

/** ATmega32U4 Pro Micro: 10-bit ADC (0–1023). ESP32 12-bit builds: use 4095. */
const ADC_MAX = 1023;

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

const rotaryState = {
  mode: 'browse',
  selectedIndex: -1,
};

function rawToPercent(raw) {
  const n = Math.round((Number(raw) / ADC_MAX) * 100);
  return Math.max(0, Math.min(100, n));
}

function renderKnobs() {
  KNOB_DEFS.forEach((k, idx) => {
    const pct = knobValues[k.id];
    const row = document.querySelector(`[data-knob-row="${k.id}"]`);
    if (!row) return;
    row.classList.toggle(
      'rotary-browse-selected',
      rotaryState.mode === 'browse' && idx === rotaryState.selectedIndex,
    );
    row.classList.toggle(
      'rotary-edit-selected',
      rotaryState.mode === 'edit' && idx === rotaryState.selectedIndex,
    );
    const input = row.querySelector('.knob-slider');
    if (input) {
      input.value = String(pct);
      input.style.setProperty('--pct', `${pct}%`);
    }
    const valSpan = row.querySelector('.knob-val');
    if (valSpan) valSpan.textContent = String(pct);
  });
}

function buildKnobRows() {
  const container = document.getElementById('knobs');
  KNOB_DEFS.forEach((k) => {
    const v = knobValues[k.id];
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="knob-row" data-knob-row="${k.id}">
        <span class="knob-name">${k.label}</span>
        <input type="range" class="knob-slider" min="0" max="100" value="${v}"
          style="--pct:${v}%"
          data-knob="${k.id}">
        <span class="knob-val">${v}</span>
      </div>
      <div class="knob-labels"><span>${k.lo}</span><span>${k.hi}</span></div>
    `;
    container.appendChild(wrap);
    const input = wrap.querySelector('.knob-slider');
    input.addEventListener('input', function () {
      const id = this.dataset.knob;
      const val = parseInt(this.value, 10);
      knobValues[id] = val;
      this.style.setProperty('--pct', `${val}%`);
      this.nextElementSibling.textContent = String(val);
    });
  });
}

function applySerialPayload(obj) {
  if (typeof obj._mode === 'string') {
    rotaryState.mode = obj._mode === 'edit' ? 'edit' : 'browse';
  }
  if (Number.isInteger(obj._selected)) {
    rotaryState.selectedIndex = Math.max(0, Math.min(KNOB_DEFS.length - 1, obj._selected));
  }

  let changed = false;
  KNOB_DEFS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(obj, k.id)) {
      knobValues[k.id] = rawToPercent(obj[k.id]);
      changed = true;
    }
  });
  if (changed || typeof obj._mode === 'string' || Number.isInteger(obj._selected)) renderKnobs();
}

// ─── Web Serial (Chrome / Edge, localhost or HTTPS) ─────────────────────────
let port;
let readerAbort;

async function connectSerial() {
  if (!('serial' in navigator)) {
    document.getElementById('serial-status').textContent =
      'Web Serial not supported — use Chrome or Edge on localhost';
    return;
  }

  const btn = document.getElementById('btn-serial');
  if (port && port.readable) {
    try {
      readerAbort?.abort();
      await port.close();
    } catch (_) { /* ignore */ }
    port = undefined;
    btn.textContent = 'Connect serial';
    document.getElementById('serial-status').textContent = 'Disconnected';
    return;
  }

  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });

  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  const lineReader = decoder.readable.getReader();
  readerAbort = new AbortController();
  const signal = readerAbort.signal;

  btn.textContent = 'Disconnect';
  document.getElementById('serial-status').textContent = 'Connected';

  (async function readLoop() {
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await lineReader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || t[0] !== '{') continue;
          try {
            applySerialPayload(JSON.parse(t));
          } catch (_) { /* incomplete line */ }
        }
      }
    } catch (e) {
      if (!signal.aborted) console.warn('Serial read:', e);
    }
  })();
}

// ─── Text append helpers ─────────────────────────────────────────────────────
function appendReceivedLine(line) {
  const ta = document.getElementById('received');
  const t = line.trim();
  if (!t) return;
  ta.value = ta.value.trim() ? `${ta.value.trim()}\n${t}` : t;
  ta.scrollTop = ta.scrollHeight;
}

// ─── Text-to-speech: OpenAI (neural) via /api/tts, or browser Speech Synthesis ─
let ttsPlaybackChain = Promise.resolve();
let currentTtsAudio = null;
let currentTtsObjectUrl = null;

function stopAllSpeech() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (currentTtsAudio) {
    currentTtsAudio.pause();
    currentTtsAudio.removeAttribute('src');
    currentTtsAudio.load();
    currentTtsAudio = null;
  }
  if (currentTtsObjectUrl) {
    URL.revokeObjectURL(currentTtsObjectUrl);
    currentTtsObjectUrl = null;
  }
  ttsPlaybackChain = Promise.resolve();
}

function speakBrowserTTS(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve();
  }
  const t = text.trim();
  if (!t || t.startsWith('[error]')) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'en-US';
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

function speakOpenAITTS(text) {
  const t = text.trim().slice(0, 4096);
  const voice = document.getElementById('tts-voice')?.value || 'nova';
  const model = document.getElementById('tts-model')?.value || 'gpt-4o-mini-tts';

  return fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: t, voice, model }),
  }).then(async (res) => {
    if (!res.ok) {
      const ct = res.headers.get('content-type') || '';
      let errMsg = res.statusText;
      if (ct.includes('application/json')) {
        const j = await res.json().catch(() => ({}));
        errMsg = j.error || errMsg;
      } else {
        errMsg = (await res.text()).slice(0, 200) || errMsg;
      }
      throw new Error(errMsg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentTtsObjectUrl = url;
    return new Promise((resolve, reject) => {
      const a = new Audio();
      currentTtsAudio = a;
      a.src = url;
      const cleanup = () => {
        if (currentTtsObjectUrl === url) {
          URL.revokeObjectURL(url);
          currentTtsObjectUrl = null;
          currentTtsAudio = null;
        }
      };
      a.onended = () => {
        cleanup();
        resolve();
      };
      a.onerror = () => {
        cleanup();
        reject(new Error('Audio playback failed'));
      };
      a.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  });
}

function enqueueSpeak(text) {
  const t = text.trim();
  if (!t || t.startsWith('[error]')) return;
  const engine = document.getElementById('tts-engine')?.value || 'openai';

  ttsPlaybackChain = ttsPlaybackChain
    .then(async () => {
      if (engine === 'openai') {
        try {
          await speakOpenAITTS(t);
        } catch (e) {
          console.warn('OpenAI TTS failed, falling back to browser if available:', e);
          if (window.speechSynthesis) await speakBrowserTTS(t);
        }
      } else if (window.speechSynthesis) {
        await speakBrowserTTS(t);
      }
    })
    .catch(() => {});
}

function maybeSpeakNewTranslation(text) {
  const auto = document.getElementById('tts-auto');
  if (!auto?.checked) return;
  enqueueSpeak(text);
}

function syncTtsEngineControls() {
  const openai = document.getElementById('tts-engine')?.value === 'openai';
  const modelEl = document.getElementById('tts-model');
  const voiceEl = document.getElementById('tts-voice');
  if (modelEl) modelEl.disabled = !openai;
  if (voiceEl) voiceEl.disabled = !openai;
}

function appendTranslationLine(line) {
  const ta = document.getElementById('translation');
  const t = line.trim();
  if (!t) return;
  ta.value = ta.value.trim() ? `${ta.value.trim()}\n${t}` : t;
  ta.scrollTop = ta.scrollHeight;
  maybeSpeakNewTranslation(t);
}

// ─── Web Speech (Chrome / Edge; default mic) ─────────────────────────────────
let recognition;
let listeningDesired = false;
let voiceTranslateChain = Promise.resolve();
let lastFinalText = '';
let lastFinalAt = 0;

function shouldSkipDuplicateFinal(text) {
  const now = Date.now();
  if (text === lastFinalText && now - lastFinalAt < 900) return true;
  lastFinalText = text;
  lastFinalAt = now;
  return false;
}

function setMicStatusIdle() {
  const el = document.getElementById('mic-status');
  el.textContent = 'Mic idle';
  el.classList.remove('listening');
}

function setMicStatusListening(interim) {
  const el = document.getElementById('mic-status');
  el.classList.add('listening');
  const i = interim.trim();
  if (i.length > 160) {
    el.textContent = `Listening: ${i.slice(0, 157)}…`;
  } else {
    el.textContent = i ? `Listening: ${i}` : 'Listening…';
  }
}

function enqueueVoiceTranslate(segment) {
  const msg = segment.trim();
  if (!msg) return;
  voiceTranslateChain = voiceTranslateChain
    .then(async () => {
      const filtered = await callOpenAI(msg);
      appendTranslationLine(filtered);
      pushExchange(msg, filtered);
      updateMemoryBadge();
    })
    .catch((e) => {
      appendTranslationLine(`[error] ${e.message}`);
    });
}

function startListening() {
  if (!recognition) return;
  listeningDesired = true;
  document.getElementById('btn-mic-start').disabled = true;
  document.getElementById('btn-mic-stop').disabled = false;
  try {
    recognition.start();
  } catch (e) {
    if (e.name !== 'InvalidStateError') {
      document.getElementById('mic-status').textContent = e.message || String(e);
      listeningDesired = false;
      document.getElementById('btn-mic-start').disabled = false;
      document.getElementById('btn-mic-stop').disabled = true;
    }
  }
}

function stopListening() {
  listeningDesired = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch (_) { /* ignore */ }
  }
  document.getElementById('btn-mic-start').disabled = false;
  document.getElementById('btn-mic-stop').disabled = true;
  setMicStatusIdle();
}

function initSpeechRecognition() {
  if (!SpeechRecognition) return;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    document.getElementById('mic-status').classList.add('listening');
    document.getElementById('mic-status').textContent = 'Listening…';
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const piece = r[0].transcript;
      if (r.isFinal) finalText += piece;
      else interim += piece;
    }
    if (interim.trim()) setMicStatusListening(interim);
    const trimmed = finalText.trim();
    if (!trimmed) return;
    if (shouldSkipDuplicateFinal(trimmed)) return;
    appendReceivedLine(trimmed);
    enqueueVoiceTranslate(trimmed);
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed') {
      listeningDesired = false;
      document.getElementById('btn-mic-start').disabled = false;
      document.getElementById('btn-mic-stop').disabled = true;
      setMicStatusIdle();
    }
    document.getElementById('mic-status').textContent = `Mic: ${e.error}`;
  };

  recognition.onend = () => {
    if (listeningDesired) {
      try {
        recognition.start();
      } catch (_) { /* InvalidStateError: already running */ }
    } else {
      document.getElementById('btn-mic-start').disabled = false;
      document.getElementById('btn-mic-stop').disabled = true;
      setMicStatusIdle();
    }
  };
}

// ─── Translate ───────────────────────────────────────────────────────────────
function updateMemoryBadge() {
  const badge = document.getElementById('mem-badge');
  const count = histories.length / 2;
  if (count === 0) {
    badge.textContent = 'no memory';
    badge.classList.remove('active');
  } else {
    badge.textContent = `${Math.round(count)} turn${count !== 1 ? 's' : ''} in memory`;
    badge.classList.add('active');
  }
}

async function translate() {
  const input = document.getElementById('received');
  const msg = input.value.trim();
  if (!msg) return;

  const btn = document.getElementById('btn-translate');
  btn.disabled = true;
  try {
    const filtered = await callOpenAI(msg);
    appendTranslationLine(filtered);
    pushExchange(msg, filtered);
    updateMemoryBadge();
  } catch (e) {
    appendTranslationLine(`[error] ${e.message}`);
  }
  btn.disabled = false;
}

function resetMemory() {
  stopListening();
  stopAllSpeech();
  voiceTranslateChain = Promise.resolve();
  lastFinalText = '';
  lastFinalAt = 0;
  histories.length = 0;
  updateMemoryBadge();
  document.getElementById('translation').value = '';
  document.getElementById('received').value = '';
}

// ─── Init ────────────────────────────────────────────────────────────────────
buildKnobRows();
updateMemoryBadge();
initSpeechRecognition();

if (!SpeechRecognition) {
  document.getElementById('btn-mic-start').disabled = true;
  document.getElementById('btn-mic-stop').disabled = true;
  document.getElementById('mic-status').textContent = 'Speech API unavailable — use Chrome or Edge';
}

if (!('speechSynthesis' in window)) {
  const browserOpt = document.querySelector('#tts-engine option[value="browser"]');
  if (browserOpt) browserOpt.disabled = true;
}

document.getElementById('tts-engine')?.addEventListener('change', syncTtsEngineControls);
syncTtsEngineControls();

document.getElementById('btn-tts-last').addEventListener('click', () => {
  const ta = document.getElementById('translation');
  const lines = ta.value.trim().split('\n').filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (last) enqueueSpeak(last);
});

document.getElementById('btn-tts-stop').addEventListener('click', () => {
  stopAllSpeech();
});

document.getElementById('btn-mic-start').addEventListener('click', () => {
  if (!recognition) return;
  startListening();
});

document.getElementById('btn-mic-stop').addEventListener('click', () => {
  stopListening();
});

document.getElementById('btn-serial').addEventListener('click', () => {
  connectSerial().catch((e) => {
    document.getElementById('serial-status').textContent = e.message || String(e);
  });
});

document.getElementById('btn-translate').addEventListener('click', translate);
document.getElementById('btn-reset').addEventListener('click', resetMemory);

document.getElementById('received').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    translate();
  }
});
