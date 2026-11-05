import { describe, it, expect } from 'vitest';
import { buildRaporKinerjaHtml, pilihScorecard, fmt, statusSkor } from './raporKinerjaPdf';
import type { KpiRecord } from '$lib/server/ess/kpi';

const rec = (over: Partial<KpiRecord> = {}): KpiRecord =>
	({
		id: 'sc1', tipe: 'Karyawan', periode: 'Oktober', tahun: 2026, status: 'Finalized', targets: [], total_skor: 82.5, skor_pelatihan: null, catatan: null, kpi_period_id: null,
		skor_general: 90, skor_spesifik: 75, bobot_general_pct: 40, bobot_spesifik_pct: 60,
		detail_general: { skor: 90, bobotTerukur: 40, bobotTotal: 40, cakupanPct: 100, breakdown: [{ nama: 'Presensi', kategori: 'Disiplin', bobot: 20, skor: 95, terukur: true, catatan: 'Baik' }] },
		detail_spesifik: { skor: 75, bobotTerukur: 30, bobotTotal: 60, cakupanPct: 50, breakdown: [{ nama: 'Output <A>', kategori: 'Kerja', bobot: 30, skor: null, terukur: false }] },
		...over
	}) as KpiRecord;

describe('helpers', () => {
	it('fmt: null/NaN → "—", bukan 0', () => {
		expect(fmt(null)).toBe('—');
		expect(fmt('x')).toBe('—');
		expect(fmt(0)).toBe('0');
		expect(fmt(82.55)).toBe('82,6');
	});
	it('statusSkor: ambang & belum terukur', () => {
		expect(statusSkor(null)).toBe('Belum terukur');
		expect(statusSkor(90)).toBe('On Target');
		expect(statusSkor(70)).toBe('Waspada');
		expect(statusSkor(10)).toBe('Kritis');
	});
	it('pilihScorecard: id harus ada di daftar milik sendiri; tanpa id = terbaru; kosong → null', () => {
		const l = [rec({ id: 'a' }), rec({ id: 'b' })];
		expect(pilihScorecard(l)?.id).toBe('a');
		expect(pilihScorecard(l, 'b')?.id).toBe('b');
		expect(pilihScorecard(l, 'orang-lain')).toBeNull();
		expect(pilihScorecard([])).toBeNull();
	});
});

describe('buildRaporKinerjaHtml', () => {
	const input = { karyawan: { nama: 'Siti <Z>', posisi: 'Mekanik', divisi: null }, rec: rec() };
	it('skor nyata, General vs Spesifik, komponen belum terukur ditulis begitu (bukan 0), escape', () => {
		const html = buildRaporKinerjaHtml(input);
		expect(html).toContain('Siti &lt;Z&gt;');
		expect(html).toContain('<b>82,5</b>');
		expect(html).toContain('KPI General — skor 90 (On Target) · bobot 40%');
		expect(html).toContain('KPI Spesifik Jabatan — skor 75 (Waspada) · bobot 60%');
		expect(html).toContain('Cakupan terukur 50%');
		expect(html).toContain('belum terukur');
		expect(html).toContain('Output &lt;A&gt;');
		expect(html).toContain('PRIBADI — RAHASIA');
		expect(html).toContain('<b>—</b><span>Skor pelatihan');
	});
	it('AI hanya bila ada (sudah dirilis); tanpa AI → bagian tidak ada', () => {
		expect(buildRaporKinerjaHtml(input)).not.toContain('Rekomendasi Pengembangan');
		const withAi = buildRaporKinerjaHtml({ ...input, rec: rec({ ai_recommendation: 'Tingkatkan X', ai_action_items: [{ aksi: 'Ikut pelatihan', prioritas: 'high', deadline_minggu: 2 }] }) });
		expect(withAi).toContain('Tingkatkan X');
		expect(withAi).toContain('Ikut pelatihan');
		expect(withAi).toContain('bukan keputusan penilaian');
	});
	it('tanpa rincian/target → catatan jujur; peringkat anonim tanpa nama; tanpa gaji/komersial', () => {
		const html = buildRaporKinerjaHtml({ ...input, rec: rec({ detail_general: null, detail_spesifik: null, peringkat_departemen: 2, total_di_departemen: 9 }) });
		expect(html).toContain('Rincian komponen belum tersedia');
		expect(html).toContain('Tidak ada indikator target tercatat');
		expect(html).toContain('Peringkat anonim di departemen: 2 dari 9');
		expect(html).not.toMatch(/gaji|upah|salary|Rp\s?\d/i);
	});
	it('riwayat dari data yang sama', () => {
		const html = buildRaporKinerjaHtml({ ...input, riwayat: [{ periode: 'September', tahun: 2026, total_skor: 70 }, { periode: 'Agustus', tahun: 2026, total_skor: null }] });
		expect(html).toContain('Riwayat Skor Total');
		expect(html).toContain('September 2026');
		expect(html).toContain('Belum terukur');
	});
});
