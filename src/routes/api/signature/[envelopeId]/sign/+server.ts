// src/routes/api/signature/[envelopeId]/sign/+server.ts
// Generic sign endpoint for the universal Signature Service (F0) — lapangan
// signers on the Dashboard Lapangan app. Parallels the ESS HR sign route
// (api/ess/my-hr-documents/[id]/sign) but operates on signature_envelope +
// doc_signature instead of being HR-specific. Not called by any UI yet — F1
// will be the first real caller.
//
// Does its own minimal Firebase-token + karyawan resolution (via
// resolveKaryawanByEmail) rather than importing ess/attendanceGuard.ts,
// which is scoped/named for the ESS attendance routes specifically.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { computeVerifyHash, computeEnvelopeRefKey } from '$lib/server/shared/signatureVerify';

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
	const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
	if (!match) throw error(400, 'Format tanda tangan tidak valid.');
	return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const envelopeId = Number(event.params.envelopeId);
	if (!envelopeId) throw error(400, 'envelopeId tidak valid.');

	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const body = await event.request.json().catch(() => null);
	const ttdDataUrl = body?.ttdDataUrl;
	if (!ttdDataUrl) throw error(400, 'Tanda tangan belum diisi.');

	const envRes = await directusServerJson<{ data: any }>(`/items/signature_envelope/${envelopeId}`);
	const envelope = envRes?.data;
	if (!envelope) throw error(404, 'Envelope tidak ditemukan.');

	const signersQuery = new URLSearchParams({
		filter: JSON.stringify({ envelope_id: { _eq: envelopeId } }),
		sort: 'urutan'
	});
	const signersRes = await directusServerJson<{ data: any[] }>(`/items/doc_signature?${signersQuery.toString()}`);
	const signers = signersRes?.data || [];

	const myRow = signers.find(
		(s) => String(s.karyawan_id) === String(karyawan.id) && s.status === 'pending'
	);
	if (!myRow) throw error(403, 'Tidak ada tanda tangan yang menunggu Anda pada dokumen ini.');

	if (envelope.urutan_wajib) {
		const earlierPending = signers.some((s) => s.urutan < myRow.urutan && s.status === 'pending');
		if (earlierPending) throw error(409, 'Menunggu urutan penandatangan sebelumnya.');
	}

	const currentHash = computeVerifyHash(
		computeEnvelopeRefKey(envelope.modul_asal, envelope.ref_id),
		envelope.data_snapshot
	);
	if (envelope.verify_hash && currentHash !== envelope.verify_hash) {
		throw error(409, 'Isi dokumen telah berubah sejak envelope dibuat. Hubungi admin sebelum menandatangani.');
	}

	const { buffer, mime } = dataUrlToBuffer(ttdDataUrl);
	const formData = new FormData();
	formData.append(
		'file',
		new Blob([new Uint8Array(buffer)], { type: mime }),
		`ttd_envelope_${envelope.id}_${karyawan.id}.png`
	);
	const uploadRes = await directusServerUpload(formData);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah gambar tanda tangan.');
	const ttdFileId = (await uploadRes.json())?.data?.id;

	const now = new Date().toISOString();
	const ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		|| event.getClientAddress?.()
		|| 'unknown';
	const userAgent = event.request.headers.get('user-agent') || 'unknown';

	await directusServerJson(`/items/doc_signature/${myRow.id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'signed',
			ttd_file: ttdFileId,
			hash_saat_ttd: currentHash,
			signed_at: now,
			ip,
			user_agent: userAgent
		})
	});

	await directusServerJson('/items/signature_audit', {
		method: 'POST',
		body: JSON.stringify({
			envelope_id: envelope.id,
			event: 'ditandatangani',
			aktor: karyawan.nama_karyawan,
			ip,
			user_agent: userAgent
		})
	});

	const remaining = signers.filter((s) => s.id !== myRow.id);
	const allSigned = remaining.every((s) => s.status === 'signed');
	const envelopeStatus = allSigned ? 'selesai' : 'berjalan';

	await directusServerJson(`/items/signature_envelope/${envelope.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: envelopeStatus })
	});

	return json({ success: true, status: envelopeStatus });
};
