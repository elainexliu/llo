/**
 * Shared filter logic (aligned with large-language-object-v2.1.html KNOB_DEFS).
 */

export const KNOB_DEFS = [
  { id: 'register', label: 'Register', lo: 'hostile', hi: 'warm', default: 50 },
  { id: 'trust', label: 'Trust', lo: 'suspicious', hi: 'credulous', default: 40 },
  { id: 'subtext', label: 'Subtext', lo: 'literal', hi: 'reading into', default: 35 },
  { id: 'formality', label: 'Formality', lo: 'raw', hi: 'formal', default: 50 },
  { id: 'projection', label: 'Projection', lo: 'neutral', hi: 'self-referential', default: 20 },
];

/** Current 0–100 values (updated by physical sliders or defaults). */
export const knobValues = {};
KNOB_DEFS.forEach((k) => {
  knobValues[k.id] = k.default;
});

/** Claude message history for this single filter. */
export const histories = [];

export function describeKnobs() {
  const v = knobValues;
  const segments = [];

  const reg = v.register / 100;
  if (reg < 0.25) segments.push("You interpret everything with suspicion and mild hostility — a cold, guarded reading.");
  else if (reg < 0.45) segments.push("Your reading is slightly cool and detached, with an undercurrent of wariness.");
  else if (reg < 0.6) segments.push("Your reading is emotionally neutral.");
  else if (reg < 0.8) segments.push("You read messages with warmth — you want to find the good in them.");
  else segments.push("You read messages with intense warmth and generosity, almost naively so.");

  const trust = v.trust / 100;
  if (trust < 0.25) segments.push("You assume ulterior motives and read between the lines for manipulation.");
  else if (trust < 0.45) segments.push("You're mildly skeptical — you take things with a grain of salt.");
  else if (trust < 0.6) segments.push("You take messages at face value.");
  else if (trust < 0.8) segments.push("You trust what you hear and extend the benefit of the doubt.");
  else segments.push("You are fully credulous — you believe everything, without question.");

  const sub = v.subtext / 100;
  if (sub < 0.25) segments.push("You process only the literal content. Implications pass through you unread.");
  else if (sub < 0.45) segments.push("You occasionally notice implied meaning but mostly stay with what was said.");
  else if (sub < 0.6) segments.push("You pick up on subtext roughly as intended.");
  else if (sub < 0.8) segments.push("You amplify subtext — you read implied meanings loudly, sometimes over what was literally said.");
  else segments.push("You are entirely focused on subtext. The literal words almost vanish; only what you feel is underneath remains.");

  const form = v.formality / 100;
  if (form < 0.25) segments.push("You render everything in raw, unfiltered terms.");
  else if (form < 0.45) segments.push("You strip back polite framing and get to the blunt core.");
  else if (form < 0.6) segments.push("You preserve the register of the original.");
  else if (form < 0.8) segments.push("You elevate the language slightly — things feel more composed and considered.");
  else segments.push("You translate everything into formal, measured, slightly elevated prose.");

  const proj = v.projection / 100;
  if (proj < 0.25) segments.push("You do not project. The message remains about the sender.");
  else if (proj < 0.45) segments.push("Occasionally you filter things through your own experience without realizing it.");
  else if (proj < 0.6) segments.push("You sometimes make it about yourself — relating what you hear back to your own situation.");
  else if (proj < 0.8) segments.push("You strongly relate incoming messages to your own feelings and situation.");
  else segments.push("You completely project — everything becomes about you. The sender's intent dissolves into your own inner state.");

  return segments.join(' ');
}

export function buildSystemPrompt() {
  const filterDesc = describeKnobs();
  const historyCount = histories.length / 2;

  let memoryInstruction = '';
  if (historyCount >= 1) {
    memoryInstruction = `\n\nYou have been operating across ${Math.round(historyCount)} previous exchange(s). Your filter has been shaping this conversation from the start. The distortions you've introduced in earlier turns have become the assumed reality — you are not correcting; you are continuing. If earlier filtered versions created an impression (of tension, warmth, suspicion, etc.), that impression colors how you read this new message too. Distortions compound.`;
  }

  return `You are a perceptual filter embedded in a person's mind. When someone speaks to them, the words pass through you before reaching conscious understanding. You do not summarize or annotate — you output the message as it lands: the same words, but warped by the parameters of this particular mind.

Your filter profile:
${filterDesc}${memoryInstruction}

Rules:
- Output only the transformed message. No framing, no quotes, no labels, no "they said", no commentary.
- Keep grammatical person consistent with the original (if they said "I", your output keeps "I").
- Length should be similar to the original. No padding or over-explanation.
- Distortion scales with parameter extremity. Neutral params = subtle shift. Extreme params = heavy warping.
- The transformation should feel like the same message heard through a distorted lens, not a rewrite or paraphrase.
- If multiple parameters are extreme and in tension (e.g. very warm + very suspicious), let that tension produce something complex and slightly incoherent — that's realistic.`;
}

/**
 * Calls the local server (server.mjs), which reads OPENAI_API_KEY from .env.
 * Keys never ship to the browser — use `npm start` from hardware-bridge/, not raw file://.
 */
export async function callOpenAI(newMessage) {
  const systemPrompt = buildSystemPrompt();
  const messages = [...histories, { role: 'user', content: newMessage }];

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: systemPrompt, messages }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || res.statusText || 'Request failed');
  }
  if (typeof data.text === 'string') return data.text;
  throw new Error('No response text');
}

export function pushExchange(original, filtered) {
  histories.push({ role: 'user', content: original });
  histories.push({ role: 'assistant', content: filtered });
  if (histories.length > 16) {
    histories.splice(0, histories.length - 16);
  }
}
