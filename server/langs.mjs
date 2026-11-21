// =====================================================================
// The languages Primer works in.
//   UI_LANGS    the interface languages (assets/i18n/<code>.json, and
//               English); a learner's account language is one of these.
//   LANG_NAMES  every language a course can be written in, named the way
//               the AI is told it. The interface languages come first.
// The same list, with native names, is in assets/js/i18n.js.
// =====================================================================
export const UI_LANGS = new Set(['en', 'hi', 'bho', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'or', 'ml', 'pa', 'as', 'mai', 'es', 'fr', 'ar', 'pt', 'ru']);

// No prototype, so a code like "constructor" is never mistaken for a language.
export const LANG_NAMES = Object.freeze(Object.assign(Object.create(null), {
  en: 'English',
  hi: 'Hindi',
  bho: 'Bhojpuri (in Devanagari script)',
  bn: 'Bengali',
  mr: 'Marathi',
  te: 'Telugu',
  ta: 'Tamil',
  gu: 'Gujarati',
  ur: 'Urdu',
  kn: 'Kannada',
  or: 'Odia',
  ml: 'Malayalam',
  pa: 'Punjabi (in Gurmukhi script)',
  as: 'Assamese',
  mai: 'Maithili (in Devanagari script)',
  es: 'Spanish',
  fr: 'French',
  ar: 'Arabic',
  pt: 'Portuguese',
  ru: 'Russian',
  // more languages a course can be written in
  ne: 'Nepali',
  si: 'Sinhala',
  sa: 'Sanskrit',
  kok: 'Konkani (in Devanagari script)',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  uk: 'Ukrainian',
  el: 'Greek',
  tr: 'Turkish',
  fa: 'Persian',
  he: 'Hebrew',
  sw: 'Swahili',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Simplified Chinese',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  fil: 'Filipino'
}));

export const isLang = (code) => typeof code === 'string' && Object.hasOwn(LANG_NAMES, code);
export const isUILang = (code) => typeof code === 'string' && UI_LANGS.has(code);
