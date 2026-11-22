// src/routes/api/ess/pakta-saya/+server.ts
// "Pakta & Aturan Saya" (dropdown header): semua SOP/Alur/perubahan Gate yang belum disetujui dan TERKAIT aturan rute — dikelompokkan,
// dengan rute kegiatan yang dikunci tiap item. Fitur mati → jawab cepat tanpa query tambahan. Gagal baca → fail-open + errors.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadGateItemsForUser, loadPaktaCatalog, loadPaktaConfig, loadPaktaConfirms, loadPaktaObjections, objectionMap, paktaBacaUrl } from '$lib/server/paktaServer';
import { listPaktaSaya } from '$lib/utils/paktaPolicy';
import { computeUnconfirmed } from '$lib/utils/sopReadRequirement';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const cfg = await loadPaktaConfig();
	if (!cfg.enabled || cfg.route_rules.length === 0) return json({ success: true, enabled: cfg.enabled, count: 0, prosedur: [], gate: [] });

	const errors: string[] = [];
	const catalog = await loadPaktaCatalog();
	errors.push(...catalog.errors);
	const confirms = await loadPaktaConfirms(karyawan.id, errors);
	const gateItems = await loadGateItemsForUser(cfg, karyawan.id, errors);
	const unconfirmed = [...computeUnconfirmed({ flows: catalog.flows, sops: catalog.sops, confirms, divisi: karyawan.divisi }), ...gateItems];
	const base = listPaktaSaya(unconfirmed, cfg);
	if (base.count === 0) return json({ success: true, enabled: true, count: 0, prosedur: [], gate: [], ...(errors.length ? { errors } : {}) });

	// Status kendala per item (dispensasi tidak dihitung) — dibaca hanya bila ada item.
	const objRows = await loadPaktaObjections(karyawan.id, errors);
	const r = listPaktaSaya(unconfirmed, cfg, objectionMap(objRows, unconfirmed));
	const withUrl = <T extends { type: string; flow_key: string | null; sop_id: number | null }>(x: T) => ({ ...x, baca_url: x.type === 'gate' ? null : paktaBacaUrl(x as any) });
	return json({ success: true, enabled: true, count: r.count, prosedur: r.prosedur.map(withUrl), gate: r.gate.map(withUrl), ...(errors.length ? { errors } : {}) });
};
