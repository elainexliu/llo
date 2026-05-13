import {
  callClaude,
  setCustomPersonalityPrompt,
  setCustomFullSystemPrompt,
  clearCustomPersonalityFilters,
  buildSystemPrompt,
  buildTranslationSystemPromptFromPersonality,
} from './filter-engine.js';
import { normalizeNfcUidString } from './nfc-profiles.js';

/** @type {{ version: number, tags: Record<string, { phrase?: string, blurb?: string, summary?: string, prompt: string, source?: string, translationSystemPrompt?: string, promptFormat?: string }> }} */
let nfcPersonalityStore = { version: 1, tags: {} };

function lowerNfcLabel(s) {
  return (typeof s === 'string' ? s.trim() : '').toLowerCase();
}

function tagPhrase(tag) {
  if (!tag) return '';
  return lowerNfcLabel(tag.phrase || tag.summary || '');
}
let nfcCanonicalPreviewTimer;
let lastScannedNfcUid = '';

const SpeechRecognition =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

function setDeviceScreenReadout(text) {
  const el = document.getElementById('device-screen');
  if (!el) return;
  const t = (text || '').trim() || '— no tag —';
  el.textContent = t.length > 200 ? `${t.slice(0, 197)}…` : t;
}

function setPersonalitiesStatus(msg, isError) {
  const el = document.getElementById('nfc-personalities-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#f0a0a0' : 'var(--muted)';
}

function refreshNfcCanonicalPreview() {
  const el = document.getElementById('nfc-preview-canonical');
  if (!el) return;
  const pr = (document.getElementById('nfc-edit-prompt')?.value || '').trim();
  const fmt = document.getElementById('nfc-prompt-format')?.value || 'inner';
  try {
    el.value = fmt === 'full' && pr ? pr : buildTranslationSystemPromptFromPersonality(pr);
  } catch {
    el.value = '';
  }
}

function refreshNfcLiveSystemPreview() {
  const el = document.getElementById('nfc-preview-live');
  if (!el) return;
  try {
    el.value = buildSystemPrompt();
  } catch {
    el.value = '';
  }
}

function scheduleNfcCanonicalPreview() {
  clearTimeout(nfcCanonicalPreviewTimer);
  nfcCanonicalPreviewTimer = setTimeout(() => {
    refreshNfcCanonicalPreview();
  }, 350);
}

async function loadNfcPersonalitiesFromServer() {
  const r = await fetch('/api/nfc-personalities');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  const data = await r.json();
  if (!data || data.version !== 1 || !data.tags || typeof data.tags !== 'object') {
    throw new Error('Invalid personalities JSON');
  }
  nfcPersonalityStore = { version: 1, tags: { ...data.tags } };
  populateNfcPersonalitySelect();
  setPersonalitiesStatus(`Loaded ${Object.keys(nfcPersonalityStore.tags).length} tag(s).`, false);
  refreshNfcCanonicalPreview();
  refreshNfcLiveSystemPreview();
}

async function saveNfcPersonalitiesToServer() {
  const r = await fetch('/api/nfc-personalities', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nfcPersonalityStore),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  populateNfcPersonalitySelect();
  setPersonalitiesStatus('Saved to server.', false);
}

function populateNfcPersonalitySelect() {
  const sel = document.getElementById('nfc-personality-select');
  if (!sel) return;
  const keys = Object.keys(nfcPersonalityStore.tags).sort();
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = keys.length ? '— pick a tag —' : '— no tags in library —';
  sel.appendChild(opt0);
  for (const uid of keys) {
    const o = document.createElement('option');
    o.value = uid;
    const t = nfcPersonalityStore.tags[uid];
    const s = tagPhrase(t) || uid;
    o.textContent = `${uid.slice(0, 10)}… ${s}`.slice(0, 72);
    sel.appendChild(o);
  }
}

function fillNfcEditorFromUid(uid) {
  const hex = normalizeNfcUidString(uid);
  document.getElementById('nfc-edit-uid').value = hex;
  const tag = hex ? nfcPersonalityStore.tags[hex] : null;
  const srcEl = document.getElementById('nfc-edit-source');
  if (srcEl) srcEl.value = tag?.source || '';
  const phraseEl = document.getElementById('nfc-edit-phrase');
  if (phraseEl) phraseEl.value = tag ? tagPhrase(tag) : '';
  const blurbEl = document.getElementById('nfc-edit-blurb');
  if (blurbEl) blurbEl.value = tag?.blurb ? lowerNfcLabel(String(tag.blurb)) : '';
  document.getElementById('nfc-edit-prompt').value = tag?.prompt || '';
  const fmtEl = document.getElementById('nfc-prompt-format');
  if (fmtEl) fmtEl.value = tag?.promptFormat === 'full' ? 'full' : 'inner';
  refreshNfcCanonicalPreview();
  refreshNfcLiveSystemPreview();
}

function readNfcEditorUid() {
  return normalizeNfcUidString(document.getElementById('nfc-edit-uid')?.value || '');
}

/** Apply NFC UID → natural-language filter from server JSON. */
function applyNfcUid(uidRaw) {
  const hex = normalizeNfcUidString(uidRaw);
  const badge = document.getElementById('nfc-status');
  lastScannedNfcUid = hex;
  if (!hex) {
    if (badge) badge.textContent = 'NFC: invalid UID';
    setDeviceScreenReadout('— invalid UID —');
    refreshNfcCanonicalPreview();
    refreshNfcLiveSystemPreview();
    return;
  }

  const tag = nfcPersonalityStore.tags[hex];
  if (!tag) {
    clearCustomPersonalityFilters();
    if (badge) badge.textContent = `NFC: unknown (${hex}) — add in panel`;
    setDeviceScreenReadout(`UNKNOWN\n${hex}`);
    fillNfcEditorFromUid(hex);
    const sel = document.getElementById('nfc-personality-select');
    if (sel) sel.value = '';
    refreshNfcCanonicalPreview();
    refreshNfcLiveSystemPreview();
    return;
  }

  if (tag.promptFormat === 'full') {
    setCustomFullSystemPrompt(tag.prompt);
  } else {
    setCustomPersonalityPrompt(tag.prompt);
  }
  const p = tagPhrase(tag);
  const b = lowerNfcLabel(tag.blurb || '');
  if (badge) badge.textContent = `NFC: ${p}`;
  setDeviceScreenReadout(b ? `${p}\n${b}` : p);
  fillNfcEditorFromUid(hex);
  const sel = document.getElementById('nfc-personality-select');
  if (sel) sel.value = hex;
  refreshNfcCanonicalPreview();
  refreshNfcLiveSystemPreview();
}

function dispatchInboundJson(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (typeof obj.nfc_uid === 'string') {
    applyNfcUid(obj.nfc_uid);
  }
}

function parseSerialJsonLines(chunk, bufferRef) {
  let buf = bufferRef.value + chunk;
  const lines = buf.split('\n');
  bufferRef.value = lines.pop() || '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      dispatchInboundJson(JSON.parse(t));
    } catch (_) {
      /* incomplete JSON line */
    }
  }
}

