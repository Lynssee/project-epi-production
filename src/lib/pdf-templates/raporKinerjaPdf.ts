// src/lib/pdf-templates/raporKinerjaPdf.ts
// Rapor Kinerja PRIBADI (karyawan sendiri) → HTML untuk Gotenberg. Penyatuan Engine Cetak, Fase 4.
// SUMBER = scorecard Finalized milik karyawan itu (listKpiKaryawan di server; kebijakan visibilitas & redaksi AI-sebelum-rilis sudah
// diterapkan di sana) — rapor TIDAK memakai angka kiriman klien. Tidak ada data gaji/komersial. Nilai tidak terukur = "belum terukur"
// (bukan 0); AI hanya bila sudah dirilis (ai_* kosong ⇒ bagian dihilangkan).
import type { KpiRecord } from '$lib/server/ess/kpi';

const COMPANY_NAME = 'PT Eltama Prima Indo';

export function escHtml(v: unknown): string {
	return String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const arr = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
export const fmt = (v: unknown, digits = 1): string => {
	if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—';
	return Number(v).toLocaleString('id-ID', { maximumFractionDigits: digits });
};
export const statusSkor = (v: unknown): string => {
	if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return 'Belum terukur';
	const n = Number(v);
	return n >= 85 ? 'On Target' : n >= 65 ? 'Waspada' : 'Kritis';
};

export interface RaporKinerjaInput {
	karyawan: { nama: string; posisi?: string | null; divisi?: string | null };
	rec: KpiRecord;
	/** Riwayat singkat periode lain (skor total) — opsional, dari data yang sama. */
	riwayat?: { periode: string; tahun: number | null; total_skor: number | null }[];
	now?: Date;
}

/** Pilih scorecard: id eksplisit (harus milik karyawan — daftar sudah terfilter server) atau yang terbaru. null bila tidak ada. */
export function pilihScorecard(list: KpiRecord[], id?: string | null): KpiRecord | null {
	const l = arr(list);
	if (id) return l.find((k) => k.id === id) ?? null;
	return l[0] ?? null;
}

function kategoriBlock(judul: string, skor: number | null | undefined, bobotPct: number | null | undefined, d: KpiRecord['detail_general']): string {
	const rows = arr(d?.breakdown)
		.map((b) => `<tr><td>${escHtml(b.nama)}</td><td>${escHtml(b.kategori)}</td><td class="c">${fmt(b.bobot, 1)}</td><td class="c">${b.terukur ? fmt(b.skor, 1) : 'belum terukur'}</td><td>${escHtml(b.catatan) || '—'}</td></tr>`)
		.join('');
	return `<h3>${escHtml(judul)} — skor ${fmt(skor)} (${statusSkor(skor)}) · bobot ${fmt(bobotPct, 0)}%</h3>
${d ? `<p class="mute">Cakupan terukur ${fmt(d.cakupanPct, 0)}% (bobot terukur ${fmt(d.bobotTerukur, 1)} dari ${fmt(d.bobotTotal, 1)}).</p>` : ''}
${rows ? `<table><thead><tr><th>Komponen</th><th>Kategori</th><th>Bobot</th><th>Skor</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="mute">Rincian komponen belum tersedia untuk periode ini.</p>'}`;
}

export function buildRaporKinerjaHtml(input: RaporKinerjaInput): string {
	const { karyawan, rec, riwayat = [] } = input;
	const now = (input.now ?? new Date()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
	const targets = arr(rec.targets);
	const targetRows = targets
		.map((t) => `<tr><td>${escHtml(t.name)}</td><td class="c">${fmt(t.weight, 1)}</td><td class="c">${fmt(t.target, 2)}</td><td class="c">${fmt(t.achievement, 2)}</td><td>${escHtml(t.unit)}</td></tr>`)
		.join('');
	const aiActions = arr(rec.ai_action_items);

	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<style>
	* { box-sizing: border-box; }
	body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 24px; font-size: 11px; }
	.kop { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; }
	.kop .company { font-size: 14px; font-weight: 800; }
	.kop .title { font-size: 12px; font-weight: 700; color: #1e3a8a; margin-top: 4px; }
	.id { margin: 8px 0; display: flex; flex-wrap: wrap; gap: 4px 20px; font-size: 10.5px; }
	.score { display: flex; gap: 10px; margin: 8px 0; }
	.card { flex: 1; border: 1px solid #94a3b8; border-radius: 6px; padding: 6px 8px; text-align: center; }
	.card b { display: block; font-size: 20px; }
	.card span { font-size: 8.5px; text-transform: uppercase; color: #64748b; }
	h2 { font-size: 11.5px; margin: 14px 0 4px; color: #1e3a8a; text-transform: uppercase; }
	h3 { font-size: 10.5px; margin: 10px 0 2px; }
	table { width: 100%; border-collapse: collapse; margin-top: 4px; }
	th, td { border: 1px solid #94a3b8; padding: 3px 5px; text-align: left; vertical-align: top; }
	th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; }
	tr { break-inside: avoid; }
	.c { text-align: center; }
	.mute { color: #64748b; font-size: 9.5px; font-style: italic; }
	.ai { border: 1px solid #c7d2fe; background: #eef2ff; padding: 5px 8px; margin-top: 4px; }
	.foot { margin-top: 14px; font-size: 8px; color: #64748b; display: flex; justify-content: space-between; }
	.wm { position: fixed; top: 44%; left: 0; right: 0; text-align: center; font-size: 36px; font-weight: 800; color: rgba(148,163,184,.25); transform: rotate(-24deg); pointer-events: none; }
</style>
</head>
<body>
<div class="wm">PRIBADI — RAHASIA</div>
<div class="kop"><div class="company">${escHtml(COMPANY_NAME)}</div><div class="title">RAPOR KINERJA PRIBADI</div></div>
<div class="id">
	<span><b>Nama:</b> ${escHtml(karyawan.nama)}</span>
	<span><b>Jabatan:</b> ${escHtml(karyawan.posisi) || '—'}</span>
	<span><b>Divisi:</b> ${escHtml(karyawan.divisi) || '—'}</span>
	<span><b>Periode:</b> ${escHtml(rec.periode)}${rec.tahun ? ` ${rec.tahun}` : ''}</span>
	<span><b>Status:</b> ${escHtml(rec.status)}</span>
</div>
<div class="score">
	<div class="card"><b>${fmt(rec.total_skor, 1)}</b><span>Skor Total · ${statusSkor(rec.total_skor)}</span></div>
	<div class="card"><b>${fmt(rec.skor_general, 1)}</b><span>General (disiplin &amp; kepatuhan)</span></div>
	<div class="card"><b>${fmt(rec.skor_spesifik, 1)}</b><span>Spesifik jabatan</span></div>
	<div class="card"><b>${fmt(rec.skor_pelatihan, 1)}</b><span>Skor pelatihan</span></div>
</div>
${rec.peringkat_departemen && rec.total_di_departemen ? `<p class="mute">Peringkat anonim di departemen: ${rec.peringkat_departemen} dari ${rec.total_di_departemen} (nama karyawan lain tidak ditampilkan).</p>` : ''}

<h2>General vs Spesifik</h2>
${kategoriBlock('KPI General', rec.skor_general, rec.bobot_general_pct, rec.detail_general)}
${kategoriBlock('KPI Spesifik Jabatan', rec.skor_spesifik, rec.bobot_spesifik_pct, rec.detail_spesifik)}

<h2>Target &amp; Capaian Indikator</h2>
${targetRows ? `<table><thead><tr><th>Indikator</th><th>Bobot</th><th>Target</th><th>Capaian</th><th>Satuan</th></tr></thead><tbody>${targetRows}</tbody></table>` : '<p class="mute">Tidak ada indikator target tercatat pada scorecard ini.</p>'}

${rec.catatan ? `<h2>Catatan Penilai</h2><p>${escHtml(rec.catatan)}</p>` : ''}
${rec.ai_recommendation || aiActions.length ? `<h2>Rekomendasi Pengembangan (AI)</h2><div class="ai">${rec.ai_recommendation ? `<p>${escHtml(rec.ai_recommendation)}</p>` : ''}${aiActions.map((a) => `<div>• ${escHtml(a.aksi)} <i>(${escHtml(a.prioritas)}${a.deadline_minggu ? `, ${a.deadline_minggu} minggu` : ''})</i></div>`).join('')}<p class="mute">Dihasilkan otomatis; bukan keputusan penilaian.</p></div>` : ''}
${riwayat.length ? `<h2>Riwayat Skor Total</h2><table><thead><tr><th>Periode</th><th>Skor Total</th><th>Status</th></tr></thead><tbody>${riwayat.map((r) => `<tr><td>${escHtml(r.periode)}${r.tahun ? ` ${r.tahun}` : ''}</td><td class="c">${fmt(r.total_skor, 1)}</td><td>${statusSkor(r.total_skor)}</td></tr>`).join('')}</tbody></table>` : ''}

<div class="foot"><span>Dicetak ${escHtml(now)} oleh ${escHtml(karyawan.nama)}</span><span>${escHtml(COMPANY_NAME)} · Hanya scorecard Finalized · data pribadi</span></div>
</body>
</html>`;
}
