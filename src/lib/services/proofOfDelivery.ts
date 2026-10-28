// src/lib/services/proofOfDelivery.ts
// F3 (rencana v2.0 Bab 6.3, Keputusan D3): sisi klien Proof of Delivery driver —
// TTD + foto di HP driver sendiri, nol halaman publik. Server counterpart:
// api/scan/proof-of-delivery/+server.ts.

import { auth } from '$lib/firebase';
import { uploadFiles } from '@directus/sdk';
import directus, { handleDirectusError } from './directus';

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export function dataUrlToBlob(dataUrl: string): Blob {
	const [meta, base64] = dataUrl.split(',');
	const mime = meta.match(/data:(.*);base64/)?.[1] || 'image/png';
	const bytes = atob(base64);
	const arr = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
	return new Blob([arr], { type: mime });
}

async function uploadBlob(blob: Blob, filename: string, description: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', blob, filename);
		formData.append('description', description);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface SubmitPodParams {
	suratJalanId: number;
	signaturePad: { isEmpty: () => boolean; toDataURL: () => string } | null;
	photoFile: File | null;
	gps: { lat: number; lng: number; accuracy: number } | null;
}

/** L4 (antrean offline): varian berbasis Blob mentah, dipakai submit langsung MAUPUN replay dari IndexedDB. */
export async function submitProofOfDeliveryBlobs(params: {
	suratJalanId: number;
	gps: { lat: number; lng: number; accuracy: number } | null;
	signatureBlob?: Blob;
	photoBlob?: Blob;
}): Promise<{ success: boolean; nomorSj: string }> {
	let signatureFileId: string | null = null;
	if (params.signatureBlob) {
		signatureFileId = await uploadBlob(params.signatureBlob, 'ttd-pod.png', 'proof_of_delivery:signature');
	}
	let fotoFileId: string | null = null;
	if (params.photoBlob) {
		fotoFileId = await uploadBlob(params.photoBlob, 'foto-pod.jpg', 'proof_of_delivery:foto');
	}

	const idToken = await getIdToken();
	const res = await fetch('/api/scan/proof-of-delivery', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			suratJalanId: params.suratJalanId,
			signatureFileId,
			fotoFileId,
			gps: params.gps
		})
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.message || `Gagal mengirim bukti serah-terima (${res.status})`);
	}
	return res.json();
}

export async function submitProofOfDelivery(params: SubmitPodParams): Promise<{ success: boolean; nomorSj: string }> {
	const signatureBlob =
		params.signaturePad && !params.signaturePad.isEmpty() ? dataUrlToBlob(params.signaturePad.toDataURL()) : undefined;
	const photoBlob = params.photoFile || undefined;
	return submitProofOfDeliveryBlobs({
		suratJalanId: params.suratJalanId,
		gps: params.gps,
		signatureBlob,
		photoBlob
	});
}
