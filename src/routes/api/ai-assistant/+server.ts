// src/routes/api/ai-assistant/+server.ts
// Endpoint privat untuk Asisten AI dashboard lapangan (AsistenSheet.svelte).
// Fase 1/2 — Rencana Implementasi Asisten Eltama v2.0 §6/§7/§8/§13/§19.2:
// gateway TERPISAH dari erp-epi-1 (bukan kode bersama — kontrak tool saja
// yang disalin terkendali, lihat aiToolRegistry.ts), tapi arsitektur/perilaku
// SENGAJA dibuat identik dengan routes/api/ai-assistant/+server.js di sana:
// anggaran waktu bersama klien/server, registry tool berjenjang tersaring izin.
//
// Jalur Draf-dan-Persetujuan (§8): tool grup "draf" (mis. siapkan_draf_requisition)
// HANYA mengembalikan preview terstruktur lewat field `draft` di respons ini —
// TIDAK PERNAH menulis apa pun sendiri. Penulisan nyata terjadi di endpoint
// TERPISAH (/api/ai-assistant/draft-requisition) yang hanya dipanggil klien
// setelah pengguna menekan tombol "Buat Draf" secara eksplisit.
//
// NON-STREAMING (respons JSON tunggal) — sama seperti admin: streaming
// belum diuji di build produksi (Fase 0), jadi belum diaktifkan di sini.
//
// Fase 1 — "kabar kemajuan bernama" TANPA streaming (identik dengan erp-epi-1,
// lihat komentar lengkap di sana): SATU REQUEST = SATU PUTARAN tool. Klien
// memanggil ulang lewat `continuationToken` sampai status 'done'.
//
// Fase 1 Attachment (Opsi A, implementation_plan_asisten_ai_v2.md §1.1): convo
// (termasuk base64 lampiran) hidup di server (aiConvoStore.ts), klien hanya
// pegang token opaque — identik dengan gateway admin.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions } from '$lib/server/rbacServer';
import { logAiUsage } from '$lib/server/aiUsageLog';
import { logAiChatMessage } from '$lib/server/aiChatLog';
import { selectToolsForUser } from '$lib/server/aiToolRegistry';
import { execTool } from '$lib/server/aiToolExecutors';
import { getGlossaryText } from '$lib/server/aiGlossary';
import { getRolePromptText } from '$lib/server/aiRolePrompts';
import { resolveProjectScope } from '$lib/server/aiProjectScope';
import { resolveThread } from '$lib/server/aiConversations';
import { getKnowledgeContext } from '$lib/server/aiKnowledgeBase';
import { buildAttachmentParts, type AttachmentInput } from '$lib/server/aiAttachments';
import { saveConvoState, takeConvoState } from '$lib/server/aiConvoStore';
import { getAiSettings, sanitizeModelId } from '$lib/server/aiSettings';
import { OPENROUTER_URL, PLACEHOLDER_KEY, SYSTEM_PROMPT, extractSuggestions } from '$lib/server/aiAssistantShared';

// §7#6 (implementation_plan_asisten_ai_v2.md) — MODEL/MAX_TOKENS/MAX_TOOL_ROUNDS/
// MAX_HISTORY/anggaran waktu TIDAK lagi hardcode di sini — dibaca dari koleksi
// Directus `ai_settings` (lib/server/aiSettings.ts, koleksi SAMA yang dipakai
// gateway admin), bisa diubah dari panel Settings > Asisten AI tanpa deploy ulang.
// Beda dari admin: tidak ada model routing (Haiku/Sonnet) — lapangan selalu pakai
// satu model (settings.model_complex).

// Kamus istilah internal kini dibaca dinamis dari koleksi Directus `ai_glossary`
// (lib/server/aiGlossary.ts) — diedit dari panel IT > Saldo & Limit AI di
// dashboard admin, dibagi dengan gateway ini. Lihat aiGlossary.ts untuk fallback.

