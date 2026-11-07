// Validation for pieces shared to the online market showcase. Used by the
// server (before storing anything) and by the client (before rendering a
// piece someone else made). Every field is rebuilt from a whitelist onto fresh
// defaults: unknown fields are dropped, strings are capped, numbers clamped,
// option ids checked against the game's own lists. Private data (crafting
// history, sale/gift status) never leaves the player's save.

import { hasMat } from '../data/materials.js';
import { ALL_OPTION_LISTS, PALETTES } from '../data/options.js';
import { TRADITIONS } from '../data/traditions.js';
import { damascusConsistent, PATTERN_COUNT, rareColor, VISIBILITY_CAP, type DamascusData } from '../item/damascus.js';
import { CATEGORY_INFO, createDraft, SEGMENTS } from '../item/factory.js';
import { refreshDerived } from '../item/finalize.js';
import type { Category, Item, StageQuality } from '../item/types.js';

export const SHOWCASE_LIMITS = { bodyBytes: 24_000, name: 48, player: 20, workshop: 28, season: 12 };

export interface ShowcaseAuthor { player: string; workshop: string }

export type SanitizeResult = { ok: true; item: Item } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Trim, strip control characters and collapse whitespace. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
};
const int = (v: unknown, lo: number, hi: number, fb: number) => Math.round(num(v, lo, hi, fb));
const nums = (v: unknown, n: number, lo: number, hi: number, fb = 0): number[] => {
  const a = Array.isArray(v) ? v.slice(0, n) : [];
  const out = a.map((x) => num(x, lo, hi, fb));
  while (out.length < n) out.push(fb);
  return out;
};
const opt = (list: string, v: unknown, fb: string): string => {
  const s = typeof v === 'string' ? v : '';
  return ALL_OPTION_LISTS[list]?.some((o) => o.id === s) ? s : fb;
};
const matId = (v: unknown, fb: string): string => (typeof v === 'string' && hasMat(v) ? v : fb);
const hex = (v: unknown, fb: string): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fb);

const QUALITY_KEYS: (keyof StageQuality)[] = ['prep', 'fold', 'shaping', 'structure', 'inlay', 'surface', 'assembly', 'engraving', 'infusion', 'finishing'];
const GEM_SLOTS = ['guard', 'pommel', 'blade', 'boss'] as const;
const BLEMISH_KINDS = ['pit', 'scratch', 'scale'] as const;
const MUTATIONS = ['colorband', 'speckle', 'ghostedge', 'veins', 'halo', 'inverted'];

