// src/routes/api/process-guidance/read-confirm/+server.ts
// Endpoint konfirmasi pemahaman SOP / Alur Bisnis (ISO 9001 / Gate Kepatuhan Lapangan G_FLD_SOP_READ_CONFIRMATION).
// Wajib login ESS (authenticateEss).
//
// Fase 4 Lifecycle Kebijakan→SOP:
//  • Yang WAJIB dikonfirmasi hanya alur/SOP dalam MASA SOSIALISASI (approval_status 'butuh_sosialisasi'), sadar VERSI,
//    dan SOP ditarget per departemen (lihat $lib/utils/sopReadRequirement.ts). Sebelumnya semua alur published dianggap
//    "belum dikonfirmasi" (887 alur → peringatan palsu untuk setiap pengguna).
//  • Mode gate dibaca lewat resolveGateMode (gate_enforcement override → gate_definitions → enforce_from), jadi mengikuti
//    pengaturan superadmin di /settings/gates.
//  • Versi yang tercatat DIAMBIL DARI SERVER (bukan kiriman klien) supaya konfirmasi tidak bisa menunjuk versi lain.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { computeUnconfirmed, type ConfirmRow, type FlowRow, type SopRow } from '$lib/utils/sopReadRequirement';

const GATE_KEY = 'G_FLD_SOP_READ_CONFIRMATION';
const GATE_DOC_TYPE = 'laporan_harian';

