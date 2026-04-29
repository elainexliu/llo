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
  // 7-byte UIDs (your scans)
  '04eb3649be2a81': {
    label: 'Tag A — warm / balanced',
    knobs: {
      register: 62,
      trust: 48,
      subtext: 38,
      formality: 52,
      projection: 22,
    },
  },
  '04ec3649be2a81': {
    label: 'Tag B — trusting / elevated formality',
    knobs: {
      register: 58,
      trust: 72,
      subtext: 34,
      formality: 68,
      projection: 18,
    },
  },
  // 4-byte UID
  '7eb00a07': {
    label: 'Tag C — subtext-heavy / cool register',
    knobs: {
      register: 35,
      trust: 40,
      subtext: 78,
      formality: 55,
      projection: 40,
    },
  },
};
