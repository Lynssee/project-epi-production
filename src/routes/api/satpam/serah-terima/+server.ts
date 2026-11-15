import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { evaluateSecurityHandoverGate } from '$lib/server/gates/securityHandoverGate';
import { writeGateAudit } from '$lib/server/gates/gateAudit';
import { evaluateKeyHandoverGate, type KeyOutstanding } from '$lib/server/gates/securityKeyGate';
import { fetchOperationalKeys } from '$lib/server/keyService';

const SHIFTS = ['pagi', 'siang', 'malam'] as const;

/**
 * Serah-terima shift satpam (G_SEC7). Dulu klien menulis langsung ke security_shift_handover lewat
 * SDK — pengirim (satpam_keluar_id) bisa dipalsukan dan tidak ada titik untuk gate. Sekarang server
 * yang menulis: pengirim = karyawan yang login, penerima divalidasi, gate dievaluasi.
 * shadow = hanya dicatat ke gate_audit_log; soft = 422 sampai `gate_sec7_reason` diisi; hard = 400.
 * Gagal membaca data pendukung gate = fail-open (tidak memblokir serah-terima).
 */
export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Data serah-terima tidak valid.');

	const shift = String((body as any).shift || '');
	if (!SHIFTS.includes(shift as (typeof SHIFTS)[number])) throw error(400, 'Shift tidak valid.');

	const tanggalRaw = String((body as any).tanggal || '').trim();
	const tanggal = tanggalRaw || todayJakarta();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw error(400, 'Tanggal serah-terima tidak valid.');

	const masukId = Number((body as any).satpam_masuk_id);
	if (!Number.isInteger(masukId) || masukId <= 0) throw error(400, 'Pilih satpam yang masuk-shift.');
	if (masukId === Number(karyawan.id)) throw error(400, 'Satpam masuk-shift tidak boleh sama dengan yang menyerahkan.');

	const catatan = String((body as any).catatan ?? '').trim();
	const gateReason = String((body as any).gate_sec7_reason ?? '').trim() || null;

	const masukRes = await directusServerJson<{ data: any[] }>(
		`/items/karyawan?${new URLSearchParams({ 'filter[id][_eq]': String(masukId), fields: 'id,status', limit: '1' }).toString()}`
	);
	const masuk = masukRes?.data?.[0];
	if (!masuk) throw error(404, 'Satpam masuk-shift tidak ditemukan.');

	// --- G_SEC7 ---
	let audit: { decision: 'shadow' | 'warn'; reason: string | null; summary: string; violations: unknown } | null = null;
	try {
		const [mode, ps] = await Promise.all([
			resolveGateMode('G_SEC7', 'security_lifecycle'),
			getPatrolControlSettings()
		]);

		let rondaSelesaiCount: number | null = null;
		if (ps.secHandoverWajibRonda) {
			try {
				const next = new Date(`${tanggal}T00:00:00Z`);
				next.setUTCDate(next.getUTCDate() + 1);
				const res = await directusServerJson<{ data: any[] }>(
					`/items/security_patrol_log?${new URLSearchParams({
						'filter[satpam_id][_eq]': String(karyawan.id),
						'filter[status][_eq]': 'done',
						'filter[mulai][_gte]': `${tanggal}T00:00:00`,
						'filter[mulai][_lt]': `${next.toISOString().slice(0, 10)}T00:00:00`,
						fields: 'id',
						limit: '1'
					}).toString()}`
				);
				rondaSelesaiCount = res?.data?.length ?? 0;
			} catch (err) {
				console.error('[serah-terima] gagal membaca ronda untuk G_SEC7, aturan ronda dilewati:', err);
			}
		}

		const verdict = evaluateSecurityHandoverGate({
			catatan,
			rondaSelesaiCount,
			options: { minCatatanChars: ps.secHandoverMinCatatan, wajibRondaTercatat: ps.secHandoverWajibRonda }
		});

		if (!verdict.passed) {
			const snapshot = { shift, tanggal, satpam_masuk_id: masukId, mode, violations: verdict.violations };
			if (mode === 'hard') {
				await writeGateAudit({ gate: 'G_SEC7', collection: 'security_shift_handover', recordId: null, decision: 'block', reason: verdict.summary, snapshot, email: user.email ?? null });
				throw error(400, `Serah-terima belum lengkap: ${verdict.summary}.`);
			}
			if (mode === 'soft' && !gateReason) {
				throw error(422, `Serah-terima belum lengkap: ${verdict.summary}. Isi alasan untuk tetap menyerahkan, atau lengkapi dulu.`);
			}
			audit = {
				decision: mode === 'soft' ? 'warn' : 'shadow',
				reason: mode === 'soft' ? gateReason : verdict.summary,
				summary: verdict.summary,
				violations: verdict.violations
			};
		}
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[serah-terima] evaluasi G_SEC7 gagal, dilewati (fail-open):', err);
	}

	// --- G_SEC8 (rekonsiliasi kunci): kunci masih berstatus dipinjam saat shift diserahkan ---
	// Terpisah dari G_SEC7 agar mode & alasan bisa diatur sendiri-sendiri oleh superadmin.
	const gateReasonKey = String((body as any).gate_sec8_reason ?? '').trim();
	// Checklist per slot: id kunci yang dicentang satpam sebagai "ada di slot" (boleh tidak dikirim oleh klien lama).
	const dicekRaw = (body as any).kunci_dicek_ids;
	const dicekIds: number[] | null = Array.isArray(dicekRaw) ? dicekRaw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : null;
	let auditKey: { decision: 'shadow' | 'warn'; reason: string | null; summary: string; violations: unknown } | null = null;
	let bukti: { dicek: number; di_slot: number; total: number } | null = null;
	try {
		const ps = await getPatrolControlSettings();
		if (ps.secKeyWajibRekonSerahTerima) {
			const mode = await resolveGateMode('G_SEC8', 'security_lifecycle');
			let outstanding: KeyOutstanding[] | null = null;
			let belumDicek: KeyOutstanding[] | null = null;
			try {
				const ops = await fetchOperationalKeys();
				outstanding = ops.filter((k) => k.status !== 'tersedia').map((k) => ({ kode: k.kode, nama: k.nama, status: k.status }));
				const diSlot = ops.filter((k) => k.status === 'tersedia');
				if (dicekIds) {
					const dicek = new Set(dicekIds);
					bukti = { dicek: diSlot.filter((k) => dicek.has(k.id)).length, di_slot: diSlot.length, total: ops.length };
					// Aturan "wajib cek fisik" default MATI (Aturan #3): hanya dievaluasi bila superadmin menyalakannya
					// dan klien memang mengirim checklist (klien lama tanpa checklist tidak dikunci mendadak).
					if (ps.secKeyWajibCekFisik) {
						belumDicek = diSlot.filter((k) => !dicek.has(k.id)).map((k) => ({ kode: k.kode, nama: k.nama, status: k.status }));
					}
				}
			} catch (err) {
				console.error('[serah-terima] gagal membaca kunci operasional untuk G_SEC8, aturan dilewati:', err);
			}
			const verdict = evaluateKeyHandoverGate({ outstanding, belumDicek });
			if (!verdict.passed) {
				const snapshot = { shift, tanggal, satpam_masuk_id: masukId, mode, violations: verdict.violations };
				if (mode === 'hard') {
					await writeGateAudit({ gate: 'G_SEC8', collection: 'security_shift_handover', recordId: null, decision: 'block', reason: verdict.summary, snapshot, email: user.email ?? null });
					throw error(400, `Serah-terima belum bisa: ${verdict.summary}. Selesaikan checklist kotak kunci di halaman ini, kembalikan kunci ke slot, atau beri izin bawa pulang di menu Kunci.`);
				}
				if (mode === 'soft' && gateReasonKey.length < ps.secKeyMinAlasan) {
					throw error(422, `${verdict.summary}. Selesaikan checklist/kembalikan kunci ke slot, atau isi alasan (minimal ${ps.secKeyMinAlasan} karakter) untuk tetap menyerahkan.`);
				}
				auditKey = {
					decision: mode === 'soft' ? 'warn' : 'shadow',
					reason: mode === 'soft' ? gateReasonKey : verdict.summary,
					summary: verdict.summary,
					violations: verdict.violations
				};
			}
		}
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[serah-terima] evaluasi G_SEC8 gagal, dilewati (fail-open):', err);
	}

	const created = await directusServerJson<{ data: any }>('/items/security_shift_handover', {
		method: 'POST',
		body: JSON.stringify({
			shift,
			tanggal,
			satpam_keluar_id: karyawan.id,
			satpam_masuk_id: masukId,
			catatan,
			diterima: false
		})
	});
	const recordId = created?.data?.id ?? null;

	if (audit) {
		await writeGateAudit({
			gate: 'G_SEC7',
			collection: 'security_shift_handover',
			recordId,
			decision: audit.decision,
			reason: audit.reason,
			snapshot: { shift, tanggal, satpam_masuk_id: masukId, summary: audit.summary, violations: audit.violations },
			email: user.email ?? null
		});
	}

	// Bukti rekonsiliasi: satpam menyerahkan checklist kotak kunci dan semuanya lolos → catat sebagai 'allow'.
	if (!auditKey && bukti) {
		await writeGateAudit({
			gate: 'G_SEC8',
			collection: 'security_shift_handover',
			recordId,
			decision: 'allow',
			reason: null,
			snapshot: { shift, tanggal, satpam_masuk_id: masukId, ...bukti },
			email: user.email ?? null
		});
	}

	if (auditKey) {
		await writeGateAudit({
			gate: 'G_SEC8',
			collection: 'security_shift_handover',
			recordId,
			decision: auditKey.decision,
			reason: auditKey.reason,
			snapshot: { shift, tanggal, satpam_masuk_id: masukId, summary: auditKey.summary, violations: auditKey.violations },
			email: user.email ?? null
		});
	}

	return json({
		record: created?.data ?? created,
		gate: audit ? { decision: audit.decision, summary: audit.summary } : null,
		gate_kunci: auditKey ? { decision: auditKey.decision, summary: auditKey.summary } : null
	});
};
