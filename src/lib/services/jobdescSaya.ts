// c:\dev\project-epi\src\lib\services\jobdescSaya.ts
// Service untuk mengambil Job Description & Evaluasi Kepatuhan Syarat Jabatan pengguna ESS lapangan.

import { secureDirectusFetch, getIdToken } from './secureDirectus';
import { authStore } from '$lib/stores/auth';
import { get } from 'svelte/store';

export interface JobdescData {
	id: number;
	posisi_id: number;
	versi: string | number;
	aktif: boolean | number;
	fungsi_tujuan: string;
	dimensi: any;
	hubungan_internal: string[] | string | null;
	hubungan_eksternal: string[] | string | null;
	/** JSON: wewenang, kpi_sla, dokumen_form, alat_sistem, k3_risiko, jalur_karier (array string), catatan_khusus (teks). */
	bagian_tambahan?: Record<string, string[] | string> | string | null;
	tugas_pokok: string[];
	tugas_tambahan: string[];
	persyaratan: string[];
}

export interface SyaratComplianceItem {
	jenis: string;
	label: string;
	wajib: boolean;
	fulfilled: boolean;
	isExpired: boolean;
	detail: string;
}

export interface ComplianceSummary {
	items: SyaratComplianceItem[];
	scorePct: number;
	isCompliant: boolean;
	missingCount: number;
	statusText: string;
}

export interface JobdescSayaResult {
	karyawan: any;
	posisi: any;
	jobdesc: JobdescData | null;
	compliance: ComplianceSummary;
}

const DOK_LABELS: Record<string, string> = {
	ktp: 'KTP / Identitas Resmi',
	sertifikat_k3: 'Sertifikat K3 / Keselamatan',
	mcu: 'Hasil MCU / Surat Bebas Narkoba',
	surat_kesehatan: 'Surat Keterangan Sehat',
	skck: 'SKCK Kepolisian',
	kontak_darurat: 'Nomor Kontak Darurat'
};

