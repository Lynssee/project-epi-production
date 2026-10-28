// src/lib/data/langkahBerikutnya.ts
// Peminjaman 11 §3.8 — kartu "Langkah Berikutnya": SATU kartu besar untuk booking terdekat yang butuh tindakan,
// menggantikan 4 kartu KPI yang tidak memberi tahu "sekarang saya harus apa". Logika murni (diuji): pemanggil memetakan
// `utama.aksi` ke handler halaman. Prioritas: aktif > disetujui > diajukan > ditolak terbaru (≤ 3 hari) > kosong.

import { teksDitolak } from './bookingStepper';

export type AksiLangkah = 'detail' | 'mulai_pakai' | 'kembalikan' | 'checkin' | 'kunjungan' | 'chat_ga' | 'ajukan_ulang' | 'ajukan';

export interface LangkahBooking {
	id: number | string;
	status: string;
	tanggal_mulai?: string | null;
	tanggal_selesai_rencana?: string | null;
	date_created?: string | null;
	tanggal_approve?: string | null;
	vehicle_id?: number | string | null;
	vehicle?: { name?: string; nomor_polisi?: string } | null;
	butuh_kendaraan?: boolean | null;
	tipe_keperluan?: string | null;
	referensi_site_visit_id?: string | null;
	approver?: string | null;
	alasan_tolak?: string | null;
	approval_progress?: { current_step: number; total_steps: number; step_label?: string | null } | null;
}

export interface LangkahKartu {
	kind: string;
	tone: 'info' | 'ok' | 'warn' | 'error' | 'neutral';
	emoji: string;
	judul: string;
	detail: string;
	booking: LangkahBooking | null;
	utama: { label: string; aksi: AksiLangkah };
	sekunder: { label: string; aksi: AksiLangkah }[];
}

const HARI = 24 * 3600 * 1000;
const t = (iso?: string | null) => (iso ? new Date(iso).getTime() : NaN);

/** Pilih booking terdekat dari `now` menurut tanggal_mulai (NaN diurut paling akhir). */
function terdekat(list: LangkahBooking[], now: number): LangkahBooking | null {
	if (!list.length) return null;
	return [...list].sort((a, b) => {
		const da = Number.isFinite(t(a.tanggal_mulai)) ? Math.abs(t(a.tanggal_mulai) - now) : Infinity;
		const db = Number.isFinite(t(b.tanggal_mulai)) ? Math.abs(t(b.tanggal_mulai) - now) : Infinity;
		return da - db;
	})[0];
}

const plat = (b: LangkahBooking) => [b.vehicle?.name, b.vehicle?.nomor_polisi ? `(${b.vehicle.nomor_polisi})` : ''].filter(Boolean).join(' ') || 'Kendaraan';

