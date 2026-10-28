// src/lib/server/pembelianLokalProyekSubmit.ts
// SERVER-ONLY. Penajaman Pembelian Proyek (26 Agu 2026) — submit reimburse pembelian
// lokal dari dashboard lapangan. Koleksi `pembelian_lokal_proyek` dan endpoint approve/
// reject aslinya ada di erp-epi-1 (admin) — app ini hanya menulis baris baru berstatus
// "Menunggu Approval" ke Directus yang sama; approval tetap di erp-epi-1 (persis pola
// yang sama dengan PR biasa: submit bisa dari mana saja, approval terpusat di admin).
//
// Cek sisa pagu di sini adalah SALINAN TIPIS dari erp-epi-1/src/lib/server/
// projectPaguHelper.js (kedua app berbagi Directus yang sama) -- hanya untuk umpan
// balik cepat ke pengaju di lapangan, bukan keputusan final (itu dihitung ulang saat
// approve di erp-epi-1).

import { directusServerJson } from './directus';
import { buildProjectSoIdList } from '$lib/utils/projectSoIds';

const num = (v: any) => parseFloat(v || 0) || 0;

const KLASIFIKASI_DARURAT = ['breakdown_critical', 'safety_hazard', 'material_habis', 'lainnya'];
const MIN_ALASAN_DARURAT_LEN = 15;

// Vendor Wajib Terdaftar — Fase 2 (celah C4)
const DEFAULT_BELI_LOKAL_THRESHOLD = 1_000_000;
const MIN_ALASAN_TANPA_VENDOR_LEN = 15;

function normalizeVendorName(s: string): string {
	return String(s ?? '')
		.toUpperCase()
		.replace(/\b(PT|CV|UD|PD|TBK|PERSERO|PERSEROAN|KOPERASI|FIRMA)\b\.?/g, '')
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim();
}

async function loadBeliLokalThreshold(): Promise<number> {
	const res: any = await directusServerJson(
		`/items/app_settings?filter[module][_eq]=procurement` +
			`&filter[setting_key][_eq]=vendor_identitas.beli_lokal_threshold&fields=setting_value&limit=1`
	).catch(() => null);
	const n = Number(res?.data?.[0]?.setting_value);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_BELI_LOKAL_THRESHOLD;
}

/** Catat nama toko teks bebas ke vendor_bayangan_log (best-effort — tidak menggagalkan submit). */
async function logVendorBayangan(nama: string, refId: number | string, nilai: number, tanggal: string) {
	const clean = String(nama ?? '').trim();
	if (!clean) return;
	try {
		await directusServerJson('/items/vendor_bayangan_log', {
			method: 'POST',
			body: JSON.stringify({
				nama: clean,
				nama_normal: normalizeVendorName(clean),
				sumber: 'beli_lokal',
				ref_id: String(refId),
				nilai: nilai || 0,
				tanggal: tanggal || new Date().toISOString().slice(0, 10)
			})
		});
	} catch (e: any) {
		console.warn('[beli-lokal] gagal catat vendor_bayangan_log:', e?.message || e);
	}
}

