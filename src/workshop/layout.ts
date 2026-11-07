// Fixed geometry of the workshop stage (internal 320x180 pixel space).

export const W = 320;
export const H = 180;
/** Bottom of the rafters / top of the back wall. */
export const CEIL = 20;
/** Junction of back wall and floor. */
export const FLOOR_Y = 122;
/** Feet of furniture standing against the back wall. */
export const BASE = 126;

export const WALK_X0 = 8;
export const WALK_X1 = 312;
export const WALK_Y0 = 136;
export const WALK_Y1 = 166;

export type StationId = 'forge' | 'anvil' | 'workbench' | 'storage' | 'finishing' | 'journal' | 'display' | 'door' | 'gallery';

export const STATION_LABELS: Record<StationId, string> = {
  forge: 'Forge — begin a new piece',
  anvil: 'Anvil — begin a new piece',
  workbench: 'Workbench — upgrades & tools',
  storage: 'Storage — materials',
  finishing: 'Finishing bench — your creations',
  journal: 'Journal — designs & discoveries',
  display: 'Display rack — arrange your display',
  door: 'Door — visit the village',
  gallery: 'Gallery — the collection room',
};

export interface Rect { x: number; y: number; w: number; h: number }
export interface StationDef {
  id: StationId;
  /** Hover / click rectangle. */
  hit: Rect;
  /** Where the smith stands to use it. */
  ix: number;
  iy: number;
  /** Where the label floats (centre x, bottom y). */
  lx: number;
  ly: number;
}

export function stationDefs(gallery: boolean, shelves: string): StationDef[] {
  const disp: Rect = shelves === 'cabinet' ? { x: 258, y: 22, w: 48, h: 106 } : shelves === 'rack2' ? { x: 260, y: 28, w: 44, h: 86 } : { x: 260, y: 44, w: 44, h: 64 };
  const list: StationDef[] = [
    { id: 'door', hit: { x: 3, y: 76, w: 31, h: 50 }, ix: 18, iy: 140, lx: 20, ly: 74 },
    { id: 'storage', hit: { x: 33, y: 58, w: 33, h: 70 }, ix: 49, iy: 140, lx: 49, ly: 56 },
    { id: 'forge', hit: { x: 64, y: 56, w: 54, h: 72 }, ix: 91, iy: 142, lx: 91, ly: 54 },
    { id: 'anvil', hit: { x: 118, y: 118, w: 28, h: 30 }, ix: 134, iy: 156, lx: 133, ly: 116 },
    { id: 'finishing', hit: { x: 146, y: 92, w: 46, h: 36 }, ix: 169, iy: 142, lx: 169, ly: 90 },
    { id: 'workbench', hit: { x: 192, y: 64, w: 40, h: 64 }, ix: 211, iy: 142, lx: 211, ly: 62 },
    { id: 'journal', hit: { x: 233, y: 94, w: 27, h: 34 }, ix: 246, iy: 142, lx: 246, ly: 92 },
    { id: 'display', hit: disp, ix: 282, iy: 142, lx: 282, ly: disp.y - 2 },
  ];
  if (gallery) list.push({ id: 'gallery', hit: { x: 304, y: 68, w: 16, h: 58 }, ix: 309, iy: 140, lx: 300, ly: 66 });
  return list;
}

// Window -------------------------------------------------------------------
export interface WinGeo {
  kind: string;
  /** Outer bounds incl. frame. */
  x: number; y: number; w: number; h: number;
  /** Is local pixel (lx,ly) open glass (sky visible)? */
  glass: (lx: number, ly: number) => boolean;
  /** Centre of the glass in scene coords. */
  cx: number; cy: number;
}

export function windowGeo(kind: string): WinGeo {
  switch (kind) {
    case 'large': {
      const x = 142, y = 44, w = 54, h = 36;
      return { kind, x, y, w, h, cx: x + w / 2, cy: y + h / 2, glass: (lx, ly) => lx >= 3 && lx < w - 3 && ly >= 3 && ly < h - 3 };
    }
    case 'round': {
      const x = 152, y = 44, w = 34, h = 34;
      return { kind, x, y, w, h, cx: x + 17, cy: y + 17, glass: (lx, ly) => (lx - 16.5) ** 2 + (ly - 16.5) ** 2 <= 13.2 * 13.2 };
    }
    case 'stained': {
      const x = 154, y = 32, w = 30, h = 48;
      return {
        kind, x, y, w, h, cx: x + 15, cy: y + 26,
        glass: (lx, ly) => {
          if (lx < 3 || lx >= w - 3 || ly >= h - 3) return false;
          if (ly < 15) return (lx - 14.5) ** 2 + (ly - 15) ** 2 <= 11.6 * 11.6;
          return true;
        },
      };
    }
    default: {
      const x = 154, y = 46, w = 30, h = 32;
      return { kind: 'small', x, y, w, h, cx: x + 15, cy: y + 16, glass: (lx, ly) => lx >= 3 && lx < w - 3 && ly >= 3 && ly < h - 3 };
    }
  }
}

// Forge mouth --------------------------------------------------------------
export interface Mouth { x: number; y: number; w: number; h: number; inside: (x: number, y: number) => boolean }

export function forgeMouth(style: string): Mouth {
  const x = 80, y = 101, w = 23, h = 20; // x 80..102, y 101..120
  if (style === 'stone') return { x, y, w, h, inside: (px, py) => px >= 80 && px <= 102 && py >= 104 && py <= 120 };
  if (style === 'dragonmaw')
    return {
      x, y, w, h,
      inside: (px, py) => {
        const cx = 91;
        // rounded maw
        if ((px - cx) ** 2 / (11.5 * 11.5) + (py - 112) ** 2 / (9.5 * 9.5) > 1) return false;
        // fangs from the top and bottom jaws
        const k = Math.abs(((px - 81) % 5) - 2);
        if (py <= 105 && py - 103 < 2 - k && px > 81 && px < 101) return false;
        if (py >= 118 && 120 - py < 2 - k && px > 82 && px < 100) return false;
        return py <= 120;
      },
    };
  // arch (brick, copper hood)
  return { x, y, w, h, inside: (px, py) => py <= 120 && px >= 80 && px <= 102 && (py >= 112 || (px - 91) ** 2 + (py - 112) ** 2 <= 11.4 * 11.4) };
}

/** Anvil sorts against the player by this floor y. */
export const ANVIL_BASE_Y = 147;
