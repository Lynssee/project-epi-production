// src/lib/services/strategyRadar.ts
// Strategic Suite v2 (Fase 6) — chip radar sinyal pasar dari lapangan + kartu read-only Posisi Lini.
// Sinyal ditulis ke koleksi Directus `strategy_field_signal` lewat proxy terautentikasi (sama seperti service lain);
// ditinjau Superadmin/GM di erp-epi → /strategy tab PESTLE. KUNCI `pilar` HARUS sama dengan erp-epi
// (src/lib/shared/strategyFieldSignal.js) — repo terpisah, jadi daftar ini disalin.
import directus, { handleDirectusError } from './directus';
import { createItem } from '@directus/sdk';
import { auth } from '$lib/firebase';
import { getIdToken } from './secureDirectus';

export type RadarPilar = 'economic' | 'legal' | 'political' | 'social' | 'technological' | 'environmental';
export type RadarSourceForm = 'laporan_harian' | 'kunjungan_sales' | 'komplain_customer';

export const RADAR_PILARS: Array<{ pilar: RadarPilar; label: string; hint: string }> = [
	{ pilar: 'economic', label: 'Harga / kompetitor', hint: 'Harga bahan naik-turun, kompetitor banting harga, pelanggan lambat bayar.' },
	{ pilar: 'legal', label: 'Aturan / izin', hint: 'Aturan baru, syarat dokumen/izin, pajak, persyaratan tender.' },
	{ pilar: 'political', label: 'Pemerintah / tender', hint: 'Kebijakan, proyek pemerintah/BUMN, perubahan prioritas anggaran.' },
	{ pilar: 'social', label: 'Tenaga kerja / sosial', hint: 'Isu tenaga kerja, warga sekitar site, tenaga terampil langka.' },
	{ pilar: 'technological', label: 'Teknologi / metode', hint: 'Metode, alat, atau produk baru yang dipakai kompetitor/pelanggan.' },
	{ pilar: 'environmental', label: 'Lingkungan / cuaca', hint: 'Cuaca ekstrem, limbah, persyaratan lingkungan di site.' }
];

export const RADAR_MIN_CATATAN = 8;
export const RADAR_MAX_CATATAN = 500;

export function validateRadar(input: { pilar: string; catatan: string; kompetitor?: string }): string | null {
	if (!RADAR_PILARS.some((p) => p.pilar === input.pilar)) return 'Pilih kategori sinyal.';
	const c = (input.catatan || '').trim();
	if (c.length < RADAR_MIN_CATATAN) return `Catatan minimal ${RADAR_MIN_CATATAN} karakter agar bisa ditindaklanjuti.`;
	if (c.length > RADAR_MAX_CATATAN) return `Catatan maksimal ${RADAR_MAX_CATATAN} karakter.`;
	if ((input.kompetitor || '').length > 120) return 'Nama kompetitor maksimal 120 karakter.';
	return null;
}

export interface KirimSinyalParams {
	pilar: RadarPilar;
	catatan: string;
	kompetitor?: string;
	sourceForm: RadarSourceForm;
	sourceRef?: string | number | null;
	projectId?: number | string | null;
	customerName?: string | null;
}

/** Kirim satu sinyal. Melempar Error berpesan jelas (validasi/jaringan) — pemanggil menampilkannya, TIDAK memblokir form induk. */
export async function kirimSinyalRadar(p: KirimSinyalParams): Promise<void> {
	const invalid = validateRadar(p);
	if (invalid) throw new Error(invalid);
	const user = auth.currentUser;
	const pid = p.projectId == null || p.projectId === '' ? null : Number(p.projectId);
	try {
		await directus.request(
			createItem('strategy_field_signal', {
				pilar: p.pilar,
				catatan: p.catatan.trim(),
				kompetitor: (p.kompetitor || '').trim() || null,
				source_form: p.sourceForm,
				source_ref: p.sourceRef == null ? null : String(p.sourceRef).slice(0, 64),
				project_id: pid != null && Number.isInteger(pid) ? pid : null,
				customer_name: (p.customerName || '').slice(0, 160) || null,
				reporter_name: (user?.displayName || user?.email || '').slice(0, 120) || null,
				reporter_uid: (user?.uid || '').slice(0, 64) || null,
				status: 'baru'
			})
		);
	} catch (e) {
		handleDirectusError(e);
		throw new Error('Sinyal belum terkirim. Periksa koneksi lalu coba lagi — laporan Anda tidak terpengaruh.');
	}
}

export interface PosisiLiniItem {
	lini_key: string;
	label: string;
	quadrant: 'star' | 'cash_cow' | 'question' | 'dog' | 'tidak_dinilai';
	growth_pct: number | null;
	projects_cur: number;
	projects_prior: number;
	action: string | null;
}
export interface PosisiLiniResult {
	enabled: boolean;
	periode?: string | null;
	generated_at?: string | null;
	jendela?: string | null;
	items: PosisiLiniItem[];
}

/** Kartu read-only: posisi lini dari snapshot Strategi (tanpa nilai rupiah/margin). Dimatikan bawaan oleh Superadmin. */
export async function fetchPosisiLini(): Promise<PosisiLiniResult> {
	const token = await getIdToken();
	const res = await fetch('/api/strategy/posisi-lini', { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) throw new Error(`Gagal memuat posisi lini (HTTP ${res.status}).`);
	return (await res.json()) as PosisiLiniResult;
}
