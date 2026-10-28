// src/routes/api/workshop/[workshop=workshop]/quick-report/+server.ts
// WSK-13 — Quick Report lapangan (1 PO + foto + catatan) atomik + idempoten.
//   POST { clientTxnId, projectId, aktivitas?, fotoIds[] } -> 200 { success, laporanId, idempotent, tanggal }
import type { RequestHandler } from './$types';
import { handleQuickReportCreate } from '$lib/server/workshopDailyReport';
import type { OpsWorkshopKey } from '$lib/services/workshopOpsProfile';

export const POST: RequestHandler = (event) => handleQuickReportCreate(event, event.params.workshop as OpsWorkshopKey);
