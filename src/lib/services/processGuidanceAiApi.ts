// src/lib/services/processGuidanceAiApi.ts
// Klien API untuk AI Process Navigator Lapangan.

export interface FieldAiStage {
	nodeId: string;
	label: string;
	pic: string;
	summary: string;
	actionField?: { label: string; href: string } | null;
	gate?: string | null;
}

export interface FieldAiGateSummary {
	key: string;
	modul: string;
	documentType: string;
}

export interface FieldAiResult {
	ok: boolean;
	found?: boolean;
	source?: 'ai' | 'deterministic';
	matchedFlowKey?: string;
	matchedFlowTitle?: string;
	sopCode?: string;
	answer?: string;
	stages?: FieldAiStage[];
	gatesSummary?: FieldAiGateSummary[];
	quickTips?: string;
	message?: string;
	error?: string;
}

export async function askFieldAiNavigator(
	query: string,
	opts: { fetchImpl?: typeof fetch; mode?: 'fast' | 'ai' } = {}
): Promise<FieldAiResult> {
	try {
		const fetcher = opts.fetchImpl || fetch;
		const res = await fetcher('/api/process-guidance/ai-navigator', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, mode: opts.mode || 'ai', targetApp: 'project-epi' })
		});

		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.success === false) {
			return {
				ok: false,
				error: data?.error || `Gagal menghubungi asisten panduan (HTTP ${res.status}).`
			};
		}

		const rest = { ...data };
		delete rest.success;
		return { ok: true, ...rest };
	} catch (e: any) {
		console.warn('[askFieldAiNavigator] gagal:', e?.message || e);
		return { ok: false, error: 'Tidak dapat terhubung ke server panduan lapangan.' };
	}
}
