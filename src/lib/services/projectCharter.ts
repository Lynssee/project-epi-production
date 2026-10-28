import { secureDirectusJson, secureDirectusFetch } from './secureDirectus';
import { WAKTU_KERJA_OPTIONS, SHIFT_KERJA_OPTIONS, JENIS_MANPOWER_OPTIONS, VERIFIKASI_KONTRAK_OPTIONS } from '$lib/shared/charterOptions';

// Pilihan Charter: SATU kosakata dengan ERP (PRJ-15, K12) — lihat $lib/shared/charterOptions.
export {
  WAKTU_KERJA_OPTIONS,
  SHIFT_KERJA_OPTIONS,
  LEMBUR_OPTIONS,
  YA_TIDAK_OPTIONS,
  YA_TIDAK_OPTIONS as IJIN_BARANG_OPTIONS,
  YA_TIDAK_OPTIONS as ALAT_LOADING_OPTIONS,
  JENIS_MANPOWER_OPTIONS,
  VERIFIKASI_KONTRAK_OPTIONS,
  PERSIAPAN_PERMUKAAN_OPTIONS
} from '$lib/shared/charterOptions';

// Satuan luas area (disimpan sebagai teks di nilai_luasan) — bukan pilihan master charter ERP.
export const SATUAN_UKURAN_OPTIONS = ['m²', 'm', 'pcs', 'titik', 'unit', 'kg'];

/**
 * Kolom project_charters yang benar-benar ada di Directus (PRJ-04).
 * Form lapangan punya field tambahan (target_ketebalan, dst.) yang TIDAK ada
 * sebagai kolom -> Directus menolak seluruh PATCH dengan 403. Hanya kirim allowlist ini.
 */
const CHARTER_WRITABLE = [
  'tanggal_mulai_project', 'selesai_project_target', 'waktu_kerja', 'jam_kerja_mulai', 'jam_kerja_selesai',
  'waktu_lembur', 'jam_lembur_mulai', 'jam_lembur_selesai', 'shift_kerja', 'ijin_barang_masuk',
  'alat_loading_unloading', 'syarat_packing_list', 'jenis_manpower', 'verifikasi_kontrak', 'syarat_mcu', 'syarat_skck',
  'syarat_sertifikat', 'syarat_surat_sehat', 'persiapan_permukaan', 'nilai_luasan', 'spec_cat_merk',
  'lain_lain_keterangan', 'lain_lain_note', 'project_leader', 'customer_contact_nama',
  'customer_contact_jabatan', 'customer_contact_hp', 'customer_contact_email'
] as const;

const NULLABLE_WHEN_EMPTY = ['tanggal_mulai_project', 'selesai_project_target', 'jam_lembur_mulai', 'jam_lembur_selesai'];

export function toCharterPayload(form: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of CHARTER_WRITABLE) {
    if (!(k in form)) continue;
    const v = form[k];
    out[k] = v === '' && NULLABLE_WHEN_EMPTY.includes(k) ? null : v;
  }
  // Pemetaan field lapangan -> kolom ERP
  if (form.target_luas_area) out.nilai_luasan = `${form.target_luas_area} ${form.satuan_luas || 'm²'}`.trim();
  if (form.catatan_teknis) out.lain_lain_keterangan = form.catatan_teknis;
  return out;
}

const SPEC_KETERANGAN = 'Target DFT (lapangan)';

/** Target ketebalan (DFT) ditulis ke tabel anak project_charter_spec_items, satu baris. */
async function syncDftSpecItem(charterId: number | string, form: Record<string, any>) {
  if (form.target_ketebalan === undefined || form.target_ketebalan === '' || form.target_ketebalan === null) return;
  const filter = JSON.stringify({ project_charter_id: { _eq: charterId }, keterangan: { _eq: SPEC_KETERANGAN } });
  const existing = await secureDirectusJson(`/items/project_charter_spec_items?filter=${encodeURIComponent(filter)}&fields=id&limit=1`);
  const id = existing.data?.[0]?.id;
  await secureDirectusJson(id ? `/items/project_charter_spec_items/${id}` : `/items/project_charter_spec_items`, {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify({
      project_charter_id: charterId,
      keterangan: SPEC_KETERANGAN,
      tebal: form.target_ketebalan,
      satuan_ukuran: form.satuan_ketebalan || 'micron'
    })
  });
}

