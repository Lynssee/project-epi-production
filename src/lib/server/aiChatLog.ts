// src/lib/server/aiChatLog.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiChatLog.js (erp-epi-1) —
// mencatat isi percakapan ke koleksi Directus `ai_chat_log` yang SAMA
// (instance Directus dibagi kedua repo). Pencatatan NON-FATAL.

import { directusServerJson } from './directus';

const MAX_CONTENT_LEN = 5000;

/** @returns id baris ai_chat_log yang dibuat (Fase 4 — target feedback 👍/👎), atau null bila gagal/kosong. */
export async function logAiChatMessage(opts: {
	sessionId?: string;
	userEmail?: string;
	role: 'user' | 'assistant';
	content: string;
	page?: string;
	threadId?: number | null;
	attachments?: Array<{ name: string; mime: string; kind: string; size: number; fileId?: string | null }>;
}): Promise<number | null> {
	const { sessionId = '', userEmail = '', role, content, page = '', threadId = null, attachments = [] } = opts;
	const text = String(content || '').trim();
	if (!text) return null;
	try {
		const res = await directusServerJson<{ data?: { id?: number } }>('/items/ai_chat_log', {
			method: 'POST',
			body: JSON.stringify({
				session_id: sessionId || '',
				user_email: userEmail || '',
				role,
				page: page || '',
				content: text.slice(0, MAX_CONTENT_LEN),
				thread_id: threadId || null,
				attachments: Array.isArray(attachments) && attachments.length ? attachments : null
			})
		});
		return res?.data?.id ?? null;
	} catch (e: any) {
		console.error('[aiChatLog] gagal mencatat pesan (non-fatal):', e?.message);
		return null;
	}
}
