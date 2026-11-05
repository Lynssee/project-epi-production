// src/lib/utils/raporKinerjaSayaPdf.ts
// Rapor Kinerja Saya (PDF A4 portrait) dari data "Tren Kinerja Saya". jsPDF dimuat dinamis; unduh langsung (doc.save) —
// tanpa window.open sehingga tidak terkena pop-up blocker.
import type { KinerjaTren } from '$lib/services/ess/kinerjaTren';

export async function unduhRaporKinerjaSaya(data: KinerjaTren, namaKaryawan: string): Promise<{ success: boolean; error?: string; filename?: string }> {
	if (!data?.available || !data.buckets?.length) return { success: false, error: 'Belum ada data tren untuk diunduh' };
	try {
		const { jsPDF } = await import('jspdf');
		const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
		const W = doc.internal.pageSize.getWidth();
		const H = doc.internal.pageSize.getHeight();
		const mx = 40;
		const thr = data.thresholds || { onTarget: 85, warning: 65 };
		const buckets = data.buckets;
		const tone = (v: number | null): [number, number, number] =>
			v == null ? [148, 163, 184] : v >= thr.onTarget ? [16, 149, 93] : v >= thr.warning ? [217, 119, 6] : [225, 29, 72];
		const nama = (namaKaryawan || '-').replace(/[^\x20-\x7E -ÿ]/g, '');

		doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(15, 23, 42);
		doc.text('PT ELTAMA PRIMA INDO', mx, 45);
		doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
		doc.text('SI-TAMA — Rapor Kinerja Saya', mx, 59);
		doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 41, 59);
		doc.text(`RAPOR KINERJA — ${nama.toUpperCase()}`, mx, 80);
		doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
		const avg = data.summary?.avgScore;
		doc.text(`Periode: ${(data.cadence || '').toUpperCase()} ${data.year ?? ''} | Skor rata-rata: ${avg != null ? avg : '-'} | Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`, mx, 94);
		doc.setDrawColor(203, 213, 225); doc.line(mx, 102, W - mx, 102);

		// Tabel manual: kolom label + 1 kolom per periode.
		const labelW = 190;
		const colW = Math.min(52, (W - 2 * mx - labelW) / Math.max(1, buckets.length));
		let y = 120;
		const rowH = 18;
		const header = () => {
			doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
			doc.setFillColor(30, 41, 59); doc.rect(mx, y - 12, labelW + colW * buckets.length, rowH, 'F');
			doc.setTextColor(255, 255, 255);
			doc.text('Indikator', mx + 4, y);
			buckets.forEach((b, i) => doc.text(b.label, mx + labelW + i * colW + colW / 2, y, { align: 'center' }));
			y += rowH;
		};
		const row = (label: string, vals: (number | null)[], bold = false) => {
			if (y > H - 130) { doc.addPage('a4', 'portrait'); y = 50; header(); }
			doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8);
			if (bold) { doc.setFillColor(241, 245, 249); doc.rect(mx, y - 12, labelW + colW * buckets.length, rowH, 'F'); }
			doc.setTextColor(30, 41, 59);
			const lines = doc.splitTextToSize(label, labelW - 8) as string[];
			doc.text(lines[0] + (lines.length > 1 ? '…' : ''), mx + 4, y);
			vals.forEach((v, i) => {
				const c = tone(v);
				doc.setTextColor(c[0], c[1], c[2]);
				doc.text(v != null ? String(v) : '-', mx + labelW + i * colW + colW / 2, y, { align: 'center' });
			});
			y += rowH;
		};
		header();
		row('SKOR TOTAL', buckets.map((b) => data.cells?.[b.key]?.score ?? null), true);
		for (const ind of data.indicators || []) {
			row(`${ind.name}${ind.weight != null ? ` (${ind.weight}%)` : ''}`, buckets.map((b) => ind.cells?.[b.key]?.achievement ?? null));
		}
		y += 8;
		doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
		doc.text(`Hanya skor final yang sudah dirilis. Ambang: On Target >= ${thr.onTarget}, Waspada ${thr.warning}-${thr.onTarget - 1}, Kritis < ${thr.warning}. "-" = belum ada data.`, mx, y);

		const filename = `Rapor_Kinerja_${nama.replace(/[^\w-]+/g, '_')}_${data.cadence}_${data.year ?? ''}.pdf`;
		doc.save(filename);
		return { success: true, filename };
	} catch (e: any) {
		console.error('[raporKinerjaSaya] gagal:', e);
		return { success: false, error: e?.message || 'Gagal membuat PDF' };
	}
}
