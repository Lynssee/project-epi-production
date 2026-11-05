// src/routes/(app)/serverProfile.ts
// Logika murni untuk tampilan "Server" di tab Fetch Halaman -- mengubah satu baris log lambat (dari
// GET /api/health/pulse?profile=1 server lapangan) menjadi rekomendasi perbaikan yang bisa disalin.
// Kembar src/routes/settings/system-health/fetchBottleneck.js di erp-epi.
// Tidak menyentuh jaringan/DOM supaya mudah dites.

/** Ringkas baris log lambat -> { severity, flags[], steps[] } */
export function adviseSlowEntry(e: any, { slowMs = 500, bigKb = 500 }: { slowMs?: number; bigKb?: number } = {}) {
  const steps: string[] = [];
  const flags: string[] = [];
  const kb = Math.round((Number(e?.bytes) || 0) / 1024);
  const isRead = (e?.method || 'GET') === 'GET';

  if (e?.unboundedLimit) {
    flags.push('limit=-1');
    steps.push('Ganti limit=-1 dengan paginasi (limit + page) atau ambil agregat saja (aggregate[count]) bila hanya butuh jumlah.');
  }
  if (e?.wildcardFields) {
    flags.push('fields=*');
    steps.push('Sebutkan kolom yang dipakai saja (fields=id,nama,...) alih-alih fields=* / relasi.*.');
  }
  if (kb >= bigKb) {
    flags.push(`${kb} KB`);
    steps.push(`Respons besar (${kb} KB): kurangi kolom, tambahkan filter, atau muat bertahap saat dibutuhkan.`);
  }
  if (Number(e?.status) >= 400) {
    flags.push(`status ${e.status}`);
    steps.push(e.status === 403
      ? 'Di arsitektur ini 403 dari Directus = kesalahan pengambilan data (nama kolom/relasi salah atau query bersarang), bukan izin. Jalankan scripts/audit-field-contract.mjs lalu pisahkan fetch per relasi.'
      : 'Periksa pesan error di log server (proxy_errors.log) untuk request ini.');
  }
  if (!isRead) {
    steps.push('Penulisan lambat: periksa guard/hook di proxy (write-guard, gate) dan jumlah record per request; pertimbangkan kirim bertahap.');
  } else if (!steps.length) {
    steps.push('Tidak ada pola overfetch. Tambahkan filter yang lebih sempit, pastikan kolom filter/sort ter-index di Directus, atau cache di sisi pemanggil bila datanya jarang berubah.');
  }
  if (isRead && Number(e?.durMs) >= slowMs * 3) {
    steps.push('Sangat lambat (≥ 3× ambang): jalankan ulang untuk memastikan bukan lonjakan sesaat; bila konsisten, prioritaskan perbaikan ini.');
  }

  const ratio = (Number(e?.durMs) || 0) / Math.max(1, slowMs);
  const severity: 'bad' | 'warn' | 'info' = ratio >= 3 || Number(e?.status) >= 500 ? 'bad' : ratio >= 1.5 || flags.length ? 'warn' : 'info';
  return { severity, flags, steps };
}

/** Teks siap salin untuk developer (tanpa nilai filter -- hanya nama parameter). */
export function slowEntryToText(e: any, opts?: { slowMs?: number; bigKb?: number }) {
  const a = adviseSlowEntry(e, opts);
  const q = [e?.limit != null ? `limit=${e.limit}` : null, e?.fields ? `fields=${String(e.fields).slice(0, 60)}` : null, ...(e?.params || []).map((p: string) => `${p}=…`)]
    .filter(Boolean)
    .join('&');
  return [
    `[SLOW FETCH] ${e?.method || 'GET'} ${e?.path || e?.collection || '?'}${q ? `?${q}` : ''}`,
    `Halaman: ${e?.route || '-'} | ${e?.durMs ?? '?'} ms | ${e?.cache || '-'} | status ${e?.status ?? '-'} | ${Math.round((Number(e?.bytes) || 0) / 1024)} KB`,
    `Rekomendasi:`,
    ...a.steps.map((s, i) => `${i + 1}. ${s}`)
  ].join('\n');
}

/** Urutkan baris tabel (koleksi/halaman) menurut kunci; null diperlakukan sebagai 0. */
export function sortRows<T extends Record<string, any>>(rows: T[] | null | undefined, key = 'totalMs'): T[] {
  return [...(rows || [])].sort((a, b) => (Number(b?.[key]) || 0) - (Number(a?.[key]) || 0));
}

/** Warna sel latensi menurut ambang (ms). */
export function latencyTone(ms: number | null | undefined, slowMs = 500): string {
  const v = ms == null ? NaN : Number(ms); // Number(null) = 0 -- null berarti "tidak ada data", bukan cepat
  if (!Number.isFinite(v)) return 'text-slate-400';
  if (v >= slowMs * 2) return 'text-rose-600 font-bold';
  if (v >= slowMs) return 'text-amber-600 font-bold';
  return 'text-slate-700 dark:text-slate-200';
}
