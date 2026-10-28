import directus, { handleDirectusError } from './directus';
import { readItems, createItem, readItem, updateItem, deleteItem } from '@directus/sdk';
import { getIdToken } from './secureDirectus';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { hasPermission } from '$lib/constants/permissions';
import { runWithRetry, SNAPSHOT_FAILED_WARNING } from './paSnapshotRetry';
import { evaluateSubmitDecision, evaluatePreflightFailOpen, gatesNeedingPernyataan, hasValidPernyataan } from './evaluateSubmitDecision';
import { loadSubmitDecisionEngineMode } from './pengajuanSubmitEngineSettings';
import {
	BUDGET_APPROVED_STATUSES,
	BUDGET_OUTSTANDING_STATUSES,
	BUDGET_PAID_STATUSES,
	BUDGET_REJECTED_STATUSES,
	getBudgetStatusLabel,
} from '$lib/constants/status';


export async function getPengajuanAnggaran(
	limit = 10,
	options: { offset?: number; search?: string; sort?: string; filterStatus?: string; projectIds?: number[] } = {}
) {
	try {
		const filter: Record<string, any> = {};
		
		if (options.search) {
			const q = options.search.trim();
			const searchFilter = {
				_or: [
					{ nomor_pengajuan: { _icontains: q } },
					{ nama_pengaju: { _icontains: q } },
					{ tujuan_pengajuan: { _icontains: q } }
				]
			};
			if (filter._and) {
				filter._and.push(searchFilter);
			} else {
				filter._and = [searchFilter];
			}
		}

		if (options.filterStatus) {
			let statusFilter: any = {};
			// Daftar status diambil dari $lib/constants/status — jangan hardcode di sini.
			// Sebelumnya 'disetujui' hanya cocok ['Verified','Selesai'] (melewatkan 39 baris
			// 'Approved'), dan 'dibayarkan' hanya ['Dibayarkan','Paid'] yang TIDAK PERNAH ada
			// di data sehingga selalu mengembalikan 0 baris walau ada 121 'Completed'.
			if (options.filterStatus === 'menunggu') {
				statusFilter = { status: { _in: BUDGET_OUTSTANDING_STATUSES } };
			} else if (options.filterStatus === 'disetujui') {
				statusFilter = { status: { _in: [...BUDGET_APPROVED_STATUSES] } };
			} else if (options.filterStatus === 'ditolak') {
				statusFilter = { status: { _in: [...BUDGET_REJECTED_STATUSES] } };
			} else if (options.filterStatus === 'dibayarkan') {
				statusFilter = { status: { _in: [...BUDGET_PAID_STATUSES] } };
			} else {
				statusFilter = { status: { _eq: options.filterStatus } };
			}

			if (filter._and) {
				filter._and.push(statusFilter);
			} else {
				filter._and = [statusFilter];
			}
		}

		if (options.projectIds && options.projectIds.length > 0) {
			const projectFilter = { project_id: { _in: options.projectIds } };
			if (filter._and) {
				filter._and.push(projectFilter);
			} else {
				filter._and = [projectFilter];
			}
		}

		const queryOptions: any = {
			limit,
			sort: options.sort ? [options.sort] : ['-date_created']
		};

		if (Object.keys(filter).length > 0) {
			queryOptions.filter = filter;
		}

		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}

		const result = await directus.request(
			readItems('pengajuan_anggaran', queryOptions)
		);
		return result || []; // array directly
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getPengajuanById(id: string | number) {
	try {
		const result = await directus.request(readItem('pengajuan_anggaran', id));
		return result; // object directly
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Generate nomor pengajuan anggaran: PA-YYMM-XXXX.
 *
 * Audit 10 Sep 2026 (erp-epi docs/(analyst) audit-duplikat-nomor-pengajuan-anggaran.md):
 * PA-0303 terduplikat di produksi karena fungsi ini (waktu itu format polos `PA-NNNN`,
 * tanpa tahun-bulan) memakai pola read-then-write non-atomik -- dua submit lapangan
 * hampir bersamaan sama-sama membaca `maxSeq` yang sama sebelum salah satu commit.
 * Dashboard Admin (erp-epi) sudah lebih dulu memakai format `PA-YYMM-NNNN`
 * (generatePengajuanAnggaranNumber() di erp-epi/src/lib/services/budgetRequestApi.js) --
 * format di sini disamakan supaya kedua app menghitung sequence di ruang lingkup yang
 * sama per bulan (bukan dua skema berbeda yang membingungkan pencarian/rekonsiliasi).
 *
 * Perbaikan di sini HANYA mempersempit jendela race (cek ulang keberadaan nomor kandidat
 * tepat sebelum dipakai, retry dengan jitter) -- BUKAN jaminan atomik penuh dari sisi
 * kode. Jaminan penuh berasal dari unique constraint yang SUDAH dipasang di Directus
 * untuk kolom `pengajuan_anggaran.nomor_pengajuan` (10 Sep 2026) -- kalau race ini tetap
 * lolos, `createItem()` di createPengajuanAnggaran() akan gagal dengan error dari
 * Directus (bukan lagi diam-diam terduplikasi), jadi user perlu submit ulang.
 */
export async function generatePengajuanAnggaranNumber() {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const prefix = `PA-${yy}${mm}`;

	// 1. Coba alokasi nomor terpusat dari server endpoint (bebas dari filter RLS proyek)
	try {
		const token = await getIdToken();
		const res = await fetch('/api/pengajuan-anggaran-next-number', {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (res.ok) {
			const data = await res.json();
			if (data?.nomor_pengajuan) {
				return data.nomor_pengajuan;
			}
		}
	} catch (apiErr) {
		console.warn('[finance] Gagal alokasi nomor lewat /api/pengajuan-anggaran-next-number, mencoba fallback Directus:', apiErr);
	}

	// 2. Fallback jika endpoint server tidak merespons
	const MAX_ATTEMPTS = 5;
	try {
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const result = (await directus.request(
				readItems('pengajuan_anggaran', {
					filter: {
						nomor_pengajuan: {
							_starts_with: prefix
						}
					},
					fields: ['nomor_pengajuan'],
					limit: -1
				})
			)) as any[];

			let maxSeq = 0;
			if (result && Array.isArray(result)) {
				result.forEach((p: any) => {
					const parts = (p.nomor_pengajuan || '').split('-');
					const seq = parseInt(parts[parts.length - 1], 10);
					if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
				});
			}

			const candidate = `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;

			// Cek ulang tepat sebelum dipakai -- mempersempit (bukan menutup total) jendela
			// race dengan submit lain yang mungkin sudah commit di antara scan di atas dan
			// baris ini.
			let taken = false;
			try {
				const dupCheck = (await directus.request(
					readItems('pengajuan_anggaran', {
						filter: { nomor_pengajuan: { _eq: candidate } },
						fields: ['id'],
						limit: 1
					})
				)) as any[];
				taken = Array.isArray(dupCheck) && dupCheck.length > 0;
			} catch {
				taken = false;
			}

			if (!taken) return candidate;

			// Sudah diambil submit lain barusan -- tunggu jitter singkat lalu scan ulang
			// dari awal (maxSeq akan ikut naik karena baris baru itu sudah masuk hasil query).
			await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
		}
	} catch (e) {
		// fall through ke fallback di bawah
	}

	const fallback = String(Math.floor(Date.now() / 1000) % 10000).padStart(4, '0');
	return `${prefix}-${fallback}`;
}

// Mapping COA diangkat ke financeCoaMap.ts (file murni tanpa import lain) supaya bisa diuji
// langsung tanpa menyeret runtime SvelteKit/Firebase — di-import ke scope lokal dan di-re-export
// agar call site lama tetap jalan.
import { COA_MAP, resolveCoaForFieldItem } from './financeCoaMap';
export { COA_MAP, resolveCoaForFieldItem };

export interface CreatePengajuanAnggaranOptions {
	preflightResultCached?: any;
	onProgress?: (stage: 'preflight' | 'number' | 'header' | 'items' | 'evaluating_gate' | 'approval') => void;
	/** Peringatan NON-fatal setelah PA tersimpan (mis. snapshot gate gagal tersimpan). Pengajuan tetap sah. */
	onWarning?: (message: string) => void;
}

export async function createPengajuanAnggaran(
	formData: any,
	items: any[],
	options: CreatePengajuanAnggaranOptions = {}
) {
	try {
		// PA-09: apakah pemeriksa gate (preflight) benar-benar menjawab. Dipakai pagar fail-open bertingkat di bawah.
		let preflightAvailable = false;
		// Fase 4a (AI Analysis Engine v2.0): kunci keras gate G1 (department valid) lewat
		// proxy pra-terbang yang sudah ada (Fase 3, /api/pengajuan-preflight — TIDAK diubah).
		// Fail-OPEN bila proxy belum tersedia (ERP_EPI1_BASE_URL kosong) — itu keterbatasan
		// infrastruktur, bukan alasan menahan pengajuan. Hanya block bila gate BENAR-BENAR
		// dievaluasi dan G1 gagal.
		try {
			let preflightResult = options.preflightResultCached;
			if (!preflightResult) {
				options.onProgress?.('preflight');
				const token = await getIdToken();
				const preflightRes = await fetch('/api/pengajuan-preflight', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						department_id: formData.department_id || null,
						project_id: formData.project_id || null,
						kategori: formData.kategori || 'operasional',
						// Fase 3 (Pengajuan Anggaran v3, 22 Agu 2026): kategori_belanja dikirim dari
						// CategoryPicker bila form sudah pakai kategori baru — dipakai server untuk
						// resolusi requires_attachment/spj_batas_hari per budget_category_config.
						kategori_belanja: formData.kategori_belanja || null,
						// Fase 4: field dinamis (so_id/kontrak_id/dst) dibutuhkan G_KOMISI/G_KONTRAK/
						// G_BAST untuk mengevaluasi kategori Gelombang 2 SEBELUM record dibuat.
						dynamic_fields: formData.dynamic_fields || null,
						// G_PO (dibuka kembali 22 Agu 2026): interlockingRulesEngine.js baca ctx.pr_id
						// di level atas, bukan dari dalam dynamic_fields.
						pr_id: formData.dynamic_fields?.pr_id || null,
						items: (items || []).map((it: any) => ({ kategori_item: it.kategori_item, total: it.total ?? (Number(it.quantity) || 0) * (Number(it.harga) || 0) })),
						tanggal_dibutuhkan: formData.tanggal_dibutuhkan || null,
						// Fase 0.1 (Lampiran Otomatis v2, 27 Agu 2026): jumlah nyata dari multi-file
						// (lampiran_file_ids). lampiran_file_id tunggal dipertahankan utk kompat.
						lampiran_count: (formData.lampiran_file_ids?.length || 0) + (formData.lampiran_file_id ? 1 : 0),
						lampiran_exception_reason: formData.lampiran_exception_reason || null,
						lampiran_exception_note: formData.lampiran_exception_note || null
					})
				});
				preflightResult = await preflightRes.json().catch(() => ({ available: false }));
			}
			preflightAvailable = !!preflightResult?.available;
			if (preflightResult?.available) {
				const g1 = (preflightResult.gates || []).find((g: any) => g.gate_key === 'G1');
				if (g1 && g1.status === 'failed') {
					throw new Error(`Pengajuan tidak bisa dikirim: ${g1.message}`);
				}

				const auth = get(authStore);
				const canOverrideProjectData = hasPermission(auth.roleId, 'override_project_data_gate', undefined, auth.roleIds);

				// G9/G10/G11 — kelengkapan data proyek (timeline, laporan harian, manpower).
				// Block keras kecuali actor punya feature 'override_project_data_gate'
				// (khusus role setara General Manager / 'manager' — lihat DEFAULT_ROLE_PERMISSIONS).
				const failedProjectDataGates = (preflightResult.gates || []).filter(
					(g: any) => ['G9', 'G10', 'G11'].includes(g.gate_key) && g.status === 'failed'
				);
				if (failedProjectDataGates.length > 0) {
					if (!canOverrideProjectData) {
						throw new Error(
							`Pengajuan tidak bisa dikirim: ${failedProjectDataGates.map((g: any) => g.message).join('; ')}. Hanya General Manager yang bisa membuka block ini.`
						);
					}
					// Override tercatat ke Activity Log (koleksi bersama dgn admin) — non-fatal.
					try {
						await directus.request(createItem('activity_log', {
							module: 'project',
							collection: 'pengajuan_anggaran',
							action: 'update',
							description: `Override Gerbang Kelengkapan Data Proyek (dari lapangan) untuk project_id=${formData.project_id}: ${failedProjectDataGates.map((g: any) => g.message).join('; ')}`,
							actor_id: auth.user?.uid || 'system',
							actor_name: auth.user?.displayName || auth.user?.email || auth.karyawanName || 'system',
							actor_role: auth.roleId || '',
							changes: { after: { project_id: formData.project_id, failed_gates: failedProjectDataGates.map((g: any) => g.gate_key) } },
							created_at: new Date().toISOString()
						}));
					} catch (logErr) {
						console.warn('[finance] gagal mencatat override ke activity_log (diabaikan):', logErr);
					}
				}

				// G18/G19 (Role Access Management, 25 Agu 2026): block keras TANPA jalur
				// override — kepemilikan proyek (G18) & dept_scope kategori (G19) ditegakkan
				// lewat pengajuan_access_matrix di server, bukan sekadar dropdown client.
				// G_KOMISI/G_KONTRAK/G_BAST (Fase 4, Pengajuan Anggaran v3, 22 Agu 2026): block
				// keras TANPA jalur override, sama pola dgn G17 di sisi admin. Hanya berlaku
				// untuk kategori Gelombang 2 yang mendaftarkannya (komisi_internal/external,
				// subkontraktor_termin) — kategori lain tidak pernah memicu gate ini.
				const failedNewGates = (preflightResult.gates || []).filter(
					(g: any) => ['G18', 'G19', 'G_KOMISI', 'G_KONTRAK', 'G_BAST', 'G_BBM_SPLIT'].includes(g.gate_key) && g.status === 'failed'
				);
				// Dual Gate PA (soft): laporan bolong / MoM belum ada -> wajib pernyataan tertulis.
				const needPernyataan = gatesNeedingPernyataan(preflightResult.gates || []);
				if (needPernyataan.length > 0 && !hasValidPernyataan(formData.dynamic_fields?._gate_pernyataan)) {
					throw new Error(`Pengajuan tidak bisa dikirim: ${needPernyataan.map((g: any) => g.message).join('; ')} Isi pernyataan tertulis (minimal 20 karakter) di panel "Periksa Sebelum Kirim", atau lengkapi laporannya.`);
				}
				const legacyBlockingMessages = [
					...(canOverrideProjectData ? [] : failedProjectDataGates.map((g: any) => g.message)),
					...failedNewGates.map((g: any) => g.message)
				];

				// Fase 1 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — "Satu Otak
				// Penegakan". Mesin baru (bukan daftar gate_key hardcode di atas) supaya
				// konfigurasi Panel Kalibrasi Gate langsung berlaku di lapangan. Flag
				// app_settings.pengajuan.submit_decision_engine menentukan mana yang benar2
				// menentukan blokir — default 'shadow' TIDAK mengubah perilaku (legacy tetap
				// berlaku), hanya mencatat kalau kedua mesin berbeda hasil (observabilitas
				// sebelum admin memutuskan pindah ke 'on').
				try {
					const engineMode = await loadSubmitDecisionEngineMode();
					const decision = evaluateSubmitDecision(preflightResult.gates || [], { canOverrideProjectData });
					const engineBlockingMessages = decision.blockedForActor.map((g) => g.message || g.gate_key);
					// overridable G4/G8/G20 (alasan pengecualian) sudah tervalidasi terpisah oleh
					// form (lampiran_exception_reason ≥20 karakter) sebelum sampai sini — di sini
					// hanya dicatat lewat decision.overridable, tidak menambah blokir baru.

					if (engineMode === 'shadow' || engineMode === 'legacy') {
						const legacySet = new Set(legacyBlockingMessages);
						const engineSet = new Set(engineBlockingMessages);
						const differs =
							legacySet.size !== engineSet.size ||
							[...legacySet].some((m) => !engineSet.has(m)) ||
							[...engineSet].some((m) => !legacySet.has(m));
						if (differs) {
							await directus.request(createItem('activity_log', {
								module: 'project',
								collection: 'pengajuan_anggaran',
								action: 'update',
								description: `[submit_decision_engine=${engineMode}] Mesin baru & lama berbeda hasil untuk project_id=${formData.project_id}. Legacy blokir: ${legacyBlockingMessages.join('; ') || '(tidak ada)'}. Mesin baru blokir: ${engineBlockingMessages.join('; ') || '(tidak ada)'}.`,
								actor_id: 'system',
								actor_name: 'system',
								actor_role: '',
								changes: { after: { project_id: formData.project_id, legacy: legacyBlockingMessages, engine: engineBlockingMessages } },
								created_at: new Date().toISOString()
							})).catch((e) => console.warn('[finance] gagal mencatat would_block_diff (diabaikan):', e));
						}
						if (legacyBlockingMessages.length > 0) {
							throw new Error(`Pengajuan tidak bisa dikirim: ${legacyBlockingMessages.join('; ')}`);
						}
					} else {
						// engineMode === 'on' — mesin baru yang menentukan.
						if (engineBlockingMessages.length > 0) {
							throw new Error(`Pengajuan tidak bisa dikirim: ${engineBlockingMessages.join('; ')}`);
						}
					}
				} catch (engineErr: any) {
					if (String(engineErr?.message || '').startsWith('Pengajuan tidak bisa dikirim')) throw engineErr;
					// Setelan/engine gagal dimuat — fail-open ke legacy supaya submit tidak
					// pernah tertahan gara-gara infrastruktur observability.
					console.warn('[finance] submit_decision_engine gagal dievaluasi (fail-open ke legacy):', engineErr);
					if (legacyBlockingMessages.length > 0) {
						throw new Error(`Pengajuan tidak bisa dikirim: ${legacyBlockingMessages.join('; ')}`);
					}
				}
			}
		} catch (preflightError: any) {
			// Hanya lempar ulang bila ini benar-benar penolakan G1 (pesan diawali
			// "Pengajuan tidak bisa dikirim"). Kegagalan jaringan/proxy lainnya diabaikan
			// (fail-open), sama seperti panel "Periksa Sebelum Kirim" di form.
			if (String(preflightError?.message || '').startsWith('Pengajuan tidak bisa dikirim')) {
				throw preflightError;
			}
			console.warn('[finance] pre-flight gate check gagal (diabaikan, fail-open):', preflightError);
		}

		// PA-09 butir 3: fail-open hanya untuk nominal kecil / ada alasan tertulis (form menyimpannya di
		// dynamic_fields._preflight_fail_open_reason). Di atas itu: tolak, jangan loloskan diam-diam.
		const failOpenCheck = evaluatePreflightFailOpen({
			available: preflightAvailable,
			total: formData.total_amount,
			reason: formData.dynamic_fields?._preflight_fail_open_reason
		});
		if (!failOpenCheck.ok) throw new Error(failOpenCheck.message);

		// PA-16: jumlah kosong/0 TIDAK lagi diam-diam menjadi 1, dan total header = Σ(jumlah × harga) item yang
		// benar-benar dikirim (bukan angka dari form), supaya nominal penentu tier approval didukung rincian.
		for (const it of items || []) {
			if (!(Number(it.quantity) > 0)) {
				throw new Error(`Jumlah untuk "${it.deskripsi || 'item'}" wajib diisi dan lebih dari 0.`);
			}
		}
		const totalDariItem = (items || []).reduce((sum: number, it: any) => sum + Number(it.quantity) * (Number(it.harga) || 0), 0);

		// 1. Generate nomor_pengajuan
		options.onProgress?.('number');
		let nomorPengajuan = await generatePengajuanAnggaranNumber();

		// 2. Submit parent record
		options.onProgress?.('header');
		const parentData = {
			nomor_pengajuan: nomorPengajuan,
			pengaju_id: formData.pengaju_id || null,
			nama_pengaju: formData.nama_pengaju,
			department: formData.department || 'Project',
			department_id: formData.department_id || null,
			kategori: formData.kategori,
			kategori_belanja: formData.kategori_belanja || null,
			dynamic_fields: formData.dynamic_fields || null,
			// G_PO / sync Pembelian↔Anggaran (dibuka kembali 22 Agu 2026): pr_id sebelumnya
			// hook dorman. Sumber: field dinamis "PR Terkait" kategori material_supplier.
			pr_id: formData.dynamic_fields?.pr_id || null,
			urgency: formData.urgency || 'Normal',
			tujuan_pengajuan: formData.tujuan_pengajuan,
			tanggal_dibutuhkan: formData.tanggal_dibutuhkan,
			payment_method: formData.payment_method || 'Transfer',
			total_amount: totalDariItem,
			comments: formData.comments || '',
			project_id: formData.project_id,
			// Fase 0.3 (Penajaman Pengajuan Anggaran v2, 18 Agu 2026): sisi lapangan tidak
			// pernah mengisi budget_axis — ini akar kenapa ratusan record produksi dari jalur
			// ini butuh backfill manual. project_id menentukan sumbu (project = RAB, kosong =
			// pagu department); department_id tetap boleh terisi bersamaan (pemilik biaya).
			budget_axis: formData.project_id ? 'project' : 'department',
			penerima_dana_type: formData.penerima_dana_type || null,
			penerima_dana_nama: formData.penerima_dana_nama || '',
			bank_name: formData.bank_name || '',
			bank_account_number: formData.bank_account_number || '',
			bank_account_name: formData.bank_account_name || '',
			// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep)
			rekening_penerima_id: formData.rekening_penerima_id || null,
			created_by_email: formData.created_by_email || null,
			// PC3-08 (FLD-11): kategori petty_cash wajib membawa dana tujuan isi ulang — tanpa ini sistem menebak fund dari departemen.
			petty_cash_fund_id: formData.petty_cash_fund_id || null,
			// Fase 3 (AI Analysis Engine v2.0): lampiran sungguhan, sebelumnya kotak
			// dekoratif tanpa fungsi di form ini — M2M sama seperti sisi admin.
			// Fase 0.1 (27 Agu 2026): multi-file (lampiran_file_ids). Pola persis
			// budgetRequestApi.js::submitPengajuanAnggaran di admin; single tetap didukung.
			lampiran:
				formData.lampiran_file_ids && formData.lampiran_file_ids.length > 0
					? formData.lampiran_file_ids.map((fileId: string) => ({ directus_files_id: fileId }))
					: formData.lampiran_file_id
						? [{ directus_files_id: formData.lampiran_file_id }]
						: [],
			// Fase 0.5: alasan pengecualian terstruktur bila lampiran benar-benar tidak ada
			// untuk kategori yang mewajibkannya (G8) — lihat anggaran/baru/+page.svelte.
			lampiran_exception_reason: formData.lampiran_exception_reason || null,
			lampiran_exception_note: formData.lampiran_exception_note || null,
			// Pengajuan Darurat Atas Nama (dari lapangan, Leader/Wakil/Supervisor): ditahan sampai pemohon konfirmasi.
			// Otorisasi ditegakkan server di /api/pengajuan-atas-nama/finalisasi (tidak sah -> PA dibatalkan otomatis).
			...(formData.is_on_behalf
				? {
						status: 'Menunggu Konfirmasi Pemohon',
						is_on_behalf: true,
						pemohon_status: 'menunggu',
						pengaju_id: formData.pengaju_id,
						pengisi_karyawan_id: formData.pengisi_karyawan_id,
						alasan_darurat: formData.alasan_darurat
					}
				: { status: 'Pending' }),
			finance_processed: false
		};

		// Lapis kedua anti-duplikat nomor (audit PA-0303, erp-epi docs/(analyst)
		// audit-duplikat-nomor-pengajuan-anggaran.md, 10 Sep 2026): generatePengajuanAnggaranNumber()
		// mempersempit race-nya, dan unique constraint di Directus (nomor_pengajuan) mencegah
		// duplikat tersimpan -- tapi itu berarti create() BISA gagal kalau kandidat sempat
		// direbut submit lain persis di antara pre-check dan insert. Retry dengan nomor baru
		// sebelum menyerah, supaya user lapangan tidak melihat error mentah dari Directus
		// untuk kejadian yang sebetulnya bisa pulih sendiri.
		let createdParent: any = null;
		const MAX_CREATE_ATTEMPTS = 3;
		for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
			try {
				createdParent = await directus.request(createItem('pengajuan_anggaran', { ...parentData, nomor_pengajuan: nomorPengajuan }));
				break;
			} catch (createErr: any) {
				const msg = String(createErr?.errors?.[0]?.message || createErr?.message || '').toLowerCase();
				const isUniqueViolation = msg.includes('unique') || msg.includes('duplicate');
				if (!isUniqueViolation || attempt === MAX_CREATE_ATTEMPTS - 1) throw createErr;
				console.warn(`[finance] nomor_pengajuan ${nomorPengajuan} bentrok saat create, generate ulang & retry...`);
				nomorPengajuan = await generatePengajuanAnggaranNumber();
			}
		}
		if (!createdParent || !createdParent.id) {
			throw new Error('Gagal membuat header pengajuan anggaran.');
		}

		const parentId = createdParent.id;

		// 3. Submit items (separated for each relation)
		options.onProgress?.('items');
		for (const item of items) {
			const resolvedCoa = resolveCoaForFieldItem(item, formData.kategori_belanja);
			const itemPayload = {
				pengajuan_anggaran_id: parentId,
				deskripsi: item.deskripsi || '',
				kategori_item: item.kategori_item || 'lain_lain',
				vendor_name: item.vendor_name || '',
				quantity: Number(item.quantity) || 1,
				units: item.units || 'Pcs',
				harga: Number(item.harga) || 0,
				total: (Number(item.quantity) || 1) * (Number(item.harga) || 0),
				notes: item.notes || '',
				account_code: resolvedCoa
			};
			const createdItem = (await directus.request(createItem('items_pengajuan_anggaran', itemPayload))) as any;
			// Guard: pastikan pengajuan_anggaran_id tersimpan dan tidak terlepas
			if (createdItem && createdItem.id && createdItem.pengajuan_anggaran_id !== parentId) {
				console.warn(`[createPengajuanAnggaran] Item #${createdItem.id} pengajuan_anggaran_id tidak cocok. Fallback update...`);
				await directus.request(updateItem('items_pengajuan_anggaran', createdItem.id, {
					pengajuan_anggaran_id: parentId
				})).catch((e: any) => console.error('[createPengajuanAnggaran] Fallback patch failed:', e));
			}
		}

		// 3.5 Evaluasi & simpan snapshot gate (audit 10 Sep 2026): sebelum ini, PA dari
		// Dashboard Lapangan TIDAK PERNAH memanggil evaluateInterlockingGates setelah
		// dibuat -- interlocking_status/interlocking_gates tetap NULL selamanya kecuali
		// admin membuka Gate Wizard manual. paApprovalGate.js (erp-epi) membaca array
		// gate kosong sebagai "tidak ada yang gagal" (fail-open), jadi gate WAJIB (G1-G20)
		// tidak pernah ditegakkan untuk seluruh jalur submit lapangan. Pola di sini
		// identik dgn evaluateInterlockingGates() di erp-epi budgetRequestApi.js: panggil
		// endpoint validate admin (lewat proxy pengajuan-preflight yang sudah ada), lalu
		// PATCH hasilnya balik ke record. Best-effort -- kegagalan di sini TIDAK boleh
		// menggagalkan pengajuan yang sudah tersimpan.
		// Audit hidden cost #1051 (20 Okt 2026): dulu kegagalan hanya console.warn sehingga PA (mis. PA-2610-0166)
		// masuk antrean approval TANPA snapshot dan tidak ada yang tahu. Sekarang: retry 1x, lalu bila tetap gagal
		// (a) penyebab dicatat ke gate_audit_log via server, (b) pengaju diberi peringatan (onWarning). PA tetap sah.
		options.onProgress?.('evaluating_gate');
		const snapshot = await runWithRetry(async () => {
			const token = await getIdToken();
			const evalRes = await fetch('/api/pengajuan-preflight', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ pengajuan_id: parentId })
			});
			const evalResult = await evalRes.json().catch(() => ({ available: false }));
			if (!(evalRes.ok && evalResult.available && evalResult.status)) {
				throw new Error(evalResult.reason || `Pemeriksa gate membalas ${evalRes.status}`);
			}
			await directus.request(
				updateItem('pengajuan_anggaran', parentId, {
					interlocking_status: evalResult.status,
					interlocking_gates: evalResult.gates,
					threshold_tier: evalResult.tier,
					budget_check_result: evalResult.budget,
					kategori_belanja: evalResult.kategori_belanja
				})
			);
		});
		if (!snapshot.ok) {
			console.warn('[finance] snapshot gate gagal tersimpan setelah retry untuk pengajuan', parentId, ':', snapshot.error?.message);
			// Pelaporan audit juga best-effort: tidak boleh menggagalkan pengajuan.
			getIdToken()
				.then((token) =>
					fetch('/api/pengajuan-anggaran-snapshot-gagal', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
						body: JSON.stringify({ pengajuan_id: parentId, attempts: snapshot.attempts, error: snapshot.error?.message || '' })
					})
				)
				.catch((e) => console.warn('[finance] gagal melaporkan kegagalan snapshot gate (diabaikan):', e?.message));
			options.onWarning?.(SNAPSHOT_FAILED_WARNING);
		}

		// 4. Daftarkan ke Approval Engine admin (25 Agu 2026 — akar bug PA-0257: sebelum
		// ini, record dari lapangan TIDAK PERNAH terdaftar ke approval_requests, sehingga
		// admin tidak pernah melihat stepper/tombol approve dan pengajuan menggantung
		// "Pending" selamanya). WAJIB berhasil, sama filosofi dengan sisi admin
		// (submitPengajuanAnggaran::budgetRequestApi.js) — record yang sudah tersimpan
		// TIDAK dihapus kalau ini gagal (menghindari kehilangan data pengaju), tapi
		// pemanggil diberi tahu tegas supaya tidak mengira pengajuan sudah lengkap.
		options.onProgress?.('approval');
		if (formData.is_on_behalf) {
			// Atas Nama: JANGAN daftar ke approval. Server memvalidasi wewenang lalu memberi tahu pemohon.
			const token = await getIdToken();
			const finRes = await fetch('/api/pengajuan-atas-nama/finalisasi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
				body: JSON.stringify({ pengajuanId: parentId })
			});
			if (!finRes.ok) {
				const errBody = await finRes.json().catch(() => ({}));
				throw new Error(errBody?.message || 'Pengajuan atas nama ditolak server (' + finRes.status + ').');
			}
			return createdParent;
		}
		try {
			const token = await getIdToken();
			const approvalRes = await fetch('/api/pengajuan-anggaran-submit-approval', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					pengajuanId: parentId,
					nomorPengajuan,
					totalAmount: totalDariItem,
					departmentKey: formData.department || null,
					summary: formData.tujuan_pengajuan || formData.comments || null,
					requesterId: formData.pengaju_id || null
				})
			});
			if (!approvalRes.ok) {
				const errBody = await approvalRes.json().catch(() => ({}));
				throw new Error(errBody?.message || `Admin membalas ${approvalRes.status}`);
			}
		} catch (approvalError: any) {
			console.error('[finance] gagal mendaftarkan pengajuan ke Approval Engine:', approvalError);
			throw new Error(
				`Pengajuan ${nomorPengajuan} tersimpan tapi GAGAL didaftarkan ke alur approval: ${approvalError?.message || 'error tidak diketahui'}. Hubungi Admin untuk didaftarkan manual — JANGAN kirim ulang pengajuan yang sama.`
			);
		}

		return createdParent;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getPengajuanItems(pengajuanId: string | number) {
	try {
		const result = await directus.request(
			readItems('items_pengajuan_anggaran', {
				filter: {
					pengajuan_anggaran_id: {
						_eq: Number(pengajuanId)
					}
				},
				limit: -1
			})
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Sisakan 4 digit terakhir — rekening TIDAK PERNAH disimpan lengkap di riwayat edit. */
function maskRekeningLapangan(v: unknown): string | null {
	const digits = String(v ?? '').replace(/\D+/g, '');
	if (!digits) return null;
	return digits.length >= 4 ? `****${digits.slice(-4)}` : `****${digits}`;
}

/** Kolom rekening yang dilacak di __edit_history — pola sama budgetRequestApi.js (erp-epi). */
const REKENING_EDIT_FIELDS_LAPANGAN: Array<[string, (v: unknown) => unknown]> = [
	['penerima_dana_type', (v) => v ?? null],
	['penerima_dana_nama', (v) => v || null],
	['bank_name', (v) => v || null],
	['bank_account_number', maskRekeningLapangan],
	['bank_account_name', (v) => v || null],
	['rekening_penerima_id', (v) => v ?? null]
];

export async function updatePengajuanAnggaran(id: string | number, formData: any, items: any[]) {
	try {
		// Penajaman Penerima Dana & Track Record v2, Fase 2 (11 Sep) — celah terbesar
		// dari audit Fase 0: perubahan rekening lewat form lapangan TIDAK tercatat sama
		// sekali (beda dgn admin erp-epi yang sudah punya __edit_history sejak R3). Ambil
		// nilai "sebelum" dulu supaya bisa dibandingkan; best-effort — kegagalan di sini
		// TIDAK BOLEH menggagalkan update aslinya (Aturan #7, fail-open).
		let existing: any = null;
		try {
			existing = await directus.request(
				readItem('pengajuan_anggaran', id, {
					fields: ['status', 'dynamic_fields', 'penerima_dana_type', 'penerima_dana_nama', 'bank_name', 'bank_account_number', 'bank_account_name', 'is_on_behalf', 'pemohon_status']
				})
			);
		} catch (e) {
			console.warn('[updatePengajuanAnggaran] Gagal ambil data lama untuk riwayat edit rekening:', e);
		}

		const rekeningChanges: Array<{ field: string; before: unknown; after: unknown }> = [];
		if (existing) {
			for (const [field, fmt] of REKENING_EDIT_FIELDS_LAPANGAN) {
				const afterRaw = (formData as Record<string, unknown>)[field];
				if (afterRaw === undefined) continue;
				const beforeRaw = existing[field];
				if (String(beforeRaw ?? '') === String(afterRaw ?? '')) continue;
				rekeningChanges.push({ field, before: fmt(beforeRaw), after: fmt(afterRaw) });
			}
		}

		// 1. Update parent record
		const parentData: Record<string, any> = {
			nama_pengaju: formData.nama_pengaju,
			department: formData.department || 'Project',
			kategori: formData.kategori,
			urgency: formData.urgency || 'Normal',
			tujuan_pengajuan: formData.tujuan_pengajuan,
			tanggal_dibutuhkan: formData.tanggal_dibutuhkan,
			payment_method: formData.payment_method || 'Transfer',
			total_amount: formData.total_amount,
			comments: formData.comments || '',
			project_id: formData.project_id,
			penerima_dana_type: formData.penerima_dana_type || null,
			penerima_dana_nama: formData.penerima_dana_nama || '',
			bank_name: formData.bank_name || '',
			bank_account_number: formData.bank_account_number || '',
			bank_account_name: formData.bank_account_name || '',
			created_by_email: formData.created_by_email || null,
			status: 'Pending',
			finance_processed: false
		};
		// Penajaman Penerima Dana & Track Record v2, Fase 4 — hanya dipatch bila form
		// eksplisit mengirimnya (picker baru), tak menimpa tautan lama dgn null.
		if (formData.rekening_penerima_id !== undefined) {
			parentData.rekening_penerima_id = formData.rekening_penerima_id || null;
		}

		if (rekeningChanges.length && existing) {
			const prevDf = (existing.dynamic_fields && typeof existing.dynamic_fields === 'object') ? existing.dynamic_fields : {};
			const hist = Array.isArray((prevDf as any).__edit_history) ? (prevDf as any).__edit_history : [];
			parentData.dynamic_fields = {
				...prevDf,
				__edit_history: [
					...hist.slice(-9),
					{
						at: new Date().toISOString(),
						editedBy: formData.created_by_email || 'lapangan',
						changes: rekeningChanges,
						// status SAAT edit ini terjadi (sebelum di-reset ke Pending di atas) —
						// dasar banner "rekening diubah setelah disetujui" di erp-epi.
						statusAtEdit: existing.status || null
					}
				]
			};
		}

		// Pengajuan Darurat Atas Nama: JANGAN timpa identitas pemohon (nama_pengaju) dengan nama pengedit, dan JANGAN
		// loncat ke 'Pending' saat masih menunggu konfirmasi (itu melewati tanda tangan pemohon). Isi yang berubah
		// setelah pemohon menandatangani dicatat di __edit_history (tampil sebagai peringatan di cetakan).
		if (existing?.is_on_behalf) {
			delete parentData.nama_pengaju;
			if (existing.status === 'Menunggu Konfirmasi Pemohon') parentData.status = existing.status;
			if (existing.pemohon_status === 'disetujui') {
				const prevDf2 = (parentData.dynamic_fields ?? existing.dynamic_fields ?? {}) as Record<string, any>;
				const hist2 = Array.isArray(prevDf2.__edit_history) ? prevDf2.__edit_history : [];
				parentData.dynamic_fields = {
					...prevDf2,
					__edit_history: [
						...hist2.slice(-9),
						{ at: new Date().toISOString(), editedBy: formData.created_by_email || 'lapangan', changes: [{ field: 'isi_pengajuan' }], statusAtEdit: existing.status || null }
					]
				};
			}
		}

		await directus.request(updateItem('pengajuan_anggaran', id, parentData));

		// 2. Fetch existing items
		const existingItems = await getPengajuanItems(id);

		// 3. Delete existing items
		for (const item of existingItems) {
			if (item.id) {
				await directus.request(deleteItem('items_pengajuan_anggaran', item.id));
			}
		}

		// 4. Create new/updated items
		for (const item of items) {
			const resolvedCoa = resolveCoaForFieldItem(item, formData.kategori_belanja);
			const itemPayload = {
				pengajuan_anggaran_id: Number(id),
				deskripsi: item.deskripsi || '',
				kategori_item: item.kategori_item || 'lain_lain',
				vendor_name: item.vendor_name || '',
				quantity: Number(item.quantity) || 1,
				units: item.units || 'Pcs',
				harga: Number(item.harga) || 0,
				total: (Number(item.quantity) || 1) * (Number(item.harga) || 0),
				notes: item.notes || '',
				account_code: resolvedCoa
			};
			const createdItem = await directus.request(createItem('items_pengajuan_anggaran', itemPayload)) as any;
			if (createdItem && createdItem.id && createdItem.pengajuan_anggaran_id !== Number(id)) {
				console.warn(`[updatePengajuanAnggaran] Item #${createdItem.id} pengajuan_anggaran_id mismatch. Fallback update...`);
				await directus.request(updateItem('items_pengajuan_anggaran', createdItem.id, {
					pengajuan_anggaran_id: Number(id)
				})).catch((e: any) => console.error('[updatePengajuanAnggaran] Fallback patch failed:', e));
			}
		}

		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

export async function approvePengajuan(id: string | number, approvedBy: string, jumlahDisetujui?: number) {
	try {
		const data: Record<string, any> = {
			status: 'Verified',
			project_finance_approved_by: approvedBy,
			project_finance_approved_date: new Date().toISOString()
		};
		if (jumlahDisetujui !== undefined && jumlahDisetujui > 0) {
			data.jumlah_disetujui = jumlahDisetujui;
		}
		await directus.request(updateItem('pengajuan_anggaran', id, data));
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false };
	}
}

/**
 * "Cek Ulang" (Fase 3, Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — evaluasi
 * ulang snapshot interlocking_gates lewat proxy /api/pengajuan-anggaran-reevaluate
 * (admin erp-epi-1). Dipakai saat pengaju/approver melengkapi data setelah pengajuan
 * terkirim, supaya tidak terjebak snapshot basi (lihat catatan di paGateSnapshot.js).
 */
export async function reevaluatePengajuanGates(id: string | number): Promise<{ success: boolean; status?: string; gates?: any[]; message?: string }> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/pengajuan-anggaran-reevaluate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ pengajuan_id: id })
		});
		const result = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { success: false, message: result?.message || 'Cek Ulang gagal — coba lagi.' };
		}
		return { success: true, status: result.status, gates: result.gates };
	} catch (e: any) {
		return { success: false, message: e?.message || 'Tidak dapat menghubungi server — coba lagi.' };
	}
}

