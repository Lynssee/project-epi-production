// src/lib/services/dispensasiRequest.ts
// Klien permintaan dispensasi gate dari lapangan (via proxy /api/dispensasi-request -> admin erp-epi).
// Foto opsional: dikompres lalu diunggah ke /api/directus/files (jalur yang sama dengan BAP borongan); hanya UUID dikirim.
import { getIdToken } from '$lib/services/secureDirectus';
import { compressPhoto } from '$lib/utils/photoCompress';
import { validateAlasan } from '$lib/utils/dispensasiAlasan';

export type DispensasiRequestResult = { ok: true; duplicate: boolean; waTerkirim: boolean } | { ok: false; message: string };

async function uploadFoto(file: File, token: string): Promise<string> {
	const compressed = await compressPhoto(file);
	const form = new FormData();
	form.append('file', compressed, compressed.name || 'bukti-dispensasi.jpg');
	const up = await fetch('/api/directus/files', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
	if (!up.ok) throw new Error('Gagal mengunggah foto');
	const id = (await up.json().catch(() => ({})))?.data?.id;
	if (!id) throw new Error('Foto gagal terbentuk');
	return id;
}

/** Kirim permintaan. Tidak pernah melempar: kegagalan dikembalikan sebagai { ok:false, message }. */
export async function submitDispensasiRequest(p: {
	projectId: number | string;
	gateKey: string;
	alasan: string;
	foto?: File | null;
}): Promise<DispensasiRequestResult> {
	const bad = validateAlasan(p.alasan);
	if (bad) return { ok: false, message: bad };
	try {
		const token = await getIdToken();
		const foto = p.foto ? await uploadFoto(p.foto, token) : null;
		const res = await fetch('/api/dispensasi-request', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ project_id: Number(p.projectId), gate_key: p.gateKey, alasan: p.alasan.trim(), foto })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok === false) return { ok: false, message: data?.message || `Gagal mengirim (HTTP ${res.status})` };
		return { ok: true, duplicate: !!data.duplicate, waTerkirim: !!data.wa_terkirim };
	} catch (e: any) {
		return { ok: false, message: e?.message || 'Gagal mengirim permintaan' };
	}
}

export type MyDispensasiRequest = {
	id: number;
	project_id: number;
	gate_key: string;
	status: 'menunggu' | 'disetujui' | 'ditolak';
	catatan_keputusan?: string | null;
};

/** Permintaan milik sendiri (terbaru). Gagal = daftar kosong (tidak menahan layar). */
export async function fetchMyDispensasiRequests(): Promise<MyDispensasiRequest[]> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/dispensasi-request', { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) return [];
		return (await res.json().catch(() => ({})))?.data || [];
	} catch {
		return [];
	}
}
