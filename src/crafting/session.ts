// The crafting session: walks a tradition's stage sequence, records every
// decision and measured performance into the item's history, and finalises it.

import { hash32, seededRng } from '../core/rng';
import { clamp } from '../core/util';
import { mat, materialDifficulty } from '../data/materials';
import { STAGE_INFO, StageId, tradition, TraditionDef } from '../data/traditions';
import { addMaterial, GameState, seasonOf } from '../game/state';
import { createDraft } from '../item/factory';
import { refreshDerived } from '../item/finalize';
import type { Category, Item, StageRecord } from '../item/types';
import { gradeOf, QUIRKS, type MinigameResult } from '../minigames/types';
import { APPLY, generateBlemishes, STAGE_MINIGAME } from './apply';
import { materialNeeds, STAGES, StageCtx, stonesNeeded } from './stages';
import { methodOf, stagesForMethod } from './method';

export class CraftSession {
  item: Item;
  stages: StageId[];
  index = 0;
  materialsPaid = false;
  trad: TraditionDef;

  constructor(public state: GameState, category: Category | null, traditionId: string, resume?: { item: Item; stages: string[]; index: number; materialsPaid: boolean }) {
    if (resume) {
      this.item = resume.item;
      this.stages = resume.stages as StageId[];
      this.index = resume.index;
      this.materialsPaid = resume.materialsPaid;
      this.trad = tradition(this.item.tradition);
    } else {
      this.trad = tradition(traditionId);
      this.item = createDraft(category!, traditionId, state.playerName, state.day, seasonOf(state.day));
      this.stages = [...this.trad.stages];
      // Sensible starting materials the player actually owns.
      const prim = this.trad.primaries.find((m) => (state.materials[m] ?? 0) >= 3) ?? this.trad.primaries[0];
      this.item.materials.primary = prim;
      const sec = ['brass', 'bronze', 'silver', 'iron', 'copper'].find((m) => m !== prim && (state.materials[m] ?? 0) >= 1) ?? 'brass';
      this.item.materials.secondary = sec;
      if (this.item.hilt) {
        const grip = ['oak', 'leather', 'walnut', 'birch'].find((g) => (state.materials[g] ?? 0) >= 1) ?? 'oak';
        this.item.hilt.gripMaterial = grip;
        this.item.materials.grip = grip;
      }
      if (this.trad.id === 'experimental') this.item.design.direction = 'experimental';
      if (this.trad.id === 'mountain') this.item.design.direction = 'rustic';
      if (this.trad.id === 'celestial') this.item.design.motif = 'star';
      if (this.trad.id === 'glassgarden') this.item.design.direction = 'nature';
    }
  }

  get stage(): StageId {
    return this.stages[this.index];
  }
  get ctx(): StageCtx {
    return { item: this.item, state: this.state, tradition: this.trad };
  }
  get stageDef() {
    return STAGES[this.stage];
  }
  get canReorder(): boolean {
    const r = this.trad.reorderable;
    if (!r) return false;
    return this.index < this.stages.findIndex((s) => r.includes(s));
  }

  /** Experimental: reorder the middle stages. */
  reorder(order: StageId[]) {
    const r = this.trad.reorderable ?? [];
    const positions = this.stages.map((s, i) => (r.includes(s) ? i : -1)).filter((i) => i >= 0);
    const valid = order.filter((s) => r.includes(s));
    if (valid.length !== positions.length) return;
    positions.forEach((p, k) => (this.stages[p] = valid[k]));
  }

  validate(): string | null {
    return this.stageDef.validate?.(this.ctx) ?? null;
  }

  minigameFor(): { id: string; params: Record<string, any> } | null {
    return this.stageDef.minigame?.(this.ctx) ?? null;
  }

  difficultyFor(): number {
    const s = this.state.settings.difficulty;
    if (s === 'relaxed') return 0;
    const md = materialDifficulty(this.item.materials.primary);
    let d = (this.trad.tier - 1) * 0.6 + md * 1.6 + 0.4;
    // Rare, demanding materials bring master-level challenges.
    if (mat(this.item.materials.primary).rarity >= 4) d += 0.4;
    if (s === 'challenging') d += 1;
    return clamp(Math.round(d * 10) / 10, 0.2, 4);
  }

  quirkFor(): string | undefined {
    if (!this.trad.quirks) return undefined;
    const keys = Object.keys(QUIRKS);
    const r = seededRng(hash32(this.item.seed, this.index), 'quirk');
    return r.chance(0.75) ? r.pick(keys) : undefined;
  }

  /** Called when the player confirms a decision-only part of a stage (before any minigame). */
  commitDecisions(): string | null {
    const err = this.validate();
    if (err) return err;
    if (this.stage === 'design') {
      const method = methodOf(this.item);
      this.stages = stagesForMethod(this.stages, method, this.trad.stages);
      if (method !== 'damascus') delete this.item.surface.damascus;
      if (method === 'damascus' && this.item.surface.texture === 'layered') this.item.surface.texture = 'smooth';
    }
    if (this.stage === 'materials' && !this.materialsPaid) {
      for (const [id, n] of Object.entries(materialNeeds(this.item))) addMaterial(this.state, id, -n);
      this.materialsPaid = true;
    }
    if (this.stage === 'inlay') {
      const sel = (this.item as any)._inlay;
      if (sel) for (const [id, n] of Object.entries(stonesNeeded(sel))) addMaterial(this.state, id, -n);
    }
    if (this.stage === 'hilt') for (const g of this.item.decoration.gems) addMaterial(this.state, g.gem, -1);
    if (this.stage === 'finish') this.item.blemishes = generateBlemishes(this.item);
    return null;
  }

  /** Apply a measured minigame result and record history. */
  applyResult(r: MinigameResult, difficulty: number) {
    const fn = APPLY[this.stage];
    fn?.(this.item, r);
    this.record({ id: STAGE_MINIGAME[this.stage] ?? this.stage, score: r.score, grade: gradeOf(r.score), difficulty, details: r.details, summary: r.summary });
  }

  record(minigame?: StageRecord['minigame']) {
    const choices: StageRecord['choices'] = {};
    for (const c of this.stageDef.controls(this.ctx)) {
      if (c.kind === 'info') continue;
      const v = c.get() as any;
      choices[c.label] = Array.isArray(v) ? v.map((x: any) => (typeof x === 'string' ? x : `${x.gem}@${x.slot}`)).join(', ') || '—' : v === '' ? '—' : v;
    }
    const notes: string[] = [];
    const q = this.state.settings.difficulty;
    if (minigame && q === 'relaxed') notes.push('Relaxed crafting mode');
    this.item.history.push({ stage: this.stage, name: STAGE_INFO[this.stage].name, choices, minigame, notes, at: Date.now() });
  }

  /** Advance to the next stage; returns true when only appraisal remains. */
  next(): boolean {
    if (this.index < this.stages.length - 1) this.index++;
    this.persist();
    return this.stage === 'appraisal';
  }

  persist() {
    this.state.draft = { item: this.item, stages: this.stages, index: this.index, materialsPaid: this.materialsPaid };
  }

  /** Finalise: compute derived data and return the finished item. */
  finalize(): Item {
    delete (this.item as any)._inlay;
    refreshDerived(this.item, true);
    this.state.draft = null;
    return this.item;
  }

  /** Abandon the piece. Materials are returned — nothing is ever lost to failure. */
  abandon() {
    if (this.materialsPaid) for (const [id, n] of Object.entries(materialNeeds(this.item))) addMaterial(this.state, id, n);
    this.state.draft = null;
  }
}
