// src/lib/server/ess/kpiBedah.ts
// "Bedah Nilai Saya" (rencana penajaman indikator KPI, Fase 4): rincian per indikator dari scorecard Finalized milik sendiri —
// mengapa nilainya X, apakah kolektif/individu, sampel dokumen yang menurunkan skor, dan langkah perbaikan.
// Murni (tanpa I/O): data berasal dari targets + sumber_perhitungan yang SUDAH dibaca listKpiKaryawan (tanpa query baru).
// Field `atribusi`/`outliers` ditulis kalkulator erp-epi (kpiEngine.js); scorecard lama tanpa field itu tetap aman (default kosong).

import { pilarOf } from './kpiPilar';
import type { BedahIndikator, BedahOutlier } from '$lib/services/ess/kpi';

const MAX_OUTLIER = 10;
const MAX_CATATAN = 700;

const asArr = (v: unknown): any[] => {
	if (Array.isArray(v)) return v;
	if (typeof v === 'string') { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } }
	return [];
};
const fin = (v: unknown): number | null => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('id-ID');

/** Langkah perbaikan singkat berbasis data nyata (tanpa angka karangan / janji skor). */
export function buatTip(i: Pick<BedahIndikator, 'terukur' | 'skor' | 'atribusi' | 'outliers' | 'outliers_total' | 'nilai' | 'target' | 'unit' | 'arah'>): string | null {
	if (!i.terukur) return 'Belum terukur — tidak dihitung 0. Pastikan aktivitas terkait tercatat di sistem agar ikut dinilai pada perhitungan berikutnya.';
	if (i.skor != null && i.skor >= 100) return null;
	const total = i.outliers_total ?? i.outliers.length;
	if (i.atribusi === 'departemen') {
		return 'Skor ini capaian kolektif departemen, bukan hanya Anda. Koordinasikan dengan atasan/tim' +
			(total > 0 ? `; ada ${total} dokumen yang menurunkan skor — selesaikan yang menjadi bagian Anda.` : '.');
	}
	if (i.outliers.length) {
		const refs = i.outliers.slice(0, 3).map((o) => o.ref).filter(Boolean).join(', ');
		return `Tindak lanjuti ${total} item yang menurunkan skor${refs ? `, mulai dari: ${refs}` : ''}.`;
	}
	if (i.nilai != null && i.target != null) {
		const gap = i.arah === 'rendah' ? i.nilai - i.target : i.target - i.nilai;
		const u = i.unit ? ` ${i.unit}` : '';
		if (gap > 0) return `Realisasi ${fmt(i.nilai)}${u} dari target ${i.arah === 'rendah' ? '≤' : '≥'} ${fmt(i.target)}${u} — selisih ${fmt(gap)}${u}.`;
	}
	return null;
}

export function bedahIndikator(
	rec: { targets?: unknown; sumber_perhitungan?: unknown },
	overrideMap?: Record<string, unknown> | null
): BedahIndikator[] {
	const targets = asArr(rec.targets);
	const sumber = asArr(rec.sumber_perhitungan);
	const byName = new Map(sumber.filter((s) => s?.indikator).map((s) => [s.indikator, s]));
	return targets.map((t, idx) => {
		const s = (sumber[idx]?.indikator === t?.name ? sumber[idx] : byName.get(t?.name)) || {};
		const terukur = Boolean(s.terukur ?? t?.terukur);
		const outliers: BedahOutlier[] = asArr(s.outliers).slice(0, MAX_OUTLIER).map((o) => ({
			ref: o?.ref != null ? String(o.ref).slice(0, 80) : '',
			detail: o?.detail != null ? String(o.detail).slice(0, 160) : '',
			nilai: fin(o?.nilai),
			satuan: o?.satuan ? String(o.satuan).slice(0, 16) : ''
		}));
		const item: BedahIndikator = {
			nama: String(t?.name ?? `Indikator ${idx + 1}`),
			pilar: pilarOf({ data_source: s.data_source, name: t?.name }, overrideMap),
			bobot: fin(t?.weight) ?? 0,
			target: fin(t?.target),
			nilai: terukur ? fin(t?.achievement) : null,
			unit: String(t?.unit || (t?.metricType === 'percentage' ? '%' : '')),
			skor: terukur ? fin(s.skor) : null,
			arah: t?.arah === 'rendah' ? 'rendah' : 'tinggi',
			terukur,
			otomatis: Boolean(s.otomatis),
			catatan: s.catatan ? String(s.catatan).slice(0, MAX_CATATAN) : '',
			atribusi: s.atribusi === 'departemen' || s.atribusi === 'individu' ? s.atribusi : null,
			outliers,
			outliers_total: fin(s.outliers_total),
			tip: null
		};
		item.tip = buatTip(item);
		return item;
	});
}
