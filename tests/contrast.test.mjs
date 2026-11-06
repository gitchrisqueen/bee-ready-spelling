// WCAG 2.2 contrast checks read straight from styles.css, so a future colour change that lowers contrast fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(join(root, 'styles.css'), 'utf8');

// WCAG relative luminance and contrast ratio.
const channel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  assert.match(h, /^[0-9a-f]{6}$/i, `not a hex colour: ${hex}`);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the contrast function matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
});

// Every rule whose selector list contains `selector` exactly (media-query rules included).
function declarations(selector, prop) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) { // preflight: ok
    if (!m[1].split(',').map(s => s.trim()).includes(selector)) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0 && d.slice(0, i).trim() === prop) out.push(d.slice(i + 1).trim());
    }
  }
  return out;
}
function cssVar(name) {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`));
  assert.ok(m, `${name} is not defined in :root`);
  return m[1];
}
// First colour in a value, resolving var(--x).
function colorIn(value) {
  const v = value.match(/var\((--[a-z0-9-]+)\)/);
  if (v) return cssVar(v[1]);
  const h = value.match(/#[0-9a-fA-F]{3,6}\b/);
  assert.ok(h, `no colour in "${value}"`);
  return h[0];
}
function colors(selector, prop) {
  const found = declarations(selector, prop);
  assert.ok(found.length, `${selector} { ${prop} } not found in styles.css`);
  return found.map(colorIn);
}
function gradientStops(selector) {
  const found = declarations(selector, 'background').find(v => v.startsWith('linear-gradient'));
  assert.ok(found, `${selector} has no gradient background`);
  return [...found.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0]);
}
function atLeast(fg, bg, min, label) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= min, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
}

const white = '#ffffff';
const pageStops = gradientStops('body');

test('12 px bold labels reach 4.5:1 on white and on every page-background stop', () => {
  assert.ok(pageStops.length >= 3, 'page gradient stops were not read');
  for (const fg of colors('.mini-kicker', 'color')) {
    for (const bg of [white, ...pageStops]) atLeast(fg, bg, 4.5, '.mini-kicker');
  }
  for (const fg of colors('.footer', 'color')) {
    for (const bg of pageStops) atLeast(fg, bg, 4.5, '.footer');
  }
});

test('voice-card caption and count-option caption reach 4.5:1 on their tiles', () => {
  const cardBgs = [...colors('.voice-card', 'background'), ...colors('.voice-card.active', 'background')];
  for (const fg of colors('.voice-card em', 'color')) {
    for (const bg of cardBgs) atLeast(fg, bg, 4.5, '.voice-card em');
  }
  const tileBgs = [...colors('.count-option', 'background'), ...colors('.count-option.active', 'background')];
  for (const fg of colors('.count-option small', 'color')) {
    for (const bg of tileBgs) atLeast(fg, bg, 4.5, '.count-option small');
  }
});

test('form-field borders reach 3:1 against their background (WCAG 1.4.11)', () => {
  const fieldBg = colors('.field input', 'background')[0];
  for (const sel of ['.field input', '.field select']) {
    for (const border of colors(sel, 'border')) atLeast(border, fieldBg, 3, `${sel} border`);
  }
  for (const border of colors('.answer-row input', 'border')) atLeast(border, white, 3, 'answer box border');
  const customBg = colors('.custom-count', 'background')[0];
  for (const border of colors('.custom-count input', 'border-bottom')) {
    atLeast(border, customBg, 3, 'custom number border');
  }
});

test('selected options use more than colour: dark border, check mark, and 3:1 against the unselected tile', () => {
  const cases = [
    { sel: '.count-option', unselectedBg: () => colors('.count-option', 'background')[0] },
    { sel: '.voice-card', unselectedBg: () => colors('.voice-card', 'background')[0] },
    { sel: '.speed-option', unselectedBg: () => colors('.speed-option', 'background')[0] },
  ];
  for (const { sel, unselectedBg } of cases) {
    const border = colors(`${sel}.active`, 'border-color')[0];
    atLeast(border, unselectedBg(), 3, `${sel}.active border vs unselected tile`);
    atLeast(border, colors(`${sel}.active`, 'background')[0], 3, `${sel}.active border vs its own fill`);
    const mark = declarations(`${sel}.active::before`, 'content');
    assert.ok(mark.length, `${sel}.active needs a check mark (::before content)`);
  }
  assert.ok(declarations('.count-option.active', 'box-shadow').length, 'selected count tile needs a thicker border');
});