export async function rejectPengajuan(id: string | number, rejectedBy: string, rejectReason: string) {
	try {
		await directus.request(updateItem('pengajuan_anggaran', id, {
			status: 'Ditolak',
			project_finance_approved_by: rejectedBy,
			project_finance_approved_date: new Date().toISOString(),
			reject_reason: rejectReason
		}));
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false };
	}
}

// ==================== Fase 2 — Lifecycle Bukti Bayar ====================

/**
 * Bukti transfer & tanggal bayar dari supplier_payments (admin erp-epi-1), dijahit lewat
 * purchase_invoices.reference_number == pengajuan_anggaran.nomor_pengajuan (kunci join yang
 * sama dipakai syncPengajuanPaymentStatus() di sisi admin). Best-effort — kembalikan null
 * kalau invoice/payment belum ada atau tautan gagal (mis. reimbursement lama tanpa link).
 *
 * Baris legacy: nomor_pengajuan NULL -> reference_number payable dibuat dgn fallback
 * sintetis 'PA-<id>' (getPengajuanReferenceNumber di erp-epi/budgetRequestApi.js). Kalau
 * pengajuanId disediakan, jatuhkan ke pola yang sama supaya bukti bayar tetap ketemu.
 */
export async function getBuktiBayarInfo(
	nomorPengajuan: string | null | undefined,
	pengajuanId?: string | number | null
) {
	const refNumber = nomorPengajuan || (pengajuanId ? `PA-${pengajuanId}` : null);
	let invoiceId: number | string | null = null;

	if (refNumber) {
		try {
			const invoices = (await directus.request(
				readItems('purchase_invoices' as any, {
					filter: { reference_number: { _eq: refNumber } },
					fields: ['id'],
					limit: 1
				})
			)) as any[];
			invoiceId = invoices?.[0]?.id ?? null;
		} catch (error) {
			console.warn('[finance] Gagal mencari invoice via reference_number:', error);
		}
	}

	// PA-Rilis Hutang v2 (Fase 4, K8) — untuk PA-Rilis, reference_number invoice TETAP
	// nilai aslinya (bukan nomor PA), jadi lookup di atas TIDAK PERNAH cocok. Jahit lewat
	// source_payable_id sebagai fallback — sama pola dgn syncPengajuanFromSourcePayable
	// di erp-epi.
	if (!invoiceId && pengajuanId) {
		try {
			const pa = (await directus.request(
				readItem('pengajuan_anggaran', pengajuanId, { fields: ['source_payable_id'] })
			)) as any;
			const sourceId =
				pa?.source_payable_id && typeof pa.source_payable_id === 'object'
					? pa.source_payable_id.id
					: pa?.source_payable_id;
			if (sourceId) invoiceId = sourceId;
		} catch (error) {
			console.warn('[finance] Gagal mencari invoice via source_payable_id:', error);
		}
	}

	if (!invoiceId) return null;

	try {
		const payments = (await directus.request(
			readItems('supplier_payments' as any, {
				filter: { purchase_invoice_id: { _eq: invoiceId } },
				fields: ['id', 'payment_date', 'payment_amount', 'bukti_bayar'],
				sort: ['-payment_date'],
				limit: 1
			})
		)) as any[];
		const payment = payments?.[0];
		if (!payment) return null;

		return {
			payment_date: payment.payment_date as string | null,
			payment_amount: payment.payment_amount as number | null,
			bukti_bayar: payment.bukti_bayar as string | null
		};
	} catch (error) {
		console.warn('[finance] Gagal memuat bukti bayar:', error);
		return null;
	}
}

