// src/lib/services/workshopRegistry.ts
// Pertajam Modul Ciketing & MB — Workshop Sebagai Entitas Utama v2, Fase 0.
// Kembaran erp-epi/src/lib/services/workshopRegistry.js — kontrak sama. Satu sumber
// kebenaran untuk pemetaan slug <-> code <-> id <-> gudang <-> enabled_modules dari
// koleksi Directus `workshops`. Pola disalin dari rndSettings.js (cache in-memory
// ~5 menit, default hardcode fallback, aman dipanggil client maupun server).

import { secureDirectusFetch } from '$lib/services/secureDirectus';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface WorkshopEntry {
  id: number;
  code: string;
  slug: string;
  name: string;
  gudang_id: number | null;
  status: string;
  enabled_modules: string[];
}

// Fallback bila Directus tak terjangkau — mencerminkan skema live per 18 Sep 2026.
const DEFAULT_WORKSHOPS: WorkshopEntry[] = [
  {
    id: 1,
    code: 'WS-CKT',
    slug: 'ciketing',
    name: 'Workshop Ciketing',
    gudang_id: 4,
    status: 'aktif',
    enabled_modules: ['sj_masuk', 'sj_keluar'],
  },
  {
    id: 2,
    code: 'MB-BLR',
    slug: 'balaraja',
    name: 'MB Balaraja',
    gudang_id: 3,
    status: 'aktif',
    enabled_modules: ['sppr', 'qc_scr', 'volume_entry', 'claim'],
  },
];

let cache: WorkshopEntry[] | null = null;
let cachedAt = 0;
let inflight: Promise<WorkshopEntry[]> | null = null;

function slugFromCode(code: string): string {
  const map: Record<string, string> = { 'WS-CKT': 'ciketing', 'MB-BLR': 'balaraja' };
  return map[code] || (code || '').toLowerCase();
}

function normalize(row: any): WorkshopEntry | null {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    slug: slugFromCode(row.code),
    name: row.name,
    gudang_id: row.gudang_id ?? null,
    status: row.status ?? 'aktif',
    enabled_modules: Array.isArray(row?.settings?.enabled_modules) ? row.settings.enabled_modules : [],
  };
}

/**
 * Muat daftar workshop aktif dari Directus. Di-cache 5 menit, gagal-lunak ke default.
 */
export async function listWorkshops(force = false): Promise<WorkshopEntry[]> {
  const now = Date.now();
  if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    let result = DEFAULT_WORKSHOPS;
    try {
      const res = await secureDirectusFetch(
        `/items/workshops?filter[status][_eq]=aktif&fields=id,code,name,gudang_id,status,settings&limit=-1`,
      );
      if (res.ok) {
        const rows = ((await res.json()).data || []) as any[];
        if (rows.length) result = rows.map(normalize).filter((w): w is WorkshopEntry => Boolean(w));
      } else {
        console.warn(`[workshopRegistry] HTTP ${res.status} — pakai default.`);
      }
    } catch (err) {
      console.warn('[workshopRegistry] Directus tak terjangkau — pakai default.', err);
    }
    cache = result;
    cachedAt = Date.now();
    inflight = null;
    return result;
  })();

  return inflight;
}

/**
 * Resolusi satu workshop dari id numerik, code (`WS-CKT`), atau slug (`ciketing`).
 * Mengembalikan `null` + console.warn eksplisit bila tak dikenal (Aturan #1 CLAUDE.md).
 */
export async function resolveWorkshop(any: number | string | null | undefined): Promise<WorkshopEntry | null> {
  if (any == null || any === '') return null;
  const list = await listWorkshops();
  const needle = String(any).toLowerCase();
  const found = list.find(
    (w) => String(w.id) === needle || w.code.toLowerCase() === needle || w.slug.toLowerCase() === needle,
  );
  if (!found) {
    console.warn(`[workshopRegistry] Workshop tidak dikenal: "${any}"`);
    return null;
  }
  return found;
}

/** Cek apakah modul tertentu aktif untuk sebuah workshop (dari `workshops.settings.enabled_modules`). */
export async function isModuleEnabled(
  ws: WorkshopEntry | number | string | null | undefined,
  moduleKey: string,
): Promise<boolean> {
  const resolved = ws && typeof ws === 'object' ? ws : await resolveWorkshop(ws);
  if (!resolved) return false;
  return resolved.enabled_modules.includes(moduleKey);
}

/** Paksa muat ulang dari Directus (mis. setelah admin menambah workshop baru). */
export function reloadWorkshopRegistry(): Promise<WorkshopEntry[]> {
  return listWorkshops(true);
}