export function sanitizeShowcaseItem(raw: unknown): SanitizeResult {
  if (!isObj(raw)) return { ok: false, error: 'Missing piece.' };
  const category = raw.category as Category;
  if (!['sword', 'dagger', 'shield'].includes(category)) return { ok: false, error: 'Unknown kind of piece.' };
  const seed = Number(raw.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return { ok: false, error: 'Invalid seed.' };
  const trad = typeof raw.tradition === 'string' && TRADITIONS.some((t) => t.id === raw.tradition) ? raw.tradition : 'foundry';
  const info = CATEGORY_INFO[category];
  const it = createDraft(category, trad, cleanText(raw.creator, SHOWCASE_LIMITS.player) || 'A smith', int(raw.createdDay, 1, 100000, 1), cleanText(raw.createdSeason, SHOWCASE_LIMITS.season) || 'Spring', seed);
  it.id = cleanText(raw.id, 40) || it.id;
  it.createdAt = int(raw.createdAt, 0, 8.64e15, Date.now());
  it.name = cleanText(raw.name, SHOWCASE_LIMITS.name) || 'Unnamed Work';
  const custom = cleanText(raw.customName, SHOWCASE_LIMITS.name);
  if (custom) it.customName = custom;

  const d = isObj(raw.design) ? raw.design : {};
  it.design = {
    direction: opt('direction', d.direction, 'elegant'),
    motif: opt('motif', d.motif, 'none'),
    palette: typeof d.palette === 'string' && PALETTES.some((p) => p.id === d.palette) ? d.palette : 'hearth',
    intents: (Array.isArray(d.intents) ? d.intents : []).filter((x: unknown) => typeof x === 'string' && ALL_OPTION_LISTS.intent.some((o) => o.id === x)).slice(0, 2),
  };
  if (category === 'dagger' && d.method === 'damascus') it.design.method = 'damascus';

  const m = isObj(raw.materials) ? raw.materials : {};
  it.materials = { primary: matId(m.primary, 'iron'), secondary: matId(m.secondary, 'brass'), grip: matId(m.grip, 'oak') };
  if (m.fusedWith && hasMat(m.fusedWith)) it.materials.fusedWith = m.fusedWith;
  it.structure = { approach: opt('approach', isObj(raw.structure) ? raw.structure.approach : '', 'balanced') };

  if (it.blade) {
    const b = isObj(raw.blade) ? raw.blade : {};
    Object.assign(it.blade, {
      length: int(b.length, info.lengthRange[0], info.lengthRange[1], it.blade.length),
      width: num(b.width, info.widthRange[0], info.widthRange[1], it.blade.width),
      profile: opt('profile', b.profile, 'straight'),
      tip: opt('tip', b.tip, 'point'),
      curve: num(b.curve, -1, 1, 0),
      thickness: num(b.thickness, 0, 1, 0.5),
      fuller: opt('fuller', b.fuller, 'single'),
      leftDev: nums(b.leftDev, SEGMENTS, -0.6, 0.6),
      rightDev: nums(b.rightDev, SEGMENTS, -0.6, 0.6),
      wobble: nums(b.wobble, SEGMENTS, -2.5, 2.5),
      asymmetry: num(b.asymmetry, 0, 1, 0),
    });
  }
  if (it.hilt && category !== 'shield') {
    const h = isObj(raw.hilt) ? raw.hilt : {};
    Object.assign(it.hilt, {
      guard: opt('guard', h.guard, 'straight'),
      guardWidth: int(h.guardWidth, 5, category === 'dagger' ? 14 : 22, it.hilt.guardWidth),
      gripLength: int(h.gripLength, info.gripRange[0], info.gripRange[1], it.hilt.gripLength),
      gripMaterial: matId(h.gripMaterial, 'oak'),
      wrap: opt('wrap', h.wrap, 'spiral'),
      wrapColor: hex(h.wrapColor, it.hilt.wrapColor),
      pommel: opt('pommel', h.pommel, 'round'),
      guardOffset: int(h.guardOffset, -3, 3, 0),
      guardTilt: int(h.guardTilt, -3, 3, 0),
      pommelOffset: int(h.pommelOffset, -2, 2, 0),
    });
    it.materials.grip = it.hilt.gripMaterial;
  }
  if (it.shield) {
    const s = isObj(raw.shield) ? raw.shield : {};
    Object.assign(it.shield, {
      shape: opt('shieldShape', s.shape, 'round'),
      width: int(s.width, 44, 80, 64),
      height: int(s.height, 50, 96, 64),
      rim: int(s.rim, 1, 4, 3),
      boss: opt('boss', s.boss, 'dome'),
      faceMaterial: matId(s.faceMaterial, 'oak'),
      planks: int(s.planks, 3, 9, 5),
      dents: nums(s.dents, 8, 0, 1),
      rimGap: num(s.rimGap, -3, 3, 0),
    });
    if (isObj(raw.hilt)) it.hilt = { guard: 'straight', guardWidth: 10, gripLength: 16, gripMaterial: 'leather', wrap: 'none', wrapColor: hex(raw.hilt.wrapColor, '#7a4a2a'), pommel: 'round', guardOffset: 0, guardTilt: 0, pommelOffset: 0 };
  }

  const su = isObj(raw.surface) ? raw.surface : {};
  it.surface = {
    texture: opt('texture', su.texture, 'smooth'),
    zones: nums(su.zones, 8, 0, 1, 0.6),
    layers: int(su.layers, 0, 256, 0),
    patternClarity: num(su.patternClarity, 0, 1, 0),
    fusion: num(su.fusion, 0, 1, 0),
  };
  if (su.damascus !== undefined) {
    if (category !== 'dagger' || it.design.method !== 'damascus' || !isObj(su.damascus)) return { ok: false, error: 'Only Damascus daggers carry a pattern.' };
    const dm = su.damascus;
    const dd: DamascusData = {
      index: int(dm.index, 1, PATTERN_COUNT, 1),
      visibility: num(dm.visibility, 0, VISIBILITY_CAP, 0),
      forge: num(dm.forge, 0, 1, 0),
      layers: int(dm.layers, 2, 256, 32),
    };
    if (dm.color !== undefined) {
      if (!rareColor(dm.color)) return { ok: false, error: 'Unknown Damascus colour.' };
      dd.color = dm.color;
    }
    if (dd.index !== dm.index || dd.visibility !== dm.visibility || dd.forge !== dm.forge) return { ok: false, error: 'Damascus record is out of range.' };
    if (!damascusConsistent(seed, it.materials.primary, it.materials.secondary, dd)) return { ok: false, error: 'That Damascus pattern does not match this blade.' };
    it.surface.damascus = dd;
  }

  const de = isObj(raw.decoration) ? raw.decoration : {};
  const en = isObj(de.engraving) ? de.engraving : {};
  it.decoration = {
    engraving: {
      pattern: opt('engraving', en.pattern, 'none'),
      jitter: (Array.isArray(en.jitter) ? en.jitter.slice(0, 400) : []).map((x: unknown) => Math.round(num(x, -1, 1, 0) * 1000) / 1000),
      slips: (Array.isArray(en.slips) ? en.slips.slice(0, 60) : []).map((x: unknown) => int(x, 0, 2000, 0)),
      crispness: num(en.crispness, 0, 1, 0.7),
      inlay: en.inlay === true,
    },
    inscription: cleanText(de.inscription, 16).replace(/[^\w\s'.,!-]/g, ''),
    gems: (Array.isArray(de.gems) ? de.gems.slice(0, 3) : [])
      .filter((g: any) => isObj(g) && GEM_SLOTS.includes(g.slot) && hasMat(g.gem))
      .map((g: any) => ({ slot: g.slot, gem: g.gem })),
    emblem: opt('emblem', de.emblem, 'none'),
    stones: (Array.isArray(de.stones) ? de.stones.slice(0, 8) : [])
      .filter((s: any) => isObj(s) && hasMat(s.stone))
      .map((s: any) => ({ t: num(s.t, 0.02, 0.9, 0.2), u: num(s.u, -0.8, 0.8, 0), stone: s.stone, rot: num(s.rot, -1, 1, 0) })),
  };
  if (isObj(de.constellation)) {
    const pts = Array.isArray(de.constellation.points) ? de.constellation.points.slice(0, 12) : [];
    it.decoration.constellation = {
      points: pts.filter(Array.isArray).map((p: any[]) => [num(p[0], 0.02, 0.95, 0.5), num(p[1], -0.9, 0.9, 0)] as [number, number]),
      brightness: num(de.constellation.brightness, 0, 1, 0.5),
    };
  }

  const f = isObj(raw.finish) ? raw.finish : {};
  it.finish = { finish: opt('finish', f.finish, 'matte') };
  if (f.glowColor !== undefined) it.finish.glowColor = hex(f.glowColor, '#ffd27a');

  const q = isObj(raw.quality) ? raw.quality : {};
  it.quality = {};
  for (const k of QUALITY_KEYS) if (q[k] !== undefined) it.quality[k] = num(q[k], 0, 1, 0.5);
  it.blemishes = (Array.isArray(raw.blemishes) ? raw.blemishes.slice(0, 9) : [])
    .filter((b: any) => isObj(b) && BLEMISH_KINDS.includes(b.kind))
    .map((b: any) => ({ t: num(b.t, 0, 1, 0.5), u: num(b.u, -1, 1, 0), kind: b.kind }));
  it.mutations = (Array.isArray(raw.mutations) ? raw.mutations : []).filter((x: unknown) => typeof x === 'string' && MUTATIONS.includes(x)).slice(0, 4);
  it.history = [];
  refreshDerived(it);
  return { ok: true, item: it };
}

export function sanitizeAuthor(raw: unknown): ShowcaseAuthor {
  const a = isObj(raw) ? raw : {};
  return { player: cleanText(a.player, SHOWCASE_LIMITS.player) || 'A smith', workshop: cleanText(a.workshop, SHOWCASE_LIMITS.workshop) || 'A quiet forge' };
}

/** What the client sends: the piece without its private crafting notes. */
export function toShowcasePayload(item: Item): Record<string, unknown> {
  const { history, favorite, displayed, sold, giftedTo, requestId, showcase, stats, tags, description, ...rest } = item;
  void history; void favorite; void displayed; void sold; void giftedTo; void requestId; void showcase; void stats; void tags; void description;
  return JSON.parse(JSON.stringify(rest));
}
