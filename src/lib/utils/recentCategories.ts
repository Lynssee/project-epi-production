// R5 (Gate Kategori Cocok) — kategori yang paling sering/terakhir dipakai pengaju, supaya salah klik di picker berkurang.
// Fungsi MURNI. `rows` urut terbaru -> terlama ([{kategori_belanja}]); skor = jumlah pemakaian dengan bobot menurun menurut umur.

export function topRecentCategories(rows: Array<{ kategori_belanja?: string | null }> | null | undefined, max = 4): string[] {
  const score = new Map<string, number>();
  (rows || []).forEach((r, i) => {
    const k = r?.kategori_belanja;
    if (!k) return;
    score.set(k, (score.get(k) || 0) + 1 / (1 + i / 10));
  });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, max)).map(([k]) => k);
}
