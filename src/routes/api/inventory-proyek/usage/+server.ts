// src/routes/api/inventory-proyek/usage/+server.ts
// Fase 2: tulis OUT-USAGE ke project_stock_ledger dari form pemakaian harian
// (routes/(app)/laporan/[project_id]/+page.svelte). Endpoint terpisah karena submitReport/
// updateReport di reports.ts menulis LANGSUNG dari klien ke Directus (bukan lewat server route) --
// ledger tidak bisa disentuh dari sana (permission-locked, lihat catatan di projectLedger.ts),
// jadi klien memanggil endpoint ini SETELAH laporan tersimpan, dengan DELTA yang sudah dihitung
// klien (delta vs material_used laporan sebelumnya -- logika delta itu sendiri sudah ada & benar
// di +page.svelte, di sini hanya menerima hasilnya, tidak menghitung ulang).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';
import { writeGateAudit } from '$lib/server/gates/gateAudit';
import { realUsageSkips } from '$lib/utils/materialManualMatch';

interface UsageDelta {
	expenseId: number | string;
	identitasBarangId: number;
	/** + = pemakaian bertambah sejak simpan terakhir, - = dikurangi (edit turun, lihat skip di bawah). */
	delta: number;
	rabBudgetId?: number | null;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds } = await authenticateGRActor(event);

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const reportId = body?.reportId;
	const batchId = String(body?.batchId || '');
	const deltas: UsageDelta[] = Array.isArray(body?.deltas) ? body.deltas : [];

	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');
	if (!isProjectAllowed(projectIds, projectId)) throw error(403, 'Anda bukan leader proyek ini.');
	if (!batchId) throw error(400, 'batchId wajib diisi (kunci idempotensi per aksi simpan).');

	// Global: aktif untuk semua proyek (Keputusan User 22 Okt 2026)

	const written: number[] = [];
	const skipped: Array<{ expenseId: string | number; reason: string }> = [];

	for (const d of deltas) {
		if (!d.identitasBarangId) {
			skipped.push({ expenseId: d.expenseId, reason: 'tidak ada identitas_barang_id (kemungkinan is_manual)' });
			continue;
		}
		if (!Number.isFinite(d.delta) || d.delta === 0) {
			skipped.push({ expenseId: d.expenseId, reason: 'delta 0' });
			continue;
		}
		if (d.delta < 0) {
			// transaction_type OUT-USAGE dipaksa bertanda negatif (Bab 7.4) -- delta negatif berarti
			// leader MENGURANGI angka pemakaian yang sudah dilaporkan (edit turun), yang secara ledger
			// berarti "kembalikan sebagian". Tidak ada tipe transaksi resmi untuk ini di skema Bab 7.4
			// (OUT-RETURN artinya fisik dikembalikan ke gudang, beda semantik). Daripada memaksakan
			// tanda yang salah, baris ini dilewati -- koreksi turun butuh mekanisme terpisah
			// (baris penyeimbang manual), belum dibangun.
			skipped.push({ expenseId: d.expenseId, reason: 'delta negatif (koreksi turun) belum didukung ledger, dilewati' });
			continue;
		}
		try {
			// OUT-USAGE selalu negatif di ledger; delta form selalu positif di titik ini (pemakaian
			// bertambah), jadi dibalik tandanya saat ditulis.
			const { entry } = await appendLedgerEntry({
				projectId,
				itemId: d.identitasBarangId,
				projectBudgetId: d.rabBudgetId || null,
				transactionType: TRANSACTION_TYPES.OUT_USAGE,
				quantity: -d.delta,
				referenceType: 'laporan_harian',
				referenceId: reportId ?? null,
				referenceNo: reportId ? `LH-${reportId}` : null,
				submittedBy: karyawan.id,
				clientTxnId: `usage-${batchId}-exp-${d.expenseId}`
			});
			written.push(entry?.id);
		} catch (e: any) {
			skipped.push({ expenseId: d.expenseId, reason: e?.message || 'gagal tulis ledger' });
		}
	}

	// Audit hidden cost #1051: skip karena KEGAGALAN (bukan delta 0 / manual / non-pilot) sebelumnya hanya kembali ke
	// klien yang mengabaikannya. Catat ke gate_audit_log (best-effort) supaya penyebabnya terlihat admin.
	const failedSkips = realUsageSkips(skipped);
	if (failedSkips.length > 0) {
		console.error('[inventory-proyek/usage] pemakaian gagal masuk ledger:', { projectId, reportId, failedSkips });
		await writeGateAudit({
			gate: 'LEDGER_USAGE_GAGAL',
			collection: 'project_stock_ledger',
			recordId: reportId ?? null,
			decision: 'warn',
			reason: `${failedSkips.length} pemakaian proyek ${projectId} gagal masuk ledger: ${failedSkips.slice(0, 3).map((s) => `exp ${s.expenseId}: ${s.reason}`).join('; ')}`,
			snapshot: { projectId, reportId, batchId, failedSkips },
			email: (karyawan as any)?.email_company ?? null
		});
	}

	if (written.length > 0) {
		rebuildProjectStockBalance({ projectId }).catch((err) => {
			console.error('[inventory-proyek/usage] Gagal auto-rebuild balance:', err);
		});
	}

	return json({ written: written.length, skipped });
};