// ==================== PA-Rilis Hutang v2 (Fase 4) — Dashboard Lapangan ====================

/**
 * Tagihan supplier outstanding (purchase_invoices) untuk proyek yang ditugaskan ke
 * user saat ini. Dipakai `/hutang-proyek` (daftar read-only) dan PayablePickerLite.svelte
 * (form `/anggaran/baru`). Query datar, satu request — bukan per-proyek.
 *
 * @param projectIds id proyek yang boleh dilihat user ini (dari getProjectsForCurrentUser)
 */
export async function fetchOutstandingPayablesForProject(projectIds: (number | string)[]) {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const result = (await directus.request(
			readItems('purchase_invoices' as any, {
				filter: {
					project_id: { _in: projectIds },
					payment_status: { _in: ['UNPAID', 'PARTIAL'] }
				},
				fields: [
					'id', 'invoice_number', 'supplier_name', 'total_amount', 'paid_amount',
					'outstanding_amount', 'due_date', 'invoice_date', 'project_id', 'supplier_po_id',
					'payment_urgency', 'scheduled_payment_date'
				],
				sort: ['due_date'],
				limit: -1
			})
		)) as any[];
		return result || [];
	} catch (error) {
		console.warn('[finance] Gagal memuat tagihan outstanding proyek:', error);
		return [];
	}
}

