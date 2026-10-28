// src/lib/server/fleetSettlement.ts
// ESS Redesign Fase 3 — Rekonsiliasi & Settlement Uang Muka Operasional (JALUR LAMA, dibekukan bertahap — file 06).
// Dipicu OTOMATIS saat perjalanan diselesaikan (checklist tahap=setelah / driver trip finish).
//
// Selisih = uang muka dicairkan − (realisasi struk + penyesuaian_manual admin)
//   > 0  → ada sisa dana perusahaan  → settlement_status = 'menunggu_setor_balik'
//          (peminjam upload bukti transfer balik via /api/fleet-booking/settlement-setor,
//           Finance verifikasi & tandai CLOSED di board)
//   < 0  → peminjam nalangi          → settlement_status = 'menunggu_reimburse'
//          + auto-draf klaim_reimbursement (approval hrd.reimburse yang sudah live) — SEKALI saja (idempoten)
//   = 0  → pas                        → settlement_status = 'balanced', advance_status = 'settled'
//
// Peminjaman 06 Fase 4:
//   • Uang muka berbasis PCR (booking.advance_pcr_id terisi) TIDAK dihitung di sini — LPJ Petty Cash yang memilikinya.
//   • Masih ada struk `menunggu` approval → 'menunggu_struk_final' (angka belum final: tanpa setor-balik/reimburse),
//     dihitung ulang lewat recomputeSettlementForBooking() saat struk diputuskan.
//   • Draf reimburse kekurangan tidak dibuat dua kali (settlement_reimburse_id).

import { directusServerJson } from '$lib/server/directus';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { filterBiayaRealisasi, jumlahkanRealisasi, perluHitung, putuskanSettlement } from '$lib/server/fleetSettlementCalc';

const rp = (n: number) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

/**
 * Hitung & terapkan settlement untuk satu booking. Idempoten & fail-soft:
 * mengembalikan null (tanpa efek) bila uang muka tidak relevan atau settlement sudah final.
 * @param booking baris fleet_bookings lengkap (advance_*, settlement_status, trip_log_id, penyesuaian_manual, karyawan_id, project_id)
 */
