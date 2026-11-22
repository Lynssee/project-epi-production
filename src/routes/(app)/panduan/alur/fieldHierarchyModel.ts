// src/routes/(app)/panduan/alur/fieldHierarchyModel.ts
// Pembantu murni membangun peran hirarki (Master -> Induk -> Anak Kerja / IK) & daftar drill-down lapangan
// langsung dari index ringkas (`FlowSummary[]`) yang sudah ada di memori (0 panggilan API tambahan, jalan offline).

import type { FlowSummary } from '$lib/utils/processMyTasks';

export type HierarchyLevel = 'master' | 'induk' | 'turunan';

export interface FieldHierarchyLabels {
	master: string;
	induk: string;
	turunan: string;
}

export const DEFAULT_FIELD_HIERARCHY_LABELS: FieldHierarchyLabels = {
	master: 'MASTER SOP',
	induk: 'SOP INDUK',
	turunan: 'ANAK KERJA / IK'
};

export interface FieldHierarchyItem {
	id: string;
	row_id: number | null;
	parent_row_id: number | null;
	title: string;
	sop_code: string;
	sub_kategori: string;
	kategori_sop: HierarchyLevel;
	role_label: string;
	approval_status: string;
	is_draft_approval: boolean;
	is_sosialisasi: boolean;
	node_count: number;
	procedure_type: string;
	depth: number;
}

export interface FieldIndukGroup {
	induk: FieldHierarchyItem;
	anakKerja: FieldHierarchyItem[];
}

export interface FieldHierarchyView {
	roleKey: HierarchyLevel;
	roleLabel: string;
	statement: string;
	ancestors: FieldHierarchyItem[];
	indukGroups: FieldIndukGroup[];
	directTurunan: FieldHierarchyItem[];
	counts: {
		totalDescendants: number;
		indukCount: number;
		turunanCount: number;
		draftApprovalCount: number;
		skippedDraftCount: number;
	};
}

export interface BuildFieldHierarchyOptions {
	currentKategori?: string | null;
	currentSopCode?: string | null;
	currentTitle?: string | null;
	labels?: Partial<FieldHierarchyLabels>;
	includeDraftApproval?: boolean;
}

const MAX_DEPTH = 4;

export function normalizeFieldKategori(val: unknown): HierarchyLevel {
	const s = String(val ?? '').trim().toLowerCase();
	if (s === 'master' || s === 'induk' || s === 'turunan') return s;
	return 'induk';
}

function sortItems(a: FlowSummary, b: FlowSummary): number {
	const rank = (k: unknown) => {
		const n = normalizeFieldKategori(k);
		return n === 'master' ? 0 : n === 'induk' ? 1 : 2;
	};
	const ra = rank(a.kategori_sop);
	const rb = rank(b.kategori_sop);
	if (ra !== rb) return ra - rb;
	const ca = String(a.sop_code ?? '');
	const cb = String(b.sop_code ?? '');
	if (ca !== cb) return ca.localeCompare(cb);
	return String(a.title ?? a.id).localeCompare(String(b.title ?? b.id));
}

function toFieldItem(
	f: FlowSummary,
	depth: number,
	labels: FieldHierarchyLabels
): FieldHierarchyItem {
	const kat = normalizeFieldKategori(f.kategori_sop);
	const appStatus = String(f.approval_status ?? '').trim().toLowerCase();
	return {
		id: f.id,
		row_id: Number.isInteger(Number(f.row_id)) && Number(f.row_id) > 0 ? Number(f.row_id) : null,
		parent_row_id:
			Number.isInteger(Number(f.parent_row_id)) && Number(f.parent_row_id) > 0
				? Number(f.parent_row_id)
				: null,
		title: f.title || f.id,
		sop_code: String(f.sop_code ?? '').trim(),
		sub_kategori: String(f.sub_kategori ?? '').trim(),
		kategori_sop: kat,
		role_label: labels[kat],
		approval_status: appStatus || 'published',
		is_draft_approval: appStatus === 'draft',
		is_sosialisasi: appStatus === 'butuh_sosialisasi' || appStatus === 'sosialisasi',
		node_count: Number(f.node_count) || 0,
		procedure_type: String(f.procedure_type ?? '').trim(),
		depth
	};
}

function formatCodeTitle(code: string | undefined, title: string | undefined): string {
	const t = String(title ?? '').trim();
	const c = String(code ?? '').trim();
	return c ? `[${c}] ${t}` : t;
}

/**
 * Bangun metadata keterangan peran & daftar Induk/IK di bawah naungan prosedur yang sedang dibuka.
 * Aman terhadap siklus data, `row_id` kosong, dan filter `includeDraftApproval`.
 */
