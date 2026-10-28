import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { evaluateGatePersonGate } from '$lib/server/gates/gatePersonGate';
import { writeGateAudit } from '$lib/server/gates/gateAudit';

const TIPE = ['tetap', 'manpower', 'tamu'] as const;
const KEPERLUAN = ['dinas', 'pribadi', 'istirahat'] as const;

/**
 * Catat orang keluar/masuk gerbang (G_SEC2). Dulu klien menulis langsung ke security_gate_person_log
 * (pencatat tidak tercatat, pairing KELUAR↔MASUK dikerjakan klien, tidak ada titik gate). Sekarang
 * server yang menulis: satpam pencatat = karyawan login, pairing di server, gate dievaluasi.
 * shadow = hanya dicatat ke gate_audit_log; soft = 422 sampai `gate_sec2_reason` diisi; hard = 400.
 * Jalur QR izin jam-jaman (/api/ess/izin-jam/gate-scan) sudah berizin dan tidak lewat sini.
 */
export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, (user as any).localId, { email: user.email });
	if (!hasAnyPermission(permissions, 'gate_log')) throw error(403, 'Tidak punya izin mencatat gate.');

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Data gate tidak valid.');

	const arah = String((body as any).arah || '');
	if (arah !== 'in' && arah !== 'out') throw error(400, 'Arah harus masuk atau keluar.');
	const tipe = String((body as any).tipe || '');
	if (!TIPE.includes(tipe as (typeof TIPE)[number])) throw error(400, 'Tipe orang tidak valid.');
	const keperluanRaw = (body as any).keperluan;
	const keperluan = keperluanRaw == null || keperluanRaw === '' ? null : String(keperluanRaw);
	if (keperluan && !KEPERLUAN.includes(keperluan as (typeof KEPERLUAN)[number])) throw error(400, 'Keperluan tidak valid.');

	const karyawanId = Number((body as any).karyawan_id) || null;
	const manpowerId = Number((body as any).manpower_id) || null;
	const namaManual = String((body as any).nama_manual ?? '').trim() || null;
	if (tipe === 'tetap' && !karyawanId) throw error(400, 'Pilih karyawan dari hasil pencarian.');
	if (tipe === 'manpower' && !manpowerId) throw error(400, 'Pilih pekerja dari hasil pencarian.');
	if (tipe === 'tamu' && !namaManual) throw error(400, 'Isi nama.');
	const gateReason = String((body as any).gate_sec2_reason ?? '').trim() || null;

	const nowIso = new Date().toISOString();
	const today = todayJakarta();
	const todayStartMs = new Date(`${today}T00:00:00+07:00`).getTime();

	// Catatan KELUAR terbuka (belum berpasangan MASUK) untuk orang yang sama — dipakai gate dan pairing.
	let openOuts: any[] | null = null;
	try {
		const f = new URLSearchParams({
			'filter[arah][_eq]': 'out',
			'filter[paired_id][_null]': 'true',
			fields: 'id,waktu,nama_manual',
			sort: '-waktu',
			limit: '20'
		});
		if (tipe === 'tetap') f.set('filter[karyawan_id][_eq]', String(karyawanId));
		else if (tipe === 'manpower') f.set('filter[manpower_id][_eq]', String(manpowerId));
		else f.set('filter[nama_manual][_icontains]', namaManual as string);
		const res = await directusServerJson<{ data: any[] }>(`/items/security_gate_person_log?${f.toString()}`);
		openOuts = (res?.data || []).filter((l) => tipe !== 'tamu' || String(l.nama_manual || '').toLowerCase() === (namaManual as string).toLowerCase());
	} catch (err) {
		console.error('[gate-orang] gagal membaca catatan keluar terbuka:', err);
	}

	// --- G_SEC2 ---
	let audit: { decision: 'shadow' | 'warn'; reason: string | null; summary: string; violations: unknown } | null = null;
	if (arah === 'out') {
		try {
			const [mode, ps] = await Promise.all([
				resolveGateMode('G_SEC2', 'security_lifecycle'),
				getPatrolControlSettings()
			]);

			let izinAktif: boolean | null = null;
			if (tipe === 'tetap' && keperluan === 'pribadi' && ps.secWajibIzinPribadi) {
				try {
					const res = await directusServerJson<{ data: any[] }>(
						`/items/izin_jam_request?${new URLSearchParams({
							'filter[karyawan_id][_eq]': String(karyawanId),
							'filter[tanggal][_eq]': today,
							'filter[status][_in]': 'disetujui,out_scanned',
							fields: 'id',
							limit: '1'
						}).toString()}`
					);
					izinAktif = (res?.data?.length ?? 0) > 0;
				} catch (err) {
					console.error('[gate-orang] gagal membaca izin jam-jaman, aturan izin dilewati:', err);
				}
			}

			const jamWib = new Date(Date.now() + 7 * 3_600_000).getUTCHours();
			const verdict = evaluateGatePersonGate({
				arah: 'out',
				tipe,
				keperluan,
				jamWib,
				izinAktif,
				openOutAda: openOuts == null ? null : openOuts.some((l) => new Date(l.waktu).getTime() >= todayStartMs),
				options: { jamKerjaMulai: ps.secJamKerjaMulai, jamKerjaSelesai: ps.secJamKerjaSelesai, wajibIzinPribadi: ps.secWajibIzinPribadi }
			});

			if (!verdict.passed) {
				const snapshot = { tipe, keperluan, karyawan_id: karyawanId, manpower_id: manpowerId, nama_manual: namaManual, mode, violations: verdict.violations };
				if (mode === 'hard') {
					await writeGateAudit({ gate: 'G_SEC2', collection: 'security_gate_person_log', recordId: null, decision: 'block', reason: verdict.summary, snapshot, email: user.email ?? null });
					throw error(400, `Gate orang ditolak: ${verdict.summary}.`);
				}
				if (mode === 'soft' && !gateReason) {
					throw error(422, `Perlu perhatian: ${verdict.summary}. Isi alasan untuk tetap mencatat, atau batalkan.`);
				}
				audit = { decision: mode === 'soft' ? 'warn' : 'shadow', reason: mode === 'soft' ? gateReason : verdict.summary, summary: verdict.summary, violations: verdict.violations };
			}
		} catch (err) {
			if (isHttpError(err)) throw err;
			console.error('[gate-orang] evaluasi G_SEC2 gagal, dilewati (fail-open):', err);
		}
	}

	const created = await directusServerJson<{ data: any }>('/items/security_gate_person_log', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: tipe === 'tetap' ? karyawanId : null,
			manpower_id: tipe === 'manpower' ? manpowerId : null,
			nama_manual: tipe === 'tamu' ? namaManual : null,
			tipe,
			arah,
			keperluan,
			waktu: nowIso,
			satpam_pencatat_id: karyawan.id
		})
	});
	const saved = created?.data;

	// Pairing MASUK ↔ KELUAR terbuka (sama seperti perilaku klien lama).
	if (arah === 'in' && saved?.id && openOuts && openOuts.length > 0) {
		const match = openOuts[0];
		try {
			await directusServerJson(`/items/security_gate_person_log/${match.id}`, { method: 'PATCH', body: JSON.stringify({ paired_id: saved.id }) });
			await directusServerJson(`/items/security_gate_person_log/${saved.id}`, { method: 'PATCH', body: JSON.stringify({ paired_id: match.id }) });
		} catch (err) {
			console.error('[gate-orang] gagal memasangkan MASUK↔KELUAR (catatan tetap tersimpan):', err);
		}
	}

	if (audit) {
		await writeGateAudit({
			gate: 'G_SEC2',
			collection: 'security_gate_person_log',
			recordId: saved?.id ?? null,
			decision: audit.decision,
			reason: audit.reason,
			snapshot: { tipe, keperluan, karyawan_id: karyawanId, manpower_id: manpowerId, nama_manual: namaManual, summary: audit.summary, violations: audit.violations },
			email: user.email ?? null
		});
	}

	return json({ record: saved ?? created, gate: audit ? { decision: audit.decision, summary: audit.summary } : null });
};
