// src/lib/services/aiConversationsApi.ts
// Client-side wrapper untuk sidebar riwayat percakapan Asisten AI
// (src/routes/api/ai-assistant/conversations/**, .../feedback). Port dari
// erp-epi-1/src/lib/services/aiConversationsApi.js. Fase 4, implementation_plan_Modul Asisten AI v3.1.md.

import { auth } from '$lib/firebase';

async function authHeaders(): Promise<Record<string, string>> {
	const user = auth?.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const token = await user.getIdToken();
	return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export interface ThreadSummary {
	id: number;
	title: string;
	last_message_at: string | null;
	date_created: string | null;
}

export async function listConversations(): Promise<{ success: boolean; data?: ThreadSummary[]; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetch('/api/ai-assistant/conversations', { headers });
		const data = await res.json().catch(() => null);
		if (!res.ok) return { success: false, error: data?.message || `Gagal memuat riwayat (${res.status})` };
		return { success: true, data: data?.data || [] };
	} catch (e: any) {
		return { success: false, error: e?.message || 'Gagal memuat riwayat percakapan' };
	}
}

export async function getConversationMessages(threadId: number): Promise<{ success: boolean; data?: any; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetch(`/api/ai-assistant/conversations/${threadId}/messages`, { headers });
		const data = await res.json().catch(() => null);
		if (!res.ok) return { success: false, error: data?.message || `Gagal memuat percakapan (${res.status})` };
		return { success: true, data: data?.data };
	} catch (e: any) {
		return { success: false, error: e?.message || 'Gagal memuat percakapan' };
	}
}

export async function sendChatFeedback(opts: {
	chatLogId: number;
	threadId: number | null;
	verdict: 'up' | 'down';
	note?: string;
}): Promise<{ success: boolean; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetch('/api/ai-assistant/feedback', { method: 'POST', headers, body: JSON.stringify(opts) });
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) return { success: false, error: data?.message || data?.error || `Gagal mengirim feedback (${res.status})` };
		return { success: true };
	} catch (e: any) {
		return { success: false, error: e?.message || 'Gagal mengirim feedback' };
	}
}
