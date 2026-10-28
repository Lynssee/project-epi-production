// src/lib/server/aiConversations.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiConversations.js (erp-epi-1) —
// thread/percakapan Asisten AI, koleksi Directus `ai_conversations` yang SAMA
// (instance Directus dibagi kedua repo). Fase 4, implementation_plan_Modul Asisten AI v3.1.md.

import { directusServerJson } from './directus';

const TITLE_MAX_LEN = 80;

function makeTitle(firstMessage: string | undefined): string {
	const text = String(firstMessage || '').trim();
	if (!text) return '(Percakapan baru)';
	return text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN)}…` : text;
}

export interface ThreadSummary {
	id: number;
	title: string;
	last_message_at: string | null;
	date_created: string | null;
}

export interface ThreadMessage {
	id: number;
	role: 'user' | 'assistant';
	content: string;
	created_at: string;
	attachments?: Array<{ name: string; mime: string; kind: string; size: number; fileId?: string | null }> | null;
}

/**
 * Pastikan thread ada milik user ini: bila threadId diberikan, verifikasi
 * kepemilikan (tidak cocok -> null, caller yang tolak). Bila tidak, buat
 * thread baru dengan judul dari pesan pertama.
 */
export async function resolveThread({
	threadId,
	userEmail,
	app,
	firstMessage
}: {
	threadId?: number | null;
	userEmail: string;
	app: 'admin' | 'field';
	firstMessage?: string;
}): Promise<number | null> {
	if (threadId) {
		const res = await directusServerJson<{ data?: { id: number; user_email: string } }>(
			`/items/ai_conversations/${threadId}?fields=id,user_email`
		).catch(() => null);
		const row = res?.data;
		if (!row || String(row.user_email || '').toLowerCase() !== String(userEmail || '').toLowerCase()) return null;
		directusServerJson(`/items/ai_conversations/${threadId}`, {
			method: 'PATCH',
			body: JSON.stringify({ last_message_at: new Date().toISOString() })
		}).catch((e: any) => console.error('[aiConversations] gagal update last_message_at (non-fatal):', e?.message));
		return threadId;
	}

	try {
		const created = await directusServerJson<{ data?: { id: number } }>('/items/ai_conversations', {
			method: 'POST',
			body: JSON.stringify({
				user_email: userEmail || '',
				app,
				title: makeTitle(firstMessage),
				last_message_at: new Date().toISOString()
			})
		});
		return created?.data?.id ?? null;
	} catch (e: any) {
		console.error('[aiConversations] gagal membuat thread (non-fatal, lanjut tanpa thread):', e?.message);
		return null;
	}
}

/** Daftar thread milik user, terbaru dulu — untuk sidebar riwayat. */
export async function listThreads(userEmail: string, limit = 30): Promise<ThreadSummary[]> {
	const qs = new URLSearchParams({
		filter: JSON.stringify({ user_email: { _eq: userEmail } }),
		fields: 'id,title,last_message_at,date_created',
		sort: '-last_message_at',
		limit: String(limit)
	});
	const res = await directusServerJson<{ data?: ThreadSummary[] }>(`/items/ai_conversations?${qs.toString()}`).catch(() => null);
	return res?.data || [];
}

/**
 * Pesan dalam satu thread, urut lama->baru — untuk memuat ulang percakapan.
 * Verifikasi kepemilikan thread dulu (kecuali allowAnyOwner, dipakai Super Admin QC).
 */
export async function getThreadMessages(
	threadId: number,
	userEmail: string,
	{ allowAnyOwner = false }: { allowAnyOwner?: boolean } = {}
): Promise<{ thread: { id: number; user_email: string }; messages: ThreadMessage[] } | null> {
	const threadRes = await directusServerJson<{ data?: { id: number; user_email: string } }>(
		`/items/ai_conversations/${threadId}?fields=id,user_email`
	).catch(() => null);
	const thread = threadRes?.data;
	if (!thread) return null;
	if (!allowAnyOwner && String(thread.user_email || '').toLowerCase() !== String(userEmail || '').toLowerCase()) return null;

	const qs = new URLSearchParams({
		filter: JSON.stringify({ thread_id: { _eq: threadId } }),
		fields: 'id,role,content,created_at,attachments',
		sort: 'created_at',
		limit: '-1'
	});
	const res = await directusServerJson<{ data?: ThreadMessage[] }>(`/items/ai_chat_log?${qs.toString()}`).catch(() => null);
	return { thread, messages: res?.data || [] };
}
