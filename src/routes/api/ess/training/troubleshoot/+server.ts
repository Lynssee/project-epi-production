// Kartu Troubleshoot aktif untuk Buku Saku (hanya karyawan login; cache server 5 menit).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadTroubleshootCards, type TroubleshootCard } from '$lib/server/ess/troubleshootCards';

let cache: { at: number; value: TroubleshootCard[] } | null = null;
const TTL_MS = 300_000;

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	try {
		if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), value: await loadTroubleshootCards() };
		return json({ cards: cache.value });
	} catch (e) {
		console.error('[ess/training/troubleshoot] gagal:', (e as Error)?.message);
		throw error(500, 'Gagal memuat kartu troubleshoot.');
	}
};
