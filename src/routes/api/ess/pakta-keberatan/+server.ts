// src/routes/api/ess/pakta-keberatan/+server.ts
// "Ada Kendala / Ajukan Pengecualian" pada Pakta Pra-Kegiatan (rencana_sistem_pakta_sop_gate §2.2). Bukan tombol "Tidak Setuju"
// kosong: pekerja WAJIB memilih kategori kendala + menulis alasan; permintaan tercatat berstatus 'menunggu' sampai atasan/pemilik SOP
// memberi dispensasi (Fase 3 admin) — mode gate 'hard' tetap mengunci sampai itu, 'soft' membuka dengan catatan.
// Versi dokumen diambil dari SERVER (bukan kiriman klien). Koleksi `pakta_persetujuan` dibuat Lead lewat
// erp-epi/scripts/setup-pakta-prakegiatan.mjs; bila belum ada → 503 yang jelas (bukan diam-diam hilang).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { PAKTA_COLLECTION, allRuleGateKeys, loadGateChanges, loadPaktaCatalog, loadPaktaConfig, loadPaktaObjections } from '$lib/server/paktaServer';
import { PAKTA_KATEGORI_KENDALA } from '$lib/utils/paktaPolicy';

const MIN_ALASAN = 15;
const MAX_ALASAN = 1000;

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	let body: any = {};
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Payload JSON tidak valid');
	}

	const flowKey = typeof body.flow_key === 'string' ? body.flow_key.trim() : '';
	const sopId = Number.isInteger(Number(body.sop_id)) && Number(body.sop_id) > 0 ? Number(body.sop_id) : null;
	const gateKey = typeof body.gate_key === 'string' ? body.gate_key.trim().toUpperCase() : '';
	if (!flowKey && !sopId && !gateKey) throw error(400, 'flow_key, sop_id, atau gate_key wajib disertakan');

	const kategori = String(body.kategori ?? '');
	if (!PAKTA_KATEGORI_KENDALA.some((k) => k.value === kategori)) throw error(400, 'Pilih kategori kendala');
	const alasan = String(body.alasan ?? '').trim();
	if (alasan.length < MIN_ALASAN) throw error(400, `Jelaskan kendala Anda minimal ${MIN_ALASAN} karakter agar atasan bisa menindaklanjuti`);
	if (alasan.length > MAX_ALASAN) throw error(400, `Alasan maksimal ${MAX_ALASAN} karakter`);
	const route = typeof body.route === 'string' ? body.route.slice(0, 255) : null;

	// Dokumen & versi dari server — hanya dokumen yang sedang masa sosialisasi (atau gate yang baru berubah) yang bisa diajukan keberatan.
	let docType: 'flow' | 'sop' | 'gate';
	let docKey: string;
	let docVersion: number;
	if (gateKey && !flowKey && !sopId) {
		const cfg = await loadPaktaConfig();
		if (!allRuleGateKeys(cfg).includes(gateKey)) throw error(404, 'Aturan ini tidak termasuk yang perlu dikonfirmasi.');
		const gErrors: string[] = [];
		const change = (await loadGateChanges(cfg, [gateKey], gErrors)).changes.get(gateKey);
		if (!change) {
			if (gErrors.length) throw error(502, 'Gagal memverifikasi perubahan aturan. Coba lagi.');
			throw error(404, 'Tidak ada perubahan aturan yang perlu dikonfirmasi.');
		}
		docType = 'gate';
		docKey = gateKey;
		docVersion = change.version;
	} else {
		const catalog = await loadPaktaCatalog();
		const doc = flowKey
			? catalog.flows.find((f) => f.flow_key === flowKey)
			: catalog.sops.find((s) => s.id === sopId);
		if (!doc) {
			if (catalog.errors.length) throw error(502, 'Gagal memverifikasi dokumen. Coba lagi.');
			throw error(404, 'Dokumen tidak ditemukan atau tidak sedang masa sosialisasi');
		}
		docType = flowKey ? 'flow' : 'sop';
		docKey = flowKey || String(sopId);
		docVersion = flowKey ? Number((doc as any).version) || 1 : Number((doc as any).version_seq) || 1;
	}

	// Idempoten: keberatan 'menunggu' untuk dokumen+versi yang sama tidak digandakan.
	const lookupErrors: string[] = [];
	const rows = await loadPaktaObjections(karyawan.id, lookupErrors);
	if (lookupErrors.length) {
		throw error(503, 'Fitur pengajuan kendala belum aktif di server. Hubungi atasan/admin untuk dispensasi.');
	}
	if (rows.some((r) => r.doc_type === docType && String(r.doc_key) === docKey && Number(r.doc_version ?? 0) >= docVersion && r.status === 'menunggu')) {
		return json({ success: true, duplicate: true, message: 'Kendala Anda sudah tercatat dan sedang menunggu atasan.' });
	}

	let ipAddress = '';
	try {
		ipAddress = event.getClientAddress();
	} catch {
		ipAddress = '127.0.0.1';
	}

	try {
		const res = await directusServerJson<{ data: any }>(`/items/${PAKTA_COLLECTION}`, {
			method: 'POST',
			body: JSON.stringify({
				karyawan_id: karyawan.id,
				doc_type: docType,
				doc_key: docKey,
				doc_version: docVersion,
				keputusan: 'objection',
				kategori_kendala: kategori,
				alasan,
				status: 'menunggu',
				route,
				ip_address: ipAddress
			})
		});
		return json({ success: true, id: res?.data?.id ?? null, status: 'menunggu', message: 'Kendala dicatat. Atasan akan menindaklanjuti.' });
	} catch (e: any) {
		console.error('[pakta-keberatan] gagal menyimpan keberatan:', e?.message || e);
		throw error(503, 'Kendala belum bisa dicatat. Hubungi atasan Anda langsung untuk dispensasi.');
	}
};
