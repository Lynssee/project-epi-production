// src/lib/utils/p2hDraft.ts
// B5 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): draft P2H tersimpan di
// localStorage per equipment+tanggal, supaya mekanik yang terganggu di tengah pengisian
// (telepon masuk, ganti unit, sinyal putus) tidak kehilangan isian saat kembali. Sengaja
// TIDAK menyimpan tanda tangan (langkah terakhir, nilainya rendah untuk dipulihkan) dan
// TIDAK menyimpan `fotoPreview`/`uploading` mentah (blob: URL mati setelah reload — dipulihkan
// ulang dari file id Directus yang sudah diunggah, bukan dari draft).

export interface P2hDraftAnswer {
	result: 'Go' | 'No-Go' | null;
	notes: string;
	foto?: string | null;
	numeric_value?: number | null;
	text_value?: string | null;
}

export interface P2hDraft {
	answers: Record<string, P2hDraftAnswer>;
	keteranganTambahan: string;
	hoursmeterInput: number | null;
	fotoUnitFileId: string | null;
	savedAt: number;
}

function key(equipmentId: string, date: string) {
	return `p2h_draft_${equipmentId}_${date}`;
}

export function saveP2hDraft(equipmentId: string, date: string, draft: Omit<P2hDraft, 'savedAt'>) {
	try {
		localStorage.setItem(key(equipmentId, date), JSON.stringify({ ...draft, savedAt: Date.now() }));
	} catch {
		// localStorage tidak tersedia (mis. private mode) — draft tidak tersimpan, tidak fatal
	}
}

export function loadP2hDraft(equipmentId: string, date: string): P2hDraft | null {
	try {
		const raw = localStorage.getItem(key(equipmentId, date));
		if (!raw) return null;
		return JSON.parse(raw) as P2hDraft;
	} catch {
		return null;
	}
}

export function clearP2hDraft(equipmentId: string, date: string) {
	try {
		localStorage.removeItem(key(equipmentId, date));
	} catch {
		// abaikan
	}
}
