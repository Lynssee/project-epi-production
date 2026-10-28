// src/routes/api/sji/+server.ts
// Fase 1 (Rencana-Implementasi-SJ-Internal-v2-manual.md): pintu masuk lapangan untuk
// Surat Jalan Internal. Identitas pemohon di-resolve SERVER-SIDE dari Firebase (Q2) —
// TIDAK PERNAH percaya karyawan_id dari body klien.
//
// GET  ?meta=1  -> gudang pilot + setelan inventory.sji.* untuk mengisi form.
// GET  (default) -> daftar SJI milik pemohon yang login.
// POST -> ajukan SJI baru, boleh multi-item campur ambil_pakai + pinjam (Q3),
//         ditulis sebagai satu sji_header + baris anak di pengeluaran_barang/peminjaman_internal.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { allocateSjiNomor } from '$lib/server/sjiNumber';
import { createApprovalRequest } from '$lib/server/approvalSubmit';
import { notifySjiSubmitted } from '$lib/server/sjiNotify';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

async function getSjiSettings() {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/system_settings?filter[setting_key][_starts_with]=inventory.sji.&limit=-1`
	);
	const defaults: Record<string, any> = {
		'inventory.sji.enabled': false,
		'inventory.sji.tipe_options': ['ambil_pakai', 'pinjam'],
		'inventory.sji.urgency_options': ['normal', 'urgent'],
		'inventory.sji.default_deadline_hari': 7,
		'inventory.sji.auto_approve_max_nilai': 0,
		'inventory.sji.auto_approve_kategori': []
	};
	const settings = { ...defaults };
	for (const row of res?.data || []) {
		if (!(row.setting_key in settings)) continue;
		try {
			settings[row.setting_key] = JSON.parse(row.setting_value);
		} catch {
			settings[row.setting_key] = row.setting_value;
		}
	}
	return settings;
}

const PROYEK_LOKASI_STATUSES = ['on progress', 'repair', 'hold'];

// Gap 1 (audit 2026-08-03): dropdown lokasi sebelumnya statis — proyek baru/ganti status tidak
// otomatis muncul/hilang. Reconcile berjalan setiap meta di-fetch (murah, ~20 baris): sinkron
// baris gudang jenis='proyek' terhadap kondisi TERKINI koleksi projects (on progress/repair/hold).
async function reconcileProyekGudang() {
	const projFilter = encodeURIComponent(JSON.stringify({ status: { _in: PROYEK_LOKASI_STATUSES } }));
	const [projRes, existingRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(`/items/projects?filter=${projFilter}&fields=id,name,lokasi&limit=-1`),
		directusServerJson<{ data: any[] }>(`/items/gudang?filter[jenis][_eq]=proyek&fields=id,kode_gudang,is_active&limit=-1`)
	]);
	const projects = projRes?.data || [];
	const existing = existingRes?.data || [];
	const existingByKode = new Map(existing.map((g) => [g.kode_gudang, g]));
	const desiredKodes = new Set(projects.map((p) => `PROY-${p.id}`));

	const toCreate = [];
	for (const p of projects) {
		const kode = `PROY-${p.id}`;
		const found = existingByKode.get(kode);
		if (!found) {
			toCreate.push({
				kode_gudang: kode,
				nama_gudang: p.name || `Proyek #${p.id}`,
				jenis: 'proyek',
				alamat: p.lokasi || null,
				is_active: true
			});
		} else if (!found.is_active) {
			await directusServerJson(`/items/gudang/${found.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) }).catch(() => {});
		}
	}
	if (toCreate.length > 0) {
		await directusServerJson('/items/gudang', { method: 'POST', body: JSON.stringify(toCreate) }).catch(() => {});
	}

	for (const g of existing) {
		if (g.is_active && !desiredKodes.has(g.kode_gudang)) {
			await directusServerJson(`/items/gudang/${g.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) }).catch(() => {});
		}
	}
}