export async function computeProjectPaguSisa(projectId: number): Promise<{ status: 'ok' | 'not_applicable'; projectName?: string; remaining?: number; message: string }> {
	const projRes: any = await directusServerJson(`/items/projects/${projectId}?fields=id,name,so_customer_id`).catch(() => null);
	const project = projRes?.data;
	if (!project) return { status: 'not_applicable', message: `N/A — proyek #${projectId} tidak ditemukan` };

	const soCustomerId = typeof project.so_customer_id === 'object' ? project.so_customer_id?.id : project.so_customer_id;
	if (!soCustomerId) return { status: 'not_applicable', projectName: project.name, message: `N/A — proyek "${project.name}" belum punya SO/RAB tertaut` };

	// Grand PO (audit lapangan): proyek gabungan punya >1 PO -> pagu = jumlah RAB approved SEMUA PO proyek. Sebelumnya hanya
	// PO utama, sehingga pagu terlalu kecil dan nominal wajar ditandai 'failed'. Gagal baca PO saudara -> N/A (bukan
	// diam-diam PO utama saja, karena pagu yang terlalu kecil menghasilkan peringatan palsu).
	const siblingRes: any = await directusServerJson(`/items/so_customer?filter[project_id][_eq]=${projectId}&fields=id&limit=-1`).catch(() => null);
	if (!siblingRes) return { status: 'not_applicable', projectName: project.name, message: `N/A — gagal membaca PO proyek "${project.name}" untuk menghitung pagu` };
	const soIds = buildProjectSoIdList(project, siblingRes?.data || []);

	const rabRes: any = await directusServerJson(`/items/so_rab?filter[so_customer_id][_in]=${soIds.join(',')}&filter[status][_eq]=approved&fields=id&limit=-1`).catch(() => null);
	const rabIds: number[] = (rabRes?.data || []).map((r: any) => r.id).filter(Boolean);
	if (rabIds.length === 0) return { status: 'not_applicable', projectName: project.name, message: `N/A — proyek "${project.name}" belum punya RAB approved` };

	const itemsRes: any = await directusServerJson(`/items/so_rab_items?filter[so_rab_id][_in]=${rabIds.join(',')}&fields=planned_amount&limit=-1`).catch(() => null);
	const totalPagu = (itemsRes?.data || []).reduce((s: number, r: any) => s + num(r.planned_amount), 0);

	const usedRes: any = await directusServerJson(`/items/pengajuan?filter[project_id][_eq]=${projectId}&filter[status][_nin]=Rejected,Cancelled&fields=id&limit=-1`).catch(() => null);
	const prIds = (usedRes?.data || []).map((p: any) => p.id);
	let prAmount = 0;
	if (prIds.length > 0) {
		const ia: any = await directusServerJson(`/items/items_pengajuan?filter[request_id][_in]=${prIds.join(',')}&fields=quantity,harga&limit=-1`).catch(() => null);
		prAmount = (ia?.data || []).reduce((s: number, it: any) => s + num(it.quantity) * num(it.harga), 0);
	}

	const aktRes: any = await directusServerJson(`/items/project_aktualisasi?filter[project_id][_eq]=${projectId}&fields=actual_amount&limit=-1`).catch(() => null);
	const aktAmount = (aktRes?.data || []).reduce((s: number, r: any) => s + num(r.actual_amount), 0);

	const localRes: any = await directusServerJson(`/items/pembelian_lokal_proyek?filter[project_id][_eq]=${projectId}&filter[status][_eq]=Menunggu Approval&fields=nominal&limit=-1`).catch(() => null);
	const localAmount = (localRes?.data || []).reduce((s: number, r: any) => s + num(r.nominal), 0);

	const remaining = totalPagu - prAmount - aktAmount - localAmount;
	return { status: 'ok', projectName: project.name, remaining, message: `Sisa estimasi pagu: Rp ${Math.round(remaining).toLocaleString('id-ID')}` };
}

