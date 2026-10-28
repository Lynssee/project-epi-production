// src/routes/api/fleet-booking/+server.ts
// Modul Peminjaman Kendaraan Operasional Mandiri (Portal Karyawan / ESS & GA).
// Mematuhi aturan: Directus fetching must be separated for each relation.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid, createApprovalRequest } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { notifyBookingSubmitted, notifyApprovalOrphan } from '$lib/server/fleetNotify';
import { normalizeWaNumber } from '$lib/server/penawaranExport';
import { env } from '$env/dynamic/private';
import { muatApprovalProgress } from '$lib/server/fleetApprovalProgress';
import { genKodeBooking, isKodeCollision } from '$lib/server/fleetKode';
import { filterRiwayatMilik } from '$lib/server/fleetBookingOwner';
import { evaluasiKuota, normalizeKuotaMode, TANDA_MELEBIHI_KUOTA } from '$lib/server/fleetKuota';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

async function getFleetSettings() {
	try {
		const res = await directusServerJson<{ data: any[] }>(`/items/fleet_settings?limit=-1`);
		const defaults: Record<string, any> = {
			maks_peminjaman_bersamaan_per_dept: 3,
			// Peminjaman 11 §3.7 — label zona dari konfigurasi (kode tetap dalam_kota/luar_kota)
			label_zona_dalam_kota: 'Dalam Kota (Jabodetabek)',
			label_zona_luar_kota: 'Luar Kota',
			// Peminjaman 05: kuota dept per irisan jadwal; mode off | soft | hard (default soft). auto_expire_* dibaca ERP
			// (fleet-scheduled-checks) — dicantumkan di sini supaya daftar default seragam.
			kuota_dept_mode: 'soft',
			auto_expire_diajukan_jam: 6,
			auto_expire_disetujui_jam: 12,
			minimal_pengajuan_jam_sebelum: 1,
			require_driver_for_heavy_vehicles: true,
			checklist_template_peminjam: [],
			checklist_sebelum_wajib: true,
			checklist_setelah_wajib: true,
			checklist_harian_wajib: false,
			foto_checklist_wajib: true,
			blokir_checkout_bila_tidak_laik: true,
			// ESS Redesign Fase 2 — Uang Muka Operasional (Cash Advance)
			advance_aktif: 0,
			settlement_wajib_bukti_setor: 1
		};
		const out = { ...defaults };
		for (const row of res?.data || []) {
			if (!(row.key in out)) continue;
			out[row.key] = row.value_type === 'boolean' ? !!row.value : row.value;
		}
		return out;
	} catch (e) {
		return {
			maks_peminjaman_bersamaan_per_dept: 3,
			minimal_pengajuan_jam_sebelum: 1
		};
	}
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	// 1. Permintaan Metadata (Katalog Kendaraan + Settings + Data Pemohon)
	if (event.url.searchParams.get('meta') === '1') {
		let vehiclesRawRes: { data: any[] } = { data: [] };
		let settings: Record<string, any> = {};
		let vehiclesError = false;
		let visitCategoriesError = false;
		let visitCategoriesRes: { data: any[] } = { data: [] };
		let gaRecipientRes: { data: any[] } = { data: [] };
		[settings, vehiclesRawRes, visitCategoriesRes, gaRecipientRes] = await Promise.all([
			getFleetSettings(),
			directusServerJson<{ data: any[] }>(
				`/items/fleet_kendaraan?fields=id,merk,model,nomor_polisi,jenis,kapasitas_penumpang,fuel_type,location_id,status,km_terakhir&sort=merk&limit=-1`
			).catch((e) => {
				console.error('Gagal memuat katalog fleet_kendaraan:', e);
				vehiclesError = true;
				return { data: [] };
			}),
			// Fase 1 — kategori kunjungan (lookup, editable admin). Non-fatal.
			directusServerJson<{ data: any[] }>(
				`/items/fleet_visit_category?filter[aktif][_eq]=true&fields=kode,label,zona_default,wajib_project,wajib_customer,wajib_kendaraan_default,butuh_akomodasi_default&sort=sort&limit=-1`
			).catch((e) => {
				console.error('Gagal memuat fleet_visit_category:', e);
				visitCategoriesError = true;
				return { data: [] };
			}),
			// Kontak GA untuk tombol "Chat GA" di HP (Peminjaman 03 §3.6) — dikonfigurasi di fleet_notify_recipients,
			// bukan hardcode. Hanya nomor yang dikirim ke klien. Non-fatal.
			directusServerJson<{ data: any[] }>(
				`/items/fleet_notify_recipients?filter[peran][_eq]=ga_hrd&filter[active][_eq]=true&fields=no_telpon&sort=id&limit=1`
			).catch((e) => {
				console.error('Gagal memuat kontak GA (fleet_notify_recipients):', e);
				return { data: [] };
			})
		]);

		const vehiclesRaw = vehiclesRawRes?.data || [];

		// Fetch Separate Relation: location (Directus fetching must be separated for each relation)
		const locationIds = Array.from(new Set(vehiclesRaw.map((v) => v.location_id).filter(Boolean)));
		let locationMap: Record<string | number, string> = {};
		if (locationIds.length > 0) {
			try {
				const locRes = await directusServerJson<{ data: any[] }>(
					`/items/location?filter[id][_in]=${locationIds.join(',')}&fields=id,name&limit=-1`
				);
				for (const l of locRes?.data || []) locationMap[l.id] = l.name;
			} catch (e) {
				console.error('Error fetching separate location relation:', e);
			}
		}

		const vehicles = vehiclesRaw.map((v) => ({
			id: v.id,
			name: [v.merk, v.model].filter(Boolean).join(' ') || v.nomor_polisi,
			merk: v.merk || '',
			model: v.model || '',
			plat: v.nomor_polisi,
			nomor_polisi: v.nomor_polisi,
			jenis: v.jenis || 'Operasional',
			kapasitas: v.kapasitas_penumpang || 5,
			bahan_bakar: v.fuel_type || 'Belum diisi',
			lokasi: (v.location_id && locationMap[v.location_id]) || 'Pool Utama',
			status: v.status || 'Tersedia',
			odometer: v.km_terakhir || 0
		}));

		return json({
			settings,
			kontak_ga_wa: normalizeWaNumber(gaRecipientRes?.data?.[0]?.no_telpon),
			vehicles,
			vehiclesError,
			visit_categories_error: visitCategoriesError,
			visit_categories: (visitCategoriesRes?.data || []).map((c) => ({
				kode: c.kode,
				label: c.label,
				zona_default: c.zona_default || 'keduanya',
				wajib_project: !!c.wajib_project,
				wajib_customer: !!c.wajib_customer,
				wajib_kendaraan_default: c.wajib_kendaraan_default == null ? true : !!c.wajib_kendaraan_default,
				butuh_akomodasi_default: !!c.butuh_akomodasi_default
			})),
			requester: {
				id: karyawan.id,
				name: karyawan.nama_karyawan,
				dept: karyawan.divisi || 'Umum',
				jabatan: karyawan.jabatan || '',
				email: user.email
			}
		});
	}

	// 2. Permintaan Riwayat Peminjaman Karyawan (dengan separate relation fetching)
	// Peminjaman 12 §1: milik sendiri lewat karyawan_id; nama HANYA untuk baris lama yang karyawan_id-nya kosong.
	const filterOr = encodeURIComponent(JSON.stringify(filterRiwayatMilik(karyawan)));

	// Peminjaman 07 §3.2 — JANGAN telan error jadi 200 + data kosong: klien akan mengira riwayat kosong
	// (lalu mengajukan ulang). Kegagalan Directus dilaporkan sebagai 502 supaya klien bisa menampilkan cache/Coba Lagi.
	let bookingsRes: { data: any[] };
	try {
		bookingsRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_bookings?filter=${filterOr}&sort=-date_created&limit=-1`
		);
	} catch (e) {
		console.error('[fleet-booking] gagal mengambil riwayat dari Directus:', e);
		throw error(502, 'Gagal mengambil riwayat dari server data. Coba lagi.');
	}

	const bookings = bookingsRes?.data || [];

	// Fetch Separate Relations: fleet_kendaraan
	const vehicleIds = Array.from(new Set(bookings.map((b) => b.vehicle_id).filter(Boolean)));
	let vehicleMap: Record<string | number, any> = {};
	if (vehicleIds.length > 0) {
		try {
			const vRes = await directusServerJson<{ data: any[] }>(
				`/items/fleet_kendaraan?filter[id][_in]=${vehicleIds.join(',')}&fields=id,merk,model,nomor_polisi,jenis,kapasitas_penumpang,status&limit=-1`
			);
			for (const v of vRes?.data || []) {
				vehicleMap[v.id] = {
					...v,
					name: [v.merk, v.model].filter(Boolean).join(' ') || v.nomor_polisi
				};
			}
		} catch (e) {
			console.error('Error fetching separate fleet_kendaraan relation:', e);
		}
	}

	// Fetch Separate Relations: fleet_drivers
	const driverIds = Array.from(new Set(bookings.map((b) => b.driver_id).filter(Boolean)));
	let driverMap: Record<string | number, any> = {};
	if (driverIds.length > 0) {
		try {
			const dRes = await directusServerJson<{ data: any[] }>(
				`/items/fleet_drivers?filter[id][_in]=${driverIds.join(',')}&fields=id,nama,no_telepon,status&limit=-1`
			);
			for (const d of dRes?.data || []) {
				driverMap[d.id] = d;
			}
		} catch (e) {
			console.error('Error fetching separate fleet_drivers relation:', e);
		}
	}

	// Peminjaman 11 §3.2 — progres approval nyata HANYA untuk booking yang masih `diajukan` (hemat: satu rangkaian query
	// batch, bukan per baris). Gagal → objek kosong; klien menampilkan "Menunggu persetujuan" tanpa menyebut siapa.
	const progressMap = await muatApprovalProgress(
		bookings.filter((b) => b.status === 'diajukan' && b.approval_request_id).map((b) => b.approval_request_id)
	);

	// Enrich bookings
	const enriched = bookings.map((b) => ({
		...b,
		vehicle: b.vehicle_id ? vehicleMap[b.vehicle_id] || null : null,
		driver: b.driver_id ? driverMap[b.driver_id] || null : null,
		approval_progress: b.status === 'diajukan' && b.approval_request_id ? progressMap[String(b.approval_request_id)] || null : null
	}));

	return json({ data: enriched });
};

/** Peminjaman 07 — cari booking berdasarkan client_txn_id (kunci idempotensi submit dari HP). */
async function findBookingByTxnId(clientTxnId: string): Promise<any | null> {
	const f = encodeURIComponent(JSON.stringify({ client_txn_id: { _eq: clientTxnId } }));
	const ex = await directusServerJson<{ data: any[] }>(`/items/fleet_bookings?filter=${f}&limit=1`);
	return ex?.data?.[0] ?? null;
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const body = await event.request.json().catch(() => null);

	// Peminjaman 07 §3.4 — idempotensi submit. Bila respons hilang di sinyal buruk lalu user menekan Kirim lagi,
	// permintaan ulang dengan client_txn_id yang SAMA dibalas dengan booking yang sudah ada (replay) — tanpa
	// booking/approval_request/WA baru (semua itu ada SETELAH blok ini).
	let clientTxnId: string | null =
		typeof body?.client_txn_id === 'string' && body.client_txn_id.length > 0 && body.client_txn_id.length <= 64
			? body.client_txn_id
			: null;
	if (clientTxnId) {
		try {
			const existing = await findBookingByTxnId(clientTxnId);
			if (existing) {
				if (String(existing.karyawan_id) !== String(karyawan.id)) {
					throw error(409, 'ID transaksi bentrok. Muat ulang halaman.');
				}
				return json({ success: true, record: existing, duplicate_replay: true });
			}
		} catch (e: any) {
			if (e?.status === 409) throw e;
			// Lookup gagal (mis. kolom client_txn_id belum dibuat di Directus → 403). JANGAN memblokir pengajuan:
			// jalan tanpa kunci idempotensi, tapi catat jelas supaya skema segera dibuat (Aturan #1).
			console.error('[fleet-booking] lookup client_txn_id gagal — submit tanpa idempotensi. Pastikan fleet_bookings.client_txn_id sudah dibuat:', e);
			clientTxnId = null;
		}
	}

	const tujuan = (body?.tujuan || '').trim();
	const keperluan = (body?.keperluan || '').trim();
	const butuhDriver = !!body?.butuh_driver;
	const vehicleIdPref = body?.vehicle_id ? Number(body.vehicle_id) : null;
	const tanggalMulai = body?.tanggal_mulai ? new Date(body.tanggal_mulai) : null;
	const tanggalSelesai = body?.tanggal_selesai_rencana ? new Date(body.tanggal_selesai_rencana) : null;
	const muatanCatatan = (body?.catatan || '').trim();
	const tipeKeperluanAllowed = ['dinas', 'site_visit', 'operasional', 'operasional_harian', 'antar_jemput', 'kendaraan_pribadi', 'lainnya'];
	// R5 (Fase 0) — tipe_keperluan wajib & tervalidasi di server. Dulu diam-diam
	// jatuh ke 'operasional' bila kosong, sehingga baris NULL bisa lolos dari alur lain.
	const tipeKeperluan = body?.tipe_keperluan;
	const projectId = body?.project_id ? Number(body.project_id) : null;

	// Fase 1 — kategori & zona kunjungan (hanya relevan untuk site_visit).
	const kategoriKunjungan =
		tipeKeperluan === 'site_visit' && body?.kategori_kunjungan ? String(body.kategori_kunjungan) : null;
	const zonaAllowed = ['dalam_kota', 'luar_kota'];
	let zona: string | null = body?.zona && zonaAllowed.includes(body.zona) ? body.zona : null;
	// Tipe lama 'kendaraan_pribadi' = tidak memakai armada kantor. Server tetap menerima nilai ini
	// (PWA yang belum refresh) tapi memperlakukannya seperti kunjungan tanpa kendaraan supaya GA
	// tidak dipaksa menetapkan unit (audit P0-7).
	const isKendaraanPribadi = tipeKeperluan === 'kendaraan_pribadi';
	const butuhKendaraan = isKendaraanPribadi ? false : body?.butuh_kendaraan === false ? false : true;
	let butuhAkomodasi = body?.butuh_akomodasi === true;

	if (!tujuan) throw error(400, 'Tujuan perjalanan wajib diisi.');
	if (!tipeKeperluan || !tipeKeperluanAllowed.includes(tipeKeperluan)) {
		throw error(400, 'Jenis keperluan peminjaman wajib dipilih.');
	}
	if (!tanggalMulai || Number.isNaN(tanggalMulai.getTime())) throw error(400, 'Tanggal & jam mulai tidak valid.');
	if (tanggalSelesai && tanggalSelesai.getTime() <= tanggalMulai.getTime()) {
		throw error(400, 'Tanggal & jam selesai harus setelah tanggal mulai.');
	}

	// site_visit: proyek wajib kecuali kategori terpilih menandai wajib_project=false.
	// Zona & flag akomodasi diisi dari kategori bila peminjam tidak meng-override.
	let requireProject = true;
	if (tipeKeperluan === 'site_visit') {
		if (kategoriKunjungan) {
			const catRes = await directusServerJson<{ data: any[] }>(
				`/items/fleet_visit_category?filter[kode][_eq]=${encodeURIComponent(kategoriKunjungan)}&fields=wajib_project,zona_default,butuh_akomodasi_default&limit=1`
			).catch(() => ({ data: [] }));
			const cat = catRes?.data?.[0];
			if (cat) {
				requireProject = !!cat.wajib_project;
				if (!zona && cat.zona_default && cat.zona_default !== 'keduanya') zona = cat.zona_default;
				if (body?.butuh_akomodasi == null) butuhAkomodasi = !!cat.butuh_akomodasi_default;
			}
		}
		if (requireProject && !projectId) {
			throw error(400, 'Pilih proyek tujuan untuk kategori kunjungan ini.');
		}
	}

	if (isKendaraanPribadi && body?.advance_diminta === true) {
		throw error(400, 'Kendaraan pribadi tidak memakai uang muka — klaim BBM/tol lewat menu Biaya Lapangan.');
	}

	const settings = await getFleetSettings();

	// ESS Redesign Fase 2 — Uang Muka Operasional. Hanya diproses bila master switch aktif.
	const advanceAktif = Number(settings.advance_aktif) === 1 || settings.advance_aktif === true;
	// Peminjaman 06 K9 — kunjungan TANPA kendaraan tidak mendapat uang muka (klaim lewat Biaya Lapangan).
	if (advanceAktif && body?.advance_diminta === true && !butuhKendaraan) {
		throw error(400, 'Kunjungan tanpa kendaraan tidak mendapat uang muka. Klaim biayanya lewat menu Biaya Lapangan.');
	}
	const advanceDiminta = advanceAktif && body?.advance_diminta === true;
	const advEstBbm = advanceDiminta ? Math.max(0, Number(body?.advance_est_bbm) || 0) : 0;
	const advEstTol = advanceDiminta ? Math.max(0, Number(body?.advance_est_tol) || 0) : 0;
	const advEstLain = advanceDiminta ? Math.max(0, Number(body?.advance_est_lain) || 0) : 0;
	const advTotal = advEstBbm + advEstTol + advEstLain;
	if (advanceDiminta && advTotal <= 0) {
		throw error(400, 'Isi minimal salah satu estimasi uang muka (BBM / E-Toll / lain-lain).');
	}

	// Fase 2 — kunjungan tanpa kendaraan: tidak ada unit/driver, lewati batas kuota unit & cek bentrok.
	const vehicleIdEff = butuhKendaraan ? vehicleIdPref : null;
	const butuhDriverEff = butuhKendaraan ? butuhDriver : false;

	// Validasi minimal_pengajuan_jam_sebelum
	const jamSebelum = (tanggalMulai.getTime() - Date.now()) / 3600000;
	const minimalJam = Number(settings.minimal_pengajuan_jam_sebelum) || 0;
	if (jamSebelum < minimalJam - 0.05) {
		// toleransi 3 menit
		throw error(400, `Pengajuan harus diajukan minimal ${minimalJam} jam sebelum waktu keberangkatan.`);
	}

	// Kuota departemen (Peminjaman 05 §3.1/3.2): dihitung per IRISAN JADWAL (unit yang dipakai dept pada rentang yang sama),
	// bukan total booking berstatus terbuka — booking macet/terlupa/minggu-depan tidak lagi mengunci seluruh divisi.
	// Tidak berlaku utk kunjungan tanpa kendaraan (tidak memakai unit). Mode: off | soft (default: diterima + peringatan
	// + penanda untuk GA) | hard (409 menyebut booking penyebab).
	const dept = karyawan.divisi || '';
	const maksDept = Number(settings.maks_peminjaman_bersamaan_per_dept) || 0;
	const kuotaMode = normalizeKuotaMode(settings.kuota_dept_mode);
	let kuotaWarning: string | null = null;
	if (butuhKendaraan && dept && maksDept > 0 && kuotaMode !== 'off') {
		try {
			const activeFilter = encodeURIComponent(
				JSON.stringify({
					_and: [
						{ requester_dept: { _eq: dept } },
						{ status: { _in: ['diajukan', 'disetujui', 'aktif'] } },
						// `_neq: false` tidak menangkap NULL — booking lama berkolom NULL tetap memakai unit.
						{ _or: [{ butuh_kendaraan: { _null: true } }, { butuh_kendaraan: { _eq: true } }] }
					]
				})
			);
			const activeRes = await directusServerJson<{ data: any[] }>(
				`/items/fleet_bookings?filter=${activeFilter}&fields=id,kode_booking,tanggal_mulai,tanggal_selesai_rencana&limit=-1`
			);
			const hasil = evaluasiKuota(activeRes?.data || [], tanggalMulai.getTime(), (tanggalSelesai ?? tanggalMulai).getTime(), maksDept);
			if (hasil.terlampaui) {
				if (kuotaMode === 'hard') throw error(409, hasil.pesan);
				kuotaWarning = `${hasil.pesan} Pengajuan tetap diterima, tetapi GA akan menandainya melebihi kuota.`;
			}
		} catch (e: any) {
			if (e?.status === 409) throw e;
			// Gagal membaca booking → fail-open (jangan menghalangi pengajuan lapangan karena error server), tapi DILOG (Aturan #1).
			console.error('[fleet-booking] cek kuota departemen gagal — dilewati (fail-open):', e);
		}
	}

	// Cek bentrok jadwal jika memilih unit spesifik
	if (vehicleIdEff) {
		const startIso = tanggalMulai.toISOString();
		const endIso = tanggalSelesai ? tanggalSelesai.toISOString() : startIso;
		const conflictFilter = encodeURIComponent(
			JSON.stringify({
				vehicle_id: { _eq: vehicleIdEff },
				status: { _in: ['disetujui', 'aktif'] }
			})
		);
		const existingRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_bookings?filter=${conflictFilter}&fields=id,kode_booking,tanggal_mulai,tanggal_selesai_rencana&limit=-1`
		).catch(() => ({ data: [] }));

		const conflicts = (existingRes?.data || []).filter((b) => {
			const bStart = new Date(b.tanggal_mulai).getTime();
			const bEnd = b.tanggal_selesai_rencana ? new Date(b.tanggal_selesai_rencana).getTime() : bStart;
			const reqStart = tanggalMulai.getTime();
			const reqEnd = tanggalSelesai ? tanggalSelesai.getTime() : reqStart;
			return reqStart <= bEnd && reqEnd >= bStart;
		});

		if (conflicts.length > 0) {
			throw error(
				409,
				'Kendaraan pilihan Anda sudah memiliki jadwal peminjaman yang disetujui pada jam tersebut. Silakan pilih unit lain atau kosongkan preferensi agar dicarikan admin.'
			);
		}
	}

	// Fase 3 G3 — deteksi duplikat: pengaju yang sama sudah punya pengajuan aktif/menunggu yang
	// tanggalnya beririsan. MODE PERINGATAN — tidak memblokir, hanya dikembalikan ke frontend.
	let duplicateWarning: string | null = null;
	try {
		const dupFilter = encodeURIComponent(
			JSON.stringify({
				karyawan_id: { _eq: String(karyawan.id) },
				status: { _in: ['diajukan', 'disetujui', 'aktif'] }
			})
		);
		const dupRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_bookings?filter=${dupFilter}&fields=id,kode_booking,tanggal_mulai,tanggal_selesai_rencana,tujuan&limit=-1`
		).catch(() => ({ data: [] }));
		const reqStart = tanggalMulai.getTime();
		const reqEnd = tanggalSelesai ? tanggalSelesai.getTime() : reqStart;
		const overlap = (dupRes?.data || []).find((b) => {
			const bStart = new Date(b.tanggal_mulai).getTime();
			const bEnd = b.tanggal_selesai_rencana ? new Date(b.tanggal_selesai_rencana).getTime() : bStart;
			return reqStart <= bEnd && reqEnd >= bStart;
		});
		if (overlap) {
			duplicateWarning = `Anda sudah punya pengajuan (${overlap.kode_booking} — ${overlap.tujuan || 'tanpa tujuan'}) yang jadwalnya beririsan dengan ini. Pastikan ini bukan pengajuan ganda.`;
		}
	} catch {
		/* peringatan best-effort — jangan ganggu submit */
	}

	const payload = {
		kode_booking: genKodeBooking(), // Peminjaman 12 §2: BK-YYMMDD-XXXXX, tanggal WIB
		vehicle_id: vehicleIdEff,
		karyawan_id: String(karyawan.id),
		butuh_driver: butuhDriverEff,
		requester_name: karyawan.nama_karyawan,
		requester_dept: dept || null,
		keperluan: keperluan || null,
		tujuan,
		tanggal_mulai: tanggalMulai.toISOString(),
		tanggal_selesai_rencana: tanggalSelesai ? tanggalSelesai.toISOString() : null,
		status: 'diajukan',
		catatan:
			[
				kuotaWarning ? TANDA_MELEBIHI_KUOTA : null,
				muatanCatatan ||
					(isKendaraanPribadi
						? 'Memakai kendaraan pribadi — klaim BBM lewat Biaya Lapangan.'
						: !butuhKendaraan
						? 'Kunjungan lapangan tanpa kendaraan perusahaan.'
						: vehicleIdEff
							? null
							: 'Preferensi unit fleksibel — ditentukan oleh Admin GA saat approve.')
			]
				.filter(Boolean)
				.join(' ') || null,
		tipe_keperluan: tipeKeperluan,
		project_id: projectId,
		surat_jalan_id: body?.surat_jalan_id ? Number(body.surat_jalan_id) : null,
		packing_list_id: body?.packing_list_id ? String(body.packing_list_id) : null,
		kategori_kunjungan: kategoriKunjungan,
		zona,
		butuh_kendaraan: butuhKendaraan,
		butuh_akomodasi: butuhAkomodasi,
		// ESS Redesign Fase 2 — Uang Muka Operasional
		advance_diminta: advanceDiminta,
		advance_est_bbm: advanceDiminta ? advEstBbm : null,
		advance_est_tol: advanceDiminta ? advEstTol : null,
		advance_est_lain: advanceDiminta ? advEstLain : null,
		advance_amount_requested: advanceDiminta ? advTotal : null,
		advance_status: advanceDiminta ? 'diajukan' : 'none',
		...(clientTxnId ? { client_txn_id: clientTxnId } : {})
	};

	// Peminjaman 12 §2: bila kode_booking bertabrakan (kolom dibuat unique), buat kode baru & coba lagi (maks 3x).
	let result!: { data: any };
	for (let attempt = 1; ; attempt++) {
	try {
		result = await directusServerJson<{ data: any }>('/items/fleet_bookings', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
		break;
	} catch (e) {
		// Race: dua request bersamaan dengan txn yang sama — yang kalah kena unique constraint. Ambil baris pemenang
		// (pola sama dengan siteCheckin.ts) dan balas sebagai replay; approval/WA sudah/akan dibuat oleh request pemenang.
		if (clientTxnId) {
			try {
				const winner = await findBookingByTxnId(clientTxnId);
				if (winner && String(winner.karyawan_id) === String(karyawan.id)) {
					return json({ success: true, record: winner, duplicate_replay: true });
				}
			} catch (e2) {
				console.error('[fleet-booking] gagal mengambil ulang booking pemenang txn:', e2);
			}
		}
		if (attempt < 3 && isKodeCollision(e)) {
			console.warn(`[fleet-booking] kode_booking ${payload.kode_booking} bertabrakan — membuat kode baru (percobaan ${attempt + 1}/3)`);
			payload.kode_booking = genKodeBooking();
			continue;
		}
		throw e;
	}
	}
	const record = result?.data ?? result;

	// Daftarkan ke Universal Approval Engine (Fase 1 approval_matrix + workflow 2 tahap
	// yang baru dibuat) — sebelumnya baris approval_matrix fleet.booking terdaftar tapi
	// tidak pernah dipakai karena tidak ada approval_requests yang diterbitkan di sini.
	// Peminjaman 12 §3: dulu kegagalan mendaftarkan approval hanya console.warn → booking `diajukan` tanpa approval_request_id
	// TIDAK muncul di Inbox siapa pun dan menggantung selamanya (kuota dept ikut terpakai). Kini: retry 1x, lalu error jelas +
	// peringatan ke pemohon + WA ke GA; penyapu terjadwal (heal_orphan_approval di ERP) mendaftarkannya kemudian.
	let approvalYatim = false;
	const daftarkanApproval = async () => {
		const erpBaseUrl = env.ERP_EPI1_BASE_URL;
		if (erpBaseUrl && /directus/i.test(erpBaseUrl)) {
			console.error('[fleet-booking] ERP_EPI1_BASE_URL menunjuk host Directus — callback approval akan gagal. Perbaiki env.');
		}
		// Fase 3 G8 — rantai approval dipilih murni dari module_key (approvalSubmit tidak menyentuh engine):
		//   tanpa kendaraan → 1 tahap; luar kota → 3 tahap; selain itu → 2 tahap.
		const approvalModuleKey = !butuhKendaraan
			? 'fleet.visit_nonvehicle'
			: zona === 'luar_kota'
				? 'fleet.booking_luar_kota'
				: 'fleet.booking';
		const approvalReq = await createApprovalRequest({
			moduleKey: approvalModuleKey,
			sourceCollection: 'fleet_bookings',
			sourceId: record.id,
			title: `${butuhKendaraan ? 'Peminjaman Kendaraan' : 'Kunjungan Lapangan'}${zona === 'luar_kota' ? ' (Luar Kota)' : ''} ${payload.kode_booking} — ${karyawan.nama_karyawan}`,
			summary: tujuan,
			departmentKey: dept || undefined,
			requesterId: karyawan.id,
			callbackUrl: erpBaseUrl ? `${erpBaseUrl.replace(/\/$/, '')}/api/fleet-booking/approval-callback` : undefined
		});
		if (!approvalReq?.id) throw new Error('createApprovalRequest tidak mengembalikan id');
		await directusServerJson(`/items/fleet_bookings/${record.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ approval_request_id: approvalReq.id })
		});
	};
	try {
		await daftarkanApproval();
	} catch (e1) {
		console.warn('[fleet-booking] gagal mendaftarkan approval, retry 1x dalam 1 detik:', e1);
		await new Promise((r) => setTimeout(r, 1000));
		try {
			await daftarkanApproval();
		} catch (e2) {
			approvalYatim = true;
			console.error(`[fleet-booking] APPROVAL YATIM: booking ${payload.kode_booking} (id ${record?.id}, pemohon ${karyawan.nama_karyawan}, dept ${dept || '-'}) tersimpan TANPA approval_request:`, e2);
			await notifyApprovalOrphan({ kodeBooking: payload.kode_booking, karyawanNama: karyawan.nama_karyawan, tujuan });
		}
	}

	// Peminjaman 06 Fase 2 — jalur lama (approval `fleet.cash_advance` terpisah + notif Finance) DIPUTUS. Uang muka kini satu
	// jalur Petty Cash: ERP membuat pengajuan kas kecil OTOMATIS saat booking disetujui (approval-callback, file 06 Fase 1).
	// Di sini hanya mencatat permintaan (advance_diminta, nominal, advance_status='diajukan' = menunggu booking disetujui).

	// Approval yatim: jangan memberi tahu atasan (tidak ada apa-apa di Inbox-nya) — GA yang mendaftarkan.
	if (!approvalYatim) {
		await notifyBookingSubmitted({
			karyawanId: karyawan.id,
			karyawanNama: karyawan.nama_karyawan,
			kodeBooking: payload.kode_booking,
			tujuan
		});
	}

	const yatimWarning = approvalYatim ? 'Pengajuan tersimpan tapi belum masuk ke antrean persetujuan. GA sudah diberi tahu.' : null;
	return json({ success: true, record, warning: [duplicateWarning, kuotaWarning, yatimWarning].filter(Boolean).join(' ') || null });
};