// Sudah live (bukan lagi pilot) — dropdown "Lokasi" tampilkan SEMUA gudang fisik aktif +
// SEMUA proyek yang sedang berjalan (on progress/repair/hold), supaya SJI bisa dipakai sebagai
// e-surat jalan pengganti kertas untuk ambil barang gudang -> proyek mana pun yang aktif.
async function getLokasiOptions() {
	await reconcileProyekGudang().catch((e) => console.warn('[api/sji] reconcileProyekGudang gagal (diabaikan):', e?.message));

	// Fase 0 (Rencana Sistem Penempatan Area v2, 20 Agu 2026): parent_gudang_id null = level teratas
	// saja, supaya rak/zona (anak) yang akan dibuat Fase 1 tidak muncul di dropdown SJI ini.
	const gudangRes = await directusServerJson<{ data: any[] }>(
		`/items/gudang?filter[is_active][_eq]=true&filter[jenis][_neq]=proyek&filter[parent_gudang_id][_null]=true&fields=id,kode_gudang,nama_gudang,jenis&sort=nama_gudang&limit=-1`
	);
	const proyekFilter = encodeURIComponent(JSON.stringify({ jenis: { _eq: 'proyek' } }));
	const proyekGudangRes = await directusServerJson<{ data: any[] }>(
		`/items/gudang?filter=${proyekFilter}&filter[is_active][_eq]=true&filter[parent_gudang_id][_null]=true&fields=id,kode_gudang,nama_gudang,jenis&sort=nama_gudang&limit=-1`
	);

	const gudangList = (gudangRes?.data || []).map((g) => ({ ...g, kategori: 'gudang' }));
	const proyekList = (proyekGudangRes?.data || []).map((g) => ({ ...g, kategori: 'proyek' }));
	return [...gudangList, ...proyekList];
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);

	if (event.url.searchParams.get('meta') === '1') {
		const [settings, gudang] = await Promise.all([getSjiSettings(), getLokasiOptions()]);
		return json({ settings, gudang });
	}

	const searchQ = event.url.searchParams.get('search');
	if (searchQ != null) {
		const q = searchQ.trim();
		if (q.length < 2) return json({ data: [] });
		const filter = encodeURIComponent(JSON.stringify({ nama_barang_lengkap: { _icontains: q } }));
		const res = await directusServerJson<{ data: any[] }>(
			`/items/identitas_barang?filter=${filter}&fields=id,nama_barang_lengkap,satuan,stok_tersedia,is_borrowable,consumable&limit=20`
		);
		return json({ data: res?.data || [] });
	}

	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const filter = encodeURIComponent(JSON.stringify({ karyawan_id: { _eq: karyawan.id } }));
	const headersRes = await directusServerJson<{ data: any[] }>(
		`/items/sji_header?filter=${filter}&fields=id,reference_no,status,urgency,keperluan,gudang_id.nama_gudang,date_created&sort=-date_created&limit=-1`
	);
	const headers = headersRes?.data || [];

	// Hitung jumlah item per header (2 sumber: pengeluaran_barang + peminjaman_internal).
	const ids = headers.map((h) => h.id);
	let itemCounts: Record<number, number> = {};
	if (ids.length > 0) {
		const idsFilter = encodeURIComponent(JSON.stringify({ sji_header_id: { _in: ids } }));
		const [pbRes, piRes] = await Promise.all([
			directusServerJson<{ data: any[] }>(`/items/pengeluaran_barang?filter=${idsFilter}&fields=sji_header_id&limit=-1`),
			directusServerJson<{ data: any[] }>(`/items/peminjaman_internal?filter=${idsFilter}&fields=sji_header_id&limit=-1`)
		]);
		for (const row of [...(pbRes?.data || []), ...(piRes?.data || [])]) {
			const hid = typeof row.sji_header_id === 'object' ? row.sji_header_id?.id : row.sji_header_id;
			if (hid == null) continue;
			itemCounts[hid] = (itemCounts[hid] || 0) + 1;
		}
	}

	return json({
		data: headers.map((h) => ({ ...h, item_count: itemCounts[h.id] || 0 }))
	});
};

interface SjiItemInput {
	itemId: number;
	quantity: number;
	tipe: 'ambil_pakai' | 'pinjam';
	ukuran?: string;
	lokasiPekerjaan?: string;
	tanggalJatuhTempo?: string;
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const settings = await getSjiSettings();
	if (!settings['inventory.sji.enabled']) {
		throw error(403, 'Fitur Surat Jalan Internal belum diaktifkan. Hubungi admin.');
	}

	const body = await event.request.json().catch(() => null);
	const gudangId = Number(body?.gudangId);
	const urgency: string = body?.urgency === 'urgent' ? 'urgent' : 'normal';
	const keperluan: string = (body?.keperluan || '').trim();
	const items: SjiItemInput[] = Array.isArray(body?.items) ? body.items : [];

	if (!Number.isFinite(gudangId)) throw error(400, 'Gudang wajib dipilih.');
	if (items.length === 0) throw error(400, 'Minimal satu item harus diajukan.');
	for (const it of items) {
		if (!Number.isFinite(Number(it.itemId))) throw error(400, 'Item tidak valid.');
		if (!(Number(it.quantity) > 0)) throw error(400, 'Kuantitas harus lebih dari 0.');
		if (it.tipe !== 'ambil_pakai' && it.tipe !== 'pinjam') throw error(400, 'Tipe item tidak valid.');
	}

	const { nomor } = await allocateSjiNomor();

	const headerRes = await directusServerJson<{ data: any }>('/items/sji_header', {
		method: 'POST',
		body: JSON.stringify({
			reference_no: nomor,
			karyawan_id: karyawan.id,
			gudang_id: gudangId,
			urgency,
			keperluan: keperluan || null,
			status: 'diajukan',
			sumber: 'field'
		})
	});
	const header = headerRes.data;

