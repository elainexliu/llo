// import 'dotenv/config';
// import express from 'express';
// import { fileURLToPath } from 'url';
// import { dirname, join } from 'path';
// import { readFile, writeFile, mkdir } from 'fs/promises';
// import Anthropic from '@anthropic-ai/sdk';


// const __dirname = dirname(fileURLToPath(import.meta.url));
// const NFC_PERSONALITIES_PATH = join(__dirname, 'data', 'nfc-personalities.json');
// const app = express();
// app.use(express.json({ limit: '1mb' }));

// const PORT = Number(process.env.PORT) || 8787;

// // Anthropic — for chat/filter
// const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
// const ANTHROPIC_TEMPERATURE = Number.isFinite(Number(process.env.ANTHROPIC_TEMPERATURE))
//   ? Number(process.env.ANTHROPIC_TEMPERATURE)
//   : 0.2;
// const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// // OpenAI — for TTS only
// const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
// const TTS_VOICE_DEFAULT = process.env.OPENAI_TTS_VOICE || 'nova';

// const TTS_VOICES = new Set([
//   'alloy', 'ash', 'ballad', 'coral', 'echo',
//   'fable', 'nova', 'onyx', 'sage', 'shimmer',
//   'verse', 'marin', 'cedar',
// ]);

// const TTS_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);

// // ElevenLabs — TTS (separate from OpenAI)
// const ELEVENLABS_MODEL_DEFAULT = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
// const ELEVENLABS_VOICE_DEFAULT = process.env.ELEVENLABS_VOICE_ID || '';

// const ELEVENLABS_MODELS = new Set([
//   'eleven_multilingual_v2',
//   'eleven_turbo_v2',
//   'eleven_turbo_v2_5',
//   'eleven_flash_v2',
//   'eleven_flash_v2_5',
//   'eleven_v3',
// ]);

// const ELEVEN_OUTPUT_FORMATS = new Set([
//   'mp3_44100_32',
//   'mp3_44100_64',
//   'mp3_44100_96',
//   'mp3_44100_128',
//   'mp3_44100_192',
//   'mp3_22050_32',
// ]);

// function isSafeElevenVoiceId(id) {
//   return typeof id === 'string' && /^[a-zA-Z0-9]{15,40}$/.test(id);
// }

// app.post('/api/chat', async (req, res) => {
//   if (!process.env.ANTHROPIC_API_KEY) {
//     res.status(500).json({
//       error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file in hardware-bridge/',
//     });
//     return;
//   }

//   const { system, messages } = req.body;
//   if (typeof system !== 'string' || !Array.isArray(messages)) {
//     res.status(400).json({ error: 'Expected JSON body: { system: string, messages: array }' });
//     return;
//   }

//   try {
//     const msg = await anthropic.messages.create({
//       model: ANTHROPIC_MODEL,
//       max_tokens: 400,
//       temperature: Math.max(0, Math.min(1, ANTHROPIC_TEMPERATURE)),
//       system,
//       messages,
//     });

//     const text = msg.content?.[0]?.text?.trim();
//     if (!text) {
//       res.status(502).json({ error: 'Empty response from Anthropic' });
//       return;
//     }

//     res.json({ text });
//   } catch (e) {
//     const msg = e?.message || String(e);
//     if (msg.includes('not_found_error') && msg.includes('model:')) {
//       res.status(500).json({
//         error: `${msg}. Try setting ANTHROPIC_MODEL in .env to an available model for your account (for example: claude-3-5-sonnet-latest or claude-3-5-haiku-latest).`,
//       });
//       return;
//     }
//     res.status(500).json({ error: msg });
//   }
// });

// // ─── TTS (OpenAI — Anthropic has no TTS) ─────────────────────────────────────
// app.post('/api/tts', async (req, res) => {
//   const key = process.env.OPENAI_API_KEY;
//   if (!key) {
//     res.status(500).json({
//       error: 'OPENAI_API_KEY is not set. TTS requires an OpenAI key even when using Anthropic for chat.',
//     });
//     return;
//   }

