// src/routes/api/process-guidance/flows/kendalaSearch.ts
// Pencarian cepat "kendala / pesan gate" lintas alur (mis. "kurva s", "kredit hold", "foto ba", "G_LH_FOTO"): MURNI, tanpa I/O.
// Dijalankan di server atas alur terbit yang SUDAH ber-cache, dan hanya mengembalikan beberapa hasil kecil → hemat kuota HP
// (klien tidak perlu mengunduh seluruh alur ±2 MB hanya untuk mencari). Semua kata kunci harus muncul pada SATU bidang.
import type { ProcessFlow } from '$lib/data/processGuidance';

export type KendalaKind = 'kendala' | 'gate' | 'syarat' | 'langkah';
export interface KendalaHit {
	flow_id: string;
	flow_title: string;
	node_id: string;
	node_label: string;
	kind: KendalaKind;
	snippet: string;
}

export const MIN_QUERY = 2;
export const MAX_QUERY = 80;
const KIND_RANK: Record<KendalaKind, number> = { kendala: 0, gate: 1, syarat: 2, langkah: 3 };
const norm = (s: string) => s.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim();

export function tokenize(q: string): string[] {
	return norm(String(q ?? '').slice(0, MAX_QUERY)).split(' ').filter((t) => t.length >= 1);
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Satu hasil terbaik per langkah, urut: kendala → gate → syarat → langkah, lalu judul alur. */
export function searchKendala(flows: ProcessFlow[], query: string, limit = 12): KendalaHit[] {
	const tokens = tokenize(query);
	if (tokens.join('').length < MIN_QUERY) return [];
	const matches = (text: string) => {
		const t = norm(text);
		return tokens.every((tok) => t.includes(tok));
	};
	const hits: KendalaHit[] = [];
	for (const f of Array.isArray(flows) ? flows : []) {
		for (const n of f?.nodes ?? []) {
			if (!n) continue; // data rusak: jangan menjatuhkan pencarian
			const base = { flow_id: f.id, flow_title: f.title, node_id: n.id, node_label: n.label };
			let best: KendalaHit | null = null;
			const offer = (kind: KendalaKind, text: string) => {
				if (!text || !matches(text)) return;
				if (!best || KIND_RANK[kind] < KIND_RANK[best.kind]) best = { ...base, kind, snippet: clip(text) };
			};
			for (const b of n.blockers ?? []) offer('kendala', String(b ?? ''));
			for (const g of n.gates ?? []) offer('gate', `${g?.key ?? ''} ${g?.modul ?? ''} ${g?.documentType ?? ''}`.trim());
			for (const c of n.checklist ?? []) offer('syarat', String(c ?? ''));
			offer('langkah', `${n.label ?? ''} ${n.desc ?? ''}`);
			if (best) hits.push(best);
		}
	}
	return hits.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.flow_title.localeCompare(b.flow_title) || a.node_label.localeCompare(b.node_label)).slice(0, limit);
}