	const defaultDeadlineHari = Number(settings['inventory.sji.default_deadline_hari']) || 7;
	const autoApproveMaxNilai = Number(settings['inventory.sji.auto_approve_max_nilai']) || 0;
	const autoApproveKategori: string[] = Array.isArray(settings['inventory.sji.auto_approve_kategori'])
		? settings['inventory.sji.auto_approve_kategori']
		: [];
	const createdItems: any[] = [];
	let allAutoApproved = true;

	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		const lineRef = `${nomor}-${i + 1}`;

		// Cek stok (Q8: tidak diblokir, hanya peringatan tercatat di catatan) + ambil harga &
		// kategori untuk cek auto-approve berbasis NILAI (Fase 3, Q15).
		let stockNote = '';
		let autoApproved = false;
		try {
			const itemRes = await directusServerJson<{ data: any }>(
				`/items/identitas_barang/${it.itemId}?fields=id,stok_tersedia,harga_beli,parent_category.parent_category`
			);
			const stok = parseFloat(itemRes?.data?.stok_tersedia) || 0;
			if (Number(it.quantity) > stok) {
				stockNote = `PERINGATAN: stok tersedia saat pengajuan ${stok}, diminta ${it.quantity}.`;
			}
			const hargaBeli = parseFloat(itemRes?.data?.harga_beli) || 0;
			const nilai = hargaBeli * Number(it.quantity);
			const kategori = itemRes?.data?.parent_category?.parent_category || null;
			const kategoriOk = autoApproveKategori.length === 0 || (kategori && autoApproveKategori.includes(kategori));
			if (autoApproveMaxNilai > 0 && nilai <= autoApproveMaxNilai && kategoriOk) {
				autoApproved = true;
			}
		} catch {
			/* non-fatal, lanjut tanpa auto-approve/catatan stok kalau lookup harga gagal */
		}
		if (!autoApproved) allAutoApproved = false;

		const commonStatusFields = autoApproved
			? { status: 'disetujui', approver: 'Auto (Sistem)', tanggal_approval: new Date().toISOString() }
			: { status: 'diajukan' };

		if (it.tipe === 'ambil_pakai') {
			const res = await directusServerJson<{ data: any }>('/items/pengeluaran_barang', {
				method: 'POST',
				body: JSON.stringify({
					reference_no: lineRef,
					karyawan_id: karyawan.id,
					item_id: it.itemId,
					quantity: it.quantity,
					ukuran: it.ukuran || null,
					keperluan: keperluan || null,
					...commonStatusFields,
					sji_header_id: header.id,
					gudang_id: gudangId,
					sumber: 'field',
					catatan: stockNote || null
				})
			});
			createdItems.push({ tipe: 'ambil_pakai', ...res.data });
		} else {
			const jatuhTempo =
				it.tanggalJatuhTempo ||
				new Date(Date.now() + defaultDeadlineHari * 86400000).toISOString().split('T')[0];
			const res = await directusServerJson<{ data: any }>('/items/peminjaman_internal', {
				method: 'POST',
				body: JSON.stringify({
					reference_no: lineRef,
					peminjam_id: karyawan.id,
					item_id: it.itemId,
					quantity: it.quantity,
					keperluan: keperluan || null,
					lokasi_pekerjaan: it.lokasiPekerjaan || null,
					tanggal_jatuh_tempo: jatuhTempo,
					...commonStatusFields,
					sji_header_id: header.id,
					gudang_id: gudangId,
					sumber: 'field',
					catatan: stockNote || null
				})
			});
			createdItems.push({ tipe: 'pinjam', ...res.data });
		}
	}

	if (allAutoApproved) {
		await directusServerJson(`/items/sji_header/${header.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'disetujui', approver: 'Auto (Sistem)', tanggal_approval: new Date().toISOString() })
		});
	} else {
		// Mirror ke Inbox Approval terpusat (K5) — best-effort, non-blocking. Approve
		// sesungguhnya TETAP lewat tombol admin pengeluaran_barang/peminjaman_internal.
		try {
			await createApprovalRequest({
				moduleKey: 'sji',
				sourceCollection: 'sji_header',
				sourceId: header.id,
				title: `SJI ${nomor}`,
				summary: keperluan || `${items.length} item diajukan`,
				requesterId: karyawan.id,
				departmentKey: 'inventory'
			});
		} catch (e) {
			console.warn('[api/sji] mirror ke approval_requests gagal (diabaikan):', (e as Error)?.message);
		}
		// Fase 4 — non-aktif default (inventory.sji.notif_wa_enabled=false), lihat sjiNotify.ts.
		notifySjiSubmitted(karyawan.id, karyawan.nama_karyawan, nomor, gudangId).catch(() => {});
	}

	return json({ success: true, id: header.id, reference_no: nomor, items: createdItems, autoApproved: allAutoApproved });
};