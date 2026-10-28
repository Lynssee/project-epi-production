import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';
import { checkRmrVisitGate } from '$lib/server/visitGate';
import { getFieldGateMode } from '$lib/server/gateEnforcement';

const KATEGORI_VALID = ['Transport', 'Kesehatan', 'Komunikasi', 'Perjalanan Dinas', 'Lainnya'];
// G_RMR_VISIT — "4-Gate Site Visit System" Fase 3b (8 Sep 2026): padanan wiring erp-epi
// (ess/reimburse/+server.js). Endpoint ini membuat record langsung — hard-block di sini
// ADALAH titik penegakannya, bukan preflight terpisah.
const KATEGORI_BUTUH_VISIT = ['Transport', 'Perjalanan Dinas'];

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const kategori = form.get('kategori')?.toString();
	const jumlah = Number(form.get('jumlah'));
	const catatan = form.get('catatan')?.toString()?.trim() || '';
	const bukti = form.get('bukti_pendukung');
	const siteCheckinId = form.get('site_checkin_id')?.toString()?.trim() || null;
	const visitException = form.get('visit_exception')?.toString()?.trim() || null;

	const MAX_JUMLAH = 500_000_000; // batas wajar klaim reimbursement — cegah input nominal absurd

	if (!KATEGORI_VALID.includes(kategori || '')) throw error(400, 'Kategori tidak valid.');
	if (!Number.isFinite(jumlah) || jumlah <= 0 || jumlah > MAX_JUMLAH) throw error(400, 'Jumlah klaim tidak valid.');

	if (kategori && KATEGORI_BUTUH_VISIT.includes(kategori)) {
		// Fase 0 v2 (9 Sep 2026): mode-aware lewat gate_enforcement (Aturan #3 — gate baru
		// TIDAK boleh lahir langsung wajib). Default 'shadow' sampai admin menaikkan mode.
		const rmrVisitMode = await getFieldGateMode('G_RMR_VISIT').catch(() => 'shadow');
		const visitCheck = await checkRmrVisitGate(siteCheckinId, visitException, String(karyawan.id), todayJakarta()).catch((e) => ({
			allowed: false,
			reason: e instanceof Error ? e.message : 'Gagal memeriksa gate kunjungan'
		}));
		if (!visitCheck.allowed) {
			if (rmrVisitMode === 'hard') {
				throw error(400, `Gate G_RMR_VISIT: ${visitCheck.reason || 'Reimbursement kategori ini wajib terkait kunjungan lapangan yang sah.'}`);
			}
			console.warn(`[G_RMR_VISIT] mode=${rmrVisitMode} — gate gagal tapi tidak diblokir: ${visitCheck.reason}`);
		}
	}

	let buktiId: string | null = null;
	if (bukti instanceof File && bukti.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', bukti, `reimburse-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah bukti.');
		const uploaded = await uploadRes.json();
		buktiId = uploaded?.data?.id || null;
	}

	const payload = {
		karyawan_id: String(karyawan.id),
		tanggal_pengajuan: todayJakarta(),
		kategori,
		jumlah,
		bukti_pendukung: buktiId,
		catatan,
		status: 'Diajukan',
		// Fase 0 v2 (9 Sep 2026): klaim_reimbursement.site_checkin_id sudah diperbaiki ke
		// varchar(36) — kirim string uuid langsung, JANGAN Number() (selalu NaN untuk uuid).
		site_checkin_id: siteCheckinId || null,
		visit_exception: visitException
	};

	const result = await directusServerJson('/items/klaim_reimbursement', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	const recordId = result?.data?.id ?? result?.id;
	try {
		await mirrorSubmitApprovalRequest({
			moduleKey: 'hrd.reimburse',
			sourceCollection: 'klaim_reimbursement',
			sourceId: recordId,
			title: `Reimburse ${kategori} — ${karyawan.nama_karyawan}`,
			summary: catatan || null,
			amount: jumlah,
			departmentKey: karyawan.divisi,
			requesterId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mendaftarkan reimburse ke Inbox terpusat:', e);
	}

	createMasterPengajuanEntry({
		kategori: 'hrd',
		jenisPengajuan: 'RMB',
		judul: `Reimburse ${kategori} — ${karyawan.nama_karyawan}`,
		deskripsi: catatan || null,
		totalAmount: jumlah,
		pengajuId: karyawan.id,
		departmentKey: karyawan.divisi,
		detailRefCollection: 'klaim_reimbursement',
		detailRefId: recordId,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog RMB (diabaikan):', e?.message));

	return json({ record: result?.data ?? result });
};