//   const { text, voice, model } = req.body;
//   if (typeof text !== 'string' || !text.trim()) {
//     res.status(400).json({ error: 'Expected JSON body: { text: string, voice?: string, model?: string }' });
//     return;
//   }

//   const v = typeof voice === 'string' && TTS_VOICES.has(voice) ? voice : TTS_VOICE_DEFAULT;
//   const m = typeof model === 'string' && TTS_MODELS.has(model) ? model : TTS_MODEL;
//   const maxChars = m === 'gpt-4o-mini-tts' ? 7000 : 4096;
//   const input = text.trim().slice(0, maxChars);

//   try {
//     const r = await fetch('https://api.openai.com/v1/audio/speech', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${key}`,
//       },
//       body: JSON.stringify({
//         model: m,
//         voice: v,
//         input,
//         response_format: 'mp3',
//       }),
//     });

//     if (!r.ok) {
//       let errMsg = r.statusText;
//       try {
//         const errJson = await r.json();
//         errMsg = errJson.error?.message || JSON.stringify(errJson);
//       } catch {
//         errMsg = await r.text();
//       }
//       res.status(r.status).json({ error: errMsg });
//       return;
//     }

//     const buf = Buffer.from(await r.arrayBuffer());
//     res.setHeader('Content-Type', 'audio/mpeg');
//     res.setHeader('Cache-Control', 'no-store');
//     res.send(buf);
//   } catch (e) {
//     res.status(500).json({ error: e.message || String(e) });
//   }
// });

// // ─── TTS (ElevenLabs) ─────────────────────────────────────────────────────────
// app.post('/api/tts-elevenlabs', async (req, res) => {
//   const key = process.env.ELEVENLABS_API_KEY;
//   if (!key) {
//     res.status(500).json({
//       error:
//         'ELEVENLABS_API_KEY is not set. Add it to hardware-bridge/.env (and optional ELEVENLABS_VOICE_ID default).',
//     });
//     return;
//   }

//   const { text, voice_id, model_id, output_format } = req.body;
//   if (typeof text !== 'string' || !text.trim()) {
//     res.status(400).json({ error: 'Expected JSON body: { text: string, voice_id?: string, model_id?: string }' });
//     return;
//   }

//   const vidRaw = typeof voice_id === 'string' && voice_id.trim() ? voice_id.trim() : ELEVENLABS_VOICE_DEFAULT;
//   if (!vidRaw || !isSafeElevenVoiceId(vidRaw)) {
//     res.status(400).json({
//       error:
//         'Missing or invalid voice_id. Paste a voice ID from elevenlabs.io (Voices), or set ELEVENLABS_VOICE_ID in .env.',
//     });
//     return;
//   }

//   const mid =
//     typeof model_id === 'string' && ELEVENLABS_MODELS.has(model_id) ? model_id : ELEVENLABS_MODEL_DEFAULT;
//   const fmt =
//     typeof output_format === 'string' && ELEVEN_OUTPUT_FORMATS.has(output_format)
//       ? output_format
//       : 'mp3_44100_128';

//   const input = text.trim().slice(0, 2500);

//   const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vidRaw)}`);
//   url.searchParams.set('output_format', fmt);

//   try {
//     const r = await fetch(url.toString(), {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'xi-api-key': key,
//         Accept: 'audio/mpeg',
//       },
//       body: JSON.stringify({
//         text: input,
//         model_id: mid,
//       }),
//     });

//     if (!r.ok) {
//       let errMsg = r.statusText;
//       try {
//         const errJson = await r.json();
//         const d = errJson.detail;
//         errMsg =
//           (Array.isArray(d) ? d.map((x) => x.msg || x).join('; ') : d?.message || d) ||
//           errJson.message ||
//           JSON.stringify(errJson);
//       } catch {
//         errMsg = (await r.text()).slice(0, 300) || errMsg;
//       }
//       res.status(r.status).json({ error: String(errMsg) });
//       return;
//     }

//     const buf = Buffer.from(await r.arrayBuffer());
//     res.setHeader('Content-Type', 'audio/mpeg');
//     res.setHeader('Cache-Control', 'no-store');
//     res.send(buf);
//   } catch (e) {
//     res.status(500).json({ error: e.message || String(e) });
//   }
// });

// /** Non-secret flags so the UI can show whether API TTS is configured. */
// app.get('/api/tts-status', (req, res) => {
//   const vid = process.env.ELEVENLABS_VOICE_ID?.trim();
//   res.json({
//     openai_key_set: Boolean(process.env.OPENAI_API_KEY?.trim()),
//     elevenlabs_key_set: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
//     elevenlabs_voice_default_set: Boolean(vid && isSafeElevenVoiceId(vid)),
//   });
// });

// app.use(express.static(join(__dirname, 'web')));

// app.listen(PORT, () => {
//   console.log(`Hardware bridge: http://localhost:${PORT}`);
// });


/////////////////////////////////////// INTEGRATED VERSION ///////////////////////////////////////

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { SerialPort } from 'serialport';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'fs';
import fs from 'fs/promises';
import { tmpdir } from 'os';
// import FormData from 'form-data';
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
import player from 'play-sound';
const audioPlayer = player({});

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 8787;
const SERIAL_PORT_PATH = process.env.SERIAL_PORT || 'COM5';
const BAUD_RATE = 921600;
const SAMPLE_RATE = 16000;
const CARTRIDGES_PATH = join(__dirname, 'cartridges.json');

// ─── Anthropic ────────────────────────────────────────────────────────────────
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
const ANTHROPIC_TEMPERATURE = Number.isFinite(Number(process.env.ANTHROPIC_TEMPERATURE))
  ? Number(process.env.ANTHROPIC_TEMPERATURE)
  : 0.2;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── OpenAI TTS ───────────────────────────────────────────────────────────────
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE_DEFAULT = process.env.OPENAI_TTS_VOICE || 'nova';

const TTS_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'fable', 'nova', 'onyx', 'sage', 'shimmer',
  'verse', 'marin', 'cedar',
]);

const TTS_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);

// ─── ElevenLabs ───────────────────────────────────────────────────────────────
const ELEVENLABS_MODEL_DEFAULT = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const ELEVENLABS_VOICE_DEFAULT = process.env.ELEVENLABS_VOICE_ID || '';

const ELEVENLABS_MODELS = new Set([
  'eleven_multilingual_v2',
  'eleven_turbo_v2',
  'eleven_turbo_v2_5',
  'eleven_flash_v2',
  'eleven_flash_v2_5',
  'eleven_v3',
]);

const ELEVEN_OUTPUT_FORMATS = new Set([
  'mp3_44100_32', 'mp3_44100_64', 'mp3_44100_96',
  'mp3_44100_128', 'mp3_44100_192', 'mp3_22050_32',
]);

