// src/routes/api/process-guidance/flows/+server.ts
// GET: alur peta bisnis TERBIT untuk aplikasi lapangan (pintasan = actions_field). Wajib login (authenticateEss).
// Hemat kuota HP: seluruh alur ±2 MB, jadi ada dua bentuk ringan (halaman Alur Kerja memakai keduanya):
//   ?lite=1      -> ringkasan tiap alur tanpa definisi   { success, source:'directus', flows:[{id,title,description,version,node_count}] }
//   ?id=<alur>   -> SATU alur lengkap                    { success, source:'directus', flow } (404 bila tak ada)
//   ?chain=<alur> -> Rantai Serah-Terima alur itu { success, source:'directus', chain:{upstream,downstream} } (404 bila tak ada); konfigurasi
//                    serah-terima dibaca dari app_settings (cache 5 mnt) dan bila gagal memakai bawaan — tidak pernah menggagalkan rantai
//   ?gates=<alur> -> ringkasan GATE alur itu untuk kartu "Siklus Dokumen & Syarat Lolos Gate" { success, source:'directus', gates:{[gate_key]:{mode,nama,message,hint,owner_role,bypass,checklist}}, available, partial?, reason? }
//                    dibaca dari admin (cache 5 mnt per scope, token pemanggil diteruskan); gagal → available:false (kartu tetap tampil tanpa detail)
//   ?kendala=<kata> -> pencarian cepat kendala/gate/syarat lintas alur { success, hits:[{flow_id,flow_title,node_id,node_label,kind,snippet}] } (maks. 12; tanpa mengunduh alur)
//   ?tahap=1 -> widget "Panduan SOP Tahap Ini": { success, source:'directus', stages:[...], flows:[{id,title,sop_code,kategori_sop,sub_kategori,tahap_proyek,approval_status,sosialisasi_end_date,node_count}] }
//                (hanya alur ber-tahap_proyek; tak ada → stages & flows kosong)
//   (tanpa param) -> semua alur lengkap, seperti semula  { success, source:'directus', flows }
//   Directus gagal -> { success: true, source: 'fallback', flows: [] } → klien memakai salinan lokal (processGuidance.ts)
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { summarizeFlow } from '$lib/utils/processMyTasks';
import { loadHandoffConfig } from '$lib/server/processHandoffConfig';
import { loadProjectStagesConfig } from '$lib/server/processProjectStagesConfig';
import { buildChain } from '$lib/utils/processHandoffChain';
import { loadGateInfoForFlow } from './gateInfo';
import { searchKendala, MIN_QUERY } from './kendalaSearch';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const params = event.url?.searchParams ?? new URLSearchParams();
	// Kueri terlalu pendek: jawab kosong TANPA membaca alur (ketikan pertama tidak membebani server).
	const kendala = params.get('kendala');
	if (kendala !== null && kendala.trim().length < MIN_QUERY) return json({ success: true, hits: [] });
	try {
		const flows = await loadPublishedFlowsForField();
		const chainId = params.get('chain');
		if (chainId) {
			if (!flows.some((f) => f.id === chainId)) return json({ success: false, error: 'Alur tidak ditemukan.' }, { status: 404 });
			return json({ success: true, source: 'directus', chain: buildChain(chainId, flows, await loadHandoffConfig()) });
		}
		const gatesId = params.get('gates');
		if (gatesId) {
			const flow = flows.find((f) => f.id === gatesId);
			if (!flow) return json({ success: false, error: 'Alur tidak ditemukan.' }, { status: 404 });
			const info = await loadGateInfoForFlow(flow, event.request?.headers?.get('authorization') || '');
			return json({ success: true, source: 'directus', ...info });
		}
		// ?tahap=1: HANYA alur ber-tahap_proyek (ringkas, tanpa definisi) + daftar tahap. Tak ada alur bertahap → kosong
		// (klien tidak perlu membaca data proyek sama sekali).
		if (params.get('tahap') === '1') {
			const staged = flows.filter((f) => Array.isArray(f.tahap_proyek) && f.tahap_proyek.length > 0);
			return json({
				success: true,
				source: 'directus',
				stages: staged.length ? await loadProjectStagesConfig() : [],
				flows: staged.map((f) => ({
					id: f.id,
					title: f.title,
					sop_code: f.sop_code,
					kategori_sop: f.kategori_sop,
					sub_kategori: f.sub_kategori,
					tahap_proyek: f.tahap_proyek,
					approval_status: f.approval_status,
					sosialisasi_end_date: f.sosialisasi_end_date,
					node_count: f.nodes.length
				}))
			});
		}
		if (kendala !== null) return json({ success: true, hits: searchKendala(flows, kendala) });
		const id = params.get('id');
		if (id) {
			const flow = flows.find((f) => f.id === id);
			if (!flow) return json({ success: false, error: 'Alur tidak ditemukan.' }, { status: 404 });
			return json({ success: true, source: 'directus', flow });
		}
		if (params.get('lite') === '1') {
			return json({ success: true, source: 'directus', flows: flows.map((f) => summarizeFlow(f)) });
		}
		return json({ success: true, source: 'directus', flows });
	} catch (e) {
		console.warn('[process-guidance/flows] gagal baca Directus — klien memakai salinan lokal:', e instanceof Error ? e.message : e);
		return json({ success: true, source: 'fallback', flows: [], warning: 'Alur gagal dimuat dari server; memakai salinan lokal.' });
	}
};
