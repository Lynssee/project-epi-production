// src/lib/services/internalChatApi.ts
// Unified Communication Hub Fase 4 — Chat Internal Karyawan di dashboard lapangan.
// Port dari erp-epi-1/src/lib/services/internalChatApi.js — collection Directus
// SAMA (internal_chat_rooms/internal_chat_messages), sebab kedua project mengarah
// ke instance Directus yang sama. Identitas anggota tetap Firebase UID.
import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';

const COL_ROOMS = 'internal_chat_rooms';
const COL_MESSAGES = 'internal_chat_messages';

export interface ChatRoom {
	id: number;
	type: 'direct' | 'group';
	name: string | null;
	member_uids: string[];
	member_names: string[];
	created_by_uid: string | null;
	created_by_name: string | null;
	last_message_at: string | null;
	last_message_preview: string | null;
}

export interface ChatMessage {
	id: number;
	room_id: number;
	sender_uid: string;
	sender_name: string | null;
	content: string;
	read_by: string[] | null;
	date_created: string;
}

const FIELDS_ROOM = ['id', 'type', 'name', 'member_uids', 'member_names', 'created_by_uid', 'created_by_name', 'last_message_at', 'last_message_preview', 'date_created'];

/**
 * Daftar room milik saya. Filter keanggotaan JSON array dilakukan di klien
 * (bukan filter server _contains) — sama seperti versi erp-epi-1, konsisten
 * dengan gotcha SQLite Directus proyek ini untuk operator array pada kolom JSON.
 */
export async function getMyRooms(myUid: string | null, limit = 100): Promise<ChatRoom[]> {
	if (!myUid) return [];
	try {
		const rooms: any[] = await directus.request(
			readItems(COL_ROOMS, { fields: FIELDS_ROOM, sort: ['-last_message_at'], limit })
		);
		return (rooms || []).filter((r) => Array.isArray(r.member_uids) && r.member_uids.includes(myUid));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getUnreadCount(myUid: string | null, roomIds: number[]): Promise<number> {
	if (!myUid || !roomIds.length) return 0;
	try {
		const msgs: any[] = await directus.request(
			readItems(COL_MESSAGES, {
				filter: { room_id: { _in: roomIds }, sender_uid: { _neq: myUid } },
				fields: ['id', 'room_id', 'read_by'],
				limit: -1
			})
		);
		return (msgs || []).filter((m) => !(Array.isArray(m.read_by) && m.read_by.includes(myUid))).length;
	} catch (error) {
		handleDirectusError(error);
		return 0;
	}
}

export async function getRoomMessages(roomId: number, limit = 100): Promise<ChatMessage[]> {
	try {
		return (await directus.request(
			readItems(COL_MESSAGES, {
				filter: { room_id: { _eq: roomId } },
				fields: ['id', 'room_id', 'sender_uid', 'sender_name', 'content', 'read_by', 'date_created'],
				sort: ['date_created'],
				limit
			})
		)) as ChatMessage[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function sendMessage(roomId: number, senderUid: string, senderName: string, content: string): Promise<boolean> {
	try {
		await directus.request(createItem(COL_MESSAGES, { room_id: roomId, sender_uid: senderUid, sender_name: senderName, content, read_by: [senderUid] }));
		await directus.request(updateItem(COL_ROOMS, roomId, { last_message_at: new Date().toISOString(), last_message_preview: content.slice(0, 120) }));
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

export async function markRoomAsRead(roomId: number, myUid: string | null): Promise<void> {
	if (!myUid) return;
	try {
		const msgs: any[] = await directus.request(
			readItems(COL_MESSAGES, { filter: { room_id: { _eq: roomId }, sender_uid: { _neq: myUid } }, fields: ['id', 'read_by'], limit: 100 })
		);
		const unread = (msgs || []).filter((m) => !(Array.isArray(m.read_by) && m.read_by.includes(myUid)));
		await Promise.all(unread.map((m) => directus.request(updateItem(COL_MESSAGES, m.id, { read_by: [...(m.read_by || []), myUid] }))));
	} catch (error) {
		handleDirectusError(error);
	}
}

export async function findOrCreateDirectRoom(myUid: string, myName: string, targetUid: string, targetName: string): Promise<ChatRoom | null> {
	try {
		const existing = await getMyRooms(myUid, 200);
		const found = existing.find((r) => r.type === 'direct' && r.member_uids?.includes(targetUid) && r.member_uids.length === 2);
		if (found) return found;

		return (await directus.request(
			createItem(COL_ROOMS, {
				type: 'direct',
				member_uids: [myUid, targetUid],
				member_names: [myName, targetName],
				created_by_uid: myUid,
				created_by_name: myName
			})
		)) as ChatRoom;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export function roomDisplayName(room: ChatRoom, myUid: string | null): string {
	if (room.type === 'group') return room.name || 'Grup';
	const idx = (room.member_uids || []).findIndex((u) => u !== myUid);
	return (room.member_names || [])[idx] || 'Karyawan';
}
