import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { mirrorSubmitApprovalRequest, getGaChecklistApprovalPolicy } from '$lib/server/approvalMirror';
import { notifyGaChecklistSubmitted } from '$lib/server/gaChecklistNotify';
import { gaChecklistAnswersSchema } from '$lib/schemas/gaChecklistSubmit';
import { todayJakarta } from '$lib/server/ess/time';
import { getGaAsetSettings } from '$lib/server/gaAsetSettings';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { evaluateCleaningChecklistGate } from '$lib/server/gates/cleaningChecklistGate';

/** Catat keputusan gate ke gate_audit_log. Best-effort — tidak boleh menggagalkan submit. */
async function auditGateCln2(params: {
	decision: 'shadow' | 'warn' | 'block';
	recordId: number | string | null;
	reason: string | null;
	snapshot: Record<string, unknown>;
	email: string | null;
}): Promise<void> {
	try {
		await directusServerJson('/items/gate_audit_log', {
			method: 'POST',
			body: JSON.stringify({
				gate: 'G_CLN2',
				collection: 'ga_checklist_responses',
				method: 'POST',
				record_id: params.recordId != null ? String(params.recordId) : null,
				decision: params.decision,
				reason: params.reason,
				payload_snapshot: params.snapshot,
				user_email: params.email
			})
		});
	} catch (err) {
		console.error('[submit] gagal menulis gate_audit_log G_CLN2 (diabaikan):', err);
	}
}

/**
 * 1.x (Kontrol Patroli Fase 1) — wajib cek kelengkapan ruangan untuk area yang punya
 * barang terdaftar (ga_asset). shadow = tidak ditegakkan. soft = wajib alasan bila
 * belum dicek. hard = tolak submit sampai cek ruangan selesai. Server adalah sumber
 * kebenaran (klien tidak dipercaya) — lihat Aturan #1.
 */
async function enforceRuanganCekGate(areaId: number | null, skipReason: string | null): Promise<void> {
	if (!areaId) return;
	const patrolSettings = await getPatrolControlSettings();
	if (patrolSettings.wajibCekRuanganMode === 'shadow') return;

	const assetRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_asset?${new URLSearchParams({ 'filter[area_id][_eq]': String(areaId), 'filter[status][_neq]': 'hilang', limit: '1' }).toString()}`
	);
	if (!assetRes?.data?.length) return;

	const gaAsetSettings = await getGaAsetSettings();
	const checkRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_room_check?${new URLSearchParams({ 'filter[area_id][_eq]': String(areaId), sort: '-waktu', limit: '1' }).toString()}`
	);
	const lastWaktu = checkRes?.data?.[0]?.waktu ?? null;
	const hari = lastWaktu ? Math.floor((Date.now() - new Date(lastWaktu).getTime()) / 86_400_000) : Infinity;
	const sudahCek = hari < gaAsetSettings.intervalCekHari;
	if (sudahCek) return;

	if (patrolSettings.wajibCekRuanganMode === 'hard') {
		throw error(400, 'Cek kelengkapan ruangan wajib diselesaikan dulu sebelum checklist ini bisa dikirim.');
	}
	if (!skipReason || !skipReason.trim()) {
		throw error(400, 'Cek kelengkapan ruangan belum dilakukan. Isi alasan untuk melewati, atau selesaikan cek ruangan terlebih dulu.');
	}
}

type ItemAnswer = { item_id: number; answer: 'yes' | 'no' | 'na'; notes?: string };

