'use strict';

/**
 * Normalize Mexican (and already-international) phone numbers to E.164.
 * Returns null when the input cannot be turned into a usable WhatsApp destination.
 *
 * MX mobile/landline is 10 national digits → +52XXXXXXXXXX.
 * Legacy prefixes 044 / 045 / 01 and the old +521 mobile trunk are stripped.
 */
function normalizeMxE164(raw) {
  if (raw == null) return null;
  let original = String(raw).trim();
  if (!original) return null;
  original = original.replace(/^whatsapp:/i, '').trim();

  const hasPlus = original.startsWith('+');
  let d = original.replace(/\D/g, '');
  if (!d) return null;

  // Long-distance / mobile prefixes still typed by some users
  if (/^04[45]/.test(d) && d.length >= 12) {
    d = d.replace(/^04[45]/, '');
  }
  if (d.startsWith('01') && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }

  // Old MX mobile E.164 included a "1" after the country code (+521 + 10 digits)
  if (d.startsWith('521') && d.length === 13) {
    d = '52' + d.slice(3);
  }

  if (d.length === 10) {
    return '+52' + d;
  }
  if (d.length === 12 && d.startsWith('52')) {
    return '+' + d;
  }
  if (hasPlus && d.length >= 10 && d.length <= 15) {
    return '+' + d;
  }
  // International without plus (e.g. 525512345678 already handled; other countries)
  if (!hasPlus && d.length >= 11 && d.length <= 15) {
    return '+' + d;
  }
  return null;
}

/** Persist E.164 when possible; otherwise keep the trimmed original (never invent a number). */
function persistPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return normalizeMxE164(trimmed) || trimmed;
}

module.exports = { normalizeMxE164, persistPhone };
