// src/routes/api/directus/[...path]/+server.ts
// F0 — Proxy Directus terautentikasi untuk Dashboard Lapangan.
//
// Klien memanggil /api/directus/<path-directus> dengan header
// `Authorization: Bearer <firebase_id_token>`. Server memverifikasi sesi
// Firebase lalu meneruskan ke Directus memakai token rahasia sisi server.
// Dengan ini token Directus tidak lagi ada di bundle klien.
//
// CATATAN (follow-up RBAC): proxy ini masih meneruskan dengan hak token app
// (admin). Pembatasan per-koleksi/per-role adalah langkah lanjutan (lihat
// rencana Global Deep Search §4).
//
// Fase 1 laporan-harian (2026-07): `manpower_assignment.rate_harian`/`nilai_borongan`
// dibaca dengan `fields=*` oleh fitur assign yang SUDAH jalan (ProjectManpowerAssign.svelte)
// tanpa gating role apapun — memblokir field itu di sini akan mematahkan fitur tsb, jadi
// BELUM diblok. Yang ditutup sekarang: query `aggregate[...]` ke koleksi payroll, yang bisa
// membocorkan nilai (mis. `?aggregate[sum]=rate_harian`) tanpa pernah menampilkannya di UI —
// tidak ada pemakai sah untuk aggregate di koleksi ini (lihat project-laporan-harian-approval memory).
//
// T7 (rencana JSA & Administrasi HSE v2.0, 23 Jul 2026): field sensitif
// hse_incident (identitas korban, jenis cedera, bagian tubuh, hari hilang LTI)
// di-strip dari respons GET untuk role tanpa tanggung jawab pengawasan HSE.
// Lihat $lib/server/hse/hseGuard.ts untuk detail & alasan (Directus role-based
// permission TIDAK berfungsi di sini karena semua request memakai satu token
// admin bersama).

import type { RequestEvent } from '@sveltejs/kit';
import { requireUser, type FirebaseVerifiedUser } from '$lib/server/firebaseAuth';
import { directusServerFetch, directusServerUpload, directusServerJson } from '$lib/server/directus';
import { canViewHseSensitiveFields, stripHseIncidentSensitiveFields } from '$lib/server/hse/hseGuard';
import { isPettyCashWriteBlocked, isPettyCashReadBlocked, PETTY_CASH_PROXY_BLOCK_MESSAGE } from '$lib/shared/pettyCashRules';
import { resolveFieldProjectScope, withScopeFilter, projectIdInCondition } from '$lib/server/fieldProjectScope';
import {
	resolvePengajuanAnggaranScope,
	withPengajuanAnggaranListFilter,
	isPengajuanAnggaranRowAllowed
} from '$lib/server/pengajuanAnggaranGuard';

const PAYROLL_COLLECTIONS = ['manpower_assignment', 'manpower_payroll', 'payroll'];

function isBlockedAggregateQuery(path: string, searchParams: URLSearchParams): boolean {
	const collection = path.split('/')[1] || '';
	if (!PAYROLL_COLLECTIONS.includes(collection)) return false;
	return [...searchParams.keys()].some((k) => k.startsWith('aggregate'));
}

// Fase 1.3 (audit performa, 29 Sep 2026) -- GET yang isi responsnya di-personalisasi
// SETELAH fetch dari Directus berdasarkan identitas user (bukan sekadar filter query):
// manpower_payroll (scope proyek disuntik server-side), pengajuan_anggaran (baris
// disaring/di-404-kan per pemilik), hse_incident (field sensitif di-strip per izin).
// WAJIB tetap no-store -- kalau di-cache, browser yang dipakai bergantian (device
// kantor bersama) bisa menyajikan respons user A yang sudah lolos gerbang izin ke
// user B tanpa gerbang itu pernah dievaluasi ulang. Kembar PAYROLL_COLLECTIONS di atas
// tapi jangan disatukan -- yang di atas soal blokir aggregate, ini soal cache safety.
const PERSONALIZED_GET_PREFIXES = ['items/manpower_payroll', 'items/pengajuan_anggaran', 'items/hse_incident'];

