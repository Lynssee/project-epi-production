// Pendukung TES (bukan dipakai kode produksi): meniru penolakan Directus prod terhadap PATCH bersyarat bentuk lama.
//
// Mock `directusServerJson` yang menerima bentuk apa pun menyembunyikan bug "filter di URL + body polos" (400 "data is required")
// — fitur CAS gerbang SJ / kiosk tidak pernah berhasil di produksi padahal tesnya hijau (17 Okt 2026).
// Pakai di mock: `assertBatchPatch(url, opt.body)` — melempar Error bila bentuknya bukan { query:{filter}, data } / { keys, data }.

export interface BatchPatch {
	filter: Record<string, unknown> | null;
	keys: unknown[] | null;
	data: Record<string, any>;
}

export function assertBatchPatch(url: string, rawBody: unknown): BatchPatch {
	if (/[?&]filter(\[|=)/.test(url)) {
		throw new Error(`Directus 400: "data" is required — PATCH dengan filter di URL ditolak (${url}). Pakai body { query: { filter }, data }.`);
	}
	let body: any;
	try {
		body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
	} catch {
		throw new Error('Directus 400: body PATCH bukan JSON valid.');
	}
	const data = body?.data;
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('Directus 400: "data" is required — body PATCH massal harus { query, data } atau { keys, data }.');
	}
	const filter = body?.query?.filter ?? null;
	const keys = Array.isArray(body?.keys) ? body.keys : null;
	if (!filter && !keys) {
		throw new Error('Directus 400: PATCH massal tanpa query.filter / keys (akan mengubah SEMUA baris) tidak diterima oleh tes.');
	}
	return { filter, keys, data };
}