async function callOneTurn(
	apiKey: string,
	messages: any[],
	page: string,
	params: Record<string, unknown> | null,
	glossaryText: string,
	knowledgeText: string,
	rolePromptText: string,
	tools: any[],
	model: string,
	maxTokens: number,
	timeoutMs: number
): Promise<{ assistantMessage: any; toolCalls: any[]; finishReason: string | null; usage: any }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	let res: Response;
	try {
		res = await fetch(OPENROUTER_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://erp.eltamaprimaindo.com',
				'X-Title': 'EPI Asisten AI Lapangan'
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				messages: [{ role: 'system', content: SYSTEM_PROMPT(page, params, glossaryText, knowledgeText, rolePromptText) }, ...messages],
				...(tools && tools.length ? { tools } : {})
			}),
			signal: controller.signal
		});
	} catch (e: any) {
		if (e?.name === 'AbortError') {
			throw new Error(`Waktu tunggu OpenRouter habis (${Math.round(timeoutMs / 1000)} detik). Coba lagi.`);
		}
		throw new Error(`Gagal menghubungi OpenRouter: ${e?.message || 'kesalahan jaringan'}`);
	} finally {
		clearTimeout(timeout);
	}

	const text0 = await res.text().catch(() => '');
	if (!res.ok) {
		let msg = `OpenRouter API ${res.status}`;
		try {
			msg = JSON.parse(text0)?.error?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}

	let data: any;
	try {
		data = JSON.parse(text0);
	} catch {
		throw new Error('Respons OpenRouter bukan JSON valid.');
	}

	const choice = data?.choices?.[0];
	const finishReason = choice?.finish_reason || null;
	const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
	const rawToolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];

	const toolCalls = rawToolCalls
		.filter((tc: any) => tc?.function?.name)
		.map((tc: any) => {
			let input: any = {};
			try {
				input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
			} catch {
				input = {};
			}
			return { id: tc.id, name: tc.function.name, input, rawArgs: tc.function.arguments || '{}' };
		});

	const usage = {
		input_tokens: data?.usage?.prompt_tokens || 0,
		output_tokens: data?.usage?.completion_tokens || 0
	};

	const assistantMessage = {
		role: 'assistant',
		content: text || '',
		...(toolCalls.length
			? {
					tool_calls: toolCalls.map((tc: any) => ({
						id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
						type: 'function',
						function: { name: tc.name, arguments: tc.rawArgs || '{}' }
					}))
				}
			: {})
	};

	return { assistantMessage, toolCalls, finishReason, usage };
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);

	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { roleId, permissions } = await getUserPermissions(idToken, user.localId);
	const tools = selectToolsForUser(permissions);
	const glossaryText = await getGlossaryText();
	const rolePromptText = await getRolePromptText(roleId, 'field');
	const settings = await getAiSettings();
	const model = sanitizeModelId(settings.model_complex, 'anthropic/claude-sonnet-4.5');
	const MAX_TOKENS = settings.max_tokens;
	const MAX_TOOL_ROUNDS = settings.max_tool_rounds;
	const MAX_HISTORY = settings.max_history;
	const AI_TIME_BUDGET_MS = settings.time_budget_ms;
	const ROUND_SAFETY_MARGIN_MS = settings.round_safety_margin_ms;
	const REQUEST_TIMEOUT_MS = settings.request_timeout_ms;

	const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || env.VITE_OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
	if (!apiKey || apiKey === PLACEHOLDER_KEY) {
		throw error(503, 'Asisten AI belum dikonfigurasi (OPENROUTER_API_KEY belum diisi di server).');
	}

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const page = typeof body?.page === 'string' ? body.page : '';
	const params = body?.params && typeof body.params === 'object' ? body.params : null;
	const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
	const continuationToken = typeof body?.continuationToken === 'string' ? body.continuationToken : '';

	let convo: any[];
	let totalUsage: { input_tokens: number; output_tokens: number };
	let toolsUsedSoFar: string[];
	let textSoFar: string;
	let startedAt: number;
	let round: number;
	let pendingDraft: any = null; // hasil tool grup "draf" terakhir yang sukses — lihat §8
	let threadId: number | null;
	let knowledgeText: string;

	if (continuationToken) {
		const state = takeConvoState(continuationToken);
		if (!state) {
			throw error(410, 'Sesi asisten kedaluwarsa (lebih dari 10 menit tidak ada aktivitas). Mulai percakapan baru.');
		}
		convo = Array.isArray(state.convo) ? state.convo : [];
		totalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
		toolsUsedSoFar = Array.isArray(state.toolsUsed) ? state.toolsUsed : [];
		textSoFar = typeof state.text === 'string' ? state.text : '';
		startedAt = Number(state.startedAt) || Date.now();
		round = Number(state.round) || 0;
		pendingDraft = state.draft || null;
		threadId = Number.isFinite(state.threadId) ? state.threadId : null;
		knowledgeText = typeof state.knowledgeText === 'string' ? state.knowledgeText : '';
	} else {
		const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
		const messages = rawMessages
			.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
			.slice(-MAX_HISTORY)
			.map((m: any) => ({ role: m.role, content: m.content }));

		if (!messages.length || messages[messages.length - 1].role !== 'user') {
			throw error(400, 'Pesan terakhir harus dari pengguna.');
		}

		const lastUserText = messages[messages.length - 1].content;

		// Fase 1 Attachment — lampiran hanya untuk pesan TERBARU (bukan riwayat),
		// sama seperti gateway admin. Model di sini (settings.model_complex, biasanya
		// Sonnet — mendukung vision) tidak berubah per-pesan — tidak perlu pemaksaan
		// routing seperti admin (yang punya model_simple untuk sapaan/basa-basi).
		const rawAttachments: AttachmentInput[] = Array.isArray(body?.attachments) ? body.attachments : [];
		let attachmentsMeta: Array<{ name: string; mime: string; kind: string; size: number }> = [];
		if (rawAttachments.length) {
			const { parts, meta } = await buildAttachmentParts(rawAttachments);
			if (parts.length) {
				messages[messages.length - 1] = {
					role: 'user',
					content: [...parts, { type: 'text', text: lastUserText }]
				};
			}
			attachmentsMeta = meta;
		}

		// Fase 4 — Persistence Riwayat: sama seperti admin, verifikasi kepemilikan
		// threadId dari klien atau buat thread baru.
		const requestedThreadId = Number.isFinite(body?.threadId) ? body.threadId : null;
		threadId = await resolveThread({
			threadId: requestedThreadId,
			userEmail: user.email,
			app: 'field',
			firstMessage: lastUserText
		});
		knowledgeText = await getKnowledgeContext(lastUserText, 'field');

		logAiChatMessage({ sessionId, userEmail: user.email, role: 'user', content: lastUserText, page, threadId, attachments: attachmentsMeta });

		convo = [...messages];
		totalUsage = { input_tokens: 0, output_tokens: 0 };
		toolsUsedSoFar = [];
		textSoFar = '';
		startedAt = Date.now();
		round = 0;
	}

	// Fase 2 lanjutan — project-scoping: tool berbasis equipment (status_p2h,
	// riwayat_perbaikan) menolak equipment yang sedang aktif di proyek lain,
	// lihat aiProjectScope.ts. Dihitung sekali per request, bukan per putaran tool.
	const projectIds = await resolveProjectScope(permissions, user.email);
	const execCtx = { permissions, roleId, userEmail: user.email, projectIds };

	async function finalizeDone(assistantFullText: string, budgetExhausted: boolean) {
		const extracted = extractSuggestions(assistantFullText);
		let text = extracted.text;
		if (!text.trim()) {
			text = budgetExhausted
				? 'Maaf, saya kehabisan waktu sebelum menemukan jawaban lengkap. Coba pertanyaan yang lebih spesifik.'
				: 'Maaf, saya tidak punya jawaban untuk itu.';
		} else if (budgetExhausted) {
			text += '\n\n_(Jawaban di atas dihentikan lebih awal karena anggaran waktu asisten hampir habis.)_';
		}

		logAiUsage({
			provider: 'openrouter',
			source: 'ai-assistant-lapangan',
			model,
			userEmail: user.email,
			inputTokens: totalUsage.input_tokens,
			outputTokens: totalUsage.output_tokens,
			toolsUsed: toolsUsedSoFar
		});
		const chatLogId = await logAiChatMessage({ sessionId, userEmail: user.email, role: 'assistant', content: text, page, threadId });

		return json({ status: 'done', text, tools: toolsUsedSoFar, draft: pendingDraft, threadId, chatLogId, suggestions: extracted.suggestions });
	}

	try {
		const remainingMs = AI_TIME_BUDGET_MS - (Date.now() - startedAt);
		if (round >= MAX_TOOL_ROUNDS) {
			return await finalizeDone(textSoFar, false);
		}
		if (remainingMs < ROUND_SAFETY_MARGIN_MS) {
			return await finalizeDone(textSoFar, true);
		}

		const perCallTimeout = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
		const { assistantMessage, toolCalls, finishReason, usage } = await callOneTurn(
			apiKey,
			convo,
			page,
			params,
			glossaryText,
			knowledgeText,
			rolePromptText,
			tools,
			model,
			MAX_TOKENS,
			perCallTimeout
		);
		totalUsage.input_tokens += usage?.input_tokens || 0;
		totalUsage.output_tokens += usage?.output_tokens || 0;
		if (assistantMessage.content) textSoFar += assistantMessage.content;

		if (toolCalls.length > 0) {
			convo.push(assistantMessage);
			const toolsThisRound: string[] = [];
			for (const tc of toolCalls) {
				toolsThisRound.push(tc.name);
				toolsUsedSoFar.push(tc.name);
				const result = await execTool(tc.name, tc.input, execCtx);
				if (result && !result.error && result.draft) pendingDraft = result.draft;
				convo.push({
					role: 'tool',
					tool_call_id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
					name: tc.name,
					content: JSON.stringify(result ?? {})
				});
			}
			const continuationTokenOut = saveConvoState({
				convo,
				usage: totalUsage,
				toolsUsed: toolsUsedSoFar,
				text: textSoFar,
				startedAt,
				round: round + 1,
				draft: pendingDraft,
				threadId,
				knowledgeText
			});
			return json({ status: 'in_progress', toolsThisRound, continuationToken: continuationTokenOut });
		}

		return await finalizeDone(textSoFar, false);
	} catch (e: any) {
		console.error('[ai-assistant-lapangan] error:', e?.message);
		logAiUsage({
			provider: 'openrouter',
			source: 'ai-assistant-lapangan',
			model,
			userEmail: user.email,
			inputTokens: totalUsage.input_tokens,
			outputTokens: totalUsage.output_tokens,
			status: 'error',
			errorMessage: e?.message,
			toolsUsed: toolsUsedSoFar
		});
		throw error(502, e?.message || 'Terjadi kesalahan pada asisten.');
	}
}
