import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE_DEFAULT = process.env.OPENAI_TTS_VOICE || 'nova';

/** Voices supported across OpenAI speech models (invalid pairs return API error). */
const TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]);

const TTS_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);

app.post('/api/chat', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({
      error:
        'OPENAI_API_KEY is not set. Copy .env.example to .env in hardware-bridge/ and add your key.',
    });
    return;
  }

  const { system, messages } = req.body;
  if (typeof system !== 'string' || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Expected JSON body: { system: string, messages: array }' });
    return;
  }

  const openaiMessages = [{ role: 'system', content: system }, ...messages];

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: openaiMessages,
        max_tokens: 400,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data.error?.message || JSON.stringify(data);
      res.status(r.status).json({ error: msg });
      return;
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      res.status(502).json({ error: 'Empty response from OpenAI' });
      return;
    }

    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/** OpenAI text-to-speech — returns MP3 (same API key as chat). */
app.post('/api/tts', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({
      error:
        'OPENAI_API_KEY is not set. Copy .env.example to .env in hardware-bridge/ and add your key.',
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
