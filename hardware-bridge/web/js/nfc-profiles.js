/**
 * Map NFC tag UIDs (hex, no spaces) to filter knob presets + short labels.
 * Edit labels and 0–100 values per card. Keys must match Arduino output exactly.
 */

export function normalizeNfcUidString(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .replace(/^0x/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9a-f]/g, '');
}

/**
 * @type {Record<string, { label: string, knobs: Record<string, number> }>}
 */
export const NFC_PROFILES = {
  // 7-byte UIDs — keys sorted by hex string (byte order); Tag A… matches that order.
  '04da3649be2a81': {
    label: 'Tag A — warm trust / casual',
    knobs: {
      register: 65,
      trust: 68,
      subtext: 32,
      formality: 38,
      projection: 28,
    },
  },
  '04db3649be2a81': {
    label: 'Tag B — balanced mid',
    knobs: {
      register: 52,
      trust: 52,
      subtext: 48,
      formality: 52,
      projection: 35,
    },
  },
  '04dc3649be2a81': {
    label: 'Tag C — subtext-heavy / cool register',
    knobs: {
      register: 35,
      trust: 40,
      subtext: 78,
      formality: 55,
      projection: 40,
    },
  },
  '04dd3649be2a81': {
    label: 'Tag D — formal / low projection',
    knobs: {
      register: 60,
      trust: 44,
      subtext: 36,
      formality: 75,
      projection: 15,
    },
  },
  '04e33649be2a81': {
    label: 'Tag E — register-forward',
    knobs: {
      register: 70,
      trust: 45,
      subtext: 40,
      formality: 50,
      projection: 25,
    },
  },
  '04e43649be2a81': {
    label: 'Tag F — trust-forward',
    knobs: {
      register: 55,
      trust: 65,
      subtext: 42,
      formality: 55,
      projection: 20,
    },
  },
  '04e53649be2a81': {
    label: 'Tag G — subtext-forward',
    knobs: {
      register: 48,
      trust: 50,
      subtext: 72,
      formality: 48,
      projection: 30,
    },
  },
  '04e63649be2a81': {
    label: 'Tag H — projection-forward',
    knobs: {
      register: 50,
      trust: 55,
      subtext: 45,
      formality: 45,
      projection: 55,
    },
  },
  '04eb3649be2a81': {
    label: 'Tag I — warm / balanced',
    knobs: {
      register: 62,
      trust: 48,
      subtext: 38,
      formality: 52,
      projection: 22,
    },
  },
  '04ec3649be2a81': {
    label: 'Tag J — trusting / elevated formality',
    knobs: {
      register: 58,
      trust: 72,
      subtext: 34,
      formality: 68,
      projection: 18,
    },
  },
};
