// src/routes/api/ai-assistant/stream/+server.ts
// Endpoint privat SSE untuk Asisten AI dashboard lapangan — §5A Streaming,
// implementation_plan_asisten_ai_v2.md. Port TypeScript dari
// routes/api/ai-assistant/stream/+server.js (erp-epi-1) — arsitektur SAMA
// (satu request menahan koneksi selama SELURUH loop tool-use, bukan 1 request/1
// putaran + continuationToken; aiConvoStore.ts TIDAK dipakai di sini), tapi
// menyertakan yang KHUSUS lapangan: jalur draf (§8 — pendingDraft dikirim di event
// 'done', TIDAK PERNAH menulis sendiri) dan project-scoping (aiProjectScope.ts).
//
// Nonaktif secara default (ai_settings.streaming_enabled_lapangan) — endpoint lama
// (../+server.ts) tetap jadi fallback otomatis di klien selama flag ini false ATAU
// permintaan pertama ke sini gagal/bukan SSE (lihat sendViaStream()/sendViaClassic()
// di AsistenSheet.svelte).
//
// Event SSE: `tool` {name}, `delta` {text}, `done` {...sama bentuk respons 'done'
// jalur lama, termasuk `draft`}, `error` {message}.

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
import { getAiSettings, sanitizeModelId } from '$lib/server/aiSettings';
import { OPENROUTER_URL, PLACEHOLDER_KEY, SYSTEM_PROMPT, extractSuggestions } from '$lib/server/aiAssistantShared';

