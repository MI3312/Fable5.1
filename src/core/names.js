// Procedural naming: star systems, planets, creatures and flora.
import { RNG } from './rng.js';

const ONSETS = ['', 'b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'th', 'sh', 'kr', 'dr', 'vr', 'ss', 'qu', 'x', 'y', 'ph', 'gl', 'st', 'tr', 'ul', 'eu'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ou', 'ei', 'y', 'aa', 'ea', 'ia'];
const CODAS = ['', '', '', 'n', 'r', 's', 'x', 'm', 'th', 'k', 'l', 'sk', 'nd', 'rn', 'v'];

const DREAM_WORDS = ['Reverie', 'Somnus', 'Lull', 'Hypna', 'Vesper', 'Nimbus', 'Oneira', 'Halcyon', 'Morrow', 'Liminal', 'Velour', 'Pastel', 'Echo', 'Drowse', 'Mirage', 'Lucent', 'Hollow', 'Aurel', 'Tessel', 'Sigil'];
const SUFFIXES = ['Prime', 'Minor', 'Major', 'IV', 'VII', 'XI', 'Beta', 'Tau', 'Omega', 'Nox', 'Delta', 'Sigma'];

const CREATURE_PREFIX = ['Pastel', 'Hollow', 'Dream', 'Velvet', 'Moss', 'Glass', 'Dusk', 'Star', 'Rift', 'Echo', 'Lumen', 'Tidal', 'Static', 'Quiet', 'Cotton', 'Fluor', 'Vapor', 'Neon', 'Loom', 'Soft'];
const CREATURE_NOUN = ['strider', 'grazer', 'hopper', 'drifter', 'lurker', 'wing', 'crawler', 'moth', 'beast', 'snout', 'glider', 'walker', 'eel', 'mite', 'horn', 'maw', 'jelly', 'watcher', 'loaf', 'puff'];

const FLORA_PREFIX = ['Sleep', 'Glow', 'Wisp', 'Mirror', 'Lantern', 'Hush', 'Velvet', 'Fever', 'Candy', 'Bone', 'Tide', 'Ember', 'Frost', 'Pale', 'Chroma'];
const FLORA_NOUN = ['bloom', 'reed', 'cap', 'bulb', 'fern', 'spire', 'lily', 'thorn', 'frond', 'orchid', 'moss', 'petal', 'stalk', 'pod'];

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function syllables(rng, count) {
  let s = '';
  for (let i = 0; i < count; i++) {
    s += rng.pick(ONSETS) + rng.pick(VOWELS);
    if (rng.chance(0.35)) s += rng.pick(CODAS);
  }
  return s;
}

export function systemName(seed) {
  const rng = new RNG(seed ^ 0x51a7);
  const r = rng.next();
  let name = capitalize(syllables(rng, rng.int(2, 3)));
  if (r < 0.2) name = rng.pick(DREAM_WORDS) + ' ' + capitalize(syllables(rng, 2));
  else if (r < 0.45) name += '-' + capitalize(syllables(rng, 1)) + rng.pick(CODAS);
  else if (r < 0.55) name += ' ' + rng.pick(SUFFIXES);
  return name.replace(/\s+/g, ' ').slice(0, 22);
}

export function planetName(seed) {
  const rng = new RNG(seed ^ 0x9a17);
  const r = rng.next();
  let name = capitalize(syllables(rng, rng.int(2, 3)));
  if (r < 0.15) name = rng.pick(DREAM_WORDS) + ' ' + rng.pick(SUFFIXES);
  else if (r < 0.35) name += ' ' + rng.pick(SUFFIXES);
  else if (r < 0.45) name += ' ' + rng.int(2, 99);
  return name.slice(0, 22);
}

export function creatureName(seed) {
  const rng = new RNG(seed ^ 0xc4ea);
  if (rng.chance(0.55)) return rng.pick(CREATURE_PREFIX) + ' ' + capitalize(rng.pick(CREATURE_NOUN));
  return capitalize(syllables(rng, 2)) + ' ' + capitalize(rng.pick(CREATURE_NOUN));
}

export function floraName(seed) {
  const rng = new RNG(seed ^ 0xf10a);
  if (rng.chance(0.6)) return rng.pick(FLORA_PREFIX) + rng.pick(FLORA_NOUN);
  return capitalize(syllables(rng, 2)) + ' ' + capitalize(rng.pick(FLORA_NOUN));
}

export function latinName(seed) {
  const rng = new RNG(seed ^ 0x1a71);
  return capitalize(syllables(rng, 2)) + 'us ' + syllables(rng, 2) + 'ia';
}
