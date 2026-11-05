// src/lib/utils/processPicResolver.ts
// Cermin processPicResolver.js di erp-epi (SATU aturan pencocokan PIC → master `posisi` di kedua dashboard).
// Tingkat keyakinan: explicit/alias/exact = dipakai otomatis; suggest = hanya saran; ambiguous/none = tidak dipakai.
// Jika aturan diubah di erp-epi, ubah di sini juga — processPicResolver.test.ts memuat kasus yang sama (+ parity bila repo sebelah ada).

export interface PosisiRow {
	id: number;
	nama_posisi: string;
}
export interface PosisiEntry {
	id: number;
	nama: string;
	tokens: string[];
}
export interface PosisiIndex {
	byId: Map<number, PosisiEntry>;
	byName: Map<string, PosisiEntry[]>;
	aliasMap: Map<string, number>;
	badAliases: { text: string; id: unknown }[];
	all: PosisiEntry[];
}
export type Confidence = 'explicit' | 'alias' | 'exact' | 'suggest' | 'ambiguous' | 'none';
export interface PicMatch {
	token: string;
	confidence: Confidence;
	resolved: boolean;
	posisi_id: number | null;
	candidates: { id: number; nama: string }[];
}

const INACTIVE_RE = /^\s*\[\s*tidak\s+dipakai\s*\]/i;
const STOP_WORDS = new Set(['dan', 'and', 'di', 'of', 'the', 'atau']);
const SPLIT_RE = /\s*(?:,|;|&|\/|\+|\bdan\b|\batau\b)\s*/i;
const ABBR_RE = /\b([A-Za-z]{1,2})\s*&\s*([A-Za-z]{1,2})\b/g;
const GLUE = '\u0001';

export const CONFIDENCE_RESOLVED: Confidence[] = ['explicit', 'alias', 'exact'];

export function normalizePicText(v: unknown): string {
	return String(v ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function tokensOf(v: unknown): string[] {
	return normalizePicText(v)
		.split(' ')
		.filter((t) => t && !STOP_WORDS.has(t));
}

export function splitPicText(pic: unknown): string[] {
	if (typeof pic !== 'string') return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of pic.replace(ABBR_RE, `$1${GLUE}$2`).split(SPLIT_RE)) {
		const t = part.replaceAll(GLUE, '&').trim();
		const key = normalizePicText(t);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(t);
	}
	return out;
}

export function parseAliasSetting(raw: unknown): Record<string, number> {
	let v: unknown = raw;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return {};
		}
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
	const out: Record<string, number> = {};
	for (const [text, id] of Object.entries(v as Record<string, unknown>)) {
		const t = String(text).trim().slice(0, 200);
		const n = Number(id);
		if (t && normalizePicText(t) && Number.isInteger(n) && n > 0) out[t] = n;
	}
	return out;
}

export function buildPosisiIndex(posisiRows: unknown, aliases: Record<string, unknown> = {}): PosisiIndex {
	const rows = (Array.isArray(posisiRows) ? posisiRows : []).filter(
		(p: any) => p && Number.isInteger(Number(p.id)) && typeof p.nama_posisi === 'string' && !INACTIVE_RE.test(p.nama_posisi)
	) as PosisiRow[];
	const byId = new Map<number, PosisiEntry>();
	const byName = new Map<string, PosisiEntry[]>();
	for (const p of rows) {
		const id = Number(p.id);
		const entry: PosisiEntry = { id, nama: p.nama_posisi.trim(), tokens: tokensOf(p.nama_posisi) };
		byId.set(id, entry);
		const key = normalizePicText(p.nama_posisi);
		if (!byName.has(key)) byName.set(key, []);
		byName.get(key)!.push(entry);
	}
	const aliasMap = new Map<string, number>();
	const badAliases: { text: string; id: unknown }[] = [];
	for (const [text, id] of Object.entries(aliases && typeof aliases === 'object' ? aliases : {})) {
		const key = normalizePicText(text);
		if (key && byId.has(Number(id))) aliasMap.set(key, Number(id));
		else badAliases.push({ text, id });
	}
	return { byId, byName, aliasMap, badAliases, all: [...byId.values()] };
}

