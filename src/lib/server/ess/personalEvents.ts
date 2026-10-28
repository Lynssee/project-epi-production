// src/lib/server/ess/personalEvents.ts
// My Calendar Fase 3 — event kustom pribadi (koleksi personal_events). Murni privat per
// karyawan. Recurrence (daily/weekly/monthly) ditambahkan atas permintaan eksplisit user —
// occurrence dihitung on-the-fly per rentang [from,to] di calendar.ts, TIDAK disimpan
// sebagai baris terpisah (supaya edit/hapus tetap satu titik). Konsekuensi: hapus/edit
// selalu berlaku ke SELURUH rangkaian, tidak ada pengecualian per-occurrence.

import { directusServerJson } from '$lib/server/directus';

export type RecurrenceRule = 'daily' | 'weekly' | 'monthly' | null;

export interface PersonalEventRecord {
	id: number;
	karyawan_id: number;
	title: string;
	start_date: string;
	end_date: string | null;
	all_day: boolean;
	color: string | null;
	description: string | null;
	recurrence_rule: RecurrenceRule;
	recurrence_until: string | null;
}

const EVENT_FIELDS = [
	'id', 'karyawan_id', 'title', 'start_date', 'end_date', 'all_day', 'color', 'description',
	'recurrence_rule', 'recurrence_until'
].join(',');

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

function normalize(row: any): PersonalEventRecord {
	return { ...row, karyawan_id: unwrapId(row.karyawan_id) as number, all_day: !!row.all_day };
}

export async function listMyEvents(karyawanId: number, from: string, to: string): Promise<PersonalEventRecord[]> {
	const filter = {
		_and: [
			{ karyawan_id: { _eq: karyawanId } },
			{ start_date: { _lte: to } },
			{
				_or: [
					{ _and: [{ recurrence_rule: { _null: true } }, { _or: [{ end_date: { _null: true } }, { end_date: { _gte: from } }] }] },
					{ _and: [{ recurrence_rule: { _nnull: true } }, { _or: [{ recurrence_until: { _null: true } }, { recurrence_until: { _gte: from } }] }] }
				]
			}
		]
	};
	const query = new URLSearchParams({ filter: JSON.stringify(filter), fields: EVENT_FIELDS, sort: 'start_date', limit: '200' });
	const result = await directusServerJson<{ data: any[] }>(`/items/personal_events?${query.toString()}`);
	return (result?.data || []).map(normalize);
}

export async function createEvent(
	karyawanId: number,
	input: {
		title: string;
		start_date: string;
		end_date?: string | null;
		all_day?: boolean;
		color?: string | null;
		description?: string | null;
		recurrence_rule?: RecurrenceRule;
		recurrence_until?: string | null;
	}
): Promise<PersonalEventRecord> {
	const recurrenceRule = input.recurrence_rule || null;
	const result = await directusServerJson<{ data: any }>('/items/personal_events', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: karyawanId,
			title: input.title,
			start_date: input.start_date,
			end_date: input.end_date || null,
			all_day: !!input.all_day,
			color: input.color || null,
			description: input.description || null,
			recurrence_rule: recurrenceRule,
			recurrence_until: recurrenceRule ? input.recurrence_until || null : null
		})
	});
	return normalize(result.data);
}

async function assertOwned(karyawanId: number, eventId: number): Promise<void> {
	const query = new URLSearchParams({ 'filter[karyawan_id][_eq]': String(karyawanId), 'filter[id][_eq]': String(eventId), fields: 'id', limit: '1' });
	const owned = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/personal_events?${query.toString()}`);
	if (!owned?.data?.length) throw new Error('Event tidak ditemukan.');
}

export async function updateEvent(
	karyawanId: number,
	eventId: number,
	patch: Partial<{ title: string; start_date: string; end_date: string | null; all_day: boolean; color: string | null; description: string | null }>
): Promise<PersonalEventRecord> {
	await assertOwned(karyawanId, eventId);
	const result = await directusServerJson<{ data: any }>(`/items/personal_events/${eventId}`, { method: 'PATCH', body: JSON.stringify(patch) });
	return normalize(result.data);
}

export async function deleteEvent(karyawanId: number, eventId: number): Promise<void> {
	await assertOwned(karyawanId, eventId);
	await directusServerJson(`/items/personal_events/${eventId}`, { method: 'DELETE' });
}
