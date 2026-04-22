import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

app.use(express.static(join(__dirname, 'web')));

app.listen(PORT, () => {
  console.log(`Hardware bridge: http://localhost:${PORT}`);
});