function friendlyCharterError(err: any): string {
  const msg = String(err?.message || err || '');
  const m = msg.match(/permission to access field ['"]?([\w.]+)['"]?/i);
  if (m) return `Kolom '${m[1]}' tidak dikenal server. Laporkan ke admin (bukan masalah hak akses).`;
  return msg;
}

export async function getSurveyGate(soCustomerId: number) {
  try {
    const filter = JSON.stringify({ so_customer_id: { _eq: soCustomerId } });
    const data = await secureDirectusJson(`/items/sales_survey?filter=${encodeURIComponent(filter)}&limit=1`);
    return { survey: data.data?.[0] || null };
  } catch (err) {
    console.error(err);
    return { survey: null };
  }
}

export async function loadFullCharter(soCustomerId: number) {
  try {
    const filter = JSON.stringify({ so_customer_id: { _eq: soCustomerId } });
    const result = await secureDirectusJson(`/items/project_charters?filter=${encodeURIComponent(filter)}&limit=1`);
    const charter = result.data?.[0];

    if (!charter) return { charter: null, manpower: [], specItems: [], budgetItems: [], loadErrors: [] as string[] };

    // PRJ-16: kegagalan baca data anak TIDAK ditelan diam-diam — dilog dan dikembalikan agar UI bisa menampilkan pesan.
    const loadErrors: string[] = [];
    const safeChild = (label: string) => (e: any) => {
      console.error(`[projectCharter] Gagal memuat ${label} charter ${charter.id}:`, e);
      loadErrors.push(`Gagal memuat ${label} charter`);
      return { data: [] };
    };

    const [manpowerRes, specRes, budgetRes] = await Promise.all([
      secureDirectusJson(`/items/project_charter_manpower?filter=${encodeURIComponent(JSON.stringify({ project_charter_id: { _eq: charter.id } }))}`).catch(safeChild('daftar manpower')),
      secureDirectusJson(`/items/project_charter_spec_items?filter=${encodeURIComponent(JSON.stringify({ project_charter_id: { _eq: charter.id } }))}`).catch(safeChild('spesifikasi')),
      secureDirectusJson(`/items/project_charter_budget_items?filter=${encodeURIComponent(JSON.stringify({ project_charter_id: { _eq: charter.id } }))}`).catch(safeChild('anggaran')),
    ]);

    return {
      charter,
      manpower: manpowerRes.data || [],
      specItems: specRes.data || [],
      budgetItems: budgetRes.data || [],
      loadErrors
    };
  } catch (err) {
    console.error(err);
    return { charter: null, manpower: [], specItems: [], budgetItems: [], loadErrors: ['Gagal memuat Project Charter'] };
  }
}

/**
 * Buat Project Charter baru bila belum ada untuk SO Customer ini.
 */
export async function createProjectCharter(soCustomerId: number, projectId?: number | string | null, leaderName?: string | null) {
  try {
    // PRJ-16: idempoten — cek ulang tepat sebelum POST (dua pembuka/klik bersamaan tidak boleh melahirkan 2 charter per SO).
    const dupFilter = encodeURIComponent(JSON.stringify({ so_customer_id: { _eq: soCustomerId }, status: { _neq: 'archived' } }));
    const dup = await secureDirectusJson(`/items/project_charters?filter=${dupFilter}&fields=*&sort=id&limit=1`);
    if (dup?.data?.[0]) return { success: true, data: dup.data[0], existing: true };

    const payload: Record<string, any> = {
      so_customer_id: soCustomerId,
      status: 'draft',
      waktu_kerja: WAKTU_KERJA_OPTIONS[0].value,
      shift_kerja: SHIFT_KERJA_OPTIONS[0].value,
      waktu_lembur: 'tidak',
      jenis_manpower: JENIS_MANPOWER_OPTIONS[0].value,
      verifikasi_kontrak: VERIFIKASI_KONTRAK_OPTIONS[0].value,
      syarat_mcu: false,
      syarat_skck: false,
      syarat_sertifikat: false,
      syarat_surat_sehat: false,
    };
    if (projectId) payload.project_id = projectId;
    if (leaderName) payload.project_leader = leaderName;

    const result = await secureDirectusJson(`/items/project_charters`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return { success: true, data: result.data };
  } catch (err: any) {
    console.error('Error creating project charter:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Update Project Charter draft / data.
 */
export async function updateProjectCharter(charterId: number | string, data: Record<string, any>, projectId?: number | string | null) {
  try {
    const payload = toCharterPayload(data);

    const result = await secureDirectusJson(`/items/project_charters/${charterId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    await syncDftSpecItem(charterId, data).catch(e => console.warn('Gagal sinkron target DFT ke spec item:', e));

    // PRJ-16: tanggal project TIDAK lagi disinkron dari lapangan saat simpan draft — penimpaan tanggal tanpa jejak revisi.
    // Sinkron terjadi di ERP setelah charter disetujui.

    return { success: true, data: result.data };
  } catch (err: any) {
    console.error('Error updating project charter:', err);
    return { success: false, error: friendlyCharterError(err) };
  }
}

/**
 * Leader MENGUSULKAN Project Charter (PRJ-16, K13): status → 'submitted' (menunggu Admin Project/PM di ERP).
 * Leader TIDAK lagi mengaktifkan sendiri (dulu: status 'approved', approved_by = dirinya, melewati validasi ERP & dua-langkah).
 * Aktivasi + penautan project dilakukan di ERP (approveCharter / ensureProjectForApprovedCharter).
 */
export async function submitCharter(charterId: number | string, submittedBy: string, _projectId?: number | string | null, data?: Record<string, any>) {
  try {
    const payload: Record<string, any> = {
      ...toCharterPayload(data || {}),
      status: 'submitted',
      submitted_by: submittedBy,
      submitted_at: new Date().toISOString()
    };

    const result = await secureDirectusJson(`/items/project_charters/${charterId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    if (data) await syncDftSpecItem(charterId, data).catch(e => console.warn('Gagal sinkron target DFT ke spec item:', e));

    return { success: true, data: result.data };
  } catch (err: any) {
    console.error('Error submitting project charter:', err);
    return { success: false, error: friendlyCharterError(err) };
  }
}
