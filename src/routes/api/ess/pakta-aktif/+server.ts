// src/routes/api/ess/pakta-aktif/+server.ts
// Pakta Pra-Kegiatan (rencana_sistem_pakta_sop_gate §5 Fase 1): untuk halaman yang sedang dibuka, SATU endpoint ringan yang
// menjawab "apakah ada SOP/Alur masa-sosialisasi yang WAJIB disetujui sebelum kegiatan ini dimulai, dan apakah halaman dikunci?".
//   GET ?path=/stock-lapangan/opname
// Hemat beban: setelan & katalog di-cache 5 menit di server; bila fitur mati / rute tak punya aturan / rute darurat →
// langsung jawab tanpa menyentuh Directus lagi. Hanya konfirmasi + keberatan milik pengguna yang dibaca per permintaan.
// Gagal baca Directus → fail-open (show:false) + `errors` (jangan melumpuhkan lapangan karena gangguan baca), dicatat di log.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import {
	PAKTA_GATE_KEY,
	loadPaktaCatalog,
	loadPaktaConfig,
	loadGateItemsForUser,
	loadPaktaConfirms,
	loadPaktaObjections,
	objectionMap,
	paktaBacaUrl,
	paktaRingkasan,
	resolvePaktaMode
} from '$lib/server/paktaServer';
import { decidePakta, itemsForPath, rulesForPath } from '$lib/utils/paktaPolicy';
import { computeUnconfirmed } from '$lib/utils/sopReadRequirement';

const KOSONG = { show: false, presentation: 'none', blocked: false, canProceedWithNote: false } as const;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const path = event.url.searchParams.get('path') || '';

	const cfg = await loadPaktaConfig();
	if (!cfg.enabled || rulesForPath(path, cfg).length === 0) {
		return json({ success: true, enabled: cfg.enabled, path, decision: KOSONG, items: [] });
	}

	const errors: string[] = [];
	const catalog = await loadPaktaCatalog();
	errors.push(...catalog.errors);
	const confirms = await loadPaktaConfirms(karyawan.id, errors);
	// Pakta jenis gate: hanya dimuat bila aturan rute ini menyebut gate_keys (hemat query).
	const gateItems = rulesForPath(path, cfg).some((r) => r.match.gate_keys?.length) ? await loadGateItemsForUser(cfg, karyawan.id, errors) : [];
	const unconfirmed = [...computeUnconfirmed({ flows: catalog.flows, sops: catalog.sops, confirms, divisi: karyawan.divisi }), ...gateItems];
	const { items, label } = itemsForPath(unconfirmed, path, cfg);

	if (items.length === 0) {
		return json({ success: true, enabled: true, path, label, decision: KOSONG, items: [], ...(errors.length ? { errors } : {}) });
	}

	const [gateMode, objRows] = await Promise.all([resolvePaktaMode(catalog.gateDef), loadPaktaObjections(karyawan.id, errors)]);
	const decision = decidePakta({ gateMode, items, objections: objectionMap(objRows, items) });

	return json({
		success: true,
		enabled: true,
		path,
		label,
		gate_key: PAKTA_GATE_KEY,
		gate_mode: gateMode,
		gate_nama: catalog.gateDef?.nama ?? null,
		gate_hint: catalog.gateDef?.hint ?? null,
		settings: { min_read_seconds: cfg.min_read_seconds, require_scroll: cfg.require_scroll },
		decision: {
			show: decision.show,
			presentation: decision.presentation,
			blocked: decision.blocked,
			canProceedWithNote: decision.canProceedWithNote
		},
		items: decision.pending.map((i) => ({
			type: i.type,
			id: i.id,
			flow_key: i.flow_key,
			sop_id: i.sop_id,
			title: i.title,
			sop_code: i.sop_code,
			version: i.version,
			sosialisasi_end_date: i.sosialisasi_end_date,
			gate_key: i.gate_key ?? null,
			gate_to: i.gate_to ?? null,
			ringkasan: i.type === 'gate' ? (i.ringkasan ?? null) : paktaRingkasan(i, catalog.sops),
			baca_url: i.type === 'gate' ? null : paktaBacaUrl(i)
		})),
		dispensed_count: decision.dispensed.length,
		...(errors.length ? { errors } : {})
	});
};
