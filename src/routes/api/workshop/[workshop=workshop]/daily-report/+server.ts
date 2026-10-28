// src/routes/api/workshop/[workshop=workshop]/daily-report/+server.ts
// WSK-10/13 — simpan Laporan Harian workshop dari lapangan SEKALIGUS (atomik + idempoten + penjaga tanggal ganda).
//   POST { clientTxnId, header, absensi[], absensi_leader[], material[], po_details[] }
//     -> 200 { success, laporanId, merged, jumlahTenaga, counts, skipped, manpowerForSync, idempotent }
//     -> 409 { success:false, code:'LAPORAN_TANGGAL_ADA', message, existing }   (mode 'tolak', bawaan)
// Padanan endpoint erp-epi (kontrak identik). Otorisasi per PO di server — lihat $lib/server/workshopDailyReport.ts.
import type { RequestHandler } from './$types';
import { handleDailyReportCreate } from '$lib/server/workshopDailyReport';
import type { OpsWorkshopKey } from '$lib/services/workshopOpsProfile';

export const POST: RequestHandler = (event) => handleDailyReportCreate(event, event.params.workshop as OpsWorkshopKey);
