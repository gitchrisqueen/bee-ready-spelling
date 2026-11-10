// Turns an English Wiktionary etymology paragraph into one short origin label such as "Latin" or "French".
// Used by the live lookup in the page and by tools/library/build.mjs, so both give the same label.
// The rule: the first language named in the text that is not English wins, mapped to a base name
// ("Old French" -> "French", "Medieval Latin" -> "Latin"). If only older English is named, the label is "Old English".
// Anything else gives null, and the page then says origin is not available. Never shows unparsed text.
const BASE = [
  ['Latin', /\b(?:Classical |Late |Medieval |Middle |New |Vulgar |Ecclesiastical |Renaissance )?Latin\b/],
  ['Greek', /\b(?:Ancient |Koine |Byzantine |Medieval |Modern )?Greek\b/],
  ['French', /\b(?:Old |Middle |Norman |Anglo-Norman |Modern |Canadian )?(?:Anglo-)?French\b|\bAnglo-Norman\b/],
  ['German', /\b(?:Old High |Middle High |Middle Low |Low |High |Swiss )?German\b/],
  ['Dutch', /\b(?:Middle )?Dutch\b|\bFlemish\b/],
  ['Spanish', /\b(?:Old )?Spanish\b/],
  ['Italian', /\b(?:Old )?Italian\b|\bNeapolitan\b|\bSicilian\b|\bVenetian\b|\bTuscan\b/],
  ['Portuguese', /\bPortuguese\b/],
  ['Arabic', /\bArabic\b/],
  ['Persian', /\b(?:Middle )?Persian\b/],
  ['Hebrew', /\bHebrew\b/],
  ['Yiddish', /\bYiddish\b/],
  ['Sanskrit', /\bSanskrit\b/],
  ['Hindi', /\bHindi\b|\bUrdu\b/],
  ['Turkish', /\b(?:Ottoman )?Turkish\b/],
  ['Russian', /\bRussian\b/],
  ['Polish', /\bPolish\b/],
  ['Japanese', /\bJapanese\b/],
  ['Chinese', /\b(?:Middle |Old )?Chinese\b|\bMandarin\b|\bCantonese\b/],
  ['Norse', /\bOld Norse\b|\bNorse\b|\bIcelandic\b|\bSwedish\b|\bDanish\b|\bNorwegian\b/],
  ['Celtic', /\bCeltic\b|\bIrish\b|\bScottish Gaelic\b|\bWelsh\b|\bGaelic\b|\bBreton\b|\bCornish\b/],
  ['Hungarian', /\bHungarian\b/],
  ['Malay', /\bMalay\b|\bIndonesian\b/],
  ['Hawaiian', /\bHawaiian\b/],
  ['Nahuatl', /\bNahuatl\b/],
  ['Quechua', /\bQuechua\b/],
  ['Tamil', /\bTamil\b/],
  ['Swahili', /\bSwahili\b/],
  ['Korean', /\bKorean\b/],
];
const OLD_ENGLISH = /\bOld English\b|\bAnglo-Saxon\b|\bProto-Germanic\b|\bMiddle English\b/;

export function originLabel(text) {
  if (typeof text !== 'string') return null;
  // Only the first sentence or two matter: later text is about other words or cognates.
  const body = text.replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!body) return null;
  let best = null;
  for (const [label, re] of BASE) {
    const m = re.exec(body);
    if (m && (best === null || m.index < best.index)) best = { label, index: m.index };
  }
  if (best) return best.label;
  return OLD_ENGLISH.test(body) ? 'Old English' : null;
}
