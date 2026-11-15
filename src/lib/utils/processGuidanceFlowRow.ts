// src/lib/utils/processGuidanceFlowRow.ts
// Normalisasi baris `process_guidance_flows` (Directus, DIKELOLA dari erp-epi /settings/process-guidance) → ProcessFlow versi LAPANGAN.
// Beda dengan erp-epi: pintasan diambil dari `actions_field` (route project-epi); gates disertakan read-only untuk rambu lapangan.
// Defensif: data rusak dibuang, tidak boleh membuat layar putih. Cermin processGuidanceFlowRow.js di erp-epi.
import type { ProcessAction, ProcessHandoff, ProcessFlow, ProcessNode, ProcessNodeType, ProcessFlowSop, ProcessGateRef, ProcessTrainingLink } from '$lib/data/processGuidance';

const NODE_TYPES = new Set<string>(['start', 'task', 'decision', 'end']);

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, def = 0): number => (v !== null && v !== '' && v !== undefined && Number.isInteger(Number(v)) ? Number(v) : def);
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
	Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

/** Pintasan hanya path internal ("/…", bukan "//host" atau skema lain). */
function cleanActions(v: unknown): ProcessAction[] {
	if (!Array.isArray(v)) return [];
	return v
		.map((a: any) => ({ label: str(a?.label, 80), href: str(a?.href, 300) }))
		.filter((a) => a.label && /^\/(?!\/)[^\s]*$/.test(a.href))
		.slice(0, 8);
}

const HANDOFF_TYPES = ['dokumen', 'barang', 'dana', 'otorisasi'];
/** Serah-terima lintas alur (cermin canonHandoffs erp-epi): format salah dibuang, maks. 8 per langkah. */
function cleanHandoffs(v: unknown): ProcessHandoff[] {
	if (!Array.isArray(v)) return [];
	const out: ProcessHandoff[] = [];
	for (const h of v) {
		const key = str(h?.target_flow_key, 100);
		const type = str(h?.handoff_type, 20) || 'dokumen';
		const node = str(h?.target_node_id, 60);
		if (!/^[a-z0-9_]{1,100}$/.test(key) || !HANDOFF_TYPES.includes(type) || (node && !/^[a-z0-9_]{1,60}$/.test(node))) continue;
		out.push({ target_flow_key: key, target_node_id: node, doc_label: str(h?.doc_label, 120), handoff_type: type as ProcessHandoff['handoff_type'] });
		if (out.length >= 8) break;
	}
	return out;
}

function cleanGates(v: unknown): ProcessGateRef[] {
	if (!Array.isArray(v)) return [];
	return v
		.map((g: any) => ({ key: str(g?.key, 100), modul: str(g?.modul, 100), documentType: str(g?.documentType, 100) }))
		.filter((g) => g.key)
		.slice(0, 20);
}

function canonicalizeSopBlock(sop: any): ProcessFlowSop | undefined {
	if (!sop || typeof sop !== 'object' || Array.isArray(sop)) return undefined;
	const doc_number = str(sop.doc_number, 100);
	const effective_date = str(sop.effective_date, 40);
	const revision_status = str(sop.revision_status, 40);
	const department_key = str(sop.department_key, 60);
	const department_label = str(sop.department_label, 100);
	const company_name = str(sop.company_name, 120);
	const purpose = str(sop.purpose, 2000);
	const scope = str(sop.scope, 2000);
	const deliverables = strList(sop.deliverables, 30, 300);
	const definitions = (Array.isArray(sop.definitions) ? sop.definitions : [])
		.filter((d: any) => d && typeof d === 'object')
		.map((d: any) => ({ term: str(d.term, 100), meaning: str(d.meaning, 500) }))
		.filter((d: any) => d.term)
		.slice(0, 30);

	let approvals: ProcessFlowSop['approvals'] = undefined;
	if (sop.approvals && typeof sop.approvals === 'object') {
		approvals = {
			hrd: {
				label: str(sop.approvals.hrd?.label, 60) || 'HRD',
				name: str(sop.approvals.hrd?.name, 100),
				title: str(sop.approvals.hrd?.title, 100),
				status: str(sop.approvals.hrd?.status, 40) || 'approved',
				date: str(sop.approvals.hrd?.date, 40)
			},
			related_div: {
				label: str(sop.approvals.related_div?.label, 60) || 'DIVISI TERKAIT',
				name: str(sop.approvals.related_div?.name, 100),
				title: str(sop.approvals.related_div?.title, 100),
				status: str(sop.approvals.related_div?.status, 40) || 'approved',
				date: str(sop.approvals.related_div?.date, 40)
			},
			management: {
				label: str(sop.approvals.management?.label, 60) || 'MANAGEMENT',
				name: str(sop.approvals.management?.name, 100),
				title: str(sop.approvals.management?.title, 100),
				status: str(sop.approvals.management?.status, 40) || 'approved',
				date: str(sop.approvals.management?.date, 40)
			}
		};
	}

	const res: ProcessFlowSop = {};
	if (doc_number) res.doc_number = doc_number;
	if (effective_date) res.effective_date = effective_date;
	if (revision_status) res.revision_status = revision_status;
	if (department_key) res.department_key = department_key;
	if (department_label) res.department_label = department_label;
	if (company_name) res.company_name = company_name;
	if (purpose) res.purpose = purpose;
	if (scope) res.scope = scope;
	if (deliverables.length) res.deliverables = deliverables;
	if (definitions.length) res.definitions = definitions;
	if (approvals) res.approvals = approvals;

	return Object.keys(res).length > 0 ? res : undefined;
}