// ─── Web Serial (Chrome / Edge, localhost or HTTPS) — NFC only ───────────────
let nfcPort;
let nfcReaderAbort;

async function connectNfcSerial() {
  if (!('serial' in navigator)) {
    document.getElementById('nfc-status').textContent =
      'Web Serial not supported — use Chrome or Edge on localhost';
    return;
  }

  const btn = document.getElementById('btn-nfc-serial');
  if (nfcPort && nfcPort.readable) {
    try {
      nfcReaderAbort?.abort();
      await nfcPort.close();
    } catch (_) { /* ignore */ }
    nfcPort = undefined;
    btn.textContent = 'Connect NFC';
    document.getElementById('nfc-status').textContent = 'NFC disconnected';
    return;
  }

  nfcPort = await navigator.serial.requestPort();
  await nfcPort.open({ baudRate: 115200 });

  const decoder = new TextDecoderStream();
  nfcPort.readable.pipeTo(decoder.writable);
  const lineReader = decoder.readable.getReader();
  nfcReaderAbort = new AbortController();
  const signal = nfcReaderAbort.signal;

  btn.textContent = 'Disconnect NFC';
  document.getElementById('nfc-status').textContent = 'NFC connected — tap a tag';

  const bufferRef = { value: '' };
  (async function readLoop() {
    try {
      while (!signal.aborted) {
        const { value, done } = await lineReader.read();
        if (done) break;
        parseSerialJsonLines(value, bufferRef);
      }
    } catch (e) {
      if (!signal.aborted) console.warn('NFC serial read:', e);
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
let ttsStatusFlashTimer = null;

async function fetchTtsServerFlags() {
  try {
    const r = await fetch('/api/tts-status');
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function clearTtsStatusFlash() {
  if (ttsStatusFlashTimer) {
    clearTimeout(ttsStatusFlashTimer);
    ttsStatusFlashTimer = null;
  }
  document.getElementById('tts-status')?.classList.remove('tts-status-warn');
}

function flashTtsWarning(message) {
  const el = document.getElementById('tts-status');
  if (!el) return;
  clearTtsStatusFlash();
  el.classList.add('tts-status-warn');
  el.textContent = String(message).slice(0, 240);
  ttsStatusFlashTimer = setTimeout(() => {
    ttsStatusFlashTimer = null;
    el.classList.remove('tts-status-warn');
    void refreshTtsStatus();
  }, 6500);
}

async function refreshTtsStatus() {
  const el = document.getElementById('tts-status');
  if (!el) return;
  if (el.classList.contains('tts-status-warn') && ttsStatusFlashTimer) return;

  const engine = document.getElementById('tts-engine')?.value || 'openai';
  const server = await fetchTtsServerFlags();

  if (!server) {
    el.textContent =
      'TTS: cannot load /api/tts-status — open this app via http://localhost:8787 (npm start), not file://';
    return;
  }

  if (engine === 'browser') {
    el.textContent = window.speechSynthesis
      ? 'TTS: Browser (system speech) — no API keys used'
      : 'TTS: Browser selected but speechSynthesis unavailable in this browser';
    return;
  }

  if (engine === 'openai') {
    const m = document.getElementById('tts-model')?.value || '';
    const v = document.getElementById('tts-voice')?.value || '';
    if (!server.openai_key_set) {
      el.textContent = `TTS: Engine OpenAI (${m} · ${v}) — server has no OPENAI_API_KEY; playback will use browser fallback`;
      return;
    }
    el.textContent = `TTS: OpenAI ready — ${m} · ${v} (POST /api/tts)`;
    return;
  }

  if (engine === 'elevenlabs') {
    const mid = document.getElementById('tts-eleven-model')?.value || '';
    const vid = document.getElementById('tts-eleven-voice-id')?.value?.trim() || '';
    if (!server.elevenlabs_key_set) {
      el.textContent =
        'TTS: Engine ElevenLabs — server has no ELEVENLABS_API_KEY; playback will use browser fallback';
      return;
    }
    if (!vid && !server.elevenlabs_voice_default_set) {
      el.textContent = `TTS: ElevenLabs key OK — set Voice ID or ELEVENLABS_VOICE_ID in .env (${mid})`;
      return;
    }
    const vnote = vid ? `voice ${vid.slice(0, 10)}…` : 'default voice from .env';
    el.textContent = `TTS: ElevenLabs ready — ${mid} · ${vnote} (POST /api/tts-elevenlabs)`;
  }
}

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

function playBlobAsMpegAudio(blob) {
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
}

async function ttsResponseToPlayback(res) {
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    let errMsg = res.statusText;
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => ({}));
      errMsg = j.error || errMsg;
    } else {
      errMsg = (await res.text()).slice(0, 300) || errMsg;
    }
    throw new Error(errMsg);
  }
  const blob = await res.blob();
  return playBlobAsMpegAudio(blob);
}

function speakOpenAITTS(text) {
  const t = text.trim().slice(0, 4096);
  const voice = document.getElementById('tts-voice')?.value || 'nova';
  const model = document.getElementById('tts-model')?.value || 'gpt-4o-mini-tts';

  return fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: t, voice, model }),
  }).then(ttsResponseToPlayback);
}

