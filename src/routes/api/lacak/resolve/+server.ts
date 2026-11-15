// src/routes/api/lacak/resolve/+server.ts
// Jembatan tautan pelacakan publik (erp-epi /lacak/<jenis>/<id>?h=) → layar Lapangan yang memberi aksi sesuai peran.
// TERAUTENTIKASI: qr_token Surat Jalan (bukti "memegang dokumen fisik" untuk aksi gerbang/terima) hanya diberikan kepada
// user login DAN pemegang tautan bertanda tangan sah — tautan publik saja tidak cukup. Detail: $lib/server/lacakLink.ts.
//
//   POST { jenis, id, sig } -> { target, label, external? }

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { isLacakJenis, isValidLacakId, verifyLacakSig, lacakTarget, publicLacakUrl, type LacakRows } from '$lib/server/lacakLink';

export async function POST(event: RequestEvent) {
	await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const jenis = body?.jenis;
	const id = String(body?.id ?? '');
	const sig = String(body?.sig ?? '');

	if (!isLacakJenis(jenis) || !isValidLacakId(id, jenis)) throw error(400, 'Tautan pelacakan tidak dikenali.');
	// Respons tanda tangan salah sengaja generik — tidak membedakan "dokumen tidak ada".
	if (!verifyLacakSig(jenis, id, sig)) return json({ message: 'Tautan pelacakan tidak sah atau sudah tidak berlaku.' }, { status: 403 });

	const rows: LacakRows = {};
	try {
		if (jenis === 'sj') {
			const r = await directusServerJson<{ data: { qr_token: string | null } | null }>(`/items/surat_jalan/${id}?fields=id,qr_token`);
			if (!r?.data) throw error(404, 'Surat Jalan tidak ditemukan.');
			rows.sjQrToken = r.data.qr_token;
		} else if (jenis === 'pl') {
			const r = await directusServerJson<{ data: { project_id: number | null } | null }>(`/items/packing_list/${id}?fields=id,project_id`);
			if (!r?.data) throw error(404, 'Packing List tidak ditemukan.');
			rows.plProjectId = r.data.project_id;
		}
	} catch (e: any) {
		if (e?.status) throw e; // error() SvelteKit — teruskan apa adanya
		console.error(`[lacak/resolve] gagal membaca ${jenis} #${id}:`, e?.message || e);
		throw error(503, 'Data dokumen belum dapat dimuat. Coba lagi sebentar lagi.');
	}

	const publik = publicLacakUrl(jenis, id, sig);
	const t = lacakTarget(jenis, id, rows);
	// target null = tak ada layar Lapangan untuk jenis ini → arahkan ke halaman publik (baca-saja) di erp-epi.
	return json(t.target ? { ...t, publik } : { target: publik, external: true, label: t.label, publik });
}