function isPersonalizedGetPath(path: string): boolean {
	return PERSONALIZED_GET_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Fase 2B (Gate Penawaran -> SO/PO, 2 Sep 2026) -- kembar Gate Q2 di erp-epi
// (src/lib/server/writeGuards/index.js). Proxy ini TIDAK punya framework writeGuards:
// tanpa cek ini, updatePenawaranStatus() di $lib/services/kalkulatorPenawaran.ts (tombol
// "Diterima" di /sales/penawaran) bisa menulis status 'accepted' (dipensiunkan) atau
// 'converted' tanpa linked_so_id, lolos sepenuhnya dari penjaga yang ada di erp-epi.
// Baca app_settings module 'finance_interlocking' yang SAMA dengan erp-epi supaya toggle
// warn->block tetap satu sumber kebenaran (diaktifkan dari /settings/app-config, tanpa
// deploy ulang di kedua repo). Cache 60 detik -- hemat API usage, PATCH ini jarang terjadi.
let q2ConfigCache: { enabled: boolean; fetchedAt: number } | null = null;
const Q2_CACHE_TTL_MS = 60_000;

async function isQ2Enabled(): Promise<boolean> {
	const now = Date.now();
	if (q2ConfigCache && now - q2ConfigCache.fetchedAt < Q2_CACHE_TTL_MS) return q2ConfigCache.enabled;
	try {
		const res = await directusServerJson<{ data: { setting_key: string; setting_value: string }[] }>(
			'/items/app_settings?filter[module][_eq]=finance_interlocking&filter[setting_key][_eq]=gates_enabled&limit=1'
		);
		const gatesEnabled = String(res?.data?.[0]?.setting_value ?? '')
			.split(',')
			.map((s) => s.trim());
		const enabled = gatesEnabled.includes('Q2');
		q2ConfigCache = { enabled, fetchedAt: now };
		return enabled;
	} catch {
		return q2ConfigCache?.enabled ?? false;
	}
}

// Penajaman Penerima Dana & Track Record v2, Fase 2 (11 Sep 2026) -- gate kembar
// G_REK_UBAH di erp-epi (src/lib/server/gates/rekeningGates.js + writeGuards/index.js).
// Proxy ini tidak punya framework writeGuards (T6/T14 di rencana): tanpa penjaga sendiri,
// PATCH rekening dari form lapangan (anggaran/[id]/edit) yang lewat proxy ini TIDAK
// pernah tercatat sekalipun finance.ts sudah menulis __edit_history -- ada jalur lain
// (mis. panggilan langsung ke proxy) yang melewati finance.ts sama sekali. SELALU
// shadow (keputusan user §9.3) -- TIDAK PERNAH memblokir, hanya mencatat gate_audit_log.
const REKENING_FIELDS_LAPANGAN = ['bank_name', 'bank_account_number', 'bank_account_name', 'penerima_dana_nama', 'rekening_penerima_id'];
const STATUS_SUDAH_DISETUJUI_LAPANGAN = ['approved', 'diproses', 'dibukukan', 'completed'];

function maskRekeningProxy(v: unknown): string | null {
	const digits = String(v ?? '').replace(/\D+/g, '');
	if (!digits) return null;
	return digits.length >= 4 ? `****${digits.slice(-4)}` : `****${digits}`;
}

/** Evaluasi PATCH pengajuan_anggaran/:id -- null bila tidak relevan (fail-open). */
async function evaluateRekeningUbahLapangan(
	recordId: string,
	patchBody: Record<string, any>
): Promise<{ changed: Array<{ field: string; before: unknown; after: unknown }>; statusAtEdit: string } | null> {
	if (!recordId || !patchBody || typeof patchBody !== 'object') return null;
	const touched = REKENING_FIELDS_LAPANGAN.filter((f) => Object.prototype.hasOwnProperty.call(patchBody, f));
	if (!touched.length) return null;

	let rec: any = null;
	try {
		const res = await directusServerJson<{ data: any }>(
			`/items/pengajuan_anggaran/${recordId}?fields=id,status,bank_name,bank_account_number,bank_account_name,penerima_dana_nama,rekening_penerima_id`
		);
		rec = res?.data;
	} catch {
		return null; // fail-open -- kegagalan fetch tidak boleh menghalangi PATCH aslinya
	}
	if (!rec) return null;
	if (!STATUS_SUDAH_DISETUJUI_LAPANGAN.includes(String(rec.status || '').trim().toLowerCase())) return null;

	const changed: Array<{ field: string; before: unknown; after: unknown }> = [];
	for (const f of touched) {
		const beforeVal = rec[f];
		const afterVal = patchBody[f];
		if (String(beforeVal ?? '') === String(afterVal ?? '')) continue;
		changed.push({
			field: f,
			before: f === 'bank_account_number' ? maskRekeningProxy(beforeVal) : beforeVal ?? null,
			after: f === 'bank_account_number' ? maskRekeningProxy(afterVal) : afterVal ?? null
		});
	}
	if (!changed.length) return null;
	return { changed, statusAtEdit: rec.status };
}

/** Gate Q2: integritas status kalkulator_penawaran. null = tidak relevan/lolos. */
function evaluateQ2(item: any): { reason: string } | null {
	if (!item || typeof item !== 'object') return null;
	if (item.status === 'accepted') {
		return {
			reason:
				'Status "accepted" sudah dipensiunkan -- konversi penawaran ke Sales Order dari dashboard admin, status akan otomatis menjadi "converted".'
		};
	}
	if (item.status === 'converted' && !item.linked_so_id) {
		return {
			reason:
				'Status "converted" hanya boleh ditulis bersamaan dengan linked_so_id -- gunakan alur konversi penawaran ke SO di dashboard admin, bukan ubah status manual.'
		};
	}
	return null;
}

async function handle(event: RequestEvent): Promise<Response> {
	try {
		const path = event.params.path || '';
		let search = event.url.search || '';
		const method = event.request.method;

		// Assets (GET/HEAD) dimuat via tag <img> atau preview file di browser tanpa header Authorization.
		const isAssetRead = (method === 'GET' || method === 'HEAD') && path.startsWith('assets');

		let user: FirebaseVerifiedUser | null = null;
		if (!isAssetRead) {
			user = await requireUser(event); // 401 bila sesi tidak valid
		}

		const isHseIncidentRead = method === 'GET' && path.startsWith('items/hse_incident');

		// SEC-01 (audit petty cash 21 Sep 2026) — kas kecil hanya boleh ditulis lewat /api/ess/petty-cash/*.
		if (isPettyCashWriteBlocked(path, method) || isPettyCashReadBlocked(path, method)) {
			console.warn(`[Proxy Directus] ${method} ${path} ditolak (SEC-01/PC3-05) oleh ${user?.email || '?'}`);
			return new Response(
				JSON.stringify({ error: 'PETTY_CASH_SERVER_ONLY', message: PETTY_CASH_PROXY_BLOCK_MESSAGE }),
				{ status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
			);
		}

		if (path.startsWith('items/') && isBlockedAggregateQuery(path, event.url.searchParams)) {
			return new Response(JSON.stringify({ error: 'Query aggregate tidak diizinkan untuk koleksi ini.' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Tambal sempit (temuan keamanan 14 Sep 2026) -- lihat fieldProjectScope.ts. Sebelum
		// ini, pembatasan "cuma proyek saya" untuk manpower_payroll hanya filter di browser;
		// siapa pun yang login sah bisa membaca gaji + rekening bank seluruh pekerja lintas
		// proyek lewat panggilan langsung ke proxy ini.
		if (method === 'GET' && path === 'items/manpower_payroll') {
			const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
			const scope = await resolveFieldProjectScope(idToken, user!.localId, user!.email);
			if (!scope.unrestricted) {
				if (scope.projectIds.length === 0) {
					return new Response(JSON.stringify({ data: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
					});
				}
				search = withScopeFilter(search, projectIdInCondition(scope.projectIds));
			}
		}

		// Tambal sempit koleksi pengajuan_anggaran (nominal + rekening bank penerima --
		// lihat pengajuanAnggaranGuard.ts). List (GET items/pengajuan_anggaran) dibatasi lewat
		// filter[_or] project_id/created_by_email; item tunggal (GET items/pengajuan_anggaran/:id)
		// diteruskan dulu lalu diperiksa setelah upstream menjawab (lihat di bawah, dekat
		// isHseIncidentRead) karena Directus tidak menerima filter pada path item tunggal.
		let pengajuanAnggaranScope: Awaited<ReturnType<typeof resolvePengajuanAnggaranScope>> | null = null;
		const isPengajuanAnggaranList = method === 'GET' && path === 'items/pengajuan_anggaran';
		const isPengajuanAnggaranSingle = method === 'GET' && /^items\/pengajuan_anggaran\/[^/]+$/.test(path);
		if (isPengajuanAnggaranList || isPengajuanAnggaranSingle) {
			const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
			pengajuanAnggaranScope = await resolvePengajuanAnggaranScope(idToken, user!.localId, user!.email);
			if (!pengajuanAnggaranScope.unrestricted && isPengajuanAnggaranList) {
				search = withPengajuanAnggaranListFilter(search, pengajuanAnggaranScope, user!.email);
			}
		}

		// Intercept file upload ke Directus `/files`
		if (path === 'files' && method === 'POST') {
			const formData = await event.request.formData();

			// Reconstruct FormData dari raw bytes agar aman untuk fetch Node.js (undici)
			const reconstructedFormData = new FormData();
			for (const [key, value] of formData.entries()) {
				if (value && typeof value === 'object' && typeof (value as File).arrayBuffer === 'function') {
					const file = value as File;
					const buffer = await file.arrayBuffer();
					const fileBlob = new Blob([buffer], { type: file.type });
					reconstructedFormData.append(key, fileBlob, file.name);
				} else {
					reconstructedFormData.append(key, value as string);
				}
			}

			const upstream = await directusServerUpload(reconstructedFormData);
			const resContentType = upstream.headers.get('content-type') || '';
			const finalBody = resContentType.includes('application/json') || upstream.status !== 200
				? await upstream.text()
				: new Uint8Array(await upstream.arrayBuffer());

			return new Response(finalBody, {
				status: upstream.status,
				headers: {
					'Content-Type': resContentType || 'application/json',
					'Cache-Control': 'no-store'
				}
			});
		}

		const contentType = event.request.headers.get('content-type');

		// Teruskan body sebagai bytes mentah agar aman untuk JSON maupun multipart
		// (boundary di Content-Type harus dipertahankan).
		let body: Buffer | undefined;
		let reportGateRejected: any[] | null = null; // R2-07: elemen POST array yang ditolak gerbang laporan (dikembalikan di respons)
		if (method !== 'GET' && method !== 'HEAD') {
			const buf = await event.request.arrayBuffer();
			body = buf.byteLength ? Buffer.from(buf) : undefined;
		}

		// Gate Q2 -- lihat catatan di isQ2Enabled()/evaluateQ2() di atas.
		if (method === 'PATCH' && path.startsWith('items/kalkulator_penawaran/') && body && contentType?.includes('application/json')) {
			if (await isQ2Enabled()) {
				try {
					const parsed = JSON.parse(body.toString('utf-8'));
					const q2 = evaluateQ2(parsed);
					if (q2) {
						return new Response(
							JSON.stringify({ error: 'GATE_BLOCKED', gate: 'Q2', reason: q2.reason }),
							{ status: 422, headers: { 'Content-Type': 'application/json' } }
						);
					}
				} catch {
					// body bukan JSON valid -- biarkan Directus sendiri yang menolak
				}
			}
		}

		// Fase 2 (Gate Keras Disiplin Data & Laporan Harian, erp-epi-1, 17 Sep 2026) --
		// titik tulis items/reports. Kembar persis gate di proxy erp-epi-1 (admin), TAPI
		// jalur override TIDAK tersedia di sini -- lapangan hanya mengirim laporannya
		// sendiri (tidak ada UI "Minta Perbaikan"/override, itu tugas admin). Override
		// hanya bisa dilakukan lewat proxy erp-epi-1 (PE_APPROVE_LAPORAN dicek di sana).
		// Sakelar induk `system_settings: laporan.write_gate_enabled` default OFF --
		// selama mati, TIDAK PERNAH menolak, hanya menghitung & menulis quality_*.
		const isReportsPost = path === 'items/reports' && method === 'POST';
		const isReportsPatch = path.startsWith('items/reports/') && method === 'PATCH';
		if ((isReportsPost || isReportsPatch) && body && contentType?.includes('application/json')) {
			try {
				let parsed: any = null;
				try {
					parsed = JSON.parse(body.toString('utf-8'));
				} catch {
					parsed = null; // body bukan JSON valid -- biarkan Directus sendiri yang menolak
				}
				if (parsed && typeof parsed === 'object') {
					// R2-07: gerbang berlaku PER ELEMEN -- body array (POST massal) dulu lolos tanpa gerbang & skor.
					const isArrayBody = Array.isArray(parsed);
					const elements: any[] = isArrayBody ? parsed : [parsed];
					const recordId = isReportsPatch ? path.split('/')[2] : null;
					// PATCH sering parsial -- gabung dengan record existing dulu (Aturan #2: query terpisah),
					// supaya field yang tidak disentuh tidak salah dianggap kosong.
					const existing: any = isReportsPatch
						? (await directusServerJson<{ data: any }>(`/items/reports/${recordId}`).catch(() => null))?.data || null
						: null;
					const { evaluateLaporanWriteGate, resolveLaporanGateMode } = await import('$lib/server/laporanWriteGate');
					const { gateReportElements, makeFindExisting, makeMultiShiftLoader, makeAuditWriter, LH_TANGGAL_UNIK, LH_TENAGA_TANPA_NAMA } = await import('$lib/server/reportsBatchGate');
					const fetchJson = (p: string, init?: any) => directusServerJson<any>(p, init);
					const { buildQualityChecks } = await import('$lib/server/reportsQualityChecks');
					const outcome = await gateReportElements(elements, {
						evaluate: (el) => evaluateLaporanWriteGate(existing ? { ...existing, ...el } : el),
						isCreate: isReportsPost,
						dupMode: () => resolveLaporanGateMode(LH_TANGGAL_UNIK),
						tenagaMode: () => resolveLaporanGateMode(LH_TENAGA_TANPA_NAMA),
						extraChecks: buildQualityChecks({ fetchJson, modeFor: (key) => () => resolveLaporanGateMode(key) }),
						findExisting: makeFindExisting(fetchJson),
						multiShiftProjects: makeMultiShiftLoader(fetchJson),
						audit: makeAuditWriter(fetchJson, { method, userEmail: user?.email }),
						previousFlags: existing?.quality_flags || []
					});
					const noStore = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

					if (!isArrayBody) {
						const rej = outcome.rejected[0];
						if (rej) {
							return new Response(
								JSON.stringify({
									error: 'GATE_BLOCKED',
									gates: rej.gates,
									selfApprovalBlocked: !!rej.selfApprovalBlocked,
									overrideNotAvailableHere: !!rej.overrideNotAvailableHere
								}),
								{ status: 422, headers: noStore }
							);
						}
						// quality_* selalu ditulis apa pun keputusannya (papan kepatuhan v2 butuh data sejak hari pertama);
						// gateReportElements mengisinya ke `parsed` (delta asli).
						body = Buffer.from(JSON.stringify(parsed), 'utf-8');
					} else {
						if (outcome.accepted.length === 0 && outcome.rejected.length > 0) {
							return new Response(JSON.stringify({ error: 'GATE_BLOCKED', rejected: outcome.rejected }), { status: 422, headers: noStore });
						}
						body = Buffer.from(JSON.stringify(outcome.accepted.map((a) => a.element)), 'utf-8');
						if (outcome.rejected.length) reportGateRejected = outcome.rejected;
					}
				}
			} catch (gateErr) {
				console.error('[api/directus proxy] laporanWriteGate error, melanjutkan (fail-open):', gateErr);
			}
		}

		// Gate G_REK_UBAH -- lihat catatan di evaluateRekeningUbahLapangan() di atas.
		// SELALU shadow, tidak pernah blokir -- tidak menahan request, hanya mencatat.
		if (method === 'PATCH' && path.startsWith('items/pengajuan_anggaran/') && body && contentType?.includes('application/json')) {
			const recordId = path.split('/')[2] || '';
			try {
				const parsed = JSON.parse(body.toString('utf-8'));
				const r = await evaluateRekeningUbahLapangan(recordId, parsed);
				if (r) {
					await directusServerJson('/items/gate_audit_log', {
						method: 'POST',
						body: JSON.stringify({
							gate: 'G_REK_UBAH',
							collection: 'items/pengajuan_anggaran',
							method,
							record_id: recordId,
							decision: 'shadow',
							reason: `Rekening penerima diubah setelah status "${r.statusAtEdit}" (proxy lapangan): ${r.changed.map((c) => `${c.field} ${c.before ?? '(kosong)'} → ${c.after ?? '(kosong)'}`).join('; ')}`,
							payload_snapshot: { changed: r.changed },
							user_email: user?.email || null
						})
					}).catch((e) => console.error('[api/directus proxy] Gagal mencatat G_REK_UBAH:', e));
				}
			} catch {
				// body bukan JSON valid -- biarkan Directus sendiri yang menolak
			}
		}

		const upstream = await directusServerFetch(`/${path}${search}`, {
			method,
			body: body as any,
			headers: contentType ? { 'Content-Type': contentType } : {}
		});

		// Status 204/304 tidak boleh punya body per HTTP spec.
		if (upstream.status === 204 || upstream.status === 304) {
			return new Response(null, {
				status: upstream.status,
				headers: { 'Cache-Control': 'no-store' }
			});
		}

		const resContentType = upstream.headers.get('content-type') || '';
		let finalBody: string | Uint8Array = resContentType.includes('application/json')
			? await upstream.text()
			: new Uint8Array(await upstream.arrayBuffer());

		if (upstream.ok && reportGateRejected && typeof finalBody === 'string' && resContentType.includes('application/json')) {
			try {
				const j = JSON.parse(finalBody);
				j.gate_rejected = reportGateRejected;
				finalBody = JSON.stringify(j);
			} catch {
				/* respons bukan JSON valid -- biarkan apa adanya */
			}
		}

		if (isHseIncidentRead && upstream.ok && typeof finalBody === 'string') {
			const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
			const allowed = await canViewHseSensitiveFields(idToken, user!.localId);
			if (!allowed) finalBody = stripHseIncidentSensitiveFields(finalBody);
		}

		// Lanjutan tambal pengajuan_anggaran item tunggal (lihat catatan di atas) -- baris sudah
		// terlanjur diambil dari Directus (tidak bisa difilter lewat query untuk path item
		// tunggal), jadi diperiksa di sini sebelum diteruskan ke pemanggil. Ganti dengan 404
		// generik (bukan 403) supaya tidak mengonfirmasi baris itu ada.
		if (
			isPengajuanAnggaranSingle &&
			pengajuanAnggaranScope &&
			!pengajuanAnggaranScope.unrestricted &&
			upstream.ok &&
			typeof finalBody === 'string'
		) {
			try {
				const parsed = JSON.parse(finalBody);
				const row = parsed?.data;
				if (!isPengajuanAnggaranRowAllowed(row, pengajuanAnggaranScope, user!.email)) {
					return new Response(JSON.stringify({ error: 'Not Found' }), {
						status: 404,
						headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
					});
				}
			} catch {
				// respons bukan JSON valid -- biarkan lolos apa adanya, Directus sendiri yang menentukan
			}
		}

		// Fase 1.3 -- samakan dengan proxy erp-epi (private, max-age=15, stale-while-revalidate=30)
		// untuk GET yang bukan jalur personalisasi di atas. `private` = browser saja yang boleh
		// simpan (bukan shared/CDN cache), jadi tidak bocor lintas user selama device tidak dipakai
		// bergantian dalam window 15 detik.
		// Untuk assets (gambar/dokumen statis), gunakan cache upstream atau cache panjang (24 jam)
		const cacheControlHeader = isAssetRead
			? upstream.headers.get('cache-control') || 'public, max-age=86400, stale-while-revalidate=604800'
			: method === 'GET' && !isPersonalizedGetPath(path)
				? 'private, max-age=15, stale-while-revalidate=30'
				: 'no-store';

		const resHeaders: Record<string, string> = {
			'Content-Type': resContentType || 'application/json',
			'Cache-Control': cacheControlHeader
		};

		const contentDisposition = upstream.headers.get('content-disposition');
		if (contentDisposition) {
			resHeaders['Content-Disposition'] = contentDisposition;
		}

		return new Response(finalBody as any, {
			status: upstream.status,
			headers: resHeaders
		});
	} catch (err: any) {
		console.error('[api/directus proxy]', err);
		const status = typeof err?.status === 'number' ? err.status : 500;
		const message = err?.body?.message || err?.message || 'Internal error';
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
