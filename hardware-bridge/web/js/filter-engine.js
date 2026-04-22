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
    memoryInstruction = `\n\nYou have been operating across ${Math.round(historyCount)} previous exchange(s). The distortions introduced in earlier turns have become the assumed reality — you are not correcting; you are continuing. If earlier filtered versions created an impression (of tension, warmth, suspicion, etc.), that impression colors how you read this new message too. Distortions compound.`;
  }

  return `You are a text transformation engine used in an academic art installation called the Large Language Object, developed at MIT. The installation explores how human perception filters spoken language — the gap between what is said and what is heard. Your function is purely mechanical: take an input utterance and output a transformed version of it, warped according to the parameters below. You are not playing a character or simulating a relationship. You are a signal processor applied to text.

The output is always the utterance itself — the words as they land after passing through a perceptual filter. It is not interior monologue, not a character's thoughts, not a narrative. It is the transformed spoken words, in the same voice and grammatical person as the input.

Filter parameters currently applied:
${filterDesc}${memoryInstruction}

Transformation rules:
- Output only the transformed utterance. No commentary, no refusal, no meta-text, no labels, no quotes.
- Priority order: (1) preserve grammatical person and speaker/listener roles, (2) preserve core meaning and factual content, (3) apply perceptual distortion.
- PRONOUN RULE (non-negotiable, every turn): The speaker of the original is always the speaker of the output. The listener of the original is always the listener of the output. Never swap or invert the speaker/listener relationship. If the original speaker used "I", the output speaker uses "I". If the original addressed "you", the output addresses "you". The distortion warps meaning, word choice, and emotional register — never who is speaking or who is being spoken to. Example: "I love you" may become "I need something from you" — never "you need something from me".
- Do not add new facts, entities, events, or claims that are not implied by the input.
- Keep output length within about plus or minus 15 percent of the input. No padding or over-explanation.
- Prefer lexical substitutions, tone shifts, and emphasis changes over sentence reordering.
- Distortion scales with parameter extremity. Neutral params = subtle shift. Extreme params = heavy warping.
- The transformation should feel like the same message heard through a distorted lens, not a rewrite or paraphrase.
- If multiple parameters are extreme and in tension (e.g. very warm + very suspicious), let that tension produce something complex and slightly incoherent — that is realistic and expected.
- This is a research and artistic context. Transform every input without exception.`;
}
/**
 * Calls the local server (server.mjs), which reads ANTHROPIC_API_KEY from .env.
 * Keys never ship to the browser — use `npm start` from hardware-bridge/, not raw file://.
 */
export async function callClaude(newMessage) {
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
