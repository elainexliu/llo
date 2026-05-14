import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NFC_PERSONALITIES_PATH = join(__dirname, 'data', 'nfc-personalities.json');
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 8787;

// Anthropic — for chat/filter
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
const ANTHROPIC_TEMPERATURE = Number.isFinite(Number(process.env.ANTHROPIC_TEMPERATURE))
  ? Number(process.env.ANTHROPIC_TEMPERATURE)
  : 0.2;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// OpenAI — for TTS only
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE_DEFAULT = process.env.OPENAI_TTS_VOICE || 'nova';

const TTS_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'fable', 'nova', 'onyx', 'sage', 'shimmer',
  'verse', 'marin', 'cedar',
]);

const TTS_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);

// ElevenLabs — TTS (separate from OpenAI)
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
  'mp3_44100_32',
  'mp3_44100_64',
  'mp3_44100_96',
  'mp3_44100_128',
  'mp3_44100_192',
  'mp3_22050_32',
]);

function isSafeElevenVoiceId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9]{15,40}$/.test(id);
}

function normalizePersonalityUid(uid) {
  if (!uid || typeof uid !== 'string') return '';
  return uid
    .trim()
    .toLowerCase()
    .replace(/^0x/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9a-f]/g, '');
}

function normalizeNfcPersonalitiesPut(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON body' };
  if (body.version !== 1) return { error: 'Expected { version: 1, tags: { ... } }' };
  const rawTags = body.tags;
  if (!rawTags || typeof rawTags !== 'object' || Array.isArray(rawTags)) return { error: 'Expected tags object' };

  const tags = {};
  for (const [key, entry] of Object.entries(rawTags)) {
    const uid = normalizePersonalityUid(key);
    if (!uid || !/^[0-9a-f]{4,24}$/.test(uid)) return { error: `Invalid UID key: ${key}` };
    if (!entry || typeof entry !== 'object') return { error: `Invalid entry for ${uid}` };
    const phrase = typeof entry.phrase === 'string' ? entry.phrase.trim() : '';
    const summaryLegacy = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    const phraseFinal = phrase || summaryLegacy;
    if (!phraseFinal) return { error: `Missing phrase (or legacy summary) for ${uid}` };

    const blurb = typeof entry.blurb === 'string' ? entry.blurb.trim() : '';
    if (blurb.length > 200) return { error: `blurb too long for ${uid}` };

    const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
    if (!prompt) return { error: `Missing prompt for ${uid}` };
    if (phraseFinal.length > 80) return { error: `phrase too long for ${uid} (max 80)` };
    if (prompt.length > 24000) return { error: `prompt too long for ${uid}` };
    const source = typeof entry.source === 'string' ? entry.source.trim() : '';
    if (source.length > 12000) return { error: `source too long for ${uid}` };
    const translationSystemPrompt =
      typeof entry.translationSystemPrompt === 'string' ? entry.translationSystemPrompt.trim() : '';
    if (translationSystemPrompt.length > 32000) return { error: `translationSystemPrompt too long for ${uid}` };
    const pf = entry.promptFormat;
    if (pf !== undefined && pf !== 'inner' && pf !== 'full') {
      return { error: `promptFormat must be "inner" or "full" for ${uid}` };
    }
    tags[uid] = { phrase: phraseFinal, blurb, prompt, summary: phraseFinal };
    if (pf === 'full') tags[uid].promptFormat = 'full';
    if (source) tags[uid].source = source;
    if (translationSystemPrompt) tags[uid].translationSystemPrompt = translationSystemPrompt;
  }
  return { doc: { version: 1, tags } };
}

const NFC_SYNTH_META_SYSTEM = `You help author a perceptual text filter for the MIT art installation "Large Language Object".

The user message is a spoken or written description of a personality / listening stance (how someone "hears" incoming lines).

Reply with ONLY valid JSON (no markdown fences, no commentary). Exactly these keys:
- "phrase": string, 1–3 words, Title Case or lowercase ok — a tight label (e.g. "defensive friend", "nostalgia haze").
- "blurb": string, at most 10 words, one short evocative sentence — no trailing period required if it reads cleaner without.
- "amplifiedFilter": string, roughly 400–2800 characters. This is ONLY the perceptual-filter instructions for a later Claude call: describe how incoming utterances get warped (register, trust, subtext, formality, projection, habitual misreadings, favorite vocabulary tilts) with creative liberty to **amp the vibe strongly**. Two different filters should yield obviously different transformed lines on the same input — avoid vague or timid instructions that read like generic "be mindful" text. It must read as a mechanical "signal processor" lens, not roleplay dialogue. Do NOT include the words "Transformation rules" or duplicate boilerplate about output format — a separate system template will wrap this and append fixed transformation rules.

Escape double quotes inside JSON strings per JSON rules.`;