function isSafeElevenVoiceId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9]{15,40}$/.test(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// CARTRIDGES JSON
// ─────────────────────────────────────────────────────────────────────────────
function loadCartridges() {
  if (!existsSync(CARTRIDGES_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CARTRIDGES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCartridges(data) {
  writeFileSync(CARTRIDGES_PATH, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// WAV HEADER
// ─────────────────────────────────────────────────────────────────────────────
function buildWavHeader(dataBytes) {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);   // PCM
  buf.writeUInt16LE(1, 22);   // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);   // block align
  buf.writeUInt16LE(16, 34);  // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHISPER TRANSCRIPTION
// ─────────────────────────────────────────────────────────────────────────────
async function transcribeAudio(pcmBuffer) {
  const wavPath = join(tmpdir(), `llo_${Date.now()}.wav`);
  const header = buildWavHeader(pcmBuffer.length);
  const wav = Buffer.concat([header, pcmBuffer]);
  await fs.writeFile(wavPath, wav);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(wavPath),
      model: 'whisper-1',
      language: 'en',
    });
    console.log('Whisper response:', transcription.text);
    return transcription.text?.trim() || '';
  } finally {
    await fs.unlink(wavPath).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE: generate filter name + desc from cartridge recording
// ─────────────────────────────────────────────────────────────────────────────
async function generateFilter(transcript, uid) {
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 200,
    temperature: 0.7,
    system: `You are helping design a perceptual filter for an art installation called "en clair", developed at MIT. The installation explores how human perception filters spoken language.

The user has described how they want to hear the world through this filter. From their description, extract:
1. A short evocative filter name (1-2 words, lowercase, like "defensive", "nostalgia", "suspicious")
2. A one-line poetic description (under 28 characters, like "a good friend who has something to hide...")

Respond with ONLY valid JSON in this exact format, nothing else:
{"name": "word", "desc": "short description here"}`,
    messages: [{ role: 'user', content: transcript }],
  });

  const text = msg.content?.[0]?.text?.trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
    const descMatch = text.match(/"desc"\s*:\s*"([^"]+)"/);
    parsed = {
      name: nameMatch?.[1] || 'unnamed',
      desc: descMatch?.[1] || transcript.slice(0, 60),
    };
  }

  // save to cartridges.json
  const cartridges = loadCartridges();
  cartridges[uid] = { name: parsed.name, desc: parsed.desc, prompt: transcript };
  saveCartridges(cartridges);
  console.log(`Saved filter for ${uid}: ${parsed.name}`);
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE: filter transcript through active filter
// ─────────────────────────────────────────────────────────────────────────────
// async function filterTranscript(transcript, filterPrompt, history) {
//   const inputWordCount = transcript.split(/\s+/).length;
//   const system = `You are a perceptual filter in an art installation called "en clair", developed at MIT. The installation explores how human perception and interpretation shape communication.

// The listener's perceptual filter was described as: "${filterPrompt}"

// Transform the spoken input through this perceptual lens — output only the transformed utterance as the listener would internally process it. No commentary, no meta-text, no quotation marks. Preserve grammatical person exactly (if someone says "I", keep "I"; if they say "you", keep "you").

// CRITICAL LENGTH RULE: Your response must be approximately ${inputWordCount} words. The input is ${inputWordCount} words. Do not exceed ${Math.ceil(inputWordCount * 1.2)} words under any circumstances. Do not pad, elaborate, or expand. Match the length and rhythm of the original.`;

//   const messages = [...history, { role: 'user', content: transcript }];
//   const msg = await anthropic.messages.create({
//     model: ANTHROPIC_MODEL,
//     max_tokens: 400,
//     temperature: ANTHROPIC_TEMPERATURE,
//     system,
//     messages,
//   });
//   return msg.content?.[0]?.text?.trim() || transcript;
// }

async function filterTranscript(transcript, filterPrompt, history) {
  const inputWordCount = transcript.split(/\s+/).length;

  const system = `You are a perceptual filter in an art installation called "en clair", developed at MIT. The installation explores how human perception and interpretation shape communication.

The listener's perceptual filter was described as: "${filterPrompt}"

Transform the spoken input through this perceptual lens — output only the transformed utterance as the listener would internally process it. No commentary, no meta-text, no quotation marks.

PRONOUN RULE — NON-NEGOTIABLE: Preserve every pronoun exactly as spoken. If the speaker says "you", output "you". If the speaker says "I", output "I". If the speaker says "she/he/they", keep "she/he/they". Never swap, invert, or reframe pronouns under any circumstances. The filter changes interpretation and tone, never grammatical person.

CRITICAL LENGTH RULE: Your response must be approximately ${inputWordCount} words. The input is ${inputWordCount} words. Do not exceed ${Math.ceil(inputWordCount * 1.2)} words under any circumstances. Do not pad, elaborate, or expand. Match the length and rhythm of the original.`;

  // per-turn anchor to prevent POV drift as history accumulates
  const anchoredTranscript = `[PRONOUN ANCHOR: preserve all pronouns exactly as spoken — "you" stays "you", "I" stays "I", no exceptions]

Input to filter: ${transcript}`;

  const messages = [...history, { role: 'user', content: anchoredTranscript }];
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 400,
    temperature: ANTHROPIC_TEMPERATURE,
    system,
    messages,
  });
  return msg.content?.[0]?.text?.trim() || transcript;
}


/////////////////////////// SPEAKER //////////////////////////////////////

// ─── Audio playback buffer ────────────────────────────────────────────────────
let latestAudioBuffer = null;
let latestAudioId = 0;
let latestFilteredText = '';

