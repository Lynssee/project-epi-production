// src/routes/api/ess/my-hr-documents/[id]/sign/+server.ts
// Karyawan menandatangani dokumen HR miliknya sendiri lewat kanvas TTD di /ess. Menulis
// satu baris doc_signature dengan jejak audit (hash isi dokumen saat itu, waktu, IP, user
// agent) — server yang menghitung semuanya, klien hanya mengirim gambar tanda tangan.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { computeVerifyHash } from '$lib/server/ess/hrDocVerify';

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
	const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
	if (!match) throw error(400, 'Format tanda tangan tidak valid.');
	return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
}

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.params.id;

	const body = await event.request.json().catch(() => null);
	const ttdDataUrl = body?.ttdDataUrl;
	if (!ttdDataUrl) throw error(400, 'Tanda tangan belum diisi.');

	const docQuery = new URLSearchParams({ fields: 'id,nomor_dokumen,karyawan_id,jenis,verify_hash,data_snapshot' });
	const docRes = await directusServerJson<{ data: any }>(`/items/hr_generated_document/${id}?${docQuery.toString()}`);
	const doc = docRes?.data;
	if (!doc) throw error(404, 'Dokumen tidak ditemukan.');
	if (String(doc.karyawan_id) !== String(karyawan.id)) {
		throw error(403, 'Anda tidak memiliki akses ke dokumen ini.');
	}

	const currentHash = computeVerifyHash(doc.nomor_dokumen, doc.data_snapshot);
	if (doc.verify_hash && currentHash !== doc.verify_hash) {
		// Isi dokumen berubah sejak diterbitkan — jangan biarkan tanda tangan menempel
		// pada versi yang sudah tidak sama dengan yang dilihat karyawan.
		throw error(409, 'Isi dokumen telah berubah sejak diterbitkan. Hubungi HRD sebelum menandatangani.');
	}

	const { buffer, mime } = dataUrlToBuffer(ttdDataUrl);
	const formData = new FormData();
	formData.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), `ttd_${doc.nomor_dokumen.replace(/\//g, '-')}_${karyawan.id}.png`);
	const uploadRes = await directusServerUpload(formData);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah gambar tanda tangan.');
	const ttdFileId = (await uploadRes.json())?.data?.id;

	const now = new Date().toISOString();
	const ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		|| event.getClientAddress?.()
		|| 'unknown';
	const userAgent = event.request.headers.get('user-agent') || 'unknown';

	// Cari baris doc_signature milik karyawan ini untuk dokumen ini (dibuat HRD saat generate,
	// atau belum ada sama sekali — buat baru bila belum ada).
	const sigQuery = new URLSearchParams({
		filter: JSON.stringify({ dokumen_id: { _eq: doc.id }, karyawan_id: { _eq: karyawan.id } }),
		limit: '1'
	});
	const sigRes = await directusServerJson<{ data: any[] }>(`/items/doc_signature?${sigQuery.toString()}`);
	const existing = sigRes?.data?.[0];

	const payload = {
		dokumen_id: doc.id,
		karyawan_id: karyawan.id,
		peran: 'karyawan',
		nama: karyawan.nama_karyawan,
		jabatan: '',
		ttd_file: ttdFileId,
		hash_saat_ttd: currentHash,
		signed_at: now,
		ip,
		user_agent: userAgent,
		status: 'signed'
	};

	if (existing) {
		await directusServerJson(`/items/doc_signature/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
	} else {
		await directusServerJson('/items/doc_signature', {
			method: 'POST',
			body: JSON.stringify({ ...payload, urutan: 2 })
		});
	}

	// Semua baris tanda tangan dokumen ini sudah "signed"? -> status_ttd lengkap.
	const allSigQuery = new URLSearchParams({ filter: JSON.stringify({ dokumen_id: { _eq: doc.id } }), fields: 'status', limit: '-1' });
	const allSigRes = await directusServerJson<{ data: { status: string }[] }>(`/items/doc_signature?${allSigQuery.toString()}`);
	const rows = allSigRes?.data || [];
	const statusTtd = rows.length > 0 && rows.every((r) => r.status === 'signed') ? 'lengkap' : 'menunggu';

	await directusServerJson(`/items/hr_generated_document/${doc.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status_ttd: statusTtd })
	});

	return json({ success: true, statusTtd });
};
