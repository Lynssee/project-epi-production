// src/routes/(app)/panduan/alur/gateCardModel.ts
// Model MURNI kartu "Siklus Dokumen & Syarat Lolos Gate" (tampilan HP): urutan langkah + syarat gate per langkah. Dites.
// Bahasa ke user lapangan: bukan "hard/soft", tetapi dampaknya ("Wajib lolos", "Perlu alasan", …).
import type { ProcessFlow, ProcessNode } from '$lib/data/processGuidance';
import type { FieldGateInfo } from './fieldGateApi';

export interface ModeMeta {
	label: string;
	short: string;
	cls: string;
	rank: number;
}
/** Dampak mode gate bagi tim lapangan. `rank` lebih besar = lebih mengikat. */
export const MODE_META: Record<string, ModeMeta> = {
	hard: { label: 'Wajib lolos', short: 'Wajib', cls: 'bg-rose-100 text-rose-800 border-rose-300', rank: 3 },
	soft: { label: 'Perlu alasan bila tidak lolos', short: 'Perlu alasan', cls: 'bg-orange-100 text-orange-800 border-orange-300', rank: 2 },
	warn: { label: 'Hanya peringatan', short: 'Peringatan', cls: 'bg-amber-100 text-amber-800 border-amber-300', rank: 1 },
	shadow: { label: 'Dipantau (belum memblokir)', short: 'Dipantau', cls: 'bg-slate-100 text-slate-700 border-slate-300', rank: 0 }
};
export const modeMeta = (m: string | null | undefined): ModeMeta => MODE_META[m ?? ''] ?? { label: 'Belum diketahui', short: '—', cls: 'bg-gray-100 text-gray-600 border-gray-300', rank: -1 };

export interface CycleGate {
	key: string;
	modul: string;
	info: FieldGateInfo | null;
}
export interface CycleStep {
	id: string;
	no: number;
	label: string;
	type: string;
	pic: string;
	lane: string;
	desc: string;
	sla_hours: number | null;
	fieldActions: { label: string; href: string }[];
	gates: CycleGate[];
	/** Gate paling mengikat di langkah ini (untuk ikon ringkas); null bila tanpa gate. */
	strongest: string | null;
	/** Target gate sudah memuat panduan (hint/checklist/pesan) — tampilkan tombol buka. */
	hasGuidance: boolean;
	isDecision: boolean;
	/** Panah keluar dari langkah ini (dari `flow.edges`): cabang keputusan / langkah berikut / kembali (rework). */
	branches: CycleBranch[];
}
export interface CycleBranch {
	toId: string;
	/** Nomor langkah tujuan; null bila tujuannya simpul Selesai. */
	toNo: number | null;
	toLabel: string;
	/** Kondisi pada panah ("Ya", "ditolak", …); kosong = langkah berikutnya biasa. */
	condition: string;
	/** true bila kembali ke langkah yang sama/sebelumnya (perbaikan / rework). */
	backward: boolean;
	end: boolean;
}

/** Kalimat bahasa lapangan untuk satu cabang: Jika “Ya” → lanjut ke Langkah 4 (Kirim). */
export function branchSentence(b: CycleBranch): string {
	const verb = b.end ? 'proses selesai' : `${b.backward ? 'kembali ke' : 'lanjut ke'} Langkah ${b.toNo} (${b.toLabel})`;
	return b.condition ? `Jika “${b.condition}” → ${verb}` : verb.charAt(0).toUpperCase() + verb.slice(1);
}

const order = (a: ProcessNode, b: ProcessNode) => (a.col ?? 0) - (b.col ?? 0) || (a.row ?? 0) - (b.row ?? 0);

/** Langkah berurutan (tanpa Mulai/Selesai) beserta gate dan panduannya. `gates` = hasil loadGateInfo (boleh kosong/null). */
export function buildCycle(flow: ProcessFlow | null | undefined, gates: Record<string, FieldGateInfo> | null | undefined): CycleStep[] {
	const laneLabel = new Map((flow?.lanes ?? []).map((l) => [l.key, l.label]));
	const all = [...(flow?.nodes ?? [])].filter(Boolean).sort(order);
	const byId = new Map(all.map((n) => [n.id, n]));
	const noOf = new Map(all.filter((n) => n.type !== 'start' && n.type !== 'end').map((n, i) => [n.id, i + 1]));
	const steps: CycleStep[] = [];
	for (const n of all) {
		if (n.type === 'start' || n.type === 'end') continue;
		const no = steps.length + 1;
		const branches: CycleBranch[] = (flow?.edges ?? [])
			.filter((e) => e?.from === n.id && byId.has(e.to) && byId.get(e.to)!.type !== 'start')
			.map((e) => {
				const t = byId.get(e.to)!;
				const toNo = noOf.get(t.id) ?? null;
				const end = t.type === 'end';
				return { toId: t.id, toNo, toLabel: end ? 'Selesai' : (t.label ?? t.id), condition: (e.label ?? '').trim(), backward: toNo !== null && toNo <= no, end };
			});
		const cg: CycleGate[] = (n.gates ?? []).filter((g) => g?.key).map((g) => ({ key: g.key, modul: g.modul ?? '', info: gates?.[g.key] ?? null }));
		const strongest = cg.reduce<string | null>((best, g) => (g.info && modeMeta(g.info.mode).rank > modeMeta(best).rank ? g.info.mode : best), null);
		steps.push({
			id: n.id,
			no,
			isDecision: n.type === 'decision',
			branches,
			label: n.label ?? n.id,
			type: n.type,
			pic: n.pic ?? '',
			lane: laneLabel.get(n.lane) ?? n.lane ?? '',
			desc: n.desc ?? '',
			sla_hours: n.sla_hours ?? null,
			fieldActions: (n.actions ?? []).filter((a) => a?.href).slice(0, 3).map((a) => ({ label: a.label, href: a.href })),
			gates: cg,
			strongest,
			hasGuidance: cg.some((g) => !!g.info && (!!g.info.hint || !!g.info.message || g.info.checklist.length > 0))
		});
	}
	return steps;
}

/** Ringkasan untuk kepala kartu: jumlah langkah/gate dan gate terkuat. */
export function summarizeCycle(steps: CycleStep[]): { steps: number; gated: number; gates: number; strongest: string | null } {
	let strongest: string | null = null;
	let gates = 0;
	for (const s of steps) {
		gates += s.gates.length;
		if (s.strongest && modeMeta(s.strongest).rank > modeMeta(strongest).rank) strongest = s.strongest;
	}
	return { steps: steps.length, gated: steps.filter((s) => s.gates.length > 0).length, gates, strongest };
}
