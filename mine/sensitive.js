// Topics that keep a definition, origin or example sentence from being shown to a child when the text came from the
// static library or a dictionary lookup. It does not apply to a word a child or grown-up typed, and it does not apply
// to a definition a grown-up typed: the grown-up decides those. A word whose source text is held back falls through to
// manual entry or the Dictionary link. The list is deliberately cautious and is not complete; the grown-up's review
// of looked-up text (docs/my-words-plan.md) is the second control. Add terms by pull request.
export const SENSITIVE_TERMS = Object.freeze([
  // violence and weapons
  'kill', 'killer', 'murder', 'murderer', 'homicide', 'suicide', 'shoot', 'shooter', 'gun', 'rifle', 'pistol',
  'firearm', 'bullet', 'ammunition', 'weapon', 'bomb', 'explosive', 'terror', 'terrorist', 'terrorism', 'assault',
  'abuse', 'torture', 'massacre', 'genocide', 'slaughter', 'execute', 'execution', 'stab', 'corpse', 'death',
  'deadly', 'lethal', 'fatal', 'strangle', 'hostage', 'kidnap',
  // sex and the body
  'sex', 'sexual', 'sexy', 'naked', 'nude', 'porn', 'pornography', 'erotic', 'breast', 'penis', 'vagina', 'genital',
  'intercourse', 'abortion', 'contraceptive', 'condom', 'prostitute', 'rape', 'rapist', 'molest',
  // drugs, alcohol and tobacco
  'drug', 'cocaine', 'heroin', 'marijuana', 'cannabis', 'opium', 'narcotic', 'alcohol', 'alcoholic', 'beer', 'wine',
  'liquor', 'vodka', 'whiskey', 'drunk', 'intoxicated', 'cigarette', 'tobacco',
  // other heavy subjects
  'cancer', 'gamble', 'gambling', 'casino', 'devil', 'hitler', 'nazi',
]);
// Held back only in example sentences, where a stray "died" or "stupid" is a worse surprise than in a definition
// (a definition such as "a place where dead people are buried" is fine for the word cemetery).
export const EXAMPLE_ONLY_TERMS = Object.freeze([
  'die', 'dead', 'dying', 'divorce', 'hate', 'hell', 'damn', 'bloody', 'stupid', 'idiot', 'fool', 'crazy', 'ugly',
]);
const TERMS = new Set(SENSITIVE_TERMS);
const EXAMPLE_TERMS = new Set([...SENSITIVE_TERMS, ...EXAMPLE_ONLY_TERMS]);

function forms(token) {
  const out = new Set([token]);
  if (token.endsWith('ies')) out.add(`${token.slice(0, -3)}y`);
  if (token.endsWith('es')) out.add(token.slice(0, -2));
  if (token.endsWith('s')) out.add(token.slice(0, -1));
  if (token.endsWith('ing')) { out.add(token.slice(0, -3)); out.add(`${token.slice(0, -3)}e`); }
  if (token.endsWith('ed')) { out.add(token.slice(0, -2)); out.add(token.slice(0, -1)); }
  if (token.endsWith('er')) out.add(token.slice(0, -2));
  return out;
}

export function isSensitiveWord(word, { example = false } = {}) {
  const token = String(word ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!token) return false;
  const terms = example ? EXAMPLE_TERMS : TERMS;
  for (const f of forms(token)) if (terms.has(f)) return true;
  return false;
}

// True if any word in the text is a sensitive term. `example: true` also applies the example-sentence terms.
export function isSensitiveText(text, options) {
  for (const token of String(text ?? '').split(/[^\p{L}]+/u)) if (token && isSensitiveWord(token, options)) return true;
  return false;
}