/**
 * Konteks barang per PO untuk daftar hutang proyek: nama barang + qty diterima.
 * Query datar per-chunk (tanpa relasi bersarang). Gagal -> peta kosong (halaman tetap tampil).
 * @returns peta po_id -> baris item PO
 */
export async function fetchPoItemsContext(poIds: (number | string)[]) {
	const ids = [...new Set((poIds || []).filter((v) => v != null && v !== ''))];
	const out: Record<string, any[]> = {};
	const CHUNK = 40;
	for (let i = 0; i < ids.length; i += CHUNK) {
		try {
			const rows = (await directus.request(
				readItems('purchase_order_supplier_items' as any, {
					filter: { po_id: { _in: ids.slice(i, i + CHUNK) } },
					fields: ['id', 'po_id', 'item_name', 'quantity', 'unit', 'received_qty'],
					limit: -1
				})
			)) as any[];
			for (const r of rows || []) {
				const key = String(typeof r.po_id === 'object' ? r.po_id?.id : r.po_id);
				(out[key] ||= []).push(r);
			}
		} catch (error) {
			console.warn('[finance] Gagal memuat item PO untuk hutang proyek:', error);
		}
	}
	return out;
}

/**
 * PA-Rilis Hutang AKTIF (belum final) per tagihan — dipakai `/hutang-proyek` untuk badge
 * progres & mencegah pengajuan rilis ganda (tombol "Ajukan Rilis" dinonaktifkan kalau sudah
 * ada baris di sini). Query SATU batch (`source_payable_id._in`), bukan per-tagihan (Aturan
 * "Fetching Relasi Dipisah" — hemat, flat).
 *
 * "Aktif" = status masuk BUDGET_OUTSTANDING_STATUSES ($lib/constants/status, sumber
 * kebenaran tunggal status pengajuan_anggaran di app ini) — PERSIS definisi yang dipakai
 * gate G_RILIS_DUP di erp-epi (rilisHutangGate.js): status TIDAK termasuk Rejected/Ditolak,
 * Completed/Selesai/Dibayarkan/Paid/Dibukukan, atau Dibatalkan.
 *
 * @param invoiceIds id purchase_invoices yang sedang ditampilkan (dari fetchOutstandingPayablesForProject)
 * @returns peta invoice_id (string) -> { pengajuanId, nomorPengajuan, status, label }
 */
