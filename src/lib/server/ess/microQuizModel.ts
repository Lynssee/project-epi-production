// src/lib/server/ess/microQuizModel.ts
// Micro-Quiz Harian lapangan — aturan murni (tanpa fetch) supaya mudah dites. Null-safe (CLAUDE.md #7).
// Pemilihan soal DETERMINISTIK per karyawan+hari (tanpa state): soal sama sepanjang hari, berganti besok.
// Jawaban benar TIDAK PERNAH dikirim ke klien — dinilai di server.

export interface MicroQuizSettings {
	enabled: boolean;
	kategori: string[];
	programIds: number[];
	hindariHari: number;
}

export const MICROQUIZ_MODULE = 'micro_quiz';
export const MICROQUIZ_DEFAULTS: MicroQuizSettings = { enabled: true, kategori: ['HSE & K3'], programIds: [], hindariHari: 30 };

const csv = (v: unknown): string[] =>
	String(v ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

export function resolveMicroQuizSettings(rows: any[] | null | undefined): MicroQuizSettings {
	const out: MicroQuizSettings = { ...MICROQUIZ_DEFAULTS, kategori: [...MICROQUIZ_DEFAULTS.kategori], programIds: [] };
	for (const r of Array.isArray(rows) ? rows : []) {
		const raw = r?.setting_value ?? r?.value;
		switch (r?.setting_key) {
			case 'micro_quiz.enabled':
				out.enabled = !(raw === false || raw === 'false' || raw === 0 || raw === '0');
				break;
			case 'micro_quiz.kategori':
				out.kategori = csv(raw);
				break;
			case 'micro_quiz.program_ids':
				out.programIds = csv(raw).map(Number).filter((n) => Number.isInteger(n) && n > 0);
				break;
			case 'micro_quiz.hindari_ulang_hari': {
				const n = Number(raw);
				if (Number.isFinite(n)) out.hindariHari = Math.min(365, Math.max(0, Math.round(n)));
				break;
			}
		}
	}
	return out;
}

export interface PoolQuestion {
	id: number;
	program_id: number;
	pertanyaan: string;
	tipe: 'pilihan_ganda' | 'benar_salah';
	opsi: string[];
	jawaban_benar: string;
}

export interface ClientQuestion {
	id: number;
	pertanyaan: string;
	tipe: 'pilihan_ganda' | 'benar_salah';
	opsi: string[];
}

/** Soal mentah Directus → PoolQuestion valid; null bila tidak layak (tipe esai, kunci tak ada di opsi, dll). */
export function normalizeQuestion(raw: any, programId: number): PoolQuestion | null {
	if (!raw || raw.id == null) return null;
	const tipe = raw.tipe === 'benar_salah' ? 'benar_salah' : raw.tipe === 'pilihan_ganda' ? 'pilihan_ganda' : null;
	if (!tipe) return null;
	let opsi: unknown = raw.opsi;
	if (typeof opsi === 'string') {
		try {
			opsi = JSON.parse(opsi);
		} catch {
			return null;
		}
	}
	if (!Array.isArray(opsi)) return null;
	const list = opsi.map((o) => String(o ?? '').trim()).filter(Boolean);
	const kunci = String(raw.jawaban_benar ?? '').trim();
	const pertanyaan = String(raw.pertanyaan ?? '').trim();
	if (!pertanyaan || list.length < 2 || !kunci || !list.includes(kunci)) return null;
	return { id: Number(raw.id), program_id: programId, pertanyaan, tipe, opsi: list, jawaban_benar: kunci };
}

/** FNV-1a 32-bit. */
export function hashSeed(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

function mulberry32(a: number) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Pilih 1 soal untuk seed (mis. `${karyawanId}:${tanggal}`). Soal yang belum pernah dijawab (seen) diprioritaskan. */
export function pickQuestion(pool: PoolQuestion[] | null | undefined, seed: string, seen: Set<number> = new Set()): PoolQuestion | null {
	const all = (Array.isArray(pool) ? pool : []).slice().sort((a, b) => a.id - b.id);
	if (all.length === 0) return null;
	const fresh = all.filter((q) => !seen.has(q.id));
	const src = fresh.length > 0 ? fresh : all;
	return src[hashSeed(seed) % src.length];
}

/** Urutan opsi pilihan ganda diacak deterministik per seed (anti-hafal posisi). Benar/Salah tetap. */
export function shuffledOptions(q: PoolQuestion, seed: string): string[] {
	if (q.tipe === 'benar_salah') return ['Benar', 'Salah'];
	const rnd = mulberry32(hashSeed(`${seed}#${q.id}`));
	const a = q.opsi.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function toClientQuestion(q: PoolQuestion, seed: string): ClientQuestion {
	return { id: q.id, pertanyaan: q.pertanyaan, tipe: q.tipe, opsi: shuffledOptions(q, seed) };
}

export function gradeAnswer(q: PoolQuestion | null | undefined, jawaban: unknown): boolean {
	if (!q) return false;
	return String(jawaban ?? '').trim().toLowerCase() === q.jawaban_benar.trim().toLowerCase();
}

/** Tanggal (YYYY-MM-DD) N hari sebelum `today`. */
export function daysBefore(today: string, n: number): string {
	const d = new Date(`${today}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - Math.max(0, n));
	return d.toISOString().slice(0, 10);
}

/**
 * Streak harian: jumlah hari BERUNTUN (kalender) yang dijawab, berakhir hari ini bila sudah dijawab hari ini,
 * atau kemarin bila belum (streak baru putus saat hari ini berlalu tanpa jawaban). Benar/salah sama-sama dihitung — yang dihargai kebiasaan.
 * Dibatasi oleh jendela log yang dimuat (±30 hari).
 */
export function hitungStreak(tanggal: string[], today: string): number {
	const ada = new Set(tanggal.map((t) => String(t).slice(0, 10)));
	let cur = ada.has(today) ? today : daysBefore(today, 1);
	let n = 0;
	while (ada.has(cur)) {
		n++;
		cur = daysBefore(cur, 1);
	}
	return n;
}
