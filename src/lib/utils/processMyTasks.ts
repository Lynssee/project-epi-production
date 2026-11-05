// src/lib/utils/processMyTasks.ts
// "Tugas Saya di Alur": langkah-langkah alur yang PIC-nya cocok pasti dengan jabatan pengguna. Murni, dites.
// Hanya kecocokan pasti (explicit/alias/exact) yang dihitung — tebakan tidak pernah membuat orang merasa "ditugaskan".
import type { ProcessFlow } from '$lib/data/processGuidance';
import { resolveNodePositions, type PosisiIndex } from '$lib/utils/processPicResolver';
import { trainingForNode } from '$lib/utils/processTraining';

/** Jabatan pengguna yang dipakai untuk memetakan tugas. via: dari jabatan_id karyawan, atau dari teks karyawan.posisi yang cocok pasti. */
export interface MyPosisi {
	id: number;
	nama: string;
	via: 'jabatan_id' | 'posisi_teks';
}

export interface MyTask {
	flow_id: string;
	flow_title: string;
	node_id: string;
	label: string;
	lane_label: string;
	type: string;
	sla_hours: number | null;
	kpi_code: string;
	gate_keys: string[];
	/** punya pintasan formulir lapangan */
	has_actions: boolean;
	/** Program training yang berlaku untuk langkah ini (tautan langkah + alur). Opsional: salinan lama di perangkat tidak memilikinya. */
	training?: { program_id: number; wajib: boolean }[];
	/** Jabatan penerima serah-terima berikutnya (posisi.id); detail kontaknya ada di `contacts` respons /mine. */
	handoff_to?: number[];
}

/** Langkah "end" hanya penanda selesai, bukan pekerjaan seseorang. */
export function extractMyTasks(flows: ProcessFlow[], index: PosisiIndex, posisiId: number | null): MyTask[] {
	if (!posisiId) return [];
	const out: MyTask[] = [];
	for (const flow of Array.isArray(flows) ? flows : []) {
		if (!flow || !flow.id) continue;
		const laneLabel = new Map((flow.lanes || []).map((l) => [l.key, l.label]));
		for (const node of flow.nodes || []) {
			if (!node || node.type === 'end') continue;
			if (!resolveNodePositions(node, index).posisiIds.includes(posisiId)) continue;
			out.push({
				flow_id: flow.id,
				flow_title: flow.title,
				node_id: node.id,
				label: node.label,
				lane_label: laneLabel.get(node.lane) || node.lane,
				type: node.type,
				sla_hours: node.sla_hours && node.sla_hours > 0 ? node.sla_hours : null,
				kpi_code: node.kpi_code || '',
				gate_keys: (node.gates || []).map((g) => g.key).filter(Boolean),
				has_actions: (node.actions || []).length > 0,
				training: trainingForNode(flow, node.id).map((t) => ({ program_id: t.program_id, wajib: t.wajib }))
			});
		}
	}
	return out;
}

/** Ringkasan ringan satu alur (tanpa definisi) untuk daftar pilihan di HP. */
export interface FlowSummary {
	id: string;
	title: string;
	description: string;
	version: number;
	node_count: number;
	sop_code?: string;
	kategori_sop?: 'master' | 'induk' | 'turunan';
	sub_kategori?: string;
	approval_status?: string;
	sosialisasi_end_date?: string;
	procedure_type?: string;
	/** id baris Directus & id induknya (breadcrumb). */
	row_id?: number;
	parent_row_id?: number;
}
export function summarizeFlow(flow: ProcessFlow & { version?: number }): FlowSummary {
	return {
		id: flow.id,
		title: flow.title,
		description: (flow.description || '').slice(0, 200),
		version: flow.version ?? 1,
		node_count: (flow.nodes || []).length,
		...(flow.sop_code ? { sop_code: flow.sop_code } : {}),
		...(flow.kategori_sop ? { kategori_sop: flow.kategori_sop } : {}),
		...(flow.sub_kategori ? { sub_kategori: flow.sub_kategori } : {}),
		...(flow.approval_status ? { approval_status: flow.approval_status } : {}),
		...(flow.sosialisasi_end_date ? { sosialisasi_end_date: flow.sosialisasi_end_date } : {}),
		...(flow.procedure_type ? { procedure_type: flow.procedure_type } : {}),
		...(flow.row_id ? { row_id: flow.row_id } : {}),
		...(flow.parent_row_id ? { parent_row_id: flow.parent_row_id } : {})
	};
}