/** Baca daftar Directus; kegagalan DICATAT (Directus membalas 403 bila nama kolom salah) dan dilaporkan, tidak ditelan. */
async function loadList<T>(path: string, label: string, errors: string[]): Promise<T[]> {
	try {
		const res = await directusServerJson<{ data: T[] }>(path);
		return Array.isArray(res?.data) ? res.data : [];
	} catch (e: any) {
		console.error(`[read-confirm] gagal membaca ${label}:`, e?.message || e);
		errors.push(`${label}: ${e?.message || e}`);
		return [];
	}
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const flowKey = event.url.searchParams.get('flow_key');
	const sopId = event.url.searchParams.get('sop_id');
	const errors: string[] = [];

	// 0. ?mine=1 -> daftar flow_key yang SUDAH dikonfirmasi karyawan ini (untuk filter "Belum Saya Baca"). Gagal baca -> 502 (klien memakai catatan lokal).
	if (event.url.searchParams.get('mine') === '1') {
		try {
			const res = await directusServerJson<{ data: any[] }>(
				`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawan.id}&filter[flow_key][_nnull]=true&fields=flow_key&limit=-1`
			);
			const keys = [...new Set((res?.data || []).map((c) => c.flow_key).filter((k): k is string => typeof k === 'string' && k.length > 0))];
			return json({ success: true, confirmed_keys: keys });
		} catch (e) {
			console.error('[read-confirm] gagal membaca konfirmasi milik karyawan:', e instanceof Error ? e.message : e);
			return json({ success: false, confirmed_keys: [] }, { status: 502 });
		}
	}

	// 1. Cek spesifik satu alur / satu SOP (dipakai halaman Panduan Alur & tombol "Tandai Paham")
	if (flowKey || sopId) {
		const filterKey = flowKey
			? `filter[flow_key][_eq]=${encodeURIComponent(flowKey)}`
			: `filter[sop_id][_eq]=${encodeURIComponent(String(Number(sopId) || 0))}`;
		const records = await loadList<any>(
			`/items/sop_read_confirmations?${filterKey}&filter[karyawan_id][_eq]=${karyawan.id}&fields=id,confirmed_at,flow_version,sop_version_seq&sort=-confirmed_at&limit=1`,
			'sop_read_confirmations',
			errors
		);
		const record = records[0];

		let currentVersion = 1;
		if (flowKey) {
			const flow = (await loadList<any>(
				`/items/process_guidance_flows?filter[flow_key][_eq]=${encodeURIComponent(flowKey)}&fields=id,version&limit=1`,
				'process_guidance_flows',
				errors
			))[0];
			currentVersion = Number(flow?.version) || 1;
		} else {
			const sop = (await loadList<any>(
				`/items/sop_documents?filter[id][_eq]=${encodeURIComponent(String(Number(sopId) || 0))}&fields=id,version_seq&limit=1`,
				'sop_documents',
				errors
			))[0];
			currentVersion = Number(sop?.version_seq) || 1;
		}
		const confirmedVersion = flowKey ? Number(record?.flow_version) || 1 : Number(record?.sop_version_seq) || 0;
		const confirmed = Boolean(record) && confirmedVersion >= currentVersion;

		return json({
			success: true,
			confirmed,
			needs_reconfirm: Boolean(record) && !confirmed,
			confirmed_at: record?.confirmed_at ?? null,
			current_version: currentVersion,
			...(errors.length ? { errors } : {})
		});
	}

	// 2. Daftar yang belum dikonfirmasi karyawan ini — fetch dipisah per koleksi (tanpa relasi bersarang).
	const [flows, sops, confirms, gateMode] = await Promise.all([
		loadList<FlowRow>(
			`/items/process_guidance_flows?filter[status][_eq]=published&filter[approval_status][_eq]=butuh_sosialisasi&filter[target_app][_in]=project-epi,both&fields=id,flow_key,title,sop_code,kategori_sop,sub_kategori,approval_status,sosialisasi_end_date,version&limit=200`,
			'process_guidance_flows',
			errors
		),
		loadList<SopRow>(
			`/items/sop_documents?filter[approval_status][_eq]=butuh_sosialisasi&fields=id,title,sop_code,department,approval_status,sosialisasi_end_date,version_seq,target_departments&limit=200`,
			'sop_documents',
			errors
		),
		loadList<ConfirmRow>(
			`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawan.id}&fields=id,flow_key,sop_id,flow_version,sop_version_seq,confirmed_at&limit=500`,
			'sop_read_confirmations',
			errors
		),
		resolveGateMode(GATE_KEY, GATE_DOC_TYPE).catch((e: any) => {
			console.error('[read-confirm] gagal membaca mode gate, memakai shadow:', e?.message || e);
			return 'shadow' as const;
		})
	]);

	const unconfirmedItems = computeUnconfirmed({ flows, sops, confirms, divisi: karyawan.divisi });
	const isBlocked = gateMode === 'hard' && unconfirmedItems.length > 0;

	return json({
		success: true,
		karyawan_id: karyawan.id,
		gate_key: GATE_KEY,
		gate_mode: gateMode,
		is_blocked: isBlocked,
		unconfirmed_count: unconfirmedItems.length,
		unconfirmed_items: unconfirmedItems,
		...(errors.length ? { errors } : {})
	});
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	let body: any = {};
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Payload JSON tidak valid');
	}

	const flowKey = typeof body.flow_key === 'string' ? body.flow_key.trim() : null;
	const sopId = Number.isInteger(Number(body.sop_id)) && Number(body.sop_id) > 0 ? Number(body.sop_id) : null;
	const clientVersion = Number.isInteger(Number(body.version_seq)) ? Number(body.version_seq) : 1;

	if (!flowKey && !sopId) {
		throw error(400, 'flow_key atau sop_id wajib disertakan');
	}

	// Versi sekarang diambil dari server. Tidak ditemukan → 404 (konfirmasi tidak boleh menunjuk dokumen fiktif).
	let flowVersion: number | null = null;
	let versionSeq = clientVersion;
	const lookupErrors: string[] = [];
	if (flowKey) {
		const flow = (await loadList<any>(
			`/items/process_guidance_flows?filter[flow_key][_eq]=${encodeURIComponent(flowKey)}&fields=id,version&limit=1`,
			'process_guidance_flows',
			lookupErrors
		))[0];
		if (!flow) {
			if (lookupErrors.length) throw error(502, 'Gagal memverifikasi alur. Coba lagi.');
			throw error(404, 'Alur tidak ditemukan');
		}
		flowVersion = Number(flow.version) || 1;
		versionSeq = flowVersion; // sop_version_seq pada baris alur = versi alur (kompatibel dengan klien lama)
	} else if (sopId) {
		const sop = (await loadList<any>(
			`/items/sop_documents?filter[id][_eq]=${sopId}&fields=id,version_seq&limit=1`,
			'sop_documents',
			lookupErrors
		))[0];
		if (!sop) {
			if (lookupErrors.length) throw error(502, 'Gagal memverifikasi SOP. Coba lagi.');
			throw error(404, 'SOP tidak ditemukan');
		}
		versionSeq = Number(sop.version_seq) || 1;
	}

	let ipAddress = '';
	try {
		ipAddress = event.getClientAddress();
	} catch {
		ipAddress = '127.0.0.1';
	}

	// Kiriman ulang dari antrean offline (queued): IDEMPOTEN (bila sudah tercatat untuk dokumen+versi ini tidak digandakan, mis. respons sebelumnya
	// hilang di jalan) dan memakai waktu baca ASLI dari perangkat — hanya bila masuk akal (tidak di masa depan, maksimal 30 hari ke belakang).
	const queued = body.queued === true;
	if (queued) {
		const dupFilter = flowKey
			? `filter[flow_key][_eq]=${encodeURIComponent(flowKey)}&filter[flow_version][_eq]=${flowVersion}`
			: `filter[sop_id][_eq]=${sopId}&filter[sop_version_seq][_eq]=${versionSeq}`;
		const dup = await loadList<any>(
			`/items/sop_read_confirmations?${dupFilter}&filter[karyawan_id][_eq]=${karyawan.id}&fields=id,confirmed_at&limit=1`,
			'sop_read_confirmations',
			lookupErrors
		);
		if (dup[0]) return json({ success: true, id: dup[0].id, confirmed_at: dup[0].confirmed_at, duplicate: true });
	}
	const nowMs = Date.now();
	const clientMs = queued && typeof body.read_at === 'string' ? Date.parse(body.read_at) : NaN;
	const confirmedAt =
		Number.isFinite(clientMs) && clientMs <= nowMs + 60_000 && clientMs >= nowMs - 30 * 86_400_000
			? new Date(clientMs).toISOString()
			: new Date(nowMs).toISOString();
	const payload: Record<string, any> = {
		karyawan_id: karyawan.id,
		sop_version_seq: versionSeq,
		confirmed_at: confirmedAt,
		ip_address: ipAddress
	};
	if (flowKey) {
		payload.flow_key = flowKey;
		payload.flow_version = flowVersion;
	}
	if (sopId) payload.sop_id = sopId;

	const insertRes = await directusServerJson<{ data: any }>('/items/sop_read_confirmations', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	return json({
		success: true,
		id: insertRes?.data?.id ?? null,
		confirmed_at: confirmedAt
	});
};
