// Sanggahan bertaut bukti (Fase 4): teks awal alasan keberatan yang menyebut indikator + nomor dokumen yang dipermasalahkan,
// supaya HRD langsung tahu objeknya. Tanpa perubahan skema — alasan tetap satu teks di kpi_dispute.alasan.

import type { BedahIndikator } from '$lib/services/ess/kpi';

export function draftSanggahan(ind: Pick<BedahIndikator, 'nama' | 'outliers'>, refsTerpilih: string[]): string {
	const valid = new Set((ind.outliers || []).map((o) => o.ref));
	const refs = [...new Set(refsTerpilih.filter((r) => valid.has(r)))];
	const bukti = refs.length ? ` Dokumen yang dipermasalahkan: ${refs.join(', ')}.` : '';
	return `[Indikator: ${ind.nama}]${bukti} Alasan: `;
}