export function buildFieldHierarchyView(
	currentFlowId: string,
	index: FlowSummary[],
	opts: BuildFieldHierarchyOptions = {}
): FieldHierarchyView {
	const labels: FieldHierarchyLabels = {
		master: String(opts.labels?.master || '').trim() || DEFAULT_FIELD_HIERARCHY_LABELS.master,
		induk: String(opts.labels?.induk || '').trim() || DEFAULT_FIELD_HIERARCHY_LABELS.induk,
		turunan: String(opts.labels?.turunan || '').trim() || DEFAULT_FIELD_HIERARCHY_LABELS.turunan
	};
	const includeDraft = opts.includeDraftApproval !== false;
	const list = Array.isArray(index) ? index : [];

	const byRow = new Map<number, FlowSummary>();
	const childrenByParent = new Map<number, FlowSummary[]>();
	for (const f of list) {
		const rid = Number(f.row_id);
		if (Number.isInteger(rid) && rid > 0) byRow.set(rid, f);
		const pid = Number(f.parent_row_id);
		if (Number.isInteger(pid) && pid > 0) {
			const bucket = childrenByParent.get(pid) ?? [];
			bucket.push(f);
			childrenByParent.set(pid, bucket);
		}
	}

	const cur = list.find((f) => f.id === currentFlowId) ?? null;
	const roleKey = normalizeFieldKategori(opts.currentKategori ?? cur?.kategori_sop);
	const roleLabel = labels[roleKey];

	// Silsilah ke atas (Master -> ... -> induk langsung)
	const ancestors: FieldHierarchyItem[] = [];
	if (cur?.row_id || cur?.parent_row_id) {
		const seenUp = new Set<number>();
		if (cur.row_id) seenUp.add(cur.row_id);
		let pid = Number(cur.parent_row_id);
		for (let g = 0; pid && g < MAX_DEPTH && !seenUp.has(pid); g++) {
			seenUp.add(pid);
			const parent = byRow.get(pid);
			if (!parent) break;
			ancestors.unshift(toFieldItem(parent, 0, labels));
			pid = Number(parent.parent_row_id);
		}
	}

	// Subpohon ke bawah (Induk & Anak Kerja / IK)
	const indukGroups: FieldIndukGroup[] = [];
	const directTurunan: FieldHierarchyItem[] = [];
	let indukCount = 0;
	let turunanCount = 0;
	let draftApprovalCount = 0;
	let skippedDraftCount = 0;

	const collectGrandchildren = (
		rootParentRowId: number | null,
		visited: Set<number>,
		startDepth: number
	): FieldHierarchyItem[] => {
		if (!rootParentRowId || startDepth > MAX_DEPTH) return [];
		const rawKids = [...(childrenByParent.get(rootParentRowId) ?? [])].sort(sortItems);
		const out: FieldHierarchyItem[] = [];
		for (const k of rawKids) {
			const rid = Number(k.row_id);
			if (rid && visited.has(rid)) continue;
			if (rid) visited.add(rid);
			const isDraft = String(k.approval_status ?? '').trim().toLowerCase() === 'draft';
			if (isDraft && !includeDraft) {
				skippedDraftCount += 1;
				continue;
			}
			const item = toFieldItem(k, startDepth, labels);
			if (item.kategori_sop === 'induk') indukCount += 1;
			else if (item.kategori_sop === 'turunan') turunanCount += 1;
			if (item.is_draft_approval) draftApprovalCount += 1;
			out.push(item);
			if (rid && startDepth < MAX_DEPTH) {
				out.push(...collectGrandchildren(rid, visited, startDepth + 1));
			}
		}
		return out;
	};

	const curRowId = Number(cur?.row_id);
	if (Number.isInteger(curRowId) && curRowId > 0) {
		const visited = new Set<number>([curRowId]);
		const directChildren = [...(childrenByParent.get(curRowId) ?? [])].sort(sortItems);
		for (const child of directChildren) {
			const rid = Number(child.row_id);
			if (rid && visited.has(rid)) continue;
			if (rid) visited.add(rid);
			const isDraft = String(child.approval_status ?? '').trim().toLowerCase() === 'draft';
			if (isDraft && !includeDraft) {
				skippedDraftCount += 1;
				continue;
			}
			const item = toFieldItem(child, 1, labels);
			if (item.is_draft_approval) draftApprovalCount += 1;

			if (item.kategori_sop === 'induk') {
				indukCount += 1;
				const anakKerja = collectGrandchildren(rid || null, visited, 2);
				indukGroups.push({ induk: item, anakKerja });
			} else {
				if (item.kategori_sop === 'turunan') turunanCount += 1;
				directTurunan.push(item);
				const nested = collectGrandchildren(rid || null, visited, 2);
				for (const n of nested) directTurunan.push(n);
			}
		}
	}

	const totalDescendants = indukCount + turunanCount;
	const directParent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
	const topMaster = ancestors.length > 0 ? ancestors[0] : null;

	let statement: string;
	if (roleKey === 'master') {
		statement = totalDescendants > 0
			? `Ini adalah ${roleLabel} yang menaungi ${indukCount} ${labels.induk} dan ${turunanCount} ${labels.turunan}.`
			: `Ini adalah ${roleLabel} (dokumen payung proses utama).`;
	} else if (roleKey === 'induk') {
		const parts = [`Ini adalah ${roleLabel}`];
		if (directParent) {
			parts.push(`di bawah naungan ${formatCodeTitle(directParent.sop_code, directParent.title)}`);
		}
		if (totalDescendants > 0) {
			parts.push(`dan membawahi ${totalDescendants} prosedur turunan (${turunanCount} IK)`);
		}
		statement = parts.join(' ') + '.';
	} else {
		const parts = [`Ini adalah ${roleLabel}`];
		if (directParent) {
			parts.push(`di bawah ${formatCodeTitle(directParent.sop_code, directParent.title)}`);
		}
		if (topMaster && directParent && topMaster.id !== directParent.id) {
			parts.push(`(Master: ${formatCodeTitle(topMaster.sop_code, topMaster.title)})`);
		}
		statement = parts.join(' ') + '.';
	}

	return {
		roleKey,
		roleLabel,
		statement,
		ancestors,
		indukGroups,
		directTurunan,
		counts: {
			totalDescendants,
			indukCount,
			turunanCount,
			draftApprovalCount,
			skippedDraftCount
		}
	};
}
