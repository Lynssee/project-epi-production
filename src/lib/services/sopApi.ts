// src/lib/services/sopApi.ts
// Client-side service pembaca SOP untuk dashboard lapangan (project-epi).

import { auth } from '$lib/firebase';

export interface CompanySopItem {
	id: number;
	title: string;
	sop_code: string;
	department: string;
	approval_status: string;
	status: string;
	version: string;
	version_seq: number;
	effective_date?: string;
	review_due_date?: string;
	sosialisasi_end_date?: string;
	target_departments?: string[];
	target_roles?: string[];
	flow_id?: number;
	kebijakan_id?: number;
	content?: string;
	ai_summary?: string;
	keterangan?: string;
	kategori_sop?: string;
	sub_kategori?: string;
	external_flowchart_url?: string;
	external_doc_url?: string;
	is_confirmed?: boolean;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function fetchSopList(params: { search?: string; includeContent?: boolean } = {}): Promise<{
	success: boolean;
	data: CompanySopItem[];
	error?: string;
}> {
	try {
		const idToken = await getIdToken();
		const qs = new URLSearchParams();
		if (params.search) qs.set('search', params.search);
		if (params.includeContent) qs.set('include_content', 'true');

		const res = await fetch(`/api/sop?${qs.toString()}`, {
			headers: { Authorization: `Bearer ${idToken}` }
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) {
			return { success: false, data: [], error: data?.error || `Gagal memuat SOP (${res.status})` };
		}
		return { success: true, data: data?.data || [] };
	} catch (e) {
		return { success: false, data: [], error: e instanceof Error ? e.message : 'Gagal memuat SOP' };
	}
}

export async function fetchSopDetail(id: number): Promise<{
	success: boolean;
	data?: CompanySopItem;
	error?: string;
}> {
	try {
		const idToken = await getIdToken();
		const res = await fetch(`/api/sop?id=${id}&include_content=true`, {
			headers: { Authorization: `Bearer ${idToken}` }
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) {
			return { success: false, error: data?.error || `Gagal memuat detail SOP (${res.status})` };
		}
		return { success: true, data: data?.data };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal memuat detail SOP' };
	}
}

export async function confirmSopRead(params: {
	sopId?: number | null;
	flowKey?: string | null;
	flowVersion?: number | null;
}): Promise<{
	success: boolean;
	message?: string;
	alreadyConfirmed?: boolean;
	error?: string;
}> {
	try {
		const idToken = await getIdToken();
		const res = await fetch('/api/sop/confirm-read', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify({
				sop_id: params.sopId || null,
				flow_key: params.flowKey || null,
				flow_version: params.flowVersion || null
			})
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) {
			return { success: false, error: data?.error || `Gagal konfirmasi baca (${res.status})` };
		}
		return { success: true, message: data?.message, alreadyConfirmed: data?.already_confirmed };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal konfirmasi baca' };
	}
}
