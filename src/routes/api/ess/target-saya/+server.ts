// src/routes/api/ess/target-saya/+server.ts
// Meneruskan "Target & Proyeksi Saya" ke admin erp-epi (/api/kpi/target-saya). Token Firebase diteruskan apa adanya;
// identitas ditentukan server admin dari token (bukan query). Fail-soft (TIDAK pernah 500) — tidak boleh merusak halaman Kinerja.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

const RELAY_TIMEOUT_MS = 5_000;
const NOT_FOUND_BACKOFF_MS = 2 * 60 * 1000;
const ERROR_BACKOFF_MS = 30 * 1000;

let backoff: { until: number; reason: string } | null = null;

export function _resetTargetSayaBackoff() {
	backoff = null;
}

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Target & proyeksi belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	if (backoff && Date.now() < backoff.until) {
		return json({ available: false, reason: backoff.reason });
	}

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/target-saya`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(RELAY_TIMEOUT_MS)
		});
		if (!res.ok) {
			const reason = `Server admin membalas ${res.status}.`;
			if (res.status === 404 || res.status === 501) {
				backoff = { until: Date.now() + NOT_FOUND_BACKOFF_MS, reason };
			} else if (res.status >= 500) {
				backoff = { until: Date.now() + ERROR_BACKOFF_MS, reason };
			}
			return json({ available: false, reason });
		}
		backoff = null;
		return json(await res.json());
	} catch (e: any) {
		const reason = 'Tidak dapat menghubungi server saat ini.';
		backoff = { until: Date.now() + ERROR_BACKOFF_MS, reason };
		console.warn('[target-saya] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason });
	}
}