function speakElevenLabsTTS(text) {
  const t = text.trim().slice(0, 2500);
  const voice_id = document.getElementById('tts-eleven-voice-id')?.value?.trim() || undefined;
  const model_id = document.getElementById('tts-eleven-model')?.value || 'eleven_multilingual_v2';

  return fetch('/api/tts-elevenlabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: t, voice_id, model_id }),
  }).then(ttsResponseToPlayback);
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
          const msg = e?.message || String(e);
          console.warn('OpenAI TTS failed, falling back to browser if available:', e);
          flashTtsWarning(`Heard via browser — OpenAI failed: ${msg}`);
          if (window.speechSynthesis) await speakBrowserTTS(t);
        }
      } else if (engine === 'elevenlabs') {
        try {
          await speakElevenLabsTTS(t);
        } catch (e) {
          const msg = e?.message || String(e);
          console.warn('ElevenLabs TTS failed, falling back to browser if available:', e);
          flashTtsWarning(`Heard via browser — ElevenLabs failed: ${msg}`);
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
  const engine = document.getElementById('tts-engine')?.value || 'openai';
  const wrapO = document.getElementById('tts-wrap-openai');
  const wrapE = document.getElementById('tts-wrap-eleven');
  const modelEl = document.getElementById('tts-model');
  const voiceEl = document.getElementById('tts-voice');
  const elevenVid = document.getElementById('tts-eleven-voice-id');
  const elevenModel = document.getElementById('tts-eleven-model');

  if (wrapO) wrapO.hidden = engine !== 'openai';
  if (wrapE) wrapE.hidden = engine !== 'elevenlabs';

  if (modelEl) modelEl.disabled = engine !== 'openai';
  if (voiceEl) voiceEl.disabled = engine !== 'openai';
  if (elevenVid) elevenVid.disabled = engine !== 'elevenlabs';
  if (elevenModel) elevenModel.disabled = engine !== 'elevenlabs';

  void refreshTtsStatus();
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
      const filtered = await callClaude(msg);
      appendTranslationLine(filtered);
      refreshNfcLiveSystemPreview();
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
async function translate() {
  const input = document.getElementById('received');
  const msg = input.value.trim();
  if (!msg) return;

  const btn = document.getElementById('btn-translate');
  btn.disabled = true;
  try {
    const filtered = await callClaude(msg);
    appendTranslationLine(filtered);
    refreshNfcLiveSystemPreview();
  } catch (e) {
    appendTranslationLine(`[error] ${e.message}`);
  }
  btn.disabled = false;
}

function clearTextPanels() {
  stopListening();
  stopAllSpeech();
  voiceTranslateChain = Promise.resolve();
  lastFinalText = '';
  lastFinalAt = 0;
  document.getElementById('translation').value = '';
  document.getElementById('received').value = '';
  refreshNfcLiveSystemPreview();
}

// ─── Init ────────────────────────────────────────────────────────────────────
initSpeechRecognition();
refreshNfcCanonicalPreview();
refreshNfcLiveSystemPreview();

loadNfcPersonalitiesFromServer().catch((e) => {
  setPersonalitiesStatus(`Could not load personalities: ${e.message}`, true);
});

if (!SpeechRecognition) {
  document.getElementById('btn-mic-start').disabled = true;
  document.getElementById('btn-mic-stop').disabled = true;
  document.getElementById('mic-status').textContent = 'Speech API unavailable — use Chrome or Edge';
}

if (!('speechSynthesis' in window)) {
  const browserOpt = document.querySelector('#tts-engine option[value="browser"]');
  if (browserOpt) browserOpt.disabled = true;
}

document.getElementById('tts-engine')?.addEventListener('change', () => {
  clearTtsStatusFlash();
  syncTtsEngineControls();
});
['tts-model', 'tts-voice', 'tts-eleven-model'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => void refreshTtsStatus());
});
document.getElementById('tts-eleven-voice-id')?.addEventListener('input', () => void refreshTtsStatus());

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

