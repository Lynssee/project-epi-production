// src/lib/server/returGudangServer.ts
// 4-Gate System "Surat Jalan Pengembalian & Kontrol Aset Proyek" — Rencana v2, Fase 2.
// Sisi server dashboard lapangan: membungkus baris packing_returns yang baru dibuat leader
// menjadi SATU dokumen retur (koleksi retur_gudang, dibuat di erp-epi Fase 1). Identitas &
// kepemilikan proyek DIVALIDASI di endpoint (authenticateProjectLeader) — helper ini
// mengasumsikan itu sudah lolos.

import { directusServerJson } from '$lib/server/directus';
import { getFieldGateMode } from '$lib/server/gateEnforcement';

function pad(n: number, len = 3): string {
	return String(n).padStart(len, '0');
}

interface KonfigSJ {
	format_nomor_retur?: string | null;
	reset_urutan?: string | null;
}

/** Konfigurasi surat jalan aktif (baris berlaku_dari terbaru <= hari ini). */
async function fetchKonfig(): Promise<KonfigSJ | null> {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/konfigurasi_surat_jalan?sort=-berlaku_dari&limit=-1&fields=berlaku_dari,format_nomor_retur,reset_urutan,wajib_foto_kirim`
	).catch(() => null);
	const list = res?.data || [];
	if (!list.length) return null;
	const now = new Date();
	return list.find((c) => new Date(c.berlaku_dari) <= now) || list[list.length - 1];
}

/**
 * Nomor dokumen retur berikutnya. Format dari konfigurasi_surat_jalan.format_nomor_retur
 * (default "RTN/{YYMMDD}/{NNN}"). Token: {PREFIX} {TIPE} {YYMMDD} {DD} {MM} {YYYY} {NNN}.
 * Sama semantik dengan generateReturNumber di erp-epi returGudangApi.js.
 */
export async function generateReturNumber(config?: KonfigSJ | null): Promise<string> {
	const cfg = config ?? (await fetchKonfig());
	const now = new Date();
	const yyyy = String(now.getFullYear());
	const yy = yyyy.slice(-2);
	const mm = pad(now.getMonth() + 1, 2);
	const dd = pad(now.getDate(), 2);

	const format = cfg?.format_nomor_retur || 'RTN/{YYMMDD}/{NNN}';
	const resetUrutan = cfg?.reset_urutan || 'harian';

	const templateWithoutSeq = format
		.replace('{PREFIX}', 'RTN')
		.replace('{TIPE}', 'RTN')
		.replace('{YYMMDD}', `${yy}${mm}${dd}`)
		.replace('{DD}', dd)
		.replace('{MM}', mm)
		.replace('{YYYY}', yyyy);

	const seqTokenIndex = templateWithoutSeq.indexOf('{NNN}');
	const prefix = seqTokenIndex >= 0 ? templateWithoutSeq.slice(0, seqTokenIndex) : `${templateWithoutSeq}/`;

	let searchPrefix = prefix;
	if (resetUrutan === 'bulanan') searchPrefix = prefix.replace(dd, '');
	if (resetUrutan === 'tahunan') searchPrefix = prefix.replace(`${mm}${dd}`, '');
	if (resetUrutan === 'tidak_pernah') searchPrefix = prefix.replace(`${yy}${mm}${dd}`, '');

	let nextSeq = 1;
	const qs = new URLSearchParams({
		filter: JSON.stringify({ nomor_retur: { _starts_with: searchPrefix } }),
		fields: 'nomor_retur',
		sort: '-id',
		limit: '1'
	});
	const res = await directusServerJson<{ data: Array<{ nomor_retur: string }> }>(
		`/items/retur_gudang?${qs.toString()}`
	).catch(() => null);
	const last = res?.data?.[0]?.nomor_retur;
	if (last) {
		const lastSeq = parseInt(String(last).split('/').pop() || '', 10);
		if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
	}
	return `${prefix}${pad(nextSeq)}`;
}

function makeQrToken(): string {
	try {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	} catch {
		/* fallthrough */
	}
	return `qr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateReturDocInput {
	projectId: number;
	packingReturnIds: number[];
	// §7 rekomendasi L4 — satu dokumen retur bisa membawa material DAN alat sekaligus
	// (realitas demobilisasi: satu truk, satu kali kirim). internal_loan_log PK = uuid.
	equipmentLoanIds?: string[];
	submittedByKaryawanId?: number | null;
	submittedByUid?: string | null;
	driverName?: string | null;
	driverPhone?: string | null;
	vehiclePlate?: string | null;
	expeditionName?: string | null;
	notes?: string | null;
	sumber?: 'lapangan' | 'karantina';
	/**
	 * 'dikirim' (default, perilaku lama) = barang dianggap sudah berangkat saat dokumen dibuat.
	 * 'draft' = dokumen baru referensi pengajuan; menunggu tim Inventory menjadwalkan penjemputan.
	 */
	status?: 'dikirim' | 'draft';
}

export interface ReturDocResult {
	id: number;
	nomor_retur: string;
	qr_token: string;
	status: string;
	linked: number;
	linkedEquipment: number;
}

/**
 * Buat header retur_gudang lalu tautkan packing_returns[].retur_gudang_id +
 * internal_loan_log[].retur_gudang_id (L4). Baris yang sudah tertaut dokumen lain /
 * bukan milik proyek ini DILEWATI (tidak error keras agar retry aman) dan dilaporkan
 * lewat `linked`/`linkedEquipment`.
 */
export async function createReturDocument(input: CreateReturDocInput): Promise<ReturDocResult> {
	const {
		projectId,
		packingReturnIds,
		equipmentLoanIds = [],
		submittedByKaryawanId = null,
		submittedByUid = null,
		driverName = null,
		driverPhone = null,
		vehiclePlate = null,
		expeditionName = null,
		notes = null,
		sumber = 'lapangan',
		status = 'dikirim'
	} = input;

	const ids = [...new Set((packingReturnIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	const loanIds = [...new Set((equipmentLoanIds || []).map(String).filter(Boolean))];
	if (sumber !== 'karantina' && ids.length === 0 && loanIds.length === 0) {
		throw new Error('Tidak ada baris retur atau alat untuk dibungkus jadi dokumen');
	}

	// Ambil baris kandidat, saring ke milik proyek ini & belum tertaut dokumen lain.
	let eligibleIds: number[] = [];
	if (ids.length) {
		const qs = new URLSearchParams({
			filter: JSON.stringify({ id: { _in: ids }, project_id: { _eq: projectId } }),
			fields: 'id,retur_gudang_id',
			limit: '-1'
		});
		const rowsRes = await directusServerJson<{ data: Array<{ id: number; retur_gudang_id: number | null }> }>(
			`/items/packing_returns?${qs.toString()}`
		).catch(() => ({ data: [] }));
		eligibleIds = (rowsRes?.data || []).filter((r) => r.retur_gudang_id == null).map((r) => r.id);
		if (eligibleIds.length === 0 && loanIds.length === 0) {
			throw new Error('Semua baris retur terpilih sudah tergabung dalam dokumen lain / bukan milik proyek ini');
		}
	}

	// Alat: hanya yang milik proyek ini, masih tercatat keluar (belum end_date_actual),
	// dan belum tertaut dokumen retur lain.
	let eligibleLoanIds: string[] = [];
	if (loanIds.length) {
		const qs = new URLSearchParams({
			filter: JSON.stringify({
				id: { _in: loanIds },
				project_id: { _eq: projectId },
				end_date_actual: { _null: true }
			}),
			fields: 'id,retur_gudang_id,ownership_type,owner_name,equipment_id.ownership_type,equipment_id.owner_name',
			limit: '-1'
		});
		const loanRes = await directusServerJson<{
			data: Array<{
				id: string;
				retur_gudang_id: number | null;
				ownership_type?: string;
				owner_name?: string | null;
				equipment_id?: { ownership_type?: string; owner_name?: string | null };
			}>;
		}>(`/items/internal_loan_log?${qs.toString()}`).catch(() => ({ data: [] }));

		// Proteksi Gate G_INV_NON_ELTAMA_RETURN_BLOCK
		const nonEltamaLoans = (loanRes?.data || []).filter(
			(r) => (r.ownership_type || r.equipment_id?.ownership_type || 'eltama') !== 'eltama'
		);
		if (nonEltamaLoans.length > 0) {
			const gateMode = await getFieldGateMode('G_INV_NON_ELTAMA_RETURN_BLOCK');
			if (gateMode === 'hard') {
				const culprits = nonEltamaLoans
					.map((l) => l.owner_name || l.equipment_id?.owner_name || l.ownership_type || 'Non-Eltama')
					.join(', ');
				throw new Error(
					`[G_INV_NON_ELTAMA_RETURN_BLOCK] Dokumen retur ditolak: Terdapat alat milik Subcon/Customer (${culprits}) yang tidak boleh diretur ke Gudang Eltama. Lakukan serah terima pengembalian langsung di site.`
				);
			}
		}

		eligibleLoanIds = (loanRes?.data || []).filter((r) => r.retur_gudang_id == null).map((r) => r.id);
	}

	const config = await fetchKonfig();
	const nomor_retur = await generateReturNumber(config);
	const qr_token = makeQrToken();

	const header = await directusServerJson<{ data: ReturDocResult }>(`/items/retur_gudang`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			nomor_retur,
			qr_token,
			qr_token_used: false,
			project_id: projectId,
			status,
			// shipped_at hanya diisi bila barang memang dianggap berangkat — draft belum dikirim,
			// jadi tidak ikut terhitung "terlambat diterima" di monitor gudang.
			...(status === 'dikirim' ? { shipped_at: new Date().toISOString() } : {}),
			sumber,
			submitted_by: submittedByKaryawanId ?? undefined,
			submitted_by_uid: submittedByUid,
			driver_name: driverName,
			driver_phone: driverPhone,
			vehicle_plate: vehiclePlate,
			expedition_name: expeditionName,
			notes
		})
	}).then((r) => r?.data);

	if (!header?.id) throw new Error('Gagal membuat header dokumen retur');

	// Tautkan baris satu per satu (Directus: hindari batch relasi bersarang — Aturan #2).
	let linked = 0;
	for (const rid of eligibleIds) {
		try {
			await directusServerJson(`/items/packing_returns/${rid}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ retur_gudang_id: header.id })
			});
			linked++;
		} catch (e) {
			console.error(`[returGudangServer] gagal tautkan packing_returns ${rid} ke retur ${header.id}:`, (e as Error)?.message);
		}
	}

	let linkedEquipment = 0;
	for (const lid of eligibleLoanIds) {
		try {
			await directusServerJson(`/items/internal_loan_log/${lid}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ retur_gudang_id: header.id })
			});
			linkedEquipment++;
		} catch (e) {
			console.error(`[returGudangServer] gagal tautkan internal_loan_log ${lid} ke retur ${header.id}:`, (e as Error)?.message);
		}
	}

	return { id: header.id, nomor_retur, qr_token, status, linked, linkedEquipment };
}