export async function applyCashAdvanceSettlement(booking: any): Promise<any | null> {
	if (!booking?.id) return null;
	if (!booking.advance_diminta || booking.advance_status !== 'dicairkan') return null;
	// File 06: uang muka PCR → settlement = LPJ Petty Cash, bukan jalur ini.
	if (booking.advance_pcr_id) return null;
	if (!perluHitung(booking)) return null;

	const tripLogId = booking.trip_log_id ? String(booking.trip_log_id) : null;

	// Agregasi realisasi dari fleet_trip_expense (sumber kebenaran itemized, ada foto struk).
	// Fase 5.6 v2 (9 Sep 2026, Aturan #8): kecualikan approval_status='ditolak' dan 'menunggu' (dihitung baru SAAT disetujui).
	// ⚠️ Baris LAMA tidak ter-backfill approval_status (NULL) — filterBiayaRealisasi menyertakan NULL eksplisit (Aturan #7).
	let realisasi = jumlahkanRealisasi([]);
	let adaStrukMenunggu = false;
	if (tripLogId) {
		const filter = encodeURIComponent(JSON.stringify(filterBiayaRealisasi(tripLogId)));
		const exp = await directusServerJson<{ data: any[] }>(
			`/items/fleet_trip_expense?filter=${filter}&fields=jenis,nominal&limit=-1&sort=id`
		).catch((e) => {
			console.warn('[fleetSettlement] gagal agregasi biaya trip', tripLogId, (e as any)?.message || e);
			return { data: [] as any[] };
		});
		realisasi = jumlahkanRealisasi(exp?.data);

		// Struk `menunggu` — query terpisah (Aturan #2). Gagal baca → anggap ada (jangan putuskan uang atas data yang tak pasti).
		const mf = encodeURIComponent(JSON.stringify({ _and: [{ trip_log_id: { _eq: tripLogId } }, { approval_status: { _eq: 'menunggu' } }] }));
		try {
			const m = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_expense?filter=${mf}&fields=id&limit=1&sort=id`);
			adaStrukMenunggu = (m?.data || []).length > 0;
		} catch (e) {
			console.warn('[fleetSettlement] gagal cek struk menunggu — diasumsikan ada:', (e as any)?.message || e);
			adaStrukMenunggu = true;
		}
	}

	const penyesuaian = Number(booking.penyesuaian_manual) || 0;
	const realisasiTotal = realisasi.total + penyesuaian;
	const disbursed = Number(booking.advance_amount_disbursed) || 0;
	const keputusan = putuskanSettlement({
		disbursed,
		realisasiTotal,
		adaStrukMenunggu,
		sudahReimburse: !!booking.settlement_reimburse_id
	});

	const patch: Record<string, any> = {
		realisasi_bbm: realisasi.bbm,
		realisasi_tol: realisasi.tol,
		realisasi_parkir: realisasi.parkir,
		realisasi_lain: realisasi.lain,
		settlement_selisih: keputusan.selisih,
		settlement_status: keputusan.settlement_status
	};
	if (keputusan.selesai) patch.advance_status = 'settled';

	if (keputusan.buatReimburse) {
		try {
			// Baca ulang tepat sebelum membuat: proses lain bisa sudah membuatnya (idempoten, Aturan #8).
			const cur = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${booking.id}?fields=id,settlement_reimburse_id`);
			if (cur?.data?.settlement_reimburse_id) {
				patch.settlement_reimburse_id = cur.data.settlement_reimburse_id;
			} else {
				const kekurangan = Math.abs(keputusan.selisih);
				const rmb = await directusServerJson<any>('/items/klaim_reimbursement', {
					method: 'POST',
					body: JSON.stringify({
						karyawan_id: String(booking.karyawan_id),
						tanggal_pengajuan: new Date().toISOString().slice(0, 10),
						kategori: 'Perjalanan Dinas',
						jumlah: kekurangan,
						status: 'Diajukan',
						project_id: booking.project_id || null,
						catatan: `Auto-draf kekurangan uang muka operasional peminjaman ${booking.kode_booking}. Dicairkan ${rp(disbursed)}, realisasi struk ${rp(realisasiTotal)}, kekurangan ${rp(kekurangan)}.`
					})
				});
				const reimburseId = rmb?.data?.id ?? rmb?.id ?? null;
				if (reimburseId) {
					patch.settlement_reimburse_id = reimburseId;
					await mirrorSubmitApprovalRequest({
						moduleKey: 'hrd.reimburse',
						sourceCollection: 'klaim_reimbursement',
						sourceId: reimburseId,
						title: `Kekurangan Uang Muka — ${booking.kode_booking}`,
						summary: `Kekurangan ${rp(kekurangan)} dari uang muka operasional.`,
						amount: kekurangan,
						requesterId: booking.karyawan_id
					}).catch((e) => console.warn('[fleetSettlement] mirror approval gagal:', (e as any)?.message || e));
				}
			}
		} catch (e) {
			console.warn('[fleetSettlement] gagal buat draf reimbursement:', (e as any)?.message || e);
		}
	}

	const updated = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${booking.id}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	}).catch((e) => {
		console.warn('[fleetSettlement] gagal PATCH booking:', (e as any)?.message || e);
		return null;
	});
	return updated?.data ?? null;
}

/**
 * Hitung ulang settlement booking yang tertahan di 'menunggu_struk_final' — panggil SAAT struk perjalanannya diputuskan
 * (disetujui/ditolak). Tidak berbuat apa-apa untuk status lain. Fail-soft.
 * ⚠️ Saat ini belum ada kode di kedua repo yang memutuskan fleet_trip_expense.approval_status; fungsi ini disiapkan untuk
 * titik keputusan itu (lihat PR Fase 4).
 */
export async function recomputeSettlementForBooking(bookingId: string | number): Promise<any | null> {
	try {
		const res = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}?fields=*`);
		const b = res?.data;
		if (!b || b.settlement_status !== 'menunggu_struk_final') return null;
		return await applyCashAdvanceSettlement(b);
	} catch (e) {
		console.warn('[fleetSettlement] hitung ulang settlement gagal:', (e as any)?.message || e);
		return null;
	}
}