async function streamOneTurn(
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
	timeoutMs: number,
	onDelta: (delta: string) => void
): Promise<{ assistantMessage: any; toolCalls: any[]; usage: any }> {
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
				stream: true,
				stream_options: { include_usage: true },
				messages: [{ role: 'system', content: SYSTEM_PROMPT(page, params, glossaryText, knowledgeText, rolePromptText) }, ...messages],
				...(tools && tools.length ? { tools } : {})
			}),
			signal: controller.signal
		});
	} catch (e: any) {
		clearTimeout(timeout);
		if (e?.name === 'AbortError') {
			throw new Error(`Waktu tunggu OpenRouter habis (${Math.round(timeoutMs / 1000)} detik).`);
		}
		throw new Error(`Gagal menghubungi OpenRouter: ${e?.message || 'kesalahan jaringan'}`);
	}

	if (!res.ok) {
		clearTimeout(timeout);
		const text0 = await res.text().catch(() => '');
		let msg = `OpenRouter API ${res.status}`;
		try {
			msg = JSON.parse(text0)?.error?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}
	if (!res.body) {
		clearTimeout(timeout);
		throw new Error('OpenRouter tidak mengembalikan body stream.');
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let text = '';
	const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
	let usage = { input_tokens: 0, output_tokens: 0 };

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = buffer.indexOf('\n\n')) !== -1) {
				const rawEvent = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
				if (!dataLine) continue;
				const payload = dataLine.slice(5).trim();
				if (payload === '[DONE]') continue;
				let evt: any;
				try {
					evt = JSON.parse(payload);
				} catch {
					continue;
				}
				const choice = evt?.choices?.[0];
				if (choice?.delta?.content) {
					text += choice.delta.content;
					onDelta(choice.delta.content);
				}
				if (Array.isArray(choice?.delta?.tool_calls)) {
					for (const tc of choice.delta.tool_calls) {
						const i = tc.index ?? 0;
						const entry = toolCallsMap.get(i) || { id: '', name: '', args: '' };
						if (tc.id) entry.id = tc.id;
						if (tc.function?.name && !entry.name) entry.name = tc.function.name;
						if (tc.function?.arguments) entry.args += tc.function.arguments;
						toolCallsMap.set(i, entry);
					}
				}
				if (evt?.usage) {
					usage = { input_tokens: evt.usage.prompt_tokens || 0, output_tokens: evt.usage.completion_tokens || 0 };
				}
			}
		}
	} finally {
		clearTimeout(timeout);
	}

	const toolCalls = [...toolCallsMap.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, tc]) => {
			let input: any = {};
			try {
				input = tc.args ? JSON.parse(tc.args) : {};
			} catch {
				input = {};
			}
			return { id: tc.id || `call_${Math.random().toString(36).slice(2)}`, name: tc.name, input, rawArgs: tc.args || '{}' };
		})
		.filter((tc) => tc.name);

	const assistantMessage = {
		role: 'assistant',
		content: text || '',
		...(toolCalls.length
			? {
					tool_calls: toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function',
						function: { name: tc.name, arguments: tc.rawArgs || '{}' }
					}))
				}
			: {})
	};

	return { assistantMessage, toolCalls, usage };
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const settings = await getAiSettings();

	// Belum diverifikasi di produksi sungguhan — nonaktif secara default. Respons
	// JSON biasa (bukan SSE) di sini adalah SINYAL bagi klien untuk fallback
	// otomatis ke ../+server.ts, bukan error. Dicek DULUAN sebelum izin/glosarium.
	const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || env.VITE_OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
	if (!settings.streaming_enabled_lapangan || !apiKey || apiKey === PLACEHOLDER_KEY) {
		return json({ status: 'disabled' });
	}

	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { roleId, permissions } = await getUserPermissions(idToken, user.localId);
	const tools = selectToolsForUser(permissions);
	const glossaryText = await getGlossaryText();
	const rolePromptText = await getRolePromptText(roleId, 'field');
	const model = sanitizeModelId(settings.model_complex, 'anthropic/claude-sonnet-4.5');
	const MAX_TOKENS = settings.max_tokens;
	const MAX_TOOL_ROUNDS = settings.max_tool_rounds;
	const MAX_HISTORY = settings.max_history;
	const AI_TIME_BUDGET_MS = settings.time_budget_ms;
	const ROUND_SAFETY_MARGIN_MS = settings.round_safety_margin_ms;
	const REQUEST_TIMEOUT_MS = settings.request_timeout_ms;

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const page = typeof body?.page === 'string' ? body.page : '';
	const params = body?.params && typeof body.params === 'object' ? body.params : null;
	const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

	const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
	const messages = rawMessages
		.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
		.slice(-MAX_HISTORY)
		.map((m: any) => ({ role: m.role, content: m.content }));

	if (!messages.length || messages[messages.length - 1].role !== 'user') {
		throw error(400, 'Pesan terakhir harus dari pengguna.');
	}

	const lastUserText = messages[messages.length - 1].content;

	const rawAttachments: AttachmentInput[] = Array.isArray(body?.attachments) ? body.attachments : [];
	let attachmentsMeta: Array<{ name: string; mime: string; kind: string; size: number; fileId: string | null }> = [];
	if (rawAttachments.length) {
		const { parts, meta } = await buildAttachmentParts(rawAttachments);
		if (parts.length) {
			messages[messages.length - 1] = { role: 'user', content: [...parts, { type: 'text', text: lastUserText }] };
		}
		attachmentsMeta = meta;
	}

	const requestedThreadId = Number.isFinite(body?.threadId) ? body.threadId : null;
	const threadId = await resolveThread({
		threadId: requestedThreadId,
		userEmail: user.email,
		app: 'field',
		firstMessage: lastUserText
	});
	const knowledgeText = await getKnowledgeContext(lastUserText, 'field');

	logAiChatMessage({ sessionId, userEmail: user.email, role: 'user', content: lastUserText, page, threadId, attachments: attachmentsMeta });

	// Fase 2 lanjutan — project-scoping (sama seperti jalur lama): dihitung sekali
	// per request, bukan per putaran tool.
	const projectIds = await resolveProjectScope(permissions, user.email);
	const execCtx = { permissions, roleId, userEmail: user.email, projectIds };

	const convo = [...messages];
	const totalUsage = { input_tokens: 0, output_tokens: 0 };
	const toolsUsedSoFar: string[] = [];
	let textSoFar = '';
	const startedAt = Date.now();
	let pendingDraft: any = null; // hasil tool grup "draf" terakhir yang sukses — §8

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const send = (type: string, data: any) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
			let budgetExhausted = false;

			try {
				for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
					const remainingMs = AI_TIME_BUDGET_MS - (Date.now() - startedAt);
					if (remainingMs < ROUND_SAFETY_MARGIN_MS) {
						budgetExhausted = true;
						break;
					}
					const perCallTimeout = Math.min(REQUEST_TIMEOUT_MS, remainingMs);

					const { assistantMessage, toolCalls, usage } = await streamOneTurn(
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
						perCallTimeout,
						(delta) => send('delta', { text: delta })
					);
					totalUsage.input_tokens += usage?.input_tokens || 0;
					totalUsage.output_tokens += usage?.output_tokens || 0;
					if (assistantMessage.content) textSoFar += assistantMessage.content;

					if (toolCalls.length > 0) {
						convo.push(assistantMessage);
						for (const tc of toolCalls) {
							toolsUsedSoFar.push(tc.name);
							send('tool', { name: tc.name });
							const result = await execTool(tc.name, tc.input, execCtx);
							if (result && !result.error && result.draft) pendingDraft = result.draft;
							convo.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: JSON.stringify(result ?? {}) });
						}
						continue;
					}
					break; // tidak ada tool call lagi -> selesai
				}
			} catch (e: any) {
				console.error('[ai-assistant-lapangan/stream] error:', e?.message);
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
				send('error', { message: e?.message || 'Terjadi kesalahan pada asisten.' });
				controller.close();
				return;
			}

			const extracted = extractSuggestions(textSoFar);
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

			send('done', { text, tools: toolsUsedSoFar, draft: pendingDraft, threadId, chatLogId, suggestions: extracted.suggestions });
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}