export async function fetchActiveRilisForInvoices(
	invoiceIds: (number | string)[]
): Promise<Record<string, { pengajuanId: number; nomorPengajuan: string | null; status: string; label: string }>> {
	const ids = [...new Set((invoiceIds || []).filter((v) => v != null && v !== ''))];
	const out: Record<string, { pengajuanId: number; nomorPengajuan: string | null; status: string; label: string }> = {};
	if (ids.length === 0) return out;
	try {
		const rows = (await directus.request(
			readItems('pengajuan_anggaran', {
				filter: {
					source_payable_id: { _in: ids },
					status: { _in: [...BUDGET_OUTSTANDING_STATUSES] }
				},
				fields: ['id', 'nomor_pengajuan', 'status', 'source_payable_id'],
				sort: ['-id'],
				limit: -1
			})
		)) as any[];
		for (const r of rows || []) {
			const invoiceId = String(typeof r.source_payable_id === 'object' ? r.source_payable_id?.id : r.source_payable_id);
			if (!invoiceId || out[invoiceId]) continue; // -id sort: baris pertama per tagihan = PA-Rilis terbaru
			out[invoiceId] = {
				pengajuanId: r.id,
				nomorPengajuan: r.nomor_pengajuan ?? null,
				status: r.status,
				label: getBudgetStatusLabel(r.status)
			};
		}
	} catch (error) {
		console.warn('[finance] Gagal memuat PA-Rilis aktif untuk tagihan:', error);
	}
	return out;
}