/**
 * Submit checklist lapangan. Foto per-item dikirim sebagai field terpisah bernama
 * `photo_<item_id>` dalam FormData yang sama (bisa lebih dari satu file per item).
 * Server yang menghitung skor & membuat finding — klien tidak dipercaya untuk itu,
 * supaya scoring tidak bisa dimanipulasi dari field app.
 *
 * Dua konteks (lihat rencana konsolidasi GA/Security 2026-07-13, Fase 3), TAPI keduanya
 * SEKARANG selalu memakai checkpoint dari `security_checkpoint`, disimpan ke
 * `ga_checklist_responses.security_checkpoint_id`:
 * - `area_id` (OB/Kebersihan): checkpoint di-scan lewat security_checkpoint milik area itu.
 * - `route_id` (Security/Satpam): checkpoint di-scan lewat rute patroli.
 *
 * R9 (rencana v2 GA Ruangan↔Barang↔Checklist, Fase 6, 16 Sep 2026): kolom
 * `ga_checklist_responses.checkpoint_id` (FK ke koleksi lama `ga_checkpoints`) DIPENSIUNKAN
 * -- audit 16 Sep 2026 menemukan 0 dari 1.558 baris memakainya, koleksi `ga_checkpoints`
 * sendiri sudah tidak dipakai kode manapun. Kolom TIDAK dihapus dari skema (data historis
 * mungkin masih ada), tapi kode ini tidak pernah lagi menulisnya -- lihat `checkpointFkField`.
 */
