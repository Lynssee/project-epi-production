// src/lib/services/ess/calendar.ts
// Client-side service ESS My Calendar — selalu lewat /api/ess/calendar/*.

import { auth } from '$lib/firebase';

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

export interface CreateEventParams {
	title: string;
	start_date: string;
	end_date?: string | null;
	all_day?: boolean;
	color?: string | null;
	description?: string | null;
	recurrence_rule?: 'daily' | 'weekly' | 'monthly' | null;
	recurrence_until?: string | null;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
	const idToken = await getIdToken();
	const params = new URLSearchParams({ from, to });
	const res = await fetch(`/api/ess/calendar?${params.toString()}`, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.events;
}

export async function createCalendarEvent(params: CreateEventParams): Promise<any> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/calendar/events', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.event;
}

export async function deleteCalendarEvent(id: number): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/calendar/events/${id}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