export async function createPembelianLokalProyek({
	projectId, pengajuKaryawanId, tanggalBeli, budgetCategory, deskripsi, nominal, lokasiPembelian, buktiNota,
	modeDarurat = false, klasifikasiDarurat = null, alasanDarurat = null,
	vendorId = null, alasanTanpaVendor = null
}: {
	projectId: number;
	pengajuKaryawanId: number | null;
	tanggalBeli: string;
	budgetCategory?: string | null;
	deskripsi: string;
	nominal: number;
	lokasiPembelian?: string | null;
	buktiNota: string;
	modeDarurat?: boolean;
	klasifikasiDarurat?: string | null;
	alasanDarurat?: string | null;
	vendorId?: number | null;
	alasanTanpaVendor?: string | null;
}): Promise<{ id: number; paguWarning: string | null }> {
	if (!projectId) throw new Error('Proyek wajib dipilih.');
	if (!deskripsi || deskripsi.trim().length < 5) throw new Error('Deskripsi barang/jasa yang dibeli wajib diisi.');
	if (!nominal || nominal <= 0) throw new Error('Nominal wajib diisi dan lebih dari 0.');
	if (!tanggalBeli) throw new Error('Tanggal beli wajib diisi.');
	if (!buktiNota) throw new Error('Foto nota/kuitansi wajib diunggah sebagai bukti.');

	// Vendor Wajib Terdaftar — Fase 2 (C4): di atas ambang nilai, wajib vendor
	// terdaftar ATAU alasan tertulis (jalan keluar — Aturan #6, jangan kunci reimburse).
	const vId = Number(vendorId) || null;
	const alasanVendor = (alasanTanpaVendor || '').trim();
	const threshold = await loadBeliLokalThreshold();
	if (nominal >= threshold && !vId && alasanVendor.length < MIN_ALASAN_TANPA_VENDOR_LEN) {
		throw new Error(
			`Pembelian Rp ${Math.round(nominal).toLocaleString('id-ID')} (>= ambang Rp ${Math.round(threshold).toLocaleString('id-ID')}) ` +
				`wajib memilih vendor terdaftar, atau isi alasan (min. ${MIN_ALASAN_TANPA_VENDOR_LEN} karakter) kenapa tidak memakai vendor terdaftar.`
		);
	}

	// F6.2 — Mode Darurat (Penajaman Petty Cash & LPJ v2). Validasi struktural sejajar gate
	// G_EPO_DARURAT di erp-epi-1: klasifikasi + alasan >=15 karakter + foto nota (sudah wajib).
	if (modeDarurat) {
		if (!klasifikasiDarurat || !KLASIFIKASI_DARURAT.includes(klasifikasiDarurat)) {
			throw new Error('Pilih jenis kedaruratan (breakdown kritis / bahaya keselamatan / material habis / lainnya).');
		}
		if (!alasanDarurat || alasanDarurat.trim().length < MIN_ALASAN_DARURAT_LEN) {
			throw new Error(`Alasan darurat wajib diisi minimal ${MIN_ALASAN_DARURAT_LEN} karakter.`);
		}
	}

	const pagu = await computeProjectPaguSisa(projectId).catch((e) => ({ status: 'not_applicable' as const, message: `N/A — gagal cek pagu: ${e?.message || e}` }));
	let paguStatus = 'not_applicable';
	let paguWarning: string | null = null;
	if (pagu.status === 'ok' && pagu.remaining !== undefined) {
		if (nominal > pagu.remaining) { paguStatus = 'failed'; paguWarning = pagu.message; }
		else paguStatus = 'passed';
	}

	const created: any = await directusServerJson('/items/pembelian_lokal_proyek', {
		method: 'POST',
		body: JSON.stringify({
			project_id: projectId,
			pengaju_karyawan_id: pengajuKaryawanId,
			tanggal_beli: tanggalBeli,
			budget_category: budgetCategory || null,
			deskripsi: deskripsi.trim(),
			nominal,
			lokasi_pembelian: lokasiPembelian || null,
			bukti_nota: buktiNota,
			status: 'Menunggu Approval',
			pagu_check_status: paguStatus,
			pagu_check_message: pagu.message,
			mode_darurat: modeDarurat,
			klasifikasi_darurat: modeDarurat ? klasifikasiDarurat : null,
			alasan_darurat: modeDarurat ? (alasanDarurat || '').trim() : null,
			vendor_id: vId,
			alasan_tanpa_vendor: !vId ? (alasanVendor || null) : null
		})
	});

	const newId = created?.data?.id;

	// Tanpa vendor terdaftar → catat nama toko ke antrian vendor bayangan (best-effort)
	if (!vId && newId) {
		await logVendorBayangan(lokasiPembelian || '', newId, nominal, tanggalBeli);
	}

	return { id: newId, paguWarning };
}
