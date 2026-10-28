// src/lib/services/scanResolve.ts
// Sisi klien untuk resolver scan QR Surat Jalan tunggal. Server counterpart:
// /api/scan/resolve/+server.ts (rencana v2.0 Bab 6.2).

import { auth } from '$lib/firebase';

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export interface ResolveSjResult {
	kind: 'sj';
	suratJalan: {
		id: number;
		nomorSj: string;
		status: string;
		driver: string | null;
		type: string | null;
		customerName: string | null;
	};
	role: 'satpam' | 'project_leader' | 'admin_finance' | 'other';
	allowedActions: string[];
}

// R7 (24 Sep 2026) — Gate Ketat v2 SJ Keluar Ciketing, prefix CIK-SJK-V2.
export interface ResolveCiketingSjkResult {
	// Fase 7 Unifikasi Workshop: bentuk sama untuk Balaraja (kind 'balaraja_sjk', QR BLJ-SJK-V2).
	kind: 'ciketing_sjk' | 'balaraja_sjk';
	workshop?: 'ciketing' | 'balaraja';
	sjk: {
		id: number;
		noSj: string;
		statusKirim: string | null;
		diterimaOleh: string | null;
		diterimaAt: string | null;
		approvalStatus?: string | null;
		securityVerified?: boolean;
	};
	role: 'other';
	allowedActions: string[];
}

export async function resolveSjQr(code: string): Promise<ResolveSjResult | ResolveCiketingSjkResult> {
	const idToken = await getIdToken();
	const res = await fetch('/api/scan/resolve', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ code })
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.message || `Gagal memindai QR (${res.status})`);
	}
	return res.json();
}

/** Server meminta alasan pengecualian (gate bermode soft) — UI menampilkan kolom alasan lalu kirim ulang dengan exceptionReason. */
export class SjkReasonRequiredError extends Error {
	gates: Array<{ gate_key: string; label: string }>;
	minAlasan: number;
	constructor(message: string, gates: Array<{ gate_key: string; label: string }>, minAlasan: number) {
		super(message);
		this.name = 'SjkReasonRequiredError';
		this.gates = gates;
		this.minAlasan = minAlasan;
	}
}

export async function submitWorkshopSjkConfirmReceipt(p: {
	workshopKey: 'ciketing' | 'balaraja';
	sjkId: number;
	/** WAJIB (WSK-14): token dari QR yang dipindai — tanpa token server menolak. */
	token: string;
	receiverName: string;
	fotoFileId?: string | null;
	clientEventId?: string;
	exceptionReason?: string;
}): Promise<{ success: boolean; noSj: string; diterimaAt: string; baris?: number }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/scan/workshop-sjk-confirm-receipt', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(p)
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		if (res.status === 422 && data?.code === 'GATE_REASON_REQUIRED') throw new SjkReasonRequiredError(data.message, data.gates || [], data.minAlasan || 20);
		throw new Error(data?.message || `Gagal konfirmasi terima (${res.status})`);
	}
	return res.json();
}

// Fase 4 QC Re-test Cat Keluar — QR label kaleng cat (EPI:BATCH:<id item_batch>).
export interface ResolveBatchResult {
	batch: {
		id: number;
		batchNo: string | null;
		namaBarang: string | null;
		tanggalProduksi: string | null;
		tanggalKadaluarsa: string | null;
		kadaluarsaLewat: boolean;
		umurHari: number | null;
		status: string | null;
	};
	coa: { kode: string; issuedAt: string | null } | null;
	retest: { aktif: boolean; berlakuSampai: string | null };
	hold: boolean;
	panduan: {
		thinnerType: string | null;
		thinningRatio: string | null;
		persiapanPermukaan: string | null;
		metodeAplikasi: string | null;
		overcoatMinJam: number | null;
		overcoatMaxJam: number | null;
		penyimpanan: string | null;
	} | null;
}

/** Resolusi QR batch kaleng cat. Melempar Error berpesan jelas bila batch tidak ditemukan / sesi habis. */
export async function resolveBatchQr(batchId: number): Promise<ResolveBatchResult> {
	const token = await getIdToken();
	const res = await fetch(`/api/scan/batch/${encodeURIComponent(batchId)}`, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || `Gagal membaca batch (HTTP ${res.status}).`);
	}
	return res.json();
}

/** Alias lama (pemanggil Ciketing). */
export function submitCiketingSjkConfirmReceipt(p: { sjkId: number; token: string; receiverName: string; fotoFileId?: string | null; clientEventId?: string }) {
	return submitWorkshopSjkConfirmReceipt({ workshopKey: 'ciketing', ...p });
}
