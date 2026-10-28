// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeTouch.js
// Inventory 360° Fase 7 — pelacak ringan "kartu pengetahuan dibuka" untuk statistik penggunaan per konteks keputusan.
// Modul MURNI (pengirim, timer, dan jam disuntikkan) — byte-identik di erp-epi & project-epi (dijaga tes kontrak).
//
// Hemat API: satu baris per (hari, konteks, barang, sumber) per sesi (duplikat dibuang di klien), dikirim BERKELOMPOK
// (tunda 20 dtk atau 50 baris). Kegagalan kirim dilog dan dicoba lagi pada flush berikutnya (maks. 200 baris tertahan).
// Pelacakan tidak pernah mengganggu pengguna: tidak melempar ke pemanggil.

const CONTEXTS = new Set(['purchase', 'receive', 'usage', 'maintenance', 'sales']);
const MAX_PENDING = 200;

/** Tanggal WIB (UTC+7) format YYYY-MM-DD. */
export function todayWib(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * @param {{ send:(rows:object[])=>Promise<any>, setTimer?:Function, clearTimer?:Function, now?:()=>Date, delayMs?:number, maxBatch?:number }} deps
 */
export function createTouchTracker({ send, setTimer = setTimeout, clearTimer = clearTimeout, now = () => new Date(), delayMs = 20000, maxBatch = 50 }) {
  let buffer = [];
  const seen = new Set();
  let timer = null;
  let sending = false;

  async function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    if (sending || !buffer.length) return;
    sending = true;
    const rows = buffer.splice(0, maxBatch);
    try {
      await send(rows);
    } catch (e) {
      console.error('[inventoryKnowledgeTouch] gagal mengirim statistik (dicoba lagi nanti):', e?.message || e);
      buffer = [...rows, ...buffer].slice(0, MAX_PENDING);
    } finally {
      sending = false;
    }
    if (buffer.length >= maxBatch) await flush();
    else if (buffer.length && !timer) timer = setTimer(flush, delayMs);
  }

  /** @param {{ itemId:number|string, context:string, sumber:string, userEmail?:string|null }} p */
  function track({ itemId, context, sumber, userEmail = null }) {
    const id = Number(itemId);
    if (!Number.isFinite(id) || id <= 0 || !CONTEXTS.has(context)) return;
    const tanggal = todayWib(now());
    const key = `${tanggal}|${context}|${id}|${sumber}`;
    if (seen.has(key)) return;
    seen.add(key);
    buffer.push({ tanggal, konteks: context, item_id: id, sumber, user_email: userEmail || null });
    if (buffer.length >= maxBatch) void flush();
    else if (!timer) timer = setTimer(flush, delayMs);
  }

  return { track, flush, size: () => buffer.length };
}
