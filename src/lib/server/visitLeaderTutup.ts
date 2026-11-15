// src/lib/server/visitLeaderTutup.ts
// PDP-33 — SERVER-ONLY. Leader MENUTUP visit harian (catatan + foto). Dipakai dua endpoint tipis:
//   GET  /api/visit-leader/belum-ditutup  → visit terbuka milik saya + setelan (batas jam, min foto)
//   POST /api/visit-leader/tutup          → tutup satu visit
// Kepemilikan visit: karyawan_id = saya, ATAU proyek visit itu proyek yang saya pimpin (leader/co-leader — visit manual
// admin memakai teks leader tanpa karyawan_id). Relasi di-fetch terpisah (Aturan #2); error baca dilog.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { resolveKaryawanByEmail, resolveLedProjectIds } from '$lib/server/projectLeaderGuard';
import { bacaSetelanVisit, validasiTutup, adalahTerbuka, VISIT_SETTING_KEYS, type SetelanVisit } from '$lib/shared/visitTutup';

const HARI_CARI = 14; // visit terbuka lebih tua dari ini ditutup massal oleh sistem (bukan urusan layar HP)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bacaSetelanVisitServer(): Promise<SetelanVisit> {
	const raw: Record<string, unknown> = {};
	try {
		const keys = Object.values(VISIT_SETTING_KEYS).join(',');
		const r = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?filter[module][_eq]=project&filter[setting_key][_in]=${keys}&fields=setting_key,setting_value&limit=-1`
		);
		for (const row of r?.data || []) raw[row.setting_key] = row.setting_value;
	} catch (e: any) {
		console.error('[visitLeaderTutup] gagal baca setelan visit (pakai default):', e?.message || e);
	}
	return bacaSetelanVisit(raw);
}

async function karyawanSaya(event: RequestEvent) {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Minta HRD mengisi "Email Perusahaan" pada data Anda.');
	return karyawan;
}

const tglWIB = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export async function daftarVisitBelumDitutup(event: RequestEvent) {
	const karyawan = await karyawanSaya(event);
	const [setelan, ledIds] = await Promise.all([bacaSetelanVisitServer(), resolveLedProjectIds(karyawan)]);
	const dari = tglWIB(new Date(Date.now() - HARI_CARI * 86_400_000));

	const conds: any[] = [{ karyawan_id: { _eq: String(karyawan.id) } }];
	if (ledIds.length) conds.push({ project_id: { _in: ledIds } });
	const filter = encodeURIComponent(JSON.stringify({ _and: [{ status: { _in: ['open', 'in_progress'] } }, { tanggal_kunjungan: { _gte: dari } }, { _or: conds }] }));
	const res = await directusServerJson<{ data: any[] }>(
		`/items/project_visit_leader?filter=${filter}&fields=id,tanggal_kunjungan,project_id,leader,lokasi,kegiatan,temuan,tindak_lanjut,rencana_besok,status,sumber&sort=-tanggal_kunjungan,-id&limit=30`
	).catch((e) => {
		console.error('[visitLeaderTutup] gagal baca visit terbuka:', e?.message || e);
		throw error(502, 'Gagal memuat visit. Coba lagi.');
	});
	const visits = res?.data || [];

	// nama proyek (query terpisah)
	const pids = [...new Set(visits.map((v) => Number(v.project_id)).filter(Boolean))];
	const nama = new Map<number, string>();
	if (pids.length) {
		const pr = await directusServerJson<{ data: any[] }>(`/items/projects?filter[id][_in]=${pids.join(',')}&fields=id,name&limit=-1`).catch((e) => {
			console.warn('[visitLeaderTutup] nama proyek tidak terbaca:', e?.message || e);
			return null;
		});
		for (const p of pr?.data || []) nama.set(p.id, p.name);
	}
	return {
		setelan,
		hariIni: tglWIB(),
		visits: visits.map((v) => ({ ...v, project_name: nama.get(Number(v.project_id)) || null }))
	};
}

export interface TutupInput {
	visitId: number;
	kegiatan: string;
	temuan?: string;
	tindakLanjut?: string;
	rencanaBesok?: string;
	fotoIds: string[];
}

export async function tutupVisit(event: RequestEvent, input: TutupInput) {
	const karyawan = await karyawanSaya(event);
	const setelan = await bacaSetelanVisitServer();

	const fotoIds = [...new Set((input.fotoIds || []).map((x) => String(x).trim()).filter((x) => UUID.test(x)))];
	const v = validasiTutup({ kegiatan: input.kegiatan, fotoCount: fotoIds.length, minFoto: setelan.minFoto });
	if (!v.ok) throw error(400, v.error);

	const visit = (
		await directusServerJson<{ data: any }>(`/items/project_visit_leader/${input.visitId}?fields=id,status,karyawan_id,project_id,tanggal_kunjungan`).catch((e) => {
			console.error('[visitLeaderTutup] gagal baca visit', input.visitId, e?.message || e);
			return null;
		})
	)?.data;
	if (!visit) throw error(404, 'Visit tidak ditemukan.');
	if (!adalahTerbuka(visit)) throw error(409, 'Visit ini sudah ditutup.');

	// kepemilikan: visit saya, atau proyek yang saya pimpin
	const milikSaya = String(visit.karyawan_id ?? '') === String(karyawan.id);
	if (!milikSaya) {
		const led = await resolveLedProjectIds(karyawan);
		if (!led.includes(Number(visit.project_id))) throw error(403, 'Visit ini bukan milik Anda atau proyeknya tidak Anda pimpin.');
	}

	const patch = {
		status: 'closed',
		kegiatan: String(input.kegiatan).trim(),
		temuan: String(input.temuan ?? '').trim(),
		tindak_lanjut: String(input.tindakLanjut ?? '').trim(),
		rencana_besok: String(input.rencanaBesok ?? '').trim(),
		foto_tutup: fotoIds,
		ditutup_pada: new Date().toISOString(),
		ditutup_oleh_karyawan_id: karyawan.id,
		cara_tutup: 'leader'
	};
	await directusServerJson(`/items/project_visit_leader/${visit.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
	return { id: visit.id, status: 'closed' as const, ditutup_pada: patch.ditutup_pada };
}