export interface BerangkatInput {
	fotoKirim: string[];
	driverName?: string | null;
	vehiclePlate?: string | null;
	gps?: { lat: number; lng: number } | null;
	actorName: string;
	actorUid: string;
}

export interface BerangkatResult {
	id: number;
	nomor_retur: string;
	status: string;
	shipped_at: string | null;
	already: boolean;
}

/**
 * RSM-01 §4.1 — tandai dokumen retur `draft` → `dikirim` dari sisi lapangan (leader/sopir).
 * Idempoten: bila dokumen sudah `dikirim` (atau lebih jauh) kembalikan data yang ada dengan
 * `already: true` TANPA mengubah shipped_at. Dokumen batal/ditolak ditolak dengan pesan jelas.
 * Kepemilikan proyek divalidasi di endpoint (authenticateProjectLeader) — di sini hanya status.
 * TIDAK menyentuh ledger/stok (itu tetap di penerimaan gudang).
 */
export async function markReturBerangkat(id: number, input: BerangkatInput): Promise<BerangkatResult> {
	const doc = await directusServerJson<{ data: any }>(`/items/retur_gudang/${id}?fields=id,nomor_retur,status,shipped_at,notes,project_id`).then((r) => r?.data);
	if (!doc) throw new Error('Dokumen retur tidak ditemukan');

	if (doc.status === 'dikirim' || doc.status === 'diterima' || doc.status === 'diterima_sebagian') {
		return { id: doc.id, nomor_retur: doc.nomor_retur, status: doc.status, shipped_at: doc.shipped_at ?? null, already: true };
	}
	if (doc.status !== 'draft') {
		throw new Error(`Dokumen retur ${doc.nomor_retur} berstatus "${doc.status}", tidak bisa ditandai berangkat`);
	}
	const foto = (input.fotoKirim || []).map(String).filter(Boolean);
	if (foto.length === 0) {
		throw new Error('Foto barang di kendaraan wajib diambil sebelum konfirmasi berangkat');
	}

	const now = new Date().toISOString();
	const gpsTag =
		input.gps && Number.isFinite(input.gps.lat) && Number.isFinite(input.gps.lng)
			? `[GPS berangkat ${input.gps.lat.toFixed(5)},${input.gps.lng.toFixed(5)}]`
			: '';
	const notes = [String(doc.notes || '').trim(), `[berangkat dikonfirmasi lapangan oleh ${input.actorName}]`, gpsTag].filter(Boolean).join(' ');
	const patch: Record<string, unknown> = {
		status: 'dikirim',
		shipped_at: now,
		foto_kirim: foto,
		notes,
		...(input.driverName ? { driver_name: input.driverName } : {}),
		...(input.vehiclePlate ? { vehicle_plate: input.vehiclePlate } : {})
	};
	await directusServerJson(`/items/retur_gudang/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});

	// Jejak audit (koleksi bersama dengan admin) — sekunder: gagal dilog jelas, konfirmasi tetap sah.
	try {
		await directusServerJson('/items/activity_log', {
			method: 'POST',
			body: JSON.stringify({
				module: 'retur_gudang',
				collection: 'retur_gudang',
				record_id: String(id),
				action: 'kirim',
				description: `Dokumen retur ${doc.nomor_retur} dikonfirmasi berangkat oleh ${input.actorName} (lapangan)`.slice(0, 2000),
				actor_id: input.actorUid,
				actor_name: input.actorName,
				actor_role: 'leader_lapangan',
				changes: { before: { status: doc.status, shipped_at: doc.shipped_at ?? null }, after: { status: 'dikirim', shipped_at: now } },
				created_at: now
			})
		});
	} catch (e) {
		console.error(`[returGudangServer] gagal catat activity_log berangkat ${id} (konfirmasi tetap sah):`, (e as Error)?.message);
	}

	return { id: doc.id, nomor_retur: doc.nomor_retur, status: 'dikirim', shipped_at: now, already: false };
}

/** Ambil dokumen retur + baris material (untuk halaman cetak). Query terpisah — Aturan #2. */
export async function getReturDocument(id: number) {
	const header = await directusServerJson<{ data: any }>(
		`/items/retur_gudang/${id}?fields=*`
	).then((r) => r?.data).catch(() => null);
	if (!header) return null;

	const qs = new URLSearchParams({
		filter: JSON.stringify({ retur_gudang_id: { _eq: id } }),
		fields: 'id,material_name,material_color,item_id,qty_returned,unit,condition,return_status,date_created',
		limit: '-1'
	});
	const items = await directusServerJson<{ data: any[] }>(`/items/packing_returns?${qs.toString()}`)
		.then((r) => r?.data || [])
		.catch(() => []);

	// L4 — alat yang ikut dokumen ini (query terpisah — Aturan #2).
	const eqQs = new URLSearchParams({
		filter: JSON.stringify({ retur_gudang_id: { _eq: id } }),
		fields: 'id,equipment_id,start_date,end_date_planned,end_date_actual',
		limit: '-1'
	});
	const equipment = await directusServerJson<{ data: any[] }>(`/items/internal_loan_log?${eqQs.toString()}`)
		.then((r) => r?.data || [])
		.catch(() => []);

	let projectName: string | null = null;
	if (header.project_id) {
		projectName = await directusServerJson<{ data: { name: string } }>(
			`/items/projects/${header.project_id}?fields=name`
		).then((r) => r?.data?.name || null).catch(() => null);
	}

	return { ...header, project_name: projectName, items, equipment };
}
