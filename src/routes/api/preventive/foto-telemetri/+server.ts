// src/routes/api/preventive/foto-telemetri/+server.ts
// PMT-52 — telemetri ringan kompresi foto (tier, durasi, ukuran, kelas perangkat) ke koleksi foto_kompres_log. TANPA data pribadi:
// tidak menyimpan user, unit, atau isi foto. Autentikasi cukup login Firebase (requireUser) — tanpa lookup Directus tambahan agar murah.
// Fail-soft: gagal menulis log TIDAK boleh mengganggu pengunggahan foto (klien memanggil fire-and-forget).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

const TIER = ['utama', 'darurat', 'gagal', 'asli'] as const;
const KONTEKS = ['p2h-item', 'p2h-unit', 'p2h-tutup', 'pm'] as const;
const intOrNull = (v: unknown, max: number) => {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null;
};

/** Ringkas user-agent: OS + browser saja (tanpa versi build panjang). */
export function _ringkasAgen(ua: string | null): string | null {
	if (!ua) return null;
	const os = /Android\s[\d.]+/.exec(ua)?.[0] || /iPhone OS [\d_]+/.exec(ua)?.[0]?.replace(/_/g, '.') || (/Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'OS?');
	const br = /(Chrome|Firefox|Safari|Edg)\/(\d+)/.exec(ua);
	return `${os} · ${br ? `${br[1]} ${br[2]}` : 'browser?'}`.slice(0, 120);
}

export const POST: RequestHandler = async (event) => {
	await requireUser(event);
	const b = await event.request.json().catch(() => null);
	if (!b || !(TIER as readonly string[]).includes(b.tier)) throw error(400, 'tier tidak valid.');
	try {
		await directusServerJson('/items/foto_kompres_log', {
			method: 'POST',
			body: JSON.stringify({
				tier: b.tier,
				durasi_ms: intOrNull(b.durasi_ms, 600_000),
				ukuran_asal_kb: intOrNull(b.ukuran_asal_kb, 200_000),
				ukuran_hasil_kb: intOrNull(b.ukuran_hasil_kb, 200_000),
				perangkat_lemah: b.perangkat_lemah === true,
				jaringan: ['slow', 'normal'].includes(b.jaringan) ? b.jaringan : 'unknown',
				agen: _ringkasAgen(event.request.headers.get('user-agent')),
				konteks: (KONTEKS as readonly string[]).includes(b.konteks) ? b.konteks : null
			})
		});
	} catch (err) {
		console.error('[foto-telemetri] gagal menulis foto_kompres_log (diabaikan):', err);
		return json({ ok: false });
	}
	return json({ ok: true });
};
