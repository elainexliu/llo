/**
 * NFC UID normalization (must match Arduino JSON `nfc_uid` hex).
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