/**
 * Inferensi cerdas sifat prosedur dari alur jika belum diset manual oleh Superadmin (cermin erp-epi)
 */
export function inferProcedureType(flow: {
	title?: string;
	flow_key?: string;
	id?: string;
	target_app?: string;
	procedure_type?: string;
}): 'field_ops' | 'administrative' | 'management_gate' | 'emergency_qhse' {
	if (flow?.procedure_type && ['field_ops', 'administrative', 'management_gate', 'emergency_qhse'].includes(flow.procedure_type)) {
		return flow.procedure_type as any;
	}

	const title = (flow?.title || '').toLowerCase();
	const key = (flow?.flow_key || flow?.id || '').toLowerCase();
	const targetApp = flow?.target_app || '';

	if (
		title.includes('darurat') ||
		title.includes('insiden') ||
		title.includes('incident') ||
		title.includes('emergency') ||
		title.includes('stop work') ||
		title.includes('kecelakaan') ||
		title.includes('evakuasi') ||
		key.includes('emergency') ||
		key.includes('incident')
	) {
		return 'emergency_qhse';
	}

	if (
		title.includes('approval') ||
		title.includes('persetujuan') ||
		title.includes('eskalasi') ||
		title.includes('evaluasi') ||
		title.includes('closing') ||
		title.includes('bast final') ||
		title.includes('kebijakan') ||
		title.includes('tinjauan manajemen') ||
		title.includes('kalibrasi gate') ||
		key.includes('approval') ||
		key.includes('closing') ||
		key.includes('governance')
	) {
		return 'management_gate';
	}

	if (
		targetApp === 'project-epi' ||
		key.startsWith('field_') ||
		key.startsWith('workshop_') ||
		title.includes('inspeksi') ||
		title.includes('pengujian') ||
		title.includes('aplikasi') ||
		title.includes('blasting') ||
		title.includes('coating') ||
		title.includes('spark') ||
		title.includes('holiday') ||
		title.includes('dft') ||
		title.includes('pinhole') ||
		title.includes('checklist') ||
		title.includes('pemasangan') ||
		title.includes('perakitan') ||
		title.includes('overhaul') ||
		title.includes('kalibrasi') ||
		title.includes('pemeliharaan') ||
		title.includes('pemeriksaan fisik') ||
		title.includes('lapangan')
	) {
		return 'field_ops';
	}

	if (
		targetApp === 'erp-epi' ||
		title.includes('penerbitan') ||
		title.includes('surat jalan') ||
		title.includes('faktur') ||
		title.includes('invoice') ||
		title.includes('pembayaran') ||
		title.includes('kasbon') ||
		title.includes('pengajuan') ||
		title.includes('rekonsiliasi') ||
		title.includes('pembelian') ||
		title.includes('payroll') ||
		title.includes('absensi') ||
		title.includes('kontrak') ||
		title.includes('registrasi')
	) {
		return 'administrative';
	}

	return 'field_ops';
}

export interface NormalizedFlow {
	flow: ProcessFlow & { version: number };
	dropped: string[];
}

