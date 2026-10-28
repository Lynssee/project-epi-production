// src/lib/server/aiUsageLog.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiUsageLog.js (erp-epi-1) —
// mencatat pemakaian AI ke koleksi Directus `ai_usage_log` yang SAMA
// (instance Directus dibagi kedua repo, lihat Rencana Implementasi Asisten
// Eltama v2.0 §6/§19.3). Pencatatan NON-FATAL: kegagalan logging tidak boleh
// menggagalkan respons AI ke user.

import { directusServerJson } from './directus';

const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
	'claude-opus-4-8': { input: 5, output: 25 },
	'claude-sonnet-5': { input: 3, output: 15 },
	'claude-haiku-4-5': { input: 1, output: 5 }
};

const OPENROUTER_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
	'anthropic/claude-opus-4.6': { input: 5, output: 25 },
	'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
	'anthropic/claude-sonnet-4.6': { input: 3, output: 15 },
	'anthropic/claude-haiku-4.5': { input: 1, output: 5 }
};

function calcCost(rate: { input: number; output: number } | undefined, inputTokens: number, outputTokens: number) {
	if (!rate) return 0;
	const cost = ((Number(inputTokens) || 0) / 1_000_000) * rate.input + ((Number(outputTokens) || 0) / 1_000_000) * rate.output;
	return Math.round(cost * 1e6) / 1e6;
}

export function estimateCostUsd(provider: string, model: string, inputTokens = 0, outputTokens = 0): number {
	if (provider === 'claude') return calcCost(PRICING_USD_PER_MTOK[model], inputTokens, outputTokens);
	if (provider === 'openrouter') return calcCost(OPENROUTER_PRICING_USD_PER_MTOK[model], inputTokens, outputTokens);
	return 0;
}

export async function logAiUsage(opts: {
	provider: 'claude' | 'gemini' | 'openrouter' | 'fonnte';
	source: string;
	model?: string;
	userEmail?: string;
	inputTokens?: number;
	outputTokens?: number;
	status?: 'success' | 'error';
	errorMessage?: string;
	toolsUsed?: string[];
}): Promise<void> {
	const {
		provider,
		source,
		model = '',
		userEmail = '',
		inputTokens = 0,
		outputTokens = 0,
		status = 'success',
		errorMessage = '',
		toolsUsed = []
	} = opts;
	try {
		const estimated_cost_usd = estimateCostUsd(provider, model, inputTokens, outputTokens);
		await directusServerJson('/items/ai_usage_log', {
			method: 'POST',
			body: JSON.stringify({
				provider,
				source,
				model,
				user_email: userEmail || '',
				input_tokens: Number(inputTokens) || 0,
				output_tokens: Number(outputTokens) || 0,
				estimated_cost_usd,
				status,
				error_message: errorMessage ? String(errorMessage).slice(0, 2000) : '',
				// Fase 6 — analytics "tool tersering" (implementation_plan_Modul Asisten AI v3.1.md).
				tools_used: Array.isArray(toolsUsed) ? toolsUsed : []
			})
		});
	} catch (e: any) {
		console.error('[aiUsageLog] gagal mencatat usage (non-fatal):', e?.message);
	}
}
