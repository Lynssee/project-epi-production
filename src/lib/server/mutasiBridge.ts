// src/lib/server/mutasiBridge.ts
// RSM-13 — jembatan lapangan → SATU mesin e-SJ Mutasi di erp-epi (POST /api/automation/mutasi-barang).
// Tidak ada logika mutasi kedua di sini: ajukan/setujui/kirim/terima, ledger, biaya pindah, dan gate tetap diputuskan
// erp-epi/src/lib/server/mutasiBarang.js. Jembatan memakai ERP_EPI1_BASE_URL + AUTOMATION_SERVER_SECRET (sudah ada, tanpa
// env baru). Identitas pengguna diverifikasi Firebase DI SINI; yang dikirim ke ERP hanya `karyawan_id`, dan ERP membangun
// aktor TANPA izin admin — hak ditentukan kepemimpinan/backup proyek.
//
// Beda dengan jembatan gate gerbang (fail-safe/tidak mengunci): mutasi memang butuh ERP. Bila ERP tak terjangkau, pesan jelas
// ke pengguna (503) — jangan diam-diam gagal (Aturan #1).

import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail, type ServerKaryawan } from '$lib/server/projectLeaderGuard';

export async function karyawanDariEvent(event: RequestEvent): Promise<ServerKaryawan> {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	return karyawan;
}

export type MutasiOp = 'status' | 'daftar' | 'ajukan' | 'aksi';

export async function panggilMutasiErp(
	karyawanId: number,
	op: MutasiOp,
	payload: Record<string, unknown> = {},
	opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<any> {
	const base = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!base || !secret) {
		throw error(503, 'Layanan mutasi barang belum terhubung ke server admin (ERP_EPI1_BASE_URL / AUTOMATION_SERVER_SECRET). Hubungi Admin.');
	}
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
	let res: Response;
	try {
		res = await (opts.fetchImpl ?? fetch)(`${base.replace(/\/$/, '')}/api/automation/mutasi-barang`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-automation-secret': secret },
			body: JSON.stringify({ ...payload, op, karyawan_id: karyawanId }),
			signal: ctrl.signal
		});
	} catch (e) {
		console.error('[mutasiBridge] server admin tak terjangkau:', e instanceof Error ? e.message : e);
		throw error(503, 'Server admin tidak terjangkau. Coba lagi beberapa saat lagi; data Anda belum berubah.');
	} finally {
		clearTimeout(timer);
	}
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) {
		const pesan = parsed?.message || parsed?.error?.message || `Server admin menjawab HTTP ${res.status}.`;
		console.error('[mutasiBridge] ERP menolak', op, res.status, pesan);
		throw error(res.status >= 500 ? 502 : res.status, pesan);
	}
	return parsed;
}
