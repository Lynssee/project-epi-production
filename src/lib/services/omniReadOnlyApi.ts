// src/lib/services/omniReadOnlyApi.ts
// Unified Communication Hub Fase 4 — Omnichannel READ-ONLY untuk dashboard lapangan.
// Kebijakan K-4 (lihat omniSendRequest.ts): Project Leader TIDAK BOLEH chat langsung ke
// pelanggan — hanya boleh melihat riwayat percakapan terkait proyeknya, dan tetap memakai
// "Kirim via Admin" (omniSendRequest) untuk mengirim balasan. Modul ini TIDAK punya fungsi
// kirim pesan sama sekali, dengan sengaja.
//
// Keterkaitan proyek → percakapan dilakukan lewat rantai:
//   proyek saya (projectScope) → so_customer_id → omni_conversations.linked_so_id
// Belum ada tautan langsung project_id di omni_conversations, jadi proyek TANPA SO
// tertaut tidak akan punya percakapan yang cocok — itu memang batasan data saat ini,
// bukan bug di modul ini.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { getProjectsForCurrentUser } from './projectScope';

export interface ReadOnlyConversation {
	id: number;
	channel_type: string;
	status: string;
	subject: string | null;
	assigned_name: string | null;
	last_message_at: string | null;
	last_message_preview: string | null;
	linked_so_id: number | null;
	contact?: { id: number; name: string | null; phone: string | null } | null;
}

export interface ReadOnlyMessage {
	id: number;
	conversation_id: number;
	direction: 'in' | 'out';
	sender_name: string | null;
	text: string | null;
	timestamp: string | null;
	content_type: string | null;
}

/** Percakapan omnichannel yang terkait proyek-proyek saya (via SO), read-only. */
export async function getMyLinkedConversations(): Promise<ReadOnlyConversation[]> {
	try {
		const myProjects = await getProjectsForCurrentUser(true);
		const primaryIds = myProjects
			.map((p: any) => (typeof p.so_customer_id === 'object' ? p.so_customer_id?.id : p.so_customer_id))
			.filter(Boolean);
		// Grand PO (audit lapangan): tambahkan PO saudara proyek gabungan (so_customer.project_id) -- 1 kueri kecil.
		// Gagal -> console.error, tetap pakai PO utama (tampilan saja).
		let siblingIds: any[] = [];
		const projectIds = myProjects.map((p: any) => p.id).filter(Boolean);
		if (projectIds.length) {
			try {
				const rows: any[] = await directus.request(
					readItems('so_customer', { filter: { project_id: { _in: projectIds } }, fields: ['id'] as any, limit: -1 })
				);
				siblingIds = rows.map((r) => r.id);
			} catch (e) {
				console.error('[omniReadOnly] gagal ambil PO saudara proyek:', e);
			}
		}
		const soIds = [...new Set([...primaryIds, ...siblingIds].map(Number).filter(Boolean))];
		if (!soIds.length) return [];

		const convs: any[] = await directus.request(
			readItems('omni_conversations', {
				filter: { linked_so_id: { _in: soIds } },
				fields: ['id', 'channel_type', 'status', 'subject', 'assigned_name', 'last_message_at', 'last_message_preview', 'linked_so_id', 'contact_id'],
				sort: ['-last_message_at'],
				limit: 30
			})
		);
		if (!convs.length) return [];

		const contactIds = [...new Set(convs.map((c) => c.contact_id).filter(Boolean))];
		let contactMap = new Map<number, any>();
		if (contactIds.length) {
			const contacts: any[] = await directus.request(
				readItems('omni_contacts', { filter: { id: { _in: contactIds } }, fields: ['id', 'name', 'phone'], limit: -1 })
			);
			contactMap = new Map(contacts.map((c) => [c.id, c]));
		}

		return convs.map((c) => ({ ...c, contact: c.contact_id ? contactMap.get(c.contact_id) || null : null }));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Riwayat pesan satu percakapan, read-only (tanpa balas). */
export async function getConversationMessagesReadOnly(conversationId: number): Promise<ReadOnlyMessage[]> {
	try {
		return (await directus.request(
			readItems('omni_messages', {
				filter: { conversation_id: { _eq: conversationId } },
				fields: ['id', 'conversation_id', 'direction', 'sender_name', 'text', 'timestamp', 'content_type'],
				sort: ['timestamp'],
				limit: -1
			})
		)) as ReadOnlyMessage[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
