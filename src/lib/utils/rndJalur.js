// @ts-nocheck
// src/lib/utils/rndJalur.js — SALINAN inti erp-epi/src/lib/utils/rndCertification.js (repo terpisah). Ubah keduanya bersamaan.
// Jalur sertifikasi R&D (5 level) — MURNI & client-safe. Level/prasyarat/masa berlaku bisa diubah superadmin di
// /settings/training_lms (app_settings.rnd_cert_levels, JSON); DEFAULT di bawah hanya fallback (tanpa hardcode).
// Pencapaian dihitung dari training_enrollment status 'Lulus' (belum kedaluwarsa) pada program berkode KUR-RND-*.
// Catatan: granularitas enrollment = program (Track), bukan modul — "Modul 4.1+4.3" pada level Onboarding didekati lewat Track 4.
// Level yang butuh asesmen manual (portofolio / 360°) ditandai `manual`: sistem hanya menilai bagian otomatisnya.

export const RND_CERT_SETTING_KEY = 'rnd_cert_levels';

export const DEFAULT_RND_CERT_LEVELS = Object.freeze([
	{ key: 'onboarding', nama: 'R&D Onboarding', programKodes: ['KUR-RND-T4'], requires: [], masaBerlakuBulan: 12, manual: '' },
	{ key: 'foundation', nama: 'R&D Foundation', programKodes: ['KUR-RND-T1', 'KUR-RND-T4'], requires: ['onboarding'], masaBerlakuBulan: 24, manual: '' },
	{ key: 'technical', nama: 'R&D Technical Staff', programKodes: ['KUR-RND-T2'], requires: ['foundation'], masaBerlakuBulan: 24, manual: '' },
	{ key: 'senior', nama: 'R&D Senior / Lead', programKodes: ['KUR-RND-T3'], requires: ['technical'], masaBerlakuBulan: 24, manual: 'Assessment portofolio' },
	{ key: 'manager', nama: 'R&D Manager Ready', programKodes: ['KUR-RND-T5'], requires: ['senior'], masaBerlakuBulan: 36, manual: 'Assessment 360°' }
]);

/** Parse JSON setting; tidak valid / kosong → default. Hanya level berstruktur benar yang diterima. */
export function parseRndCertLevels(raw) {
	let v = raw;
	if (typeof raw === 'string') {
		try { v = JSON.parse(raw); } catch { return DEFAULT_RND_CERT_LEVELS; }
	}
	if (!Array.isArray(v) || !v.length) return DEFAULT_RND_CERT_LEVELS;
	const out = [];
	for (const l of v) {
		if (!l || typeof l.key !== 'string' || !l.key.trim()) return DEFAULT_RND_CERT_LEVELS;
		out.push({
			key: l.key.trim(),
			nama: String(l.nama || l.key),
			programKodes: Array.isArray(l.programKodes) ? l.programKodes.map(String) : [],
			requires: Array.isArray(l.requires) ? l.requires.map(String) : [],
			masaBerlakuBulan: Number(l.masaBerlakuBulan) > 0 ? Number(l.masaBerlakuBulan) : 24,
			manual: String(l.manual || '')
		});
	}
	return out;
}

const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const asDate = (s) => {
	if (!s) return null;
	const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
	return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * @param {{levels?:any[], enrollments?:{program_kode:string,status:string,sertifikat_expired?:string|null}[], today?:Date}} p
 * @returns {{levels:Array<{key:string,nama:string,achieved:boolean,missing:string[],blockedBy:string[],manual:string}>, achievedKeys:string[], current:string|null, next:string|null}}
 */
export function evalRndJalur({ levels = DEFAULT_RND_CERT_LEVELS, enrollments = [], today = new Date() } = {}) {
	const t0 = dayStart(today);
	const lulus = new Set();
	for (const e of enrollments || []) {
		if (e?.status !== 'Lulus' || !e.program_kode) continue;
		const exp = asDate(e.sertifikat_expired);
		if (exp && exp < t0) continue; // sertifikat kedaluwarsa tidak dihitung
		lulus.add(String(e.program_kode));
	}
	const achieved = new Set();
	// Iterasi sampai stabil agar urutan array tidak menentukan hasil (level boleh diurutkan bebas di UI).
	for (let pass = 0; pass <= levels.length; pass++) {
		let changed = false;
		for (const l of levels) {
			if (achieved.has(l.key)) continue;
			if (l.programKodes.every((k) => lulus.has(k)) && (l.requires || []).every((r) => achieved.has(r))) {
				achieved.add(l.key);
				changed = true;
			}
		}
		if (!changed) break;
	}
	const rows = levels.map((l) => ({
		key: l.key,
		nama: l.nama,
		achieved: achieved.has(l.key),
		manual: l.manual || '',
		missing: l.programKodes.filter((k) => !lulus.has(k)),
		blockedBy: (l.requires || []).filter((r) => !achieved.has(r))
	}));
	const ach = rows.filter((r) => r.achieved);
	const next = rows.find((r) => !r.achieved) || null;
	return { levels: rows, achievedKeys: [...achieved], current: ach.length ? ach[ach.length - 1].key : null, next: next?.key ?? null };
}

/**
 * Gate prasyarat daftar program: program Track pada level L hanya boleh diambil bila semua level prasyarat L sudah tercapai.
 * Program yang bukan bagian jalur R&D → not_applicable. Level pertama (tanpa prasyarat) → passed.
 */
export function evalRndEnrollPrasyarat({ programKode, levels = DEFAULT_RND_CERT_LEVELS, achievedKeys = [] }) {
	const owners = levels.filter((l) => l.programKodes.includes(String(programKode)));
	if (!owners.length) return { status: 'not_applicable', reason: 'Program bukan bagian jalur sertifikasi R&D.' };
	const ach = new Set(achievedKeys);
	// Program dipakai beberapa level (mis. Track 4): cukup memenuhi prasyarat level terendah yang memuatnya.
	const need = owners.map((l) => (l.requires || []).filter((r) => !ach.has(r)));
	if (need.some((n) => n.length === 0)) return { status: 'passed' };
	const missing = [...need].sort((a, b) => a.length - b.length)[0];
	const nama = (k) => levels.find((l) => l.key === k)?.nama || k;
	return { status: 'failed', missing, reason: `Prasyarat jalur R&D belum tercapai: ${missing.map(nama).join(', ')}.` };
}
