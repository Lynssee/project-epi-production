// src/lib/server/ess/belongingServer.ts
// "Wall of Belonging" aplikasi lapangan: milestone rekan (celebration_events) di sekitar hari ini + ucapan emoji
// (celebration_wishes). Salinan setia erp-epi/src/lib/server/ess/belongingServer.js — memakai tabel EXISTING, tanpa skema baru.
// Hanya tipe milestone yang celebration_config-nya aktif & show_wall_of_fame; event dibatalkan disembunyikan.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { loadCultureSettings } from '$lib/server/ess/budayaHarian';
import { loadSpotlightTayang, type SpotlightItem } from '$lib/server/ess/spotlight';

export const WISH_EMOJI = ['💪', '🎉', '👏', '❤️'];
const MAX_EVENTS = 12;

export interface WallEvent {
	id: number;
	tipe: string;
	judul: string;
	tanggal_event: string | null;
	tahun_ke: number | null;
	jumlah_ucapan: number;
	emoji_saya: string | null;
	milik_saya: boolean;
}

export class BelongingError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

function addDays(ymd: string, delta: number): string {
	const [y, m, d] = ymd.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

async function loadWallEvents(days: number, today: string): Promise<any[]> {
	const cfg = await directusServerJson<{ data: any[] }>(
		`/items/celebration_config?filter[aktif][_eq]=1&filter[show_wall_of_fame][_eq]=1&fields=tipe_milestone&limit=-1`
	);
	const tipes = (cfg?.data || []).map((c) => c.tipe_milestone).filter(Boolean);
	if (!tipes.length) return [];
	const res = await directusServerJson<{ data: any[] }>(
		`/items/celebration_events?filter[tipe][_in]=${tipes.join(',')}&filter[status][_neq]=cancelled` +
			`&filter[tanggal_event][_gte]=${addDays(today, -days)}&filter[tanggal_event][_lte]=${addDays(today, days)}` +
			`&fields=id,karyawan_id,tipe,judul,tanggal_event,tahun_ke&sort=tanggal_event&limit=${MAX_EVENTS}`
	);
	return res?.data || [];
}

export async function getWall(karyawan: { id: number }): Promise<{ days: number; events: WallEvent[]; spotlight: SpotlightItem[] }> {
	const settings = await loadCultureSettings();
	const days = Number(settings['culture.wall_of_belonging_days']) || 7;
	const spotlight = await loadSpotlightTayang(); // Kartu Kebanggaan Proyek (Fase 5) — fail-soft
	let events: any[] = [];
	try {
		events = await loadWallEvents(days, todayJakarta());
	} catch (e) {
		console.error('[belonging] gagal memuat milestone rekan:', (e as Error)?.message);
		return { days, events: [], spotlight };
	}
	if (!events.length) return { days, events: [], spotlight };
	let wishes: any[] = [];
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/celebration_wishes?filter[event_id][_in]=${events.map((e) => e.id).join(',')}&fields=event_id,from_karyawan,emoji_reaction&limit=-1`
		);
		wishes = res?.data || [];
	} catch (e) {
		console.warn('[belonging] gagal memuat ucapan:', (e as Error)?.message);
	}
	const byEvent = new Map<string, any[]>();
	for (const w of wishes) {
		const k = String(w.event_id);
		if (!byEvent.has(k)) byEvent.set(k, []);
		byEvent.get(k)!.push(w);
	}
	return {
		days,
		spotlight,
		events: events.map((ev) => {
			const list = byEvent.get(String(ev.id)) || [];
			const mine = list.find((w) => String(w.from_karyawan) === String(karyawan.id));
			return {
				id: ev.id,
				tipe: ev.tipe,
				judul: ev.judul,
				tanggal_event: ev.tanggal_event ?? null,
				tahun_ke: ev.tahun_ke ?? null,
				jumlah_ucapan: list.length,
				emoji_saya: mine ? mine.emoji_reaction || '✅' : null,
				milik_saya: String(ev.karyawan_id) === String(karyawan.id)
			};
		})
	};
}

export async function sendWish(karyawan: { id: number }, input: { eventId: unknown; emoji: string }): Promise<{ ok: true; sudah: boolean; emoji: string }> {
	if (!WISH_EMOJI.includes(input.emoji)) throw new BelongingError('Emoji tidak valid.', 400);
	const wall = await getWall(karyawan);
	const ev = wall.events.find((e) => String(e.id) === String(input.eventId));
	if (!ev) throw new BelongingError('Milestone ini sudah tidak tampil. Muat ulang halaman.', 409);
	if (ev.milik_saya) throw new BelongingError('Ucapan untuk diri sendiri tidak diperlukan 🙂', 400);
	if (ev.emoji_saya) return { ok: true, sudah: true, emoji: ev.emoji_saya };
	await directusServerJson('/items/celebration_wishes', {
		method: 'POST',
		body: JSON.stringify({ event_id: ev.id, from_karyawan: karyawan.id, pesan: null, emoji_reaction: input.emoji })
	});
	return { ok: true, sudah: false, emoji: input.emoji };
}
