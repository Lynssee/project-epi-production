// src/lib/utils/kebutuhanCat.ts
// Kalkulator kebutuhan cat lapangan (Inventory 360° Fase 5). MURNI — tanpa jaringan; semua angka datang dari input pengguna
// (nilai solid volume diambil dari TDS resmi, BUKAN ditebak). Semua pembagian dilindungi terhadap 0/NaN (tanpa crash layar putih).
//
// Rumus baku coating:
//   daya sebar teoritis (m²/L) = solid volume (%) × 10 ÷ DFT (µm)
//   daya sebar praktis         = teoritis × (1 − loss%)
//   liter dibutuhkan           = luas ÷ daya sebar praktis
//   WFT (µm)                   = DFT ÷ (solid volume%/100)   → tebal basah acuan untuk tukang spray

export type LapisInput = { nama?: string; dftUm: number; solidVolumePct: number };
export type KebutuhanInput = {
	luasM2: number;
	lossPct: number;
	lapis: LapisInput[];
	/** Pengencer sebagai % volume dari cat (opsional, mis. 5–15). */
	thinnerPct?: number;
	/** Volume kemasan (liter) untuk hitung jumlah kaleng (opsional). */
	kemasanLiter?: number;
};
export type KebutuhanLapis = {
	nama: string;
	dftUm: number;
	solidVolumePct: number;
	dayaSebarTeoritis: number;
	dayaSebarPraktis: number;
	wftUm: number;
	liter: number;
	kaleng: number | null;
	valid: boolean;
	alasan: string | null;
};
export type KebutuhanHasil = {
	valid: boolean;
	pesan: string | null;
	lapis: KebutuhanLapis[];
	totalLiter: number;
	totalThinnerLiter: number;
	totalKaleng: number | null;
};

const num = (v: unknown): number => {
	const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
	return Number.isFinite(n) ? n : 0;
};
const round = (n: number, d = 2): number => {
	const f = 10 ** d;
	return Math.round((n + Number.EPSILON) * f) / f;
};

export function hitungLapis(luasM2: number, lossPct: number, l: LapisInput, kemasanLiter = 0): KebutuhanLapis {
	const dft = num(l?.dftUm);
	const sv = num(l?.solidVolumePct);
	const loss = Math.min(Math.max(num(lossPct), 0), 90);
	const luas = num(luasM2);
	const nama = String(l?.nama ?? '').trim();
	const base = { nama, dftUm: dft, solidVolumePct: sv, dayaSebarTeoritis: 0, dayaSebarPraktis: 0, wftUm: 0, liter: 0, kaleng: null as number | null };
	if (dft <= 0) return { ...base, valid: false, alasan: 'DFT harus lebih dari 0 µm.' };
	if (sv <= 0 || sv > 100) return { ...base, valid: false, alasan: 'Solid volume harus 1–100 %.' };
	if (luas <= 0) return { ...base, valid: false, alasan: 'Luas area harus lebih dari 0 m².' };
	const teoritis = (sv * 10) / dft;
	const praktis = teoritis * (1 - loss / 100);
	const liter = luas / praktis;
	const kem = num(kemasanLiter);
	return {
		...base,
		dayaSebarTeoritis: round(teoritis),
		dayaSebarPraktis: round(praktis),
		wftUm: round(dft / (sv / 100), 1),
		liter: round(liter),
		kaleng: kem > 0 ? Math.ceil(liter / kem - 1e-9) : null,
		valid: true,
		alasan: null
	};
}

export function hitungKebutuhan(input: KebutuhanInput): KebutuhanHasil {
	const lapisIn = Array.isArray(input?.lapis) ? input.lapis : [];
	if (!lapisIn.length) return { valid: false, pesan: 'Tambahkan minimal satu lapis cat.', lapis: [], totalLiter: 0, totalThinnerLiter: 0, totalKaleng: null };
	const kem = num(input?.kemasanLiter);
	const lapis = lapisIn.map((l) => hitungLapis(input.luasM2, input.lossPct, l, kem));
	const valid = lapis.every((l) => l.valid);
	const totalLiter = round(lapis.reduce((a, l) => a + (l.valid ? l.liter : 0), 0));
	const thinnerPct = Math.min(Math.max(num(input?.thinnerPct), 0), 100);
	return {
		valid,
		pesan: valid ? null : (lapis.find((l) => !l.valid)?.alasan ?? 'Input belum valid.'),
		lapis,
		totalLiter,
		totalThinnerLiter: round((totalLiter * thinnerPct) / 100),
		// Kaleng dihitung dari TOTAL liter (kemasan sisa bisa dipakai lapis berikutnya), bukan jumlah kaleng per lapis.
		totalKaleng: kem > 0 && valid ? Math.ceil(totalLiter / kem - 1e-9) : null
	};
}