export function normalizeFlowRow(row: any): NormalizedFlow | null {
	const flowKey = str(row?.flow_key, 100);
	let def: any = row?.definition;
	if (typeof def === 'string') {
		try {
			def = JSON.parse(def);
		} catch {
			def = null;
		}
	}
	if (!flowKey || !def || typeof def !== 'object' || !Array.isArray(def.nodes) || !Array.isArray(def.lanes)) return null;

	const dropped: string[] = [];
	const lanes: { key: string; label: string }[] = [];
	const laneKeys = new Set<string>();
	for (const l of def.lanes) {
		const key = str(l?.key, 60);
		if (!key || laneKeys.has(key)) {
			dropped.push(`lane ${l?.key ?? '(kosong)'}`);
			continue;
		}
		laneKeys.add(key);
		lanes.push({ key, label: str(l?.label, 60) || key.toUpperCase() });
	}

	const nodes: ProcessNode[] = [];
	const ids = new Set<string>();
	for (const n of def.nodes) {
		const id = str(n?.id, 60);
		if (!id || ids.has(id) || !laneKeys.has(n?.lane)) {
			dropped.push(`node ${n?.id ?? '(kosong)'}`);
			continue;
		}
		ids.add(id);
		// Field integrasi jobdesc/KPI (opsional; cermin erp-epi) — hanya dimunculkan bila valid.
		const posisiIds = [...new Set((Array.isArray(n.posisi_ids) ? n.posisi_ids : []).map(Number).filter((x: number) => Number.isInteger(x) && x > 0))].slice(0, 5) as number[];
		const trainingIds = [...new Set((Array.isArray(n.training_ids) ? n.training_ids : []).map(Number).filter((x: number) => Number.isInteger(x) && x > 0))].slice(0, 3) as number[];
		const sla = Number(n.sla_hours);
		const kpiCode = str(n.kpi_code, 60);
		const handoffs = cleanHandoffs(n.handoffs);
		nodes.push({
			...(handoffs.length ? { handoffs } : {}),
			...(posisiIds.length ? { posisi_ids: posisiIds } : {}),
			...(sla > 0 && sla <= 24 * 365 ? { sla_hours: Math.round(sla * 100) / 100 } : {}),
			...(kpiCode ? { kpi_code: kpiCode } : {}),
			...(trainingIds.length ? { training_ids: trainingIds } : {}),
			id,
			type: (NODE_TYPES.has(n.type) ? n.type : 'task') as ProcessNodeType,
			lane: n.lane,
			col: Math.max(0, int(n.col)),
			row: Math.max(0, int(n.row)),
			label: str(n.label, 80) || id,
			desc: str(n.desc, 2000),
			pic: str(n.pic, 200),
			checklist: strList(n.checklist, 20, 300),
			blockers: strList(n.blockers, 20, 300),
			actions: cleanActions(n.actions_field), // lapangan: HANYA pintasan lapangan
			gates: cleanGates(n.gates) // rambu gate sistem (read-only)
		});
	}

	const edges: { from: string; to: string; label?: string }[] = [];
	for (const e of Array.isArray(def.edges) ? def.edges : []) {
		const from = str(e?.from, 60);
		const to = str(e?.to, 60);
		if (!ids.has(from) || !ids.has(to)) {
			dropped.push(`edge ${e?.from}->${e?.to}`);
			continue;
		}
		const label = typeof e.label === 'string' ? e.label.slice(0, 60) : '';
		edges.push(label ? { from, to, label } : { from, to });
	}

	const sop = canonicalizeSopBlock(def.sop);
	// Tautan training tingkat alur (cermin canonTrainingLinks di erp-epi): id valid & unik, maks. 5; `wajib` hanya informasi.
	const training: ProcessTrainingLink[] = [];
	for (const t of Array.isArray(def.training) ? def.training : []) {
		const pid = Number(t?.program_id);
		if (!Number.isInteger(pid) || pid <= 0 || training.some((x) => x.program_id === pid)) continue;
		training.push({ program_id: pid, wajib: t.wajib === true || t.wajib === 'true' || t.wajib === 1, ...(str(t.catatan, 200) ? { catatan: str(t.catatan, 200) } : {}) });
		if (training.length >= 5) break;
	}
	const sop_code = str(row?.sop_code, 50);
	const kategori_sop = ['master', 'induk', 'turunan'].includes(row?.kategori_sop) ? row.kategori_sop : undefined;
	const sub_kategori = str(row?.sub_kategori, 100);
	// Kolom tahap_proyek (json array kunci tahap): hanya kunci valid, unik, maks. 12; selain array → diabaikan.
	const rawTahap = typeof row?.tahap_proyek === 'string' ? (() => { try { return JSON.parse(row.tahap_proyek); } catch { return []; } })() : row?.tahap_proyek;
	const tahap_proyek = Array.isArray(rawTahap) ? [...new Set(rawTahap.map((k: unknown) => String(k ?? '').trim()).filter((k: string) => /^[a-z][a-z0-9_]{1,39}$/.test(k)))].slice(0, 12) : [];
	const approval_status = str(row?.approval_status, 40);
	const external_flowchart_url = str(row?.external_flowchart_url, 1000);
	const external_doc_url = str(row?.external_doc_url, 1000);
	const sosialisasi_end_date = str(row?.sosialisasi_end_date, 30);
	const posInt = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
	const row_id = posInt(row?.id);
	const parent_row_id = posInt(row?.parent_flow_id);
	const rawProcedureType = str(row?.procedure_type, 40);
	const procedure_type = ['field_ops', 'administrative', 'management_gate', 'emergency_qhse'].includes(rawProcedureType)
		? rawProcedureType
		: inferProcedureType(row);

	return {
		flow: {
			id: flowKey,
			title: str(row.title, 120) || flowKey,
			description: str(row.description, 1000),
			lanes,
			nodes,
			edges,
			version: int(row.version, 1),
			...(training.length ? { training } : {}),
			...(sop ? { sop } : {}),
			...(sop_code ? { sop_code } : {}),
			...(kategori_sop ? { kategori_sop } : {}),
			...(sub_kategori ? { sub_kategori } : {}),
			...(tahap_proyek.length ? { tahap_proyek } : {}),
			...(approval_status ? { approval_status } : {}),
			...(external_flowchart_url ? { external_flowchart_url } : {}),
			...(external_doc_url ? { external_doc_url } : {}),
			...(sosialisasi_end_date ? { sosialisasi_end_date } : {}),
			...(procedure_type ? { procedure_type } : {}),
			...(row_id ? { row_id } : {}),
			...(parent_row_id ? { parent_row_id } : {})
		},
		dropped
	};
}
