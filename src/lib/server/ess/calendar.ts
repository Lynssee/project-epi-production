// src/lib/server/ess/calendar.ts
// My Calendar Fase 3 — aggregator paralel dari sumber yang sudah ada + personal_notes
// (reminder) + personal_events (custom). Dibatasi rentang [from, to] (per bulan yang
// tampil) supaya tidak fetch semua koleksi tiap render.

import { directusServerJson } from '$lib/server/directus';
import { listMyEvents } from '$lib/server/ess/personalEvents';

export interface CalendarEvent {
	id: string;
	title: string;
	start: string;
	end: string | null;
	allDay: boolean;
	source: 'cuti' | 'lembur' | 'shift' | 'training' | 'reminder' | 'event';
	color: string;
	eventId?: number;
	recurring?: boolean;
}

async function listCutiEvents(karyawanId: number, from: string, to: string): Promise<CalendarEvent[]> {
	const filter = {
		_and: [
			{ karyawan_id: { _eq: karyawanId } },
			{ status: { _eq: 'Disetujui' } },
			{ tanggal_mulai: { _lte: to } },
			{ tanggal_selesai: { _gte: from } }
		]
	};
	const query = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id,jenis_cuti,tanggal_mulai,tanggal_selesai',
		limit: '100'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/cuti_karyawan?${query.toString()}`);
	return (result?.data || []).map((r) => ({
		id: `cuti-${r.id}`,
		title: `Cuti: ${r.jenis_cuti}`,
		start: r.tanggal_mulai,
		end: r.tanggal_selesai,
		allDay: true,
		source: 'cuti' as const,
		color: '#10B981'
	}));
}

async function listLemburEvents(karyawanId: number, from: string, to: string): Promise<CalendarEvent[]> {
	const filter = {
		_and: [{ karyawan_id: { _eq: karyawanId } }, { status: { _eq: 'Disetujui' } }, { tanggal: { _between: [from, to] } }]
	};
	const query = new URLSearchParams({ filter: JSON.stringify(filter), fields: 'id,tanggal,jam_mulai,jam_selesai', limit: '100' });
	const result = await directusServerJson<{ data: any[] }>(`/items/ess_lembur?${query.toString()}`);
	return (result?.data || []).map((r) => ({
		id: `lembur-${r.id}`,
		title: `Lembur ${r.jam_mulai || ''}${r.jam_selesai ? '–' + r.jam_selesai : ''}`.trim(),
		start: r.tanggal,
		end: null,
		allDay: false,
		source: 'lembur' as const,
		color: '#F59E0B'
	}));
}

async function listShiftEvents(karyawanId: number, from: string, to: string): Promise<CalendarEvent[]> {
	const filter = { _and: [{ karyawan_id: { _eq: karyawanId } }, { tanggal: { _between: [from, to] } }] };
	const query = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id,tanggal,status,jadwal_kerja_id.id,jadwal_kerja_id.nama_jadwal',
		limit: '100'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/shift_roster?${query.toString()}`);
	return (result?.data || []).map((r) => ({
		id: `shift-${r.id}`,
		title: `Shift: ${r.jadwal_kerja_id?.nama_jadwal || '-'}`,
		start: r.tanggal,
		end: null,
		allDay: true,
		source: 'shift' as const,
		color: '#6366F1'
	}));
}

async function listTrainingEvents(karyawanId: number, from: string, to: string): Promise<CalendarEvent[]> {
	const filter = {
		_and: [
			{ karyawan_id: { _eq: karyawanId } },
			{ tenggat: { _nnull: true } },
			{ tenggat: { _between: [from, to] } },
			{ status: { _in: ['Enrolled', 'Ongoing', 'Remedial'] } }
		]
	};
	const query = new URLSearchParams({ filter: JSON.stringify(filter), fields: 'id,tenggat,program_id.judul', limit: '100' });
	const result = await directusServerJson<{ data: any[] }>(`/items/training_enrollment?${query.toString()}`);
	return (result?.data || []).map((r) => ({
		id: `training-${r.id}`,
		title: `Tenggat: ${r.program_id?.judul || 'Pelatihan'}`,
		start: r.tenggat,
		end: null,
		allDay: true,
		source: 'training' as const,
		color: '#EC4899'
	}));
}