app.get('/api/audio/latest', (req, res) => {
  const sinceId = parseInt(req.query.since) || 0;
  if (!latestAudioBuffer || latestAudioId <= sinceId) {
    res.status(204).end();  // no new audio
    return;
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('X-Audio-Id', latestAudioId);
  res.setHeader('Cache-Control', 'no-store');
  res.send(latestAudioBuffer);
});


async function speakText(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voiceId) {
    console.error('ElevenLabs key or voice ID not set');
    return;
  }

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set('output_format', 'mp3_44100_128');

  const r = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': key,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    }),
  });

  if (!r.ok) {
    console.error('ElevenLabs error:', r.status, await r.text());
    return;
  }

  latestAudioBuffer = Buffer.from(await r.arrayBuffer());
  latestAudioId++;
  latestFilteredText = text;
  console.log('Speaking:', text);
}

app.get('/api/audio/latest', (req, res) => {
  const sinceId = parseInt(req.query.since) || 0;
  if (!latestAudioBuffer || latestAudioId <= sinceId) {
    res.status(204).end();
    return;
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('X-Audio-Id', latestAudioId);
  res.setHeader('X-Filtered-Text', encodeURIComponent(latestFilteredText || ''));
  res.setHeader('Cache-Control', 'no-store');
  res.send(latestAudioBuffer);
});

// ─────────────────────────────────────────────────────────────────────────────
// SERIAL STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────
function initSerial() {
  let serial;
  try {
    serial = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
    console.log('SerialPort created, waiting for open...');
  } catch (e) {
    console.error('SerialPort constructor error:', e.message);
    return;
  }

  let mode = 'idle';          // idle | listening | cart_recording
  let audioChunks = [];
  let textBuf = '';
  let currentUid = '';
  let filterPrompt = '';
  let pendingSaveUid = '';
  let conversationHistory = [];

  function sendJson(obj) {
    const line = JSON.stringify(obj) + '\n';
    serial.write(line);
    console.log('→ ESP32:', line.trim());
  }

  async function handleLine(line) {
    line = line.trim();
    if (!line) return;
    if (!/^[\x20-\x7E]+$/.test(line)) return;
    console.log('← ESP32:', line);

    // ── NFC uid lookup ──────────────────────────────────────────────────────
    if (line.startsWith('{') && line.includes('nfc_uid')) {
      try {
        const { nfc_uid } = JSON.parse(line);
        currentUid = nfc_uid;
        const cartridges = loadCartridges();
        if (cartridges[nfc_uid]) {
          const { name, desc, prompt } = cartridges[nfc_uid];
          filterPrompt = prompt;
          conversationHistory = [];
          sendJson({ known: true, name, desc });
          console.log(`Known tag: ${nfc_uid} → "${name}"`);
        } else {
          sendJson({ known: false });
          console.log(`Unknown tag: ${nfc_uid}`);
        }
      } catch (e) {
        console.error('NFC parse error:', e.message);
      }
      return;
    }

    // ── save_uid (sent just after CART_STOP) ───────────────────────────────
    if (line.startsWith('{') && line.includes('save_uid')) {
      try {
        const { save_uid } = JSON.parse(line);
        pendingSaveUid = save_uid;
      } catch {}
      return;
    }

    // ── main listening: start ───────────────────────────────────────────────
    if (line === 'START') {
      mode = 'listening';
      audioChunks = [];
      console.log('Main listening started');
      return;
    }

    // ── main listening: stop ────────────────────────────────────────────────
    if (line === 'STOP' && mode === 'listening') {
      mode = 'idle';
      console.log('Main listening stopped — transcribing...');
      const pcm = Buffer.concat(audioChunks);
      audioChunks = [];
      try {
        const transcript = await transcribeAudio(pcm);
        console.log('Transcript:', transcript);
        if (transcript) {
          const filtered = await filterTranscript(transcript, filterPrompt, conversationHistory);
          console.log('Filtered:', filtered);
          conversationHistory.push({ role: 'user', content: transcript });
          conversationHistory.push({ role: 'assistant', content: filtered });
          if (conversationHistory.length > 16) conversationHistory.splice(0, 2);
          serial.write(filtered + '\n');
          await speakText(filtered);
        }
      } catch (e) {
        console.error('Listening pipeline error:', e.message);
      }
      return;
    }

    // ── cartridge recording: start ──────────────────────────────────────────
    if (line === 'CART_START') {
      mode = 'cart_recording';
      audioChunks = [];
      console.log('Cartridge recording started');
      return;
    }

    // ── cartridge recording: stop ───────────────────────────────────────────
    if (line === 'CART_STOP' && mode === 'cart_recording') {
      mode = 'idle';
      console.log('Cartridge recording stopped — generating filter...');
      const pcm = Buffer.concat(audioChunks);
      audioChunks = [];
      console.log(`Cartridge audio captured: ${pcm.length} bytes (${(pcm.length / (16000 * 2)).toFixed(1)}s)`);  // add this
      // save debug WAV
      // const debugPath = join(__dirname, 'debug_cartridge.wav');
      // const header = buildWavHeader(pcm.length);
      // const wav = Buffer.concat([header, pcm]);
      // await fs.writeFile(debugPath, wav);
      // console.log(`Debug WAV saved to ${debugPath}`);
      
      try {
        const transcript = await transcribeAudio(pcm);
        console.log('Cartridge transcript:', transcript);
        if (!transcript) throw new Error('Empty transcript');
        const uid = pendingSaveUid || currentUid;
        const { name, desc } = await generateFilter(transcript, uid);
        filterPrompt = transcript;
        conversationHistory = [];
        sendJson({ generated: true, name, desc });
      } catch (e) {
        console.error('Cartridge pipeline error:', e.message);
        sendJson({ generated: false });
      }
      return;
    }
  }

  // ── incoming data handler ─────────────────────────────────────────────────
  serial.on('data', (chunk) => {
    if (mode === 'listening' || mode === 'cart_recording') {
      const combined = Buffer.concat([Buffer.from(textBuf, 'binary'), chunk]);
  
      // search for CART_STOP before STOP to avoid substring match
      const cartIdx = combined.indexOf(Buffer.from('CART_STOP'));
      const stopIdx = combined.indexOf(Buffer.from('STOP'));
  
      let markerIdx = -1;
      let markerLen = 0;
      let markerStr = '';
  
      if (cartIdx >= 0 && mode === 'cart_recording') {
        markerIdx = cartIdx;
        markerLen = 'CART_STOP'.length + 1; // +1 for \n or \r\n
        markerStr = 'CART_STOP';
      } else if (stopIdx >= 0 && mode === 'listening') {
        // make sure this STOP isn't part of CART_STOP
        const precedingBytes = combined.slice(Math.max(0, stopIdx - 4), stopIdx).toString();
        if (!precedingBytes.includes('CART_')) {
          markerIdx = stopIdx;
          markerLen = 'STOP'.length + 1;
          markerStr = 'STOP';
        }
      }
  
      if (markerIdx >= 0) {
        audioChunks.push(combined.slice(0, markerIdx));
        textBuf = '';
        handleLine(markerStr);
        const remainder = combined.slice(markerIdx + markerLen).toString('utf8');
        if (remainder.trim()) {
          remainder.split('\n').forEach(l => { if (l.trim()) handleLine(l); });
        }
      } else {
        const safe = combined.slice(0, Math.max(0, combined.length - 12));
        const tail = combined.slice(Math.max(0, combined.length - 12));
        audioChunks.push(safe);
        textBuf = tail.toString('binary');
      }
    } else {
      textBuf += chunk.toString('utf8');
      const lines = textBuf.split('\n');
      textBuf = lines.pop() || '';
      // lines.forEach(l => handleLine(l));
      lines.forEach(l => { 
        const trimmed = l.trim();
        // only process lines that look like valid text/JSON — skip binary garbage
        if (trimmed && /^[\x20-\x7E\{\}\":,\[\]]+/.test(trimmed)) {
          handleLine(trimmed);
        }
      });
    }
  });

  serial.on('error', e => console.error('Serial error:', e.message));
  serial.on('open', () => console.log(`Serial open on ${SERIAL_PORT_PATH} at ${BAUD_RATE} baud`));
}

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING EXPRESS ENDPOINTS (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

// ─── CHAT (Anthropic) ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file in hardware-bridge/',
    });
    return;
  }

  const { system, messages } = req.body;
  if (typeof system !== 'string' || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Expected JSON body: { system: string, messages: array }' });
    return;
  }

  try {
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      temperature: Math.max(0, Math.min(1, ANTHROPIC_TEMPERATURE)),
      system,
      messages,
    });

    const text = msg.content?.[0]?.text?.trim();
    if (!text) {
      res.status(502).json({ error: 'Empty response from Anthropic' });
      return;
    }

    res.json({ text });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('not_found_error') && msg.includes('model:')) {
      res.status(500).json({
        error: `${msg}. Try setting ANTHROPIC_MODEL in .env to an available model for your account.`,
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ─── TTS (OpenAI) ─────────────────────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({
      error: 'OPENAI_API_KEY is not set.',
    });
    return;
  }

  const { text, voice, model } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Expected JSON body: { text: string, voice?: string, model?: string }' });
    return;
  }

  const v = typeof voice === 'string' && TTS_VOICES.has(voice) ? voice : TTS_VOICE_DEFAULT;
  const m = typeof model === 'string' && TTS_MODELS.has(model) ? model : TTS_MODEL;
  const maxChars = m === 'gpt-4o-mini-tts' ? 7000 : 4096;
  const input = text.trim().slice(0, maxChars);

  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: m, voice: v, input, response_format: 'mp3' }),
    });

    if (!r.ok) {
      let errMsg = r.statusText;
      try { const j = await r.json(); errMsg = j.error?.message || JSON.stringify(j); } catch { errMsg = await r.text(); }
      res.status(r.status).json({ error: errMsg });
      return;
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ─── TTS (ElevenLabs) ─────────────────────────────────────────────────────────
app.post('/api/tts-elevenlabs', async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'ELEVENLABS_API_KEY is not set.' });
    return;
  }

  const { text, voice_id, model_id, output_format } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Expected JSON body: { text: string, voice_id?: string, model_id?: string }' });
    return;
  }

  const vidRaw = typeof voice_id === 'string' && voice_id.trim() ? voice_id.trim() : ELEVENLABS_VOICE_DEFAULT;
  if (!vidRaw || !isSafeElevenVoiceId(vidRaw)) {
    res.status(400).json({ error: 'Missing or invalid voice_id.' });
    return;
  }

  const mid = typeof model_id === 'string' && ELEVENLABS_MODELS.has(model_id) ? model_id : ELEVENLABS_MODEL_DEFAULT;
  const fmt = typeof output_format === 'string' && ELEVEN_OUTPUT_FORMATS.has(output_format) ? output_format : 'mp3_44100_128';
  const input = text.trim().slice(0, 2500);
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vidRaw)}`);
  url.searchParams.set('output_format', fmt);

  try {
    const r = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: input, model_id: mid }),
    });

    if (!r.ok) {
      let errMsg = r.statusText;
      try {
        const j = await r.json();
        const d = j.detail;
        errMsg = (Array.isArray(d) ? d.map(x => x.msg || x).join('; ') : d?.message || d) || j.message || JSON.stringify(j);
      } catch { errMsg = (await r.text()).slice(0, 300) || errMsg; }
      res.status(r.status).json({ error: String(errMsg) });
      return;
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ─── TTS status ───────────────────────────────────────────────────────────────
app.get('/api/tts-status', (req, res) => {
  const vid = process.env.ELEVENLABS_VOICE_ID?.trim();
  res.json({
    openai_key_set: Boolean(process.env.OPENAI_API_KEY?.trim()),
    elevenlabs_key_set: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    elevenlabs_voice_default_set: Boolean(vid && isSafeElevenVoiceId(vid)),
  });
});

app.use(express.static(join(__dirname, 'web')));

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Hardware bridge: http://localhost:${PORT}`);
  initSerial();
});