/**
 * Status antrian bayar tagihan sumber sebuah PA-Rilis — dipakai pelacak status di
 * `/anggaran/[id]`: Diajukan → Disetujui → **Masuk Antrian Bayar** → Dibayar. Dijahit
 * lewat `source_payable_id` (K8, sama pola dgn getBuktiBayarInfo di atas).
 */
export async function fetchPayableQueueStatus(pengajuanId: string | number) {
	try {
		const pa = (await directus.request(
			readItem('pengajuan_anggaran', pengajuanId, { fields: ['source_payable_id'] })
		)) as any;
		const sourceId =
			pa?.source_payable_id && typeof pa.source_payable_id === 'object' ? pa.source_payable_id.id : pa?.source_payable_id;
		if (!sourceId) return null;

		const invoice = (await directus.request(
			readItem('purchase_invoices' as any, sourceId, {
				fields: ['id', 'payment_urgency', 'scheduled_payment_date', 'payment_status']
			})
		)) as any;
		return invoice
			? {
					payment_urgency: invoice.payment_urgency as string | null,
					scheduled_payment_date: invoice.scheduled_payment_date as string | null,
					payment_status: invoice.payment_status as string | null
				}
			: null;
	} catch (error) {
		console.warn('[finance] Gagal memuat status antrian bayar PA-Rilis:', error);
		return null;
	}
}

/** Pengaju konfirmasi dana sudah diterima di rekening. Field terpisah — lihat catatan di skema `dana_diterima_at`. */
export async function confirmDanaDiterima(id: string | number) {
	try {
		await directus.request(updateItem('pengajuan_anggaran', id, {
			dana_diterima_at: new Date().toISOString()
		}));
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false };
	}
}