document.getElementById('btn-nfc-serial').addEventListener('click', () => {
  connectNfcSerial().catch((e) => {
    document.getElementById('nfc-status').textContent = e.message || String(e);
  });
});

document.getElementById('btn-translate').addEventListener('click', translate);
document.getElementById('btn-clear-text')?.addEventListener('click', clearTextPanels);

document.getElementById('btn-clear-personality')?.addEventListener('click', () => {
  clearCustomPersonalityFilters();
  const badge = document.getElementById('nfc-status');
  if (badge) {
    badge.textContent =
      nfcPort && nfcPort.readable
        ? 'NFC connected — using default filter; tap a tag'
        : 'NFC: default filter (no tag)';
  }
  setDeviceScreenReadout('— default filter —');
  refreshNfcCanonicalPreview();
  refreshNfcLiveSystemPreview();
});

document.getElementById('nfc-personality-select')?.addEventListener('change', (e) => {
  const uid = e.target.value;
  if (uid) fillNfcEditorFromUid(uid);
});

document.getElementById('btn-nfc-reload')?.addEventListener('click', () => {
  loadNfcPersonalitiesFromServer().catch((err) => {
    setPersonalitiesStatus(err.message || String(err), true);
  });
});

document.getElementById('btn-nfc-save')?.addEventListener('click', () => {
  const uid = readNfcEditorUid();
  const source = (document.getElementById('nfc-edit-source')?.value || '').trim();
  const phrase = lowerNfcLabel(document.getElementById('nfc-edit-phrase')?.value || '');
  const blurb = lowerNfcLabel(document.getElementById('nfc-edit-blurb')?.value || '');
  const prompt = (document.getElementById('nfc-edit-prompt')?.value || '').trim();
  if (!uid) {
    setPersonalitiesStatus('Enter a valid hex UID.', true);
    return;
  }
  if (!phrase || !prompt) {
    setPersonalitiesStatus('Phrase and amplified filter are required.', true);
    return;
  }
  const fmt = document.getElementById('nfc-prompt-format')?.value === 'full' ? 'full' : 'inner';
  const translationSystemPrompt =
    fmt === 'full' ? prompt : buildTranslationSystemPromptFromPersonality(prompt);
  const entry = { phrase, prompt, translationSystemPrompt };
  if (blurb) entry.blurb = blurb;
  if (source) entry.source = source;
  if (fmt === 'full') entry.promptFormat = 'full';
  nfcPersonalityStore.tags[uid] = entry;
  saveNfcPersonalitiesToServer()
    .then(() => {
      if (uid === lastScannedNfcUid) applyNfcUid(uid);
      refreshNfcCanonicalPreview();
      refreshNfcLiveSystemPreview();
    })
    .catch((err) => setPersonalitiesStatus(err.message || String(err), true));
});

