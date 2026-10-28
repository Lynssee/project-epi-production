import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { evaluateSecurityHandoverGate } from '$lib/server/gates/securityHandoverGate';
import { writeGateAudit } from '$lib/server/gates/gateAudit';

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

	return json({ record: created?.data ?? created, gate: audit ? { decision: audit.decision, summary: audit.summary } : null });
};