// ─── NFC personalities (JSON on disk) ───────────────────────────────────────
app.get('/api/nfc-personalities', async (req, res) => {
  try {
    const raw = await readFile(NFC_PERSONALITIES_PATH, 'utf8');
    res.type('json').send(raw);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.json({ version: 1, tags: {} });
      return;
    }
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.put('/api/nfc-personalities', async (req, res) => {
  const out = normalizeNfcPersonalitiesPut(req.body);
  if (out.error) {
    res.status(400).json({ error: out.error });
    return;
  }
  try {
    await mkdir(join(__dirname, 'data'), { recursive: true });
    await writeFile(NFC_PERSONALITIES_PATH, `${JSON.stringify(out.doc, null, 2)}\n`, 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/nfc-personality-synthesize', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file in hardware-bridge/',
    });
    return;
  }

  const { description } = req.body;
  if (typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'Expected JSON body: { description: string }' });
    return;
  }

  const userText = description.trim().slice(0, 8000);

  const userBlock = `The user described this perceptual filter / listening personality (transcript or notes):

"""${userText}"""

Produce phrase, blurb, and amplifiedFilter as specified in your system instructions.

Respond in JSON only:
{
  "phrase": "one two words",
  "blurb": "at most ten words here",
  "amplifiedFilter": "long instructions only — no transformation-rules block"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: Math.max(0, Math.min(1, ANTHROPIC_TEMPERATURE + 0.28)),
      system: NFC_SYNTH_META_SYSTEM,
      messages: [{ role: 'user', content: userBlock }],
    });

    const raw = msg.content?.[0]?.text?.trim();
    if (!raw) {
      res.status(502).json({ error: 'Empty response from Anthropic' });
      return;
    }

    let parsed;
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      parsed = JSON.parse(slice);
    } catch {
      res.status(502).json({ error: 'Model did not return valid JSON', raw: raw.slice(0, 500) });
      return;
    }

    const phrase =
      typeof parsed.phrase === 'string'
        ? parsed.phrase.trim().replace(/\s+/g, ' ')
        : typeof parsed.name === 'string'
          ? parsed.name.trim().replace(/\s+/g, ' ')
          : typeof parsed.summary === 'string'
            ? parsed.summary.trim().replace(/\s+/g, ' ')
            : '';
    const blurb =
      typeof parsed.blurb === 'string'
        ? parsed.blurb.trim().replace(/\s+/g, ' ')
        : typeof parsed.shortLine === 'string'
          ? parsed.shortLine.trim().replace(/\s+/g, ' ')
          : '';
    const amplifiedFilter =
      (typeof parsed.amplifiedFilter === 'string' && parsed.amplifiedFilter.trim()) ||
      (typeof parsed.amplified_filter === 'string' && parsed.amplified_filter.trim()) ||
      (typeof parsed.prompt === 'string' && parsed.prompt.trim()) ||
      '';

    if (!phrase || !amplifiedFilter) {
      res.status(502).json({ error: 'JSON missing phrase or amplifiedFilter', parsed });
      return;
    }
    if (phrase.length > 80) {
      res.status(502).json({ error: 'Model phrase too long; try again.' });
      return;
    }
    const wordCount = blurb ? blurb.split(/\s+/).filter(Boolean).length : 0;
    if (blurb && wordCount > 12) {
      res.status(502).json({ error: 'Model blurb exceeds ~10 words; try again.' });
      return;
    }

    res.json({
      phrase,
      blurb,
      amplifiedFilter,
      summary: phrase,
      prompt: amplifiedFilter,
      promptFormat: 'inner',
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

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
        error: `${msg}. Try setting ANTHROPIC_MODEL in .env to an available model for your account (for example: claude-3-5-sonnet-latest or claude-3-5-haiku-latest).`,
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ─── TTS (OpenAI — Anthropic has no TTS) ─────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({
      error: 'OPENAI_API_KEY is not set. TTS requires an OpenAI key even when using Anthropic for chat.',
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
      body: JSON.stringify({
        model: m,
        voice: v,
        input,
        response_format: 'mp3',
      }),
    });

    if (!r.ok) {
      let errMsg = r.statusText;
      try {
        const errJson = await r.json();
        errMsg = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errMsg = await r.text();
      }
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
    res.status(500).json({
      error:
        'ELEVENLABS_API_KEY is not set. Add it to hardware-bridge/.env (and optional ELEVENLABS_VOICE_ID default).',
    });
    return;
  }

  const { text, voice_id, model_id, output_format } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Expected JSON body: { text: string, voice_id?: string, model_id?: string }' });
    return;
  }

  const vidRaw = typeof voice_id === 'string' && voice_id.trim() ? voice_id.trim() : ELEVENLABS_VOICE_DEFAULT;
  if (!vidRaw || !isSafeElevenVoiceId(vidRaw)) {
    res.status(400).json({
      error:
        'Missing or invalid voice_id. Paste a voice ID from elevenlabs.io (Voices), or set ELEVENLABS_VOICE_ID in .env.',
    });
    return;
  }

  const mid =
    typeof model_id === 'string' && ELEVENLABS_MODELS.has(model_id) ? model_id : ELEVENLABS_MODEL_DEFAULT;
  const fmt =
    typeof output_format === 'string' && ELEVEN_OUTPUT_FORMATS.has(output_format)
      ? output_format
      : 'mp3_44100_128';

  const input = text.trim().slice(0, 2500);

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vidRaw)}`);
  url.searchParams.set('output_format', fmt);

  try {
    const r = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': key,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: input,
        model_id: mid,
      }),
    });

    if (!r.ok) {
      let errMsg = r.statusText;
      try {
        const errJson = await r.json();
        const d = errJson.detail;
        errMsg =
          (Array.isArray(d) ? d.map((x) => x.msg || x).join('; ') : d?.message || d) ||
          errJson.message ||
          JSON.stringify(errJson);
      } catch {
        errMsg = (await r.text()).slice(0, 300) || errMsg;
      }
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

/** Non-secret flags so the UI can show whether API TTS is configured. */
app.get('/api/tts-status', (req, res) => {
  const vid = process.env.ELEVENLABS_VOICE_ID?.trim();
  res.json({
    openai_key_set: Boolean(process.env.OPENAI_API_KEY?.trim()),
    elevenlabs_key_set: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    elevenlabs_voice_default_set: Boolean(vid && isSafeElevenVoiceId(vid)),
  });
});

app.use(express.static(join(__dirname, 'web')));

app.listen(PORT, () => {
  console.log(`Hardware bridge: http://localhost:${PORT}`);
});