document.getElementById('btn-nfc-delete')?.addEventListener('click', () => {
  const uid = readNfcEditorUid();
  if (!uid) {
    setPersonalitiesStatus('Nothing to delete — enter a UID or pick from library.', true);
    return;
  }
  if (!nfcPersonalityStore.tags[uid]) {
    setPersonalitiesStatus('That UID is not in the library.', true);
    return;
  }
  if (!window.confirm(`Delete tag ${uid} from the library?`)) return;
  delete nfcPersonalityStore.tags[uid];
  saveNfcPersonalitiesToServer()
    .then(() => {
      fillNfcEditorFromUid('');
      if (uid === lastScannedNfcUid) {
        clearCustomPersonalityFilters();
        setDeviceScreenReadout('— tag removed —');
        document.getElementById('nfc-status').textContent = `NFC: removed ${uid.slice(0, 8)}…`;
      }
      refreshNfcCanonicalPreview();
      refreshNfcLiveSystemPreview();
    })
    .catch((err) => setPersonalitiesStatus(err.message || String(err), true));
});

function recordPersonalityDescription() {
  if (!SpeechRecognition) {
    setPersonalitiesStatus('Speech recognition unavailable in this browser.', true);
    return;
  }
  if (listeningDesired) {
    setPersonalitiesStatus('Stop “Start listening” first, then record here.', true);
    return;
  }
  const hint = document.getElementById('nfc-record-hint');
  if (hint) hint.textContent = 'Listening…';
  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec.onresult = (event) => {
    const t = event.results[0][0].transcript.trim();
    const ta = document.getElementById('nfc-edit-source');
    if (t && ta) ta.value = ta.value.trim() ? `${ta.value.trim()} ${t}` : t;
  };
  rec.onerror = () => {
    if (hint) hint.textContent = '';
  };
  rec.onend = () => {
    if (hint) hint.textContent = '';
  };
  try {
    rec.start();
  } catch (err) {
    if (hint) hint.textContent = '';
    setPersonalitiesStatus(err.message || String(err), true);
  }
}