export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const areaId = String(form.get('area_id') || '');
	const routeId = String(form.get('route_id') || '');
	const templateId = String(form.get('template_id') || '');
	const checkpointId = String(form.get('checkpoint_id') || '');
	const signatureData = String(form.get('signature') || '');
	const ruanganCekSkipReason = String(form.get('ruangan_cek_skip_reason') || '').trim() || null;

	let rawAnswers: unknown;
	try {
		rawAnswers = JSON.parse(String(form.get('responses') || '[]'));
	} catch {
		throw error(400, 'Data jawaban checklist tidak valid.');
	}
	const answersResult = gaChecklistAnswersSchema.safeParse(rawAnswers);
	if (!answersResult.success) {
		throw error(400, answersResult.error.issues[0]?.message || 'Data jawaban checklist tidak valid.');
	}
	const answers: ItemAnswer[] = answersResult.data;

	if (!areaId && !routeId) throw error(400, 'Area atau rute wajib dipilih.');
	if (!templateId) throw error(400, 'Template checklist tidak ditemukan.');
	if (!checkpointId) throw error(400, 'Checklist harus dimulai dengan scan QR titik lokasi.');
	if (!signatureData) throw error(400, 'Tanda tangan pelaksana wajib diisi.');

	// R9: 'checkpoint_id' (FK ke ga_checkpoints, dipensiunkan) TIDAK PERNAH lagi diset --
	// selalu 'security_checkpoint_id'. Union dipertahankan hanya untuk dokumentasi skema.
	const checkpointFkField: 'security_checkpoint_id' = 'security_checkpoint_id';
	let resolvedAreaIdFromRoute: number | null = null;
	let gateAreaId: number | null = null;
	let gateRoleScope: string | null = null;
	if (routeId) {
		// Checkpoint tidak dipercaya dari klien begitu saja — pastikan memang aktif, milik
		// template ini, DAN bagian dari rute yang sedang dikerjakan, tanpa scan ulang di klien.
		const cpRes = await directusServerJson<{ data: any[] }>(
			`/items/security_checkpoint?${new URLSearchParams({ 'filter[id][_eq]': checkpointId, 'filter[status][_eq]': 'active', limit: '1' }).toString()}`
		);
		const checkpoint = cpRes?.data?.[0];

		let resolvedTemplateId = checkpoint?.checklist_template_id;
		let templateMatches = resolvedTemplateId != null && String(resolvedTemplateId) === templateId;
		if (checkpoint && !templateMatches && checkpoint.area_id) {
			const areaRes = await directusServerJson<{ data: any[] }>(
				`/items/ga_areas?${new URLSearchParams({ 'filter[id][_eq]': String(checkpoint.area_id), limit: '1' }).toString()}`
			);
			const area = areaRes?.data?.[0];
			// R8/D7 (rencana v2 Fase 6, 16 Sep 2026): fallback area juga pakai template_ids
			// (array, multi-template) dengan fallback ke template_id -- sama seperti cabang
			// areaId di bawah, supaya area multi-template tidak "lolos jadwal, ditolak submit".
			if (area) {
				const areaTemplateIds: number[] = Array.isArray(area.template_ids) && area.template_ids.length
					? area.template_ids
					: [area.template_id].filter(Boolean);
				templateMatches = areaTemplateIds.map(String).includes(templateId);
			}
		}

		if (!checkpoint || !templateMatches) {
			throw error(400, 'Bukti scan titik lokasi tidak valid. Scan ulang QR di lokasi.');
		}
		resolvedAreaIdFromRoute = checkpoint.area_id ? Number(checkpoint.area_id) : null;
		const routeRes = await directusServerJson<{ data: any[] }>(
			`/items/security_patrol_route?${new URLSearchParams({ 'filter[id][_eq]': routeId, 'filter[status][_eq]': 'active', limit: '1' }).toString()}`
		);
		const route = routeRes?.data?.[0];
		if (!route || !Array.isArray(route.checkpoint_ids) || !route.checkpoint_ids.map(String).includes(checkpointId)) {
			throw error(400, 'Checkpoint bukan bagian dari rute yang sedang dikerjakan.');
		}
		gateAreaId = checkpoint.area_id ? Number(checkpoint.area_id) : null;
		gateRoleScope = checkpoint.role_scope ?? null;
	} else {
		// Validasi area memang menggunakan template ini & staff ini ditugaskan.
		const areaRes = await directusServerJson<{ data: any[] }>(
			`/items/ga_areas?${new URLSearchParams({ 'filter[id][_eq]': areaId, limit: '1' }).toString()}`
		);
		const area = areaRes?.data?.[0];
		if (!area) throw error(404, 'Area tidak ditemukan.');
		// R8/D7 (rencana v2 Fase 6, 16 Sep 2026): dulu HANYA memvalidasi template_id tunggal,
		// padahal schedule/+server.ts & checkpoint/resolve sudah lama memvalidasi template_ids
		// (array, multi-template per area) dengan fallback ke template_id. Area yang di-set
		// multi-template lolos di endpoint lain tapi DITOLAK di sini -- disatukan ke pola yang
		// sama (template_ids sebagai sumber utama, template_id sebagai fallback satu nilai).
		const areaTemplateIds: number[] = Array.isArray(area.template_ids) && area.template_ids.length
			? area.template_ids
			: [area.template_id].filter(Boolean);
		if (!areaTemplateIds.map(String).includes(templateId)) throw error(400, 'Template tidak sesuai dengan area ini.');

		// Checkpoint tidak dipercaya dari klien begitu saja — pastikan memang aktif & milik area ini,
		// supaya submit tidak bisa dipalsukan dengan checkpoint_id sembarangan tanpa scan ulang.
		const cpRes = await directusServerJson<{ data: any[] }>(
			`/items/security_checkpoint?${new URLSearchParams({ 'filter[id][_eq]': checkpointId, 'filter[status][_eq]': 'active', limit: '1' }).toString()}`
		);
		const checkpoint = cpRes?.data?.[0];
		if (!checkpoint || String(checkpoint.area_id) !== areaId) {
			throw error(400, 'Bukti scan titik lokasi tidak valid. Scan ulang QR di lokasi.');
		}
		gateAreaId = Number(areaId);
		gateRoleScope = checkpoint.role_scope ?? null;
	}

	// 1.x Kontrol Patroli Fase 1 — wajib cek kelengkapan ruangan (hanya checkpoint kebersihan).
	if (gateRoleScope === 'kebersihan') {
		await enforceRuanganCekGate(gateAreaId, ruanganCekSkipReason);
	}

	// R2 (rencana v2 Fase 6, 16 Sep 2026): deteksi submit ganda. Sebelum fix D1/D3 (Fase 0/5),
	// area_id sering null sehingga pengecekan ini tidak mungkin dilakukan -- sekarang area_id
	// selalu terisi (dari areaId langsung atau checkpoint.area_id di jalur route), jadi
	// pengecekan baru bisa diaktifkan. TIDAK memblokir keras (Aturan #6, anti-lockdown) --
	// hanya minta konfirmasi eksplisit lewat field `confirm_resubmit` bila memang disengaja
	// (mis. isi ulang setelah ada perubahan kondisi di hari yang sama).
	const finalAreaId = areaId ? Number(areaId) : resolvedAreaIdFromRoute;
	const confirmResubmit = String(form.get('confirm_resubmit') || '') === 'true';
	if (finalAreaId != null && !confirmResubmit) {
		const dupRes = await directusServerJson<{ data: any[] }>(
			`/items/ga_checklist_responses?${new URLSearchParams({
				'filter[area_id][_eq]': String(finalAreaId),
				'filter[filled_by][_eq]': String(karyawan.id),
				'filter[submitted_at][_gte]': `${todayJakarta()}T00:00:00`,
				limit: '1',
				fields: 'id,submitted_at,scoring_result'
			}).toString()}`
		);
		const dup = dupRes?.data?.[0];
		if (dup) {
			throw error(409, `Anda sudah mengisi checklist ruangan ini hari ini (skor ${dup.scoring_result}%, pukul ${new Date(dup.submitted_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}). Kirim ulang bila memang ada perubahan kondisi.`);
		}
	}

	// Ambil definisi item (is_critical) dari server, bukan dari klien, untuk scoring & finding yang akurat.
	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_checklist_items?${new URLSearchParams({
			'filter[template_id][_eq]': templateId,
			limit: '-1'
		}).toString()}`
	);
	const itemDefs = new Map<number, any>((itemsRes?.data || []).map((i) => [i.id, i]));

	// G_CLN2 "Eksekusi Checklist Area" (Security/Cleaning Fase 4) — hanya checkpoint kebersihan.
	// Dievaluasi SEBELUM foto diunggah (jumlah foto dihitung dari FormData) supaya penolakan tidak
	// meninggalkan berkas yatim. Mode/enforce_from dari gate_definitions (resolveGateMode, bisa diatur
	// superadmin di /settings/gates); aturan (foto item "Tidak", semua item dijawab) dari
	// app_settings patrol_control. shadow = hanya dicatat; soft = wajib alasan (422 → klien minta
	// alasan lalu kirim ulang dengan `gate_cln2_reason`); hard = tolak. Gagal baca = fail-open.
	const gateCln2Reason = String(form.get('gate_cln2_reason') || '').trim() || null;
	let cln2Audit: { decision: 'shadow' | 'warn'; reason: string | null; summary: string; violations: unknown } | null = null;
	if (gateRoleScope === 'kebersihan') {
		try {
			const [mode, ps] = await Promise.all([
				resolveGateMode('G_CLN2', 'cleaning_lifecycle'),
				getPatrolControlSettings()
			]);
			const photoCountByItem: Record<number, number> = {};
			for (const [key, value] of form.entries()) {
				if (!key.startsWith('photo_') || !(value instanceof File) || value.size === 0) continue;
				const id = Number(key.replace('photo_', ''));
				photoCountByItem[id] = (photoCountByItem[id] ?? 0) + 1;
			}
			const verdict = evaluateCleaningChecklistGate({
				answers,
				itemDefs: [...itemDefs.values()],
				photoCountByItem,
				options: { fotoWajibItemNo: ps.clnFotoWajibItemNo, wajibSemuaItem: ps.clnWajibSemuaItem }
			});
			if (!verdict.passed) {
				const snapshot = { area_id: gateAreaId, template_id: Number(templateId), mode, violations: verdict.violations };
				if (mode === 'hard') {
					await auditGateCln2({ decision: 'block', recordId: null, reason: verdict.summary, snapshot, email: user.email ?? null });
					throw error(400, `Checklist belum lengkap: ${verdict.summary}. Lengkapi dulu sebelum mengirim.`);
				}
				if (mode === 'soft' && !gateCln2Reason) {
					throw error(422, `Checklist belum lengkap: ${verdict.summary}. Isi alasan untuk tetap mengirim, atau lengkapi dulu.`);
				}
				cln2Audit = {
					decision: mode === 'soft' ? 'warn' : 'shadow',
					reason: mode === 'soft' ? gateCln2Reason : verdict.summary,
					summary: verdict.summary,
					violations: verdict.violations
				};
			}
		} catch (err) {
			if (isHttpError(err)) throw err;
			console.error('[submit] evaluasi G_CLN2 gagal, dilewati (fail-open):', err);
		}
	}

	// Upload foto per item.
	const photoMap: Record<number, string[]> = {};
	for (const [key, value] of form.entries()) {
		if (!key.startsWith('photo_') || !(value instanceof File) || value.size === 0) continue;
		const itemId = Number(key.replace('photo_', ''));
		const uploadForm = new FormData();
		uploadForm.append('file', value);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, `Gagal mengunggah foto item ${itemId}.`);
		const uploaded = await res.json();
		const fileId = uploaded?.data?.id;
		if (fileId) {
			if (!photoMap[itemId]) photoMap[itemId] = [];
			photoMap[itemId].push(fileId);
		}
	}

	// Scoring: % item "yes" dari item yang berlaku (bukan N/A).
	const applicable = answers.filter((a) => a.answer !== 'na');
	const passed = applicable.filter((a) => a.answer === 'yes');
	const scoringResult = applicable.length > 0 ? Math.round((passed.length / applicable.length) * 1000) / 10 : 100;

	const responsesJson: Record<string, any> = {};
	for (const a of answers) {
		responsesJson[a.item_id] = { answer: a.answer, photo_ids: photoMap[a.item_id] || [], notes: a.notes || '' };
	}

	const contextLabel = routeId ? `Rute Keamanan #${routeId}` : `Area #${areaId}`;

	// FASE 3 (Rencana Self-Service PL v2 — Bongkar Approval Theater): tentukan lebih dulu
	// apakah checklist ini MENYIMPANG. Dari 1.099 checklist GA yang pernah ada hanya 9
	// yang pernah disetujui — checklist normal mengubur approval nyata. Menyimpang =
	// ada item "No" (→ finding), atau ada item kritis "No", atau skor di bawah ambang
	// (app_settings module='ga_checklist'). Checklist normal tetap tersimpan + masuk
	// digest harian, tapi TIDAK membuat approval dan TIDAK muncul di antrean verifikasi.
	const policy = await getGaChecklistApprovalPolicy();
	const hasNo = answers.some((a) => a.answer === 'no');
	const hasCriticalNo = answers.some((a) => a.answer === 'no' && itemDefs.get(a.item_id)?.is_critical);
	const isDeviant = hasNo || hasCriticalNo || scoringResult < policy.minScore;

	const now = new Date().toISOString();
	const response = await directusServerJson<{ data: any }>('/items/ga_checklist_responses', {
		method: 'POST',
		body: JSON.stringify({
			// D1 (audit GA Ruangan↔Barang↔Checklist, 16 Sep 2026): jalur routeId (patroli satpam)
			// dulu menulis area_id null padahal checkpoint.area_id sudah tervalidasi di atas —
			// akar 1.552 baris ga_checklist_responses yatim tanpa area_id.
			area_id: areaId ? Number(areaId) : resolvedAreaIdFromRoute,
			template_id: Number(templateId),
			[checkpointFkField]: Number(checkpointId),
			filled_by: karyawan.id,
			submitted_at: now,
			responses: responsesJson,
			scoring_result: scoringResult,
			status: 'submitted',
			perlu_tindak_lanjut: isDeviant,
			signature_submitted: { data: signatureData, timestamp: now },
			...(ruanganCekSkipReason ? { ruangan_cek_skip_reason: ruanganCekSkipReason } : {})
		})
	});
	const responseId = response?.data?.id;

	if (cln2Audit) {
		await auditGateCln2({
			decision: cln2Audit.decision,
			recordId: responseId ?? null,
			reason: cln2Audit.reason,
			snapshot: { area_id: gateAreaId, template_id: Number(templateId), summary: cln2Audit.summary, violations: cln2Audit.violations },
			email: user.email ?? null
		});
	}

	// Auto-create finding untuk setiap item yang dijawab "No".
	const findings: any[] = [];
	for (const a of answers) {
		if (a.answer !== 'no') continue;
		const def = itemDefs.get(a.item_id);
		const severity = def?.is_critical ? 'critical' : 'minor';
		const finding = await directusServerJson<{ data: any }>('/items/ga_checklist_findings', {
			method: 'POST',
			body: JSON.stringify({
				response_id: responseId,
				item_id: a.item_id,
				finding_description: a.notes || `Item "${def?.item_name || a.item_id}" tidak sesuai`,
				severity,
				photo_id: (photoMap[a.item_id] || [])[0] || null,
				status: 'open'
			})
		});
		findings.push(finding?.data);
	}

	// Notifikasi ke tim GA/HRD — Notifikasi Terpusat v2 (Fase 2/6, pilot GA): relay ke hub
	// erp-epi-1 (notifyEvent) via gaChecklistNotify.ts, menggantikan POST langsung ke
	// app_notifications lama. Hub yang menulis app_notifications (in-app) DAN mencatat ke
	// notification_log (audit lintas-channel) + kirim WA bila temuan kritis. Non-fatal:
	// gagal notifikasi tidak boleh menggagalkan alur submit.
	const criticalCount = findings.filter((f) => f?.severity === 'critical').length;

	// R8 (rekomendasi Kontrol Patroli, 15 Sep 2026) — checklist menyimpang: auto-jadwalkan
	// checklist remedial esok hari untuk area yang sama, supaya area yang gagal benar-benar
	// diperiksa ulang (bukan cuma tercatat lalu terlupakan sampai jadwal rutin berikutnya).
	// Idempoten per area+tanggal (dicek dulu sebelum buat), best-effort (tidak boleh
	// menggagalkan submit checklist aslinya).
	if (isDeviant && gateAreaId) {
		try {
			const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
			const existing = await directusServerJson<{ data: any[] }>(
				`/items/ga_checklist_schedule?${new URLSearchParams({
					'filter[area_id][_eq]': String(gateAreaId),
					'filter[scheduled_date][_eq]': tomorrow,
					'filter[notes][_contains]': 'Remedial otomatis',
					limit: '1'
				}).toString()}`
			);
			if (!existing?.data?.length) {
				await directusServerJson('/items/ga_checklist_schedule', {
					method: 'POST',
					body: JSON.stringify({
						area_id: gateAreaId,
						template_id: Number(templateId),
						frequency_type: 'daily',
						scheduled_date: tomorrow,
						assigned_to_ids: [karyawan.id],
						checklist_type: 'routine',
						status: 'pending',
						notes: `Remedial otomatis — checklist ${now.slice(0, 10)} menyimpang (skor ${scoringResult}%${criticalCount ? `, ${criticalCount} temuan kritis` : ''}).`
					})
				});
			}
		} catch (err) {
			console.error('[submit] gagal auto-jadwal remedial (R8), dilewati:', err);
		}
	}

	// Buat approval HANYA bila menyimpang (atau kill-switch exception_only dimatikan).
	if (!policy.exceptionOnly || isDeviant) {
		try {
			await mirrorSubmitApprovalRequest({
				moduleKey: 'hrd.ga.checklist',
				sourceCollection: 'ga_checklist_responses',
				sourceId: responseId,
				title: `Checklist GA ${contextLabel} — ${karyawan.nama_karyawan}${isDeviant ? ' ⚠ menyimpang' : ''}`,
				summary: `Skor: ${scoringResult}%${findings.length ? ` · ${findings.length} temuan${criticalCount ? ` (${criticalCount} kritis)` : ''}` : ''}`,
				amount: null,
				departmentKey: karyawan.divisi,
				requesterId: karyawan.id
			});
		} catch (e) {
			console.warn('[approvalMirror] gagal mendaftarkan checklist GA ke Inbox terpusat:', e);
		}
	}

	await notifyGaChecklistSubmitted(responseId, contextLabel, scoringResult, criticalCount).catch(() => {});

	return json({ record: response?.data ?? response, findings, actor: user.email, deviant: isDeviant });
};