const subset = (small: string[], big: string[]) => small.length > 0 && small.every((t) => big.includes(t));

export function matchPicToken(token: string, index: PosisiIndex | null): PicMatch {
	const pick = (confidence: Confidence, entries: PosisiEntry[]): PicMatch => ({
		token,
		confidence,
		resolved: CONFIDENCE_RESOLVED.includes(confidence),
		posisi_id: CONFIDENCE_RESOLVED.includes(confidence) || confidence === 'suggest' ? entries[0].id : null,
		candidates: entries.map((e) => ({ id: e.id, nama: e.nama }))
	});
	const none: PicMatch = { token, confidence: 'none', resolved: false, posisi_id: null, candidates: [] };
	if (!index || !index.byId || index.byId.size === 0) return none;

	const key = normalizePicText(token);
	if (!key) return none;

	const aliasId = index.aliasMap.get(key);
	if (aliasId) return pick('alias', [index.byId.get(aliasId)!]);

	const exact = index.byName.get(key) || [];
	if (exact.length === 1) return pick('exact', exact);
	if (exact.length > 1) return pick('ambiguous', exact);

	const tk = tokensOf(token);
	if (tk.length === 0) return none;
	const moreSpecific = index.all.filter((p) => p.tokens.length >= 2 && subset(p.tokens, tk));
	if (moreSpecific.length > 0) {
		const longest = Math.max(...moreSpecific.map((p) => p.tokens.length));
		const best = moreSpecific.filter((p) => p.tokens.length === longest);
		return pick(best.length === 1 ? 'suggest' : 'ambiguous', best);
	}
	if (tk.length >= 2) {
		const broader = index.all.filter((p) => subset(tk, p.tokens));
		if (broader.length === 1) return pick('suggest', broader);
		if (broader.length > 1) return pick('ambiguous', broader);
	}
	return none;
}

export interface NodePositions {
	source: 'explicit' | 'pic_text' | 'none';
	matches: PicMatch[];
	posisiIds: number[];
	unresolved: string[];
	missing: number[];
}

export function resolveNodePositions(node: { pic?: unknown; posisi_ids?: unknown } | null | undefined, index: PosisiIndex | null): NodePositions {
	const explicit = Array.isArray(node?.posisi_ids) ? (node!.posisi_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
	if (explicit.length > 0) {
		const uniq = [...new Set(explicit)];
		const present = uniq.filter((id) => index?.byId?.has(id));
		const missing = uniq.filter((id) => !index?.byId?.has(id));
		return {
			source: 'explicit',
			matches: present.map((id) => {
				const nama = index!.byId.get(id)!.nama;
				return { token: nama, confidence: 'explicit' as Confidence, resolved: true, posisi_id: id, candidates: [{ id, nama }] };
			}),
			posisiIds: present,
			unresolved: [],
			missing
		};
	}
	const tokens = splitPicText(node?.pic);
	if (tokens.length === 0) return { source: 'none', matches: [], posisiIds: [], unresolved: [], missing: [] };
	if (tokens.length > 1) {
		const whole = matchPicToken(String(node!.pic).trim(), index);
		if (whole.resolved) return { source: 'pic_text', matches: [whole], posisiIds: [whole.posisi_id!], unresolved: [], missing: [] };
	}
	const matches = tokens.map((t) => matchPicToken(t, index));
	return {
		source: 'pic_text',
		matches,
		posisiIds: [...new Set(matches.filter((m) => m.resolved).map((m) => m.posisi_id!))],
		unresolved: matches.filter((m) => !m.resolved).map((m) => m.token),
		missing: []
	};
}
