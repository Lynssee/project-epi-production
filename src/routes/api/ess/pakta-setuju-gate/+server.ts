// src/routes/api/ess/pakta-setuju-gate/+server.ts
// Persetujuan Pakta jenis GATE: pekerja menyetujui bahwa ia memahami perubahan aturan sebuah gate (mis. mode naik soft → hard).
//   POST { gate_key, route? }
// Gate harus disebut di aturan rute (project.pakta.route_rules[].match.gate_keys) dan benar-benar punya perubahan terbaru; versi (= id log
// perubahan) diambil dari SERVER. Disimpan di pakta_persetujuan (keputusan 'approved', doc_type 'gate') + kode tanda tangan tersimpan
// (signature_hash). Idempoten: versi yang sama / lebih baru yang sudah disetujui tidak digandakan.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { PAKTA_COLLECTION, allRuleGateKeys, loadGateApprovals, loadGateChanges, loadPaktaConfig } from '$lib/server/paktaServer';
import { persistSignatureHash, signKonfirmasi } from '$lib/server/paktaSign';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	let body: any = {};
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Payload JSON tidak valid');
	}
	const gateKey = typeof body.gate_key === 'string' ? body.gate_key.trim().toUpperCase() : '';
	if (!gateKey) throw error(400, 'gate_key wajib disertakan');
	const route = typeof body.route === 'string' ? body.route.slice(0, 255) : null;

	const cfg = await loadPaktaConfig();
	if (!cfg.enabled) throw error(409, 'Pakta Pra-Kegiatan belum diaktifkan.');
	if (!allRuleGateKeys(cfg).includes(gateKey)) throw error(404, 'Aturan ini tidak termasuk yang perlu dikonfirmasi.');

	const errors: string[] = [];
	const { changes } = await loadGateChanges(cfg, [gateKey], errors);
	const change = changes.get(gateKey);
	if (!change) {
		if (errors.length) throw error(502, 'Gagal memverifikasi perubahan aturan. Coba lagi.');
		throw error(404, 'Tidak ada perubahan aturan yang perlu dikonfirmasi.');
	}

	const approvals = await loadGateApprovals(karyawan.id, errors);
	if (errors.length) throw error(503, 'Fitur persetujuan aturan belum aktif di server. Hubungi admin.');
	if (approvals.some((a) => a.doc_key === gateKey && Number(a.doc_version ?? 0) >= change.version)) {
		return json({ success: true, duplicate: true, message: 'Anda sudah menyetujui perubahan aturan ini.' });
	}

	let ip = '';
	try {
		ip = event.getClientAddress();
	} catch {
		ip = '127.0.0.1';
	}
	let created: { data?: { id?: number; date_created?: string } } | null = null;
	try {
		created = await directusServerJson(`/items/${PAKTA_COLLECTION}`, {
			method: 'POST',
			body: JSON.stringify({ karyawan_id: karyawan.id, doc_type: 'gate', doc_key: gateKey, doc_version: change.version, keputusan: 'approved', route, ip_address: ip })
		});
	} catch (e: any) {
		console.error('[pakta-setuju-gate] gagal menyimpan persetujuan:', e?.message || e);
		throw error(503, 'Persetujuan belum bisa dicatat. Coba lagi atau hubungi admin.');
	}
	// Directus mengisi date_created sendiri → tanda tangan memakai nilai TERSIMPAN (agar bisa dihitung ulang & diverifikasi).
	const at = created?.data?.date_created ?? new Date().toISOString();
	const signature = signKonfirmasi({ karyawanId: karyawan.id, docType: 'gate', docKey: gateKey, version: change.version, confirmedAt: at, ip });
	await persistSignatureHash(PAKTA_COLLECTION, created?.data?.id, signature);
	return json({ success: true, id: created?.data?.id ?? null, confirmed_at: at, signature });
};
