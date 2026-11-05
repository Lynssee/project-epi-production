// src/lib/utils/sopReadRequirement.ts
// Logika MURNI "SOP/Alur mana yang wajib dikonfirmasi paham" (gate G_FLD_SOP_READ_CONFIRMATION) — tanpa I/O.
//
// Aturan (Fase 4 Lifecycle Kebijakan→SOP):
//  • Wajib dikonfirmasi HANYA item yang sedang MASA SOSIALISASI (approval_status 'butuh_sosialisasi'). Alur/SOP yang sudah
//    published bukan beban konfirmasi lagi — sebelumnya 887 alur published dianggap "belum dikonfirmasi" untuk semua orang.
//  • Sadar versi: konfirmasi versi lama tidak berlaku untuk versi baru.
//      alur  → flow_version  (konfirmasi lama tanpa flow_version dianggap versi 1)
//      SOP   → sop_version_seq (tanpa nilai dianggap belum terkonfirmasi)
//  • SOP ditarget ke departemen: target_departments berisi divisi karyawan; bila kosong → department SOP == divisi;
//    bila keduanya kosong → semua orang.

export interface FlowRow {
	id: number;
	flow_key: string;
	title?: string | null;
	sop_code?: string | null;
	kategori_sop?: string | null;
	sub_kategori?: string | null;
	approval_status?: string | null;
	sosialisasi_end_date?: string | null;
	version?: number | null;
}

export interface SopRow {
	id: number;
	title?: string | null;
	sop_code?: string | null;
	department?: string | null;
	approval_status?: string | null;
	sosialisasi_end_date?: string | null;
	version_seq?: number | null;
	target_departments?: unknown;
}

export interface ConfirmRow {
	flow_key?: string | null;
	sop_id?: number | null;
	flow_version?: number | null;
	sop_version_seq?: number | null;
}

export interface UnconfirmedItem {
	type: 'flow' | 'sop';
	id: number;
	flow_key: string | null;
	sop_id: number | null;
	title: string | null;
	sop_code: string | null;
	kategori_sop: string | null;
	sub_kategori: string | null;
	approval_status: string | null;
	sosialisasi_end_date: string | null;
	version: number;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function sopTargetsDivisi(sop: SopRow, divisi: string | null | undefined): boolean {
	const targets = Array.isArray(sop.target_departments) ? (sop.target_departments as unknown[]).map(norm).filter(Boolean) : [];
	const mine = norm(divisi);
	if (targets.length > 0) return mine !== '' && targets.includes(mine);
	const dept = norm(sop.department);
	if (dept) return mine !== '' && dept === mine;
	return true;
}

/** Konfirmasi alur sah untuk versi sekarang? (legacy tanpa flow_version = v1) */
export function isFlowConfirmed(flow: FlowRow, confirms: ConfirmRow[]): boolean {
	const current = Number(flow.version) || 1;
	return confirms.some((c) => c.flow_key === flow.flow_key && (Number(c.flow_version) || 1) >= current);
}

/** Konfirmasi SOP sah untuk versi sekarang? (tanpa sop_version_seq = belum sah) */
export function isSopConfirmed(sop: SopRow, confirms: ConfirmRow[]): boolean {
	const current = Number(sop.version_seq) || 1;
	return confirms.some((c) => c.sop_id === sop.id && (Number(c.sop_version_seq) || 0) >= current);
}

export function computeUnconfirmed(input: {
	flows: FlowRow[];
	sops: SopRow[];
	confirms: ConfirmRow[];
	divisi?: string | null;
}): UnconfirmedItem[] {
	const confirms = Array.isArray(input.confirms) ? input.confirms : [];
	const items: UnconfirmedItem[] = [];

	for (const f of Array.isArray(input.flows) ? input.flows : []) {
		if (!f || f.approval_status !== 'butuh_sosialisasi' || !f.flow_key) continue;
		if (isFlowConfirmed(f, confirms)) continue;
		items.push({
			type: 'flow',
			id: f.id,
			flow_key: f.flow_key,
			sop_id: null,
			title: f.title ?? null,
			sop_code: f.sop_code ?? null,
			kategori_sop: f.kategori_sop ?? null,
			sub_kategori: f.sub_kategori ?? null,
			approval_status: f.approval_status ?? null,
			sosialisasi_end_date: f.sosialisasi_end_date ?? null,
			version: Number(f.version) || 1
		});
	}

	for (const s of Array.isArray(input.sops) ? input.sops : []) {
		if (!s || s.approval_status !== 'butuh_sosialisasi') continue;
		if (!sopTargetsDivisi(s, input.divisi)) continue;
		if (isSopConfirmed(s, confirms)) continue;
		items.push({
			type: 'sop',
			id: s.id,
			flow_key: null,
			sop_id: s.id,
			title: s.title ?? null,
			sop_code: s.sop_code ?? null,
			kategori_sop: null,
			sub_kategori: null,
			approval_status: s.approval_status ?? null,
			sosialisasi_end_date: s.sosialisasi_end_date ?? null,
			version: Number(s.version_seq) || 1
		});
	}
	return items;
}