export function pilihLangkah(
	bookings: LangkahBooking[],
	opts: { now?: number; adaKontakGa?: boolean; fmtJam?: (iso?: string | null) => string } = {}
): LangkahKartu {
	const now = opts.now ?? Date.now();
	const fmt = opts.fmtJam ?? ((iso) => (iso ? String(iso) : '-'));
	const list = bookings || [];

	// 1) Aktif
	const aktif = terdekat(list.filter((b) => b.status === 'aktif'), now);
	if (aktif) {
		const tanpaKendaraan = aktif.butuh_kendaraan === false;
		if (tanpaKendaraan) {
			return {
				kind: 'aktif_kunjungan', tone: 'ok', emoji: '📍', booking: aktif,
				judul: 'Kunjungan sedang berlangsung',
				detail: `Sejak ${fmt(aktif.tanggal_mulai)}. Selesai otomatis saat Anda check-out di lokasi.`,
				utama: { label: 'Selesaikan Kunjungan', aksi: 'kunjungan' }, sekunder: [{ label: 'Lihat Detail', aksi: 'detail' }]
			};
		}
		const perluCheckin = aktif.tipe_keperluan === 'site_visit' && !aktif.referensi_site_visit_id;
		if (perluCheckin) {
			return {
				kind: 'aktif_belum_checkin', tone: 'warn', emoji: '📍', booking: aktif,
				judul: 'Sudah sampai? Check-in dulu.',
				detail: `${plat(aktif)} sedang dipakai. Tanpa check-in, pengembalian kendaraan bisa ditolak.`,
				utama: { label: 'Check-in di Lokasi', aksi: 'checkin' },
				sekunder: [{ label: 'Kembalikan Kendaraan', aksi: 'kembalikan' }, { label: 'Lihat Detail', aksi: 'detail' }]
			};
		}
		return {
			kind: 'aktif', tone: 'ok', emoji: '🚗', booking: aktif,
			judul: `Sedang dipakai sejak ${fmt(aktif.tanggal_mulai)}`,
			detail: `${plat(aktif)}. Rencana kembali ${fmt(aktif.tanggal_selesai_rencana)}.`,
			utama: { label: 'Kembalikan Kendaraan', aksi: 'kembalikan' }, sekunder: [{ label: 'Lihat Detail', aksi: 'detail' }]
		};
	}

	// 2) Disetujui (terdekat dari sekarang)
	const disetujui = terdekat(list.filter((b) => b.status === 'disetujui'), now);
	if (disetujui) {
		if (disetujui.butuh_kendaraan === false) {
			return {
				kind: 'disetujui_kunjungan', tone: 'ok', emoji: '✅', booking: disetujui,
				judul: 'Kunjungan disetujui',
				detail: `Berangkat ${fmt(disetujui.tanggal_mulai)}. Check-in di lokasi untuk memulai.`,
				utama: { label: 'Mulai Kunjungan', aksi: 'kunjungan' }, sekunder: [{ label: 'Lihat Detail', aksi: 'detail' }]
			};
		}
		if (!disetujui.vehicle_id) {
			const bisaChat = !!opts.adaKontakGa;
			return {
				kind: 'disetujui_tanpa_unit', tone: 'warn', emoji: '⏳', booking: disetujui,
				judul: 'Disetujui, unit belum ditetapkan GA',
				detail: 'Hubungi GA agar unit segera ditentukan sebelum Anda berangkat.',
				utama: bisaChat ? { label: 'Chat GA', aksi: 'chat_ga' } : { label: 'Lihat Detail', aksi: 'detail' },
				sekunder: bisaChat ? [{ label: 'Lihat Detail', aksi: 'detail' }] : []
			};
		}
		return {
			kind: 'disetujui', tone: 'ok', emoji: '✅', booking: disetujui,
			judul: `${plat(disetujui)}, berangkat ${fmt(disetujui.tanggal_mulai)}`,
			detail: 'Cek mobil dulu sebelum jalan.',
			utama: { label: 'Mulai Pakai', aksi: 'mulai_pakai' }, sekunder: [{ label: 'Lihat Detail', aksi: 'detail' }]
		};
	}

	// 3) Diajukan (paling baru diajukan)
	const diajukan = [...list.filter((b) => b.status === 'diajukan')].sort((a, b) => (t(b.date_created) || 0) - (t(a.date_created) || 0))[0];
	if (diajukan) {
		const p = diajukan.approval_progress;
		const tahap = p ? ` ${p.step_label ? `${p.step_label} ` : ''}(${p.current_step}/${p.total_steps})` : '';
		return {
			kind: 'diajukan', tone: 'info', emoji: '⏳', booking: diajukan,
			judul: `Menunggu persetujuan${tahap}`,
			detail: 'Anda akan dikabari lewat WhatsApp begitu diputuskan.',
			utama: { label: 'Lihat Detail', aksi: 'detail' }, sekunder: []
		};
	}

	// 4) Ditolak terbaru ≤ 3 hari
	const ditolak = [...list.filter((b) => b.status === 'ditolak')]
		.filter((b) => now - (t(b.tanggal_approve) || t(b.date_created) || 0) <= 3 * HARI)
		.sort((a, b) => (t(b.tanggal_approve) || t(b.date_created) || 0) < (t(a.tanggal_approve) || t(a.date_created) || 0) ? 1 : -1)[0];
	if (ditolak) {
		return {
			kind: 'ditolak', tone: 'error', emoji: '❌', booking: ditolak,
			judul: teksDitolak(ditolak),
			detail: 'Anda bisa mengajukan ulang — datanya terisi otomatis, cukup pilih waktu baru.',
			utama: { label: 'Ajukan Ulang', aksi: 'ajukan_ulang' }, sekunder: [{ label: 'Lihat Detail', aksi: 'detail' }]
		};
	}

	return {
		kind: 'kosong', tone: 'neutral', emoji: '🚗', booking: null,
		judul: 'Butuh kendaraan?',
		detail: 'Ajukan peminjaman atau kunjungan lapangan — cukup 4 isian.',
		utama: { label: 'Ajukan', aksi: 'ajukan' }, sekunder: []
	};
}
