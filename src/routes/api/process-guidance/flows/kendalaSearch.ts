// src/routes/api/process-guidance/flows/kendalaSearch.ts
// Pencarian cepat "kendala / pesan gate" lintas alur (mis. "kurva s", "kredit hold", "foto ba", "G_LH_FOTO"): MURNI, tanpa I/O.
// Dijalankan di server atas alur terbit yang SUDAH ber-cache, dan hanya mengembalikan beberapa hasil kecil → hemat kuota HP
// (klien tidak perlu mengunduh seluruh alur ±2 MB hanya untuk mencari). Semua kata kunci harus muncul pada SATU bidang.
import type { ProcessFlow } from '$lib/data/processGuidance';

export type KendalaKind = 'kendala' | 'negatif' | 'gate' | 'syarat' | 'langkah';
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
const KIND_RANK: Record<KendalaKind, number> = { kendala: 0, negatif: 1, gate: 2, syarat: 3, langkah: 4 };
// Kata kunci awam per kategori skenario negatif (agar "server down" / "sinyal mati" menemukan skenario walau teksnya memakai istilah lain).
const NEG_KEYWORDS: Record<string, string> = {
	system_erp_error: 'erp error server down error sistem gangguan sistem 5xx 500 n8n fallback rekonsiliasi',
	network_offline: 'offline sinyal mati sinyal putus blankspot konflik sinkronisasi sync 409 fallback rekonsiliasi',
	gate_blocked: 'gate tertahan hold diblokir override pengecualian fallback',
	data_mismatch: 'selisih data dokumen tidak valid fallback rekonsiliasi',
	operational_reject: 'ditolak penolakan gagal rework fallback',
	force_majeure_k3: 'darurat k3 cuaca ekstrem stop work fallback'
};
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
	const byNode = new Map<string, KendalaHit>();
	const keep = (h: KendalaHit) => {
		const k = `${h.flow_id}:${h.node_id}`;
		const cur = byNode.get(k);
		if (!cur || KIND_RANK[h.kind] < KIND_RANK[cur.kind]) byNode.set(k, h);
	};
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
			if (best) keep(best);
		}
		// Skenario negatif (ERP Error / offline / gate / hambatan): dikaitkan ke langkahnya; tanpa step_id → langkah pertama alur.
		const nodes = (f?.nodes ?? []).filter(Boolean);
		for (const s of f?.sop?.negative_scenarios ?? []) {
			if (!s) continue;
			const target = nodes.find((n) => n.id === s.step_id) ?? nodes[0];
			if (!target) continue;
			const text = `${s.code ?? ''} ${s.trigger ?? ''} ${s.step_label ?? ''} ${s.related_gate_key ?? ''} ${NEG_KEYWORDS[s.category] ?? ''}`;
			if (!matches(text)) continue;
			const firstStep = String(s.fallback_action ?? '').split('\n')[0].replace(/^\d+\.\s*/, '');
			keep({ flow_id: f.id, flow_title: f.title, node_id: target.id, node_label: target.label, kind: 'negatif', snippet: clip(`${s.trigger ?? ''} → ${firstStep}`) });
		}
	}
	const hits = [...byNode.values()];
	return hits.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.flow_title.localeCompare(b.flow_title) || a.node_label.localeCompare(b.node_label)).slice(0, limit);
}