async function listReminderEvents(karyawanId: number, from: string, to: string): Promise<CalendarEvent[]> {
	const filter = {
		_and: [
			{ karyawan_id: { _eq: karyawanId } },
			{ type: { _eq: 'reminder' } },
			{ status: { _eq: 'active' } },
			{ reminder_date: { _between: [from, to] } }
		]
	};
	const query = new URLSearchParams({ filter: JSON.stringify(filter), fields: 'id,title,content,reminder_date', limit: '100' });
	const result = await directusServerJson<{ data: any[] }>(`/items/personal_notes?${query.toString()}`);
	return (result?.data || []).map((r) => ({
		id: `reminder-${r.id}`,
		title: r.title || r.content?.slice(0, 40) || 'Pengingat',
		start: r.reminder_date,
		end: null,
		allDay: false,
		source: 'reminder' as const,
		color: '#EF4444'
	}));
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}
function toISODate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDateOnly(str: string): Date {
	const [y, m, d] = str.slice(0, 10).split('-').map(Number);
	return new Date(y, m - 1, d);
}

/**
 * Occurrence dihitung on-the-fly, TIDAK disimpan sebagai baris terpisah (lihat komentar
 * personalEvents.ts). Guard iterasi mencegah loop berlebihan kalau recurrence_until diisi
 * jauh ke depan/start_date jauh di masa lalu — cukup untuk skala kalender pribadi.
 */
function expandOccurrences(event: Awaited<ReturnType<typeof listMyEvents>>[number], from: string, to: string): string[] {
	const rule = event.recurrence_rule;
	if (!rule) return [event.start_date];

	const start = parseDateOnly(event.start_date);
	const rangeFrom = parseDateOnly(from);
	const rangeTo = parseDateOnly(to);
	const until = event.recurrence_until ? parseDateOnly(event.recurrence_until) : rangeTo;
	const effectiveEnd = until < rangeTo ? until : rangeTo;
	if (effectiveEnd < start) return [];

	const occurrences: string[] = [];
	let cursor = new Date(start);
	const targetDay = start.getDate();
	const GUARD_MAX = 2000;
	let guard = 0;
	let monthOffset = 0;

	while (cursor <= effectiveEnd && guard < GUARD_MAX) {
		if (cursor >= rangeFrom) occurrences.push(toISODate(cursor));
		if (rule === 'daily') cursor.setDate(cursor.getDate() + 1);
		else if (rule === 'weekly') cursor.setDate(cursor.getDate() + 7);
		else if (rule === 'monthly') {
			monthOffset += 1;
			const targetMonthFirst = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1);
			const daysInTargetMonth = new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth() + 1, 0).getDate();
			cursor = new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth(), Math.min(targetDay, daysInTargetMonth));
		} else break;
		guard++;
	}
	return occurrences;
}

function toCustomEvents(events: Awaited<ReturnType<typeof listMyEvents>>, from: string, to: string): CalendarEvent[] {
	const out: CalendarEvent[] = [];
	for (const e of events) {
		const occurrenceDates = expandOccurrences(e, from, to);
		for (const occDate of occurrenceDates) {
			out.push({
				id: `event-${e.id}-${occDate}`,
				eventId: e.id,
				title: e.title,
				start: occDate,
				end: e.recurrence_rule ? null : e.end_date,
				allDay: e.all_day,
				source: 'event' as const,
				color: e.color || '#8B5CF6',
				recurring: !!e.recurrence_rule
			});
		}
	}
	return out;
}

/** Ambil semua sumber kalender secara paralel untuk rentang [from, to] (format YYYY-MM-DD). */
export async function listCalendarEvents(karyawanId: number, from: string, to: string): Promise<CalendarEvent[]> {
	const [cuti, lembur, shift, training, reminder, customEvents] = await Promise.all([
		listCutiEvents(karyawanId, from, to).catch(() => []),
		listLemburEvents(karyawanId, from, to).catch(() => []),
		listShiftEvents(karyawanId, from, to).catch(() => []),
		listTrainingEvents(karyawanId, from, to).catch(() => []),
		listReminderEvents(karyawanId, from, to).catch(() => []),
		listMyEvents(karyawanId, from, to).catch(() => [])
	]);
	return [...cuti, ...lembur, ...shift, ...training, ...reminder, ...toCustomEvents(customEvents, from, to)].sort((a, b) => a.start.localeCompare(b.start));
}