document.getElementById('btn-nfc-record')?.addEventListener('click', () => {
  recordPersonalityDescription();
});

document.getElementById('btn-nfc-synthesize')?.addEventListener('click', async () => {
  const src = (document.getElementById('nfc-edit-source')?.value || '').trim();
  const pr = (document.getElementById('nfc-edit-prompt')?.value || '').trim();
  const description = src || pr;
  if (!description) {
    setPersonalitiesStatus('Add source (or filter text) first, then generate.', true);
    return;
  }
  if (window.location.protocol === 'file:') {
    setPersonalitiesStatus(
      'Open the app from the hardware-bridge server (run npm start, then use http://localhost:8787). file:// cannot call /api.',
      true,
    );
    return;
  }
  const synthBtn = document.getElementById('btn-nfc-synthesize');
  if (synthBtn) synthBtn.disabled = true;
  setPersonalitiesStatus('Generating phrase, blurb, and amplified filter…', false);
  try {
    const r = await fetch('/api/nfc-personality-synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const rawText = await r.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(r.ok ? 'Server returned non-JSON response.' : `${r.status} ${r.statusText}`);
    }
    if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
    const phraseEl = document.getElementById('nfc-edit-phrase');
    const blurbEl = document.getElementById('nfc-edit-blurb');
    const promptEl = document.getElementById('nfc-edit-prompt');
    const phraseNorm = lowerNfcLabel(data.phrase != null ? String(data.phrase) : '');
    if (phraseNorm && phraseEl) phraseEl.value = phraseNorm;
    const blurbRaw =
      data.blurb != null
        ? String(data.blurb)
        : data.shortLine != null
          ? String(data.shortLine)
          : '';
    const blurbNorm = lowerNfcLabel(blurbRaw);
    if (blurbNorm && blurbEl) blurbEl.value = blurbNorm;
    const amp =
      typeof data.amplifiedFilter === 'string'
        ? data.amplifiedFilter.trim()
        : typeof data.prompt === 'string'
          ? data.prompt.trim()
          : '';
    if (!amp) {
      throw new Error('Server response missing amplified filter (phrase/blurb may also be empty).');
    }
    if (promptEl) promptEl.value = amp;
    const fmtEl = document.getElementById('nfc-prompt-format');
    if (fmtEl) fmtEl.value = data.promptFormat === 'full' ? 'full' : 'inner';
    refreshNfcCanonicalPreview();
    refreshNfcLiveSystemPreview();
    setPersonalitiesStatus('AI filled phrase, blurb, and filter. Save to server to persist.', false);
  } catch (e) {
    setPersonalitiesStatus(e.message || String(e), true);
  } finally {
    if (synthBtn) synthBtn.disabled = false;
  }
});

document.getElementById('nfc-edit-prompt')?.addEventListener('input', () => {
  scheduleNfcCanonicalPreview();
});

document.getElementById('nfc-prompt-format')?.addEventListener('change', () => {
  refreshNfcCanonicalPreview();
});

document.getElementById('received').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    translate();
  }
});
