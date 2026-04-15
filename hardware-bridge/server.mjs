import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

app.use(express.static(join(__dirname, 'web')));

app.listen(PORT, () => {
  console.log(`Hardware bridge: http://localhost:${PORT}`);
});
