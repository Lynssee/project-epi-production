// src/lib/server/aiConvoStore.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiConvoStore.js (erp-epi-1) —
// state server-side (Opsi A) untuk continuation loop tool-use, keyed token
// opaque. Per-proses, in-memory, TTL — hilang saat restart (batasan diterima).

type ConvoState = Record<string, any>;

const _store = new Map<string, { data: ConvoState; expiresAt: number }>();
const TTL_MS = 10 * 60 * 1000;

function sweep() {
	const now = Date.now();
	for (const [token, entry] of _store) {
		if (entry.expiresAt < now) _store.delete(token);
	}
}

export function saveConvoState(data: ConvoState): string {
	sweep();
	const token = crypto.randomUUID();
	_store.set(token, { data, expiresAt: Date.now() + TTL_MS });
	return token;
}

export function takeConvoState(token: string): ConvoState | null {
	sweep();
	const entry = _store.get(token);
	if (!entry) return null;
	_store.delete(token);
	return entry.data;
}
