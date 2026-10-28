// src/lib/services/gaRequest.ts
// Client tipis untuk GA Service Request Portal di dashboard lapangan. Memanggil
// route server project-epi sendiri (/api/ga-request), yang menulis langsung ke
// Directus bersama (koleksi ga_request, sama dengan GA Service Desk admin erp-epi-1).

import { getIdToken } from './secureDirectus';

async function authedFetch(path: string, options: RequestInit = {}) {
	const token = await getIdToken();
	const { headers = {}, ...rest } = options;
	const res = await fetch(path, {
		...rest,
		headers: {
			'Content-Type': 'application/json',
			...headers,
			Authorization: `Bearer ${token}`
		}
	});
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) {
		throw new Error(parsed?.message || `Request gagal (${res.status})`);
	}
	return parsed;
}

export interface CategoryOption {
	value: string;
	label: string;
	desc: string;
	color: string;
	bg: string;
	border: string;
}

export const JENIS_CATEGORIES: CategoryOption[] = [
	{ value: 'atk', label: 'ATK', desc: 'Alat Tulis Kantor & Kertas', color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
	{ value: 'rtk', label: 'RTK', desc: 'Rumah Tangga & Kebersihan', color: '#047857', bg: '#ECFDF5', border: '#A7F3D0' },
	{ value: 'perbaikan', label: 'Perbaikan Fasilitas', desc: 'AC, Listrik, Plumbing & Gedung', color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA' },
	{ value: 'kendaraan', label: 'Kendaraan Dinas', desc: 'Logistik & Operasional Luar', color: '#7E22CE', bg: '#FAF5FF', border: '#E9D5FF' },
	{ value: 'ruangan', label: 'Ruang Rapat', desc: 'Booking Meeting & Fasilitas', color: '#0F766E', bg: '#F0FDFA', border: '#99F6E4' },
	{ value: 'lainnya', label: 'Lainnya', desc: 'Kebutuhan Umum GA Lainnya', color: '#475569', bg: '#F8FAFC', border: '#E2E8F0' }
];

export const JENIS_OPTIONS = [
	{ value: 'atk', label: 'ATK' },
	{ value: 'rtk', label: 'RTK' },
	{ value: 'perbaikan', label: 'Perbaikan' },
	{ value: 'kendaraan', label: 'Kendaraan' },
	{ value: 'ruangan', label: 'Ruangan' },
	{ value: 'lainnya', label: 'Lainnya' }
];

export const PRIORITAS_OPTIONS = [
	{ value: 'rendah', label: 'Rendah (SLA 7 Hari)' },
	{ value: 'sedang', label: 'Sedang (SLA 3 Hari)' },
	{ value: 'tinggi', label: 'Tinggi (SLA 24 Jam)' },
	{ value: 'kritis', label: 'Kritis (SLA 4 Jam)' }
];

export const PRIORITAS_META: Record<string, { label: string; slaText: string; color: string; bg: string }> = {
	kritis: { label: 'Kritis', slaText: 'SLA 4 Jam (Darurat / Terhenti)', color: '#DC2626', bg: '#FEF2F2' },
	tinggi: { label: 'Tinggi', slaText: 'SLA 24 Jam (Mendesak / Hari Ini)', color: '#EA580C', bg: '#FFF7ED' },
	sedang: { label: 'Sedang', slaText: 'SLA 72 Jam (Standar Kerja)', color: '#2563EB', bg: '#EFF6FF' },
	rendah: { label: 'Rendah', slaText: 'SLA 7 Hari (Non-Urgent)', color: '#64748B', bg: '#F8FAFC' }
};

export const SMART_PRESETS: Record<string, { label: string; text: string; defaultPrioritas?: string }[]> = {
	atk: [
		{ label: 'Kertas HVS A4 80gr', text: 'Permintaan Kertas HVS A4 80gr untuk kebutuhan operasional kantor.' },
		{ label: 'Tinta Printer', text: 'Permintaan isi ulang / cartridge tinta printer kantor.' },
		{ label: 'Pulpen & Spidol Whiteboard', text: 'Permintaan 1 pack Pulpen Standard dan Spidol Whiteboard hitam/biru.' },
		{ label: 'Map Ordner & Stopmap', text: 'Permintaan Map Ordner dokumen dan Stopmap arsip.' },
		{ label: 'Baterai AA / AAA', text: 'Permintaan Baterai AA/AAA untuk remote AC dan perangkat kantor.' },
		{ label: 'Stapler & Isi Staples', text: 'Permintaan Stapler HD-10 beserta isi staples.' }
	],
	rtk: [
		{ label: 'Galon Air Mineral Dispenser', text: 'Permintaan isi ulang Galon Air Mineral untuk dispenser kantor.' },
		{ label: 'Kopi, Teh & Gula Pantry', text: 'Permintaan persediaan Kopi, Teh celup, dan Gula untuk pantry.' },
		{ label: 'Tissue Box Meja & Toilet', text: 'Permintaan persediaan Tissue Box meja dan Tissue toilet pantry.' },
		{ label: 'Sabun Cuci Tangan (Handwash)', text: 'Permintaan isi ulang Sabun Cuci Tangan (Handwash) wastafel.' },
		{ label: 'Pembersih Lantai & Karbol', text: 'Permintaan cairan Pembersih Lantai / Karbol toilet dan area kerja.' }
	],
	perbaikan: [
		{ label: 'AC Tidak Dingin / Bocor Air', text: 'AC ruangan tidak dingin dan meneteskan air, mohon pengecekan dan servis teknisi.', defaultPrioritas: 'tinggi' },
		{ label: 'Lampu Ruangan Padam / Rusak', text: 'Lampu ruangan kerja mati, mohon penggantian bohlam / fitting.' },
		{ label: 'Kran Air Wastafel Bocor', text: 'Kran air wastafel toilet/pantry bocor atau tidak bisa ditutup rapat.' },
		{ label: 'Stop Kontak Listrik Rusak', text: 'Stop kontak / saklar listrik longgar atau tidak mengalirkan arus.', defaultPrioritas: 'tinggi' },
		{ label: 'Kunci / Pintu Macet', text: 'Kunci atau engsel pintu ruangan macet dan sulit dibuka-tutup.' },
		{ label: 'Kursi / Meja Rusak', text: 'Kursi kerja roda macet / hidrolik turun, mohon perbaikan atau penggantian.' }
	],
	kendaraan: [
		{ label: 'Logistik & Pengiriman Lapangan', text: 'Peminjaman kendaraan dinas operasional untuk pengiriman material dan alat ke site.' },
		{ label: 'Dinas Luar & Meeting Eksternal', text: 'Peminjaman mobil operasional dinas untuk menghadiri meeting klien / dinas luar kota.' },
		{ label: 'Antar Jemput Tamu / Tim', text: 'Kebutuhan armada operasional untuk penjemputan tamu perusahaan / staf.' }
	],
	ruangan: [
		{ label: 'Meeting Internal Koordinasi', text: 'Meeting internal koordinasi rutin tim.' },
		{ label: 'Presentasi Progres Proyek / Klien', text: 'Meeting presentasi progres proyek bersama klien & manajemen.' },
		{ label: 'Training / Workshop Staf', text: 'Sesi pelatihan / training tim operasional.' }
	]
};

export const LOKASI_PRESETS = [
	'Kantor Pusat (Lt. 1)',
	'Kantor Pusat (Lt. 2)',
	'Kantor Pusat (Pantry)',
	'Workshop / Gudang Utama',
	'Ruang Server / IT',
	'Mess Karyawan',
	'Site Proyek Lapangan'
];

export interface KaryawanBrief {
	id: number;
	nama_karyawan: string;
	divisi?: string | null;
	jabatan?: string | null;
}

export interface GaRequestRow {
	id: number;
	jenis: string;
	pemohon_id: number | KaryawanBrief;
	pemohon_nama?: string;
	divisi: string | null;
	deskripsi: string;
	catatan: string | null;
	lokasi?: string | null;
	prioritas: string;
	status: string;
	sla_due: string | null;
	assigned_to: KaryawanBrief | number | null;
	assigned_to_nama?: string;
	tanggal_booking: string | null;
	jam_mulai: string | null;
	jam_selesai: string | null;
	date_created: string;
	date_updated?: string | null;
}

export interface SubmitGaRequestPayload {
	jenis: string;
	deskripsi: string;
	lokasi?: string | null;
	prioritas?: string;
	tanggalBooking?: string | null;
	jamMulai?: string | null;
	jamSelesai?: string | null;
}

export async function submitGaRequest(payload: SubmitGaRequestPayload): Promise<GaRequestRow> {
	const result = await authedFetch('/api/ga-request', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result?.data;
}

export async function getMyGaRequests(): Promise<GaRequestRow[]> {
	const result = await authedFetch('/api/ga-request', { method: 'GET' });
	return result?.data || [];
}

export async function cancelGaRequest(id: number): Promise<boolean> {
	const result = await authedFetch(`/api/ga-request?id=${id}`, {
		method: 'DELETE'
	});
	return result?.success ?? false;
}