export async function fetchJobdescSaya(): Promise<JobdescSayaResult> {
	const auth = get(authStore);
	const karyawanId = auth.karyawanId;

	if (!karyawanId) {
		throw new Error('Sesi karyawan tidak terdeteksi. Silakan login kembali.');
	}

	// 1. Ambil data karyawan
	const kRes = await secureDirectusFetch(`/items/karyawan/${karyawanId}`);
	if (!kRes.ok) throw new Error('Gagal memuat profil karyawan');
	const karyawan = (await kRes.json()).data;

	const posId = typeof karyawan.posisi === 'object' ? karyawan.posisi?.id : (karyawan.posisi_id || karyawan.jabatan_id);
	let posisi: any = null;
	let jobdesc: JobdescData | null = null;

	// 2. Ambil data posisi master
	if (posId) {
		const pRes = await secureDirectusFetch(`/items/posisi/${posId}`);
		if (pRes.ok) {
			posisi = (await pRes.json()).data;
		}
	} else if (karyawan.posisi && typeof karyawan.posisi === 'string') {
		const pRes = await secureDirectusFetch(`/items/posisi?filter[nama_posisi][_icontains]=${encodeURIComponent(karyawan.posisi.trim())}&limit=1`);
		if (pRes.ok) {
			const pData = (await pRes.json()).data;
			if (pData?.length > 0) posisi = pData[0];
		}
	}

	// 3. Ambil jobdesc aktif bila ada
	const jobdescId = posisi?.jobdesc_aktif_id;
	if (jobdescId) {
		const jdRes = await secureDirectusFetch(`/items/jabatan_jobdesc/${jobdescId}`);
		if (jdRes.ok) {
			jobdesc = (await jdRes.json()).data;
			// Draf (aktif:false) tidak pernah tampil ke karyawan; hanya versi terbit.
			if (jobdesc && !jobdesc.aktif) jobdesc = null;
		}
	}

	// 4. Ambil berkas dokumen, sertifikasi, dan aturan syarat
	const posName = (posisi?.nama_posisi || karyawan.posisi || '').toUpperCase().trim();
	const [docRes, certRes, syaratRes] = await Promise.all([
		secureDirectusFetch(`/items/karyawan_dokumen?filter[karyawan_id][_eq]=${karyawanId}&limit=-1`),
		secureDirectusFetch(`/items/karyawan_sertifikasi?filter[karyawan_id][_eq]=${karyawanId}&limit=-1`),
		secureDirectusFetch(`/items/manpower_dokumen_syarat?limit=-1`)
	]);

	const docs = docRes.ok ? (await docRes.json()).data || [] : [];
	const certs = certRes.ok ? (await certRes.json()).data || [] : [];
	const allSyarat = syaratRes.ok ? (await syaratRes.json()).data || [] : [];

	// Filter syarat yang relevan untuk jabatan ini
	let activeSyarat = allSyarat.filter((s: any) => {
		const jp = (s.jenis_pekerjaan || '').toUpperCase().trim();
		if (!jp) return true; // universal
		if (!posName) return false;
		return posName.includes(jp) || jp.includes(posName);
	});

	if (activeSyarat.length === 0) {
		activeSyarat = [
			{ jenis_dokumen: 'ktp', wajib: true },
			{ jenis_dokumen: 'kontak_darurat', wajib: true }
		];
	}

	// 5. Evaluasi Kepatuhan
	const today = new Date();
	const complianceItems: SyaratComplianceItem[] = [];

	for (const s of activeSyarat) {
		const jenis = s.jenis_dokumen;
		let fulfilled = false;
		let isExpired = false;
		let detail = '';

		if (jenis === 'ktp') {
			const hasDoc = docs.some((d: any) => d.tipe_dokumen === 'ktp' && d.status !== 'rejected');
			const hasNik = !!(karyawan?.nik && String(karyawan.nik).length >= 12);
			fulfilled = hasDoc || hasNik;
			detail = hasDoc ? 'KTP Terunggah' : hasNik ? `NIK: ${karyawan.nik}` : 'Belum ada berkas KTP';
		} else if (jenis === 'kontak_darurat') {
			const telp = karyawan?.kontak_darurat || karyawan?.telp_darurat || karyawan?.no_hp || '';
			fulfilled = !!telp && String(telp).trim().length >= 7;
			detail = fulfilled ? `Telp: ${telp}` : 'Belum diisi';
		} else if (jenis === 'sertifikat_k3' || jenis === 'k3') {
			const matchCert = certs.find((c: any) => {
				const n = (c.nama_sertifikasi || '').toLowerCase();
				return n.includes('k3') || n.includes('keselamatan') || n.includes('hse');
			});
			const matchDoc = docs.find((d: any) => d.tipe_dokumen === 'sertifikat_k3' && d.status !== 'rejected');

			if (matchCert) {
				fulfilled = true;
				detail = matchCert.nama_sertifikasi;
				if (matchCert.tanggal_expired && new Date(matchCert.tanggal_expired) < today) {
					isExpired = true;
					fulfilled = false;
					detail += ' (Kedaluwarsa)';
				}
			} else if (matchDoc) {
				fulfilled = true;
				detail = matchDoc.nama_dokumen || 'Sertifikat K3';
				if (matchDoc.tanggal_expired && new Date(matchDoc.tanggal_expired) < today) {
					isExpired = true;
					fulfilled = false;
					detail += ' (Kedaluwarsa)';
				}
			} else {
				detail = 'Belum ada sertifikasi K3';
			}
		} else if (jenis === 'mcu' || jenis === 'surat_kesehatan') {
			const matchDoc = docs.find((d: any) => ['mcu', 'surat_kesehatan'].includes(d.tipe_dokumen) && d.status !== 'rejected');
			if (matchDoc) {
				fulfilled = true;
				detail = matchDoc.nama_dokumen || 'Hasil MCU';
				if (matchDoc.tanggal_expired && new Date(matchDoc.tanggal_expired) < today) {
					isExpired = true;
					fulfilled = false;
					detail += ' (Kedaluwarsa)';
				}
			} else {
				detail = 'Belum ada berkas MCU';
			}
		} else {
			const matchDoc = docs.find((d: any) => d.tipe_dokumen === jenis && d.status !== 'rejected');
			fulfilled = !!matchDoc;
			detail = matchDoc ? (matchDoc.nama_dokumen || jenis) : `Dokumen belum diunggah`;
		}

		complianceItems.push({
			jenis,
			label: DOK_LABELS[jenis] || jenis.toUpperCase(),
			wajib: s.wajib !== false,
			fulfilled,
			isExpired,
			detail
		});
	}

	const mandatory = complianceItems.filter((i) => i.wajib);
	const fulfilledCount = mandatory.filter((i) => i.fulfilled).length;
	const missingCount = mandatory.length - fulfilledCount;
	const scorePct = mandatory.length > 0 ? Math.round((fulfilledCount / mandatory.length) * 100) : 100;

	const compliance: ComplianceSummary = {
		items: complianceItems,
		scorePct,
		isCompliant: missingCount === 0,
		missingCount,
		statusText: missingCount === 0 ? 'Lengkap (100%)' : `${fulfilledCount}/${mandatory.length} Terpenuhi`
	};

	return {
		karyawan,
		posisi,
		jobdesc,
		compliance
	};
}

export interface JobdescKonfirmasi {
	available: boolean;
	confirmed?: boolean;
	needs_reconfirm?: boolean;
	confirmed_at?: string | null;
	versi?: number;
}

/** Status konfirmasi baca jobdesc (informasi saja). Gagal → null (halaman tetap tampil tanpa status). */
export async function fetchJobdescKonfirmasi(): Promise<JobdescKonfirmasi | null> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/ess/jobdesc-konfirmasi', { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) return null;
		return (await res.json()) as JobdescKonfirmasi;
	} catch {
		return null;
	}
}

export async function konfirmasiBacaJobdesc(): Promise<{ ok: boolean; error?: string }> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/ess/jobdesc-konfirmasi', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
		const body = await res.json().catch(() => ({}));
		return res.ok && body?.success ? { ok: true } : { ok: false, error: body?.error || `HTTP ${res.status}` };
	} catch (e: any) {
		return { ok: false, error: e?.message || 'Gagal menghubungi server' };
	}
}
