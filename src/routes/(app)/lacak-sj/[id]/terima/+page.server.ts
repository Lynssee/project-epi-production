// src/routes/(app)/lacak-sj/[id]/terima/+page.server.ts
// Fase 5 Pengiriman Ekspedisi (15 Okt 2026) — teruskan setelan terima_wajib_scan_fisik
// ke wizard. Auth tetap di endpoint data (authenticateGRActor dipanggil saat submit);
// load ini TIDAK melakukan otorisasi, murni setelan tampilan.

import type { PageServerLoad } from './$types';
import { getTerimaWajibScanFisik } from '$lib/server/sjTerimaSettings';

export const load: PageServerLoad = async () => {
	return { wajibScanFisik: await getTerimaWajibScanFisik() };
};
