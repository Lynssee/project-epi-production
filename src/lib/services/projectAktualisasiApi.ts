import { secureDirectusJson, secureDirectusFetch, getIdToken } from './secureDirectus';
import { enqueue, flushQueue, registerAutoFlush, getQueue, type QueuedRequest } from '$lib/utils/offlineQueue';

const AKTUALISASI_QUEUE_URL = '/api/directus/items/project_expenses';

/** Jumlah entri aktualisasi yang masih menunggu dikirim (sinyal lemah/offline). */
export function getPendingAktualisasiCount(): number {
  return getQueue().filter((e) => e.url === AKTUALISASI_QUEUE_URL && e.method === 'POST').length;
}

async function sendQueuedAktualisasi(entry: QueuedRequest): Promise<Response> {
  const token = await getIdToken();
  return fetch(entry.url, {
    method: entry.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(entry.body)
  });
}

/** Kirim ulang semua aktualisasi yang tertahan offline. Aman dipanggil berkali-kali. */
export function flushAktualisasiQueue() {
  return flushQueue(sendQueuedAktualisasi);
}

/** Daftarkan auto-flush saat koneksi kembali online — panggil sekali per halaman (idempotent-ish,
 *  addEventListener duplikat tidak fatal karena flushQueue aman dipanggil berulang). */
export function registerAktualisasiAutoFlush() {
  registerAutoFlush(sendQueuedAktualisasi);
}

/** True untuk kegagalan jaringan mentah (offline) — BUKAN error validasi/permission dari server,
 *  yang harus tetap ditampilkan apa adanya, bukan diam-diam diantre (nanti gagal lagi saat retry). */
function isNetworkFailure(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError;
}

// Mapping COA sama persis dengan RAB_COA_MAPPING di erp-epi-1 (src/lib/services/suratJalanApi.js)
// — TIDAK bisa di-import lintas repo, jadi disalin manual. Kalau salah satu diubah, ubah keduanya.
// Isinya dipindah ke rabCoaMapping.ts (file murni tanpa import lain) supaya bisa diuji langsung
// tanpa menyeret runtime SvelteKit/Firebase — di-import ke scope lokal dan di-re-export
// agar call site lama tetap jalan.
import { RAB_COA_MAPPING } from './rabCoaMapping';
import { isPackingCategory, resolveCategoryBucket } from '$lib/shared/rapCategory';
export { RAB_COA_MAPPING };

function generateJournalNumber(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `JE${yy}${mm}${dd}${rand}`;
}

/**
 * Buat draft jurnal (is_posted:false) untuk aktualisasi yang diinput lewat "Tambah Aktualisasi"
 * (lapangan) — celah yang ditemukan 11 Agustus 2026: sebelumnya HANYA project_expenses (cost/HPP)
 * yang tersimpan, jurnal (akuntansi) tidak pernah dibuat. Draft (bukan auto-post) SENGAJA, mengikuti
 * pola suratJalanApi.js (erp-epi-1): muncul di To-Do Center admin "Journal Voucher Unposted" untuk
 * direview Finance (COA ditebak dari kategori, butuh verifikasi manusia) sebelum masuk laporan resmi.
 * Non-fatal — kegagalan di sini TIDAK membatalkan project_expenses yang sudah tersimpan, dan TIDAK
 * ikut antre offline (draft jurnal ini best-effort, retry-nya cukup lewat review manual Finance).
 */
async function createDraftExpenseJournalEntry(projectId: number | string, expenseType: string, amount: number, description: string, referenceNumber?: string) {
  if (!amount || amount <= 0) return;
  const mapping = RAB_COA_MAPPING[expenseType] || RAB_COA_MAPPING.lain_lain;
  try {
    const journalEntry = {
      journal_number: generateJournalNumber(),
      transaction_date: new Date().toISOString().split('T')[0],
      reference_type: 'PROJECT_EXPENSE_DIRECT',
      reference_number: referenceNumber || `PRJ-${projectId}`,
      description: `Biaya ${expenseType} (Tambah Aktualisasi lapangan) — Proyek #${projectId}: ${description || ''}`,
      total_debit: amount,
      total_credit: amount,
      is_posted: false,
      created_by: 'system'
    };
    const jeData = await secureDirectusJson('/items/journal_entries', {
      method: 'POST',
      body: JSON.stringify(journalEntry)
    });
    const journalId = jeData?.data?.id;
    if (!journalId) return;

    const details = [
      { journal_entry_id: journalId, account_code: mapping.debit, account_name: mapping.debitName, debit_amount: amount, credit_amount: 0, description: description || '', line_number: 1 },
      { journal_entry_id: journalId, account_code: mapping.credit, account_name: mapping.creditName, debit_amount: 0, credit_amount: amount, description: description || '', line_number: 2 }
    ];
    await Promise.all(details.map((d) => secureDirectusJson('/items/journal_entry_details', {
      method: 'POST',
      body: JSON.stringify(d)
    }).catch(() => null)));
  } catch (e) {
    console.warn('Gagal membuat draft jurnal aktualisasi (diabaikan, expense tetap tersimpan):', e);
  }
}

// R8 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): daftar ini SEKARANG dimuat dari koleksi
// Directus `project_aktualisasi_category` lewat loadAktualisasiCategories() di bawah — array
// yang sama ini dimutasi IN-PLACE (length=0 + push) setelah fetch berhasil, supaya referensi
// yang sudah diimpor (termasuk re-export di projectSummary.ts) ikut terupdate tanpa perlu ubah
// call site. Isi di bawah ini HANYA fallback statis (dipakai sebelum load pertama / bila
// Directus gagal dijangkau) — TIDAK disentuh RAB_COA_MAPPING di atas (keputusan user 16 Sep
// 2026: kategori dinamis, COA tetap 3 salinan manual seperti sekarang — lihat catatan di atas).
export const AKTUALISASI_CATEGORIES = [
  { id: 'operasional', label: 'Biaya Operasional',  icon: '💰' },
  { id: 'supplier',   label: 'Supplier / Material', icon: '🎨' },
  { id: 'jasa',       label: 'Jasa / Subkon',       icon: '👷' },
  { id: 'sewa_alat',  label: 'Alat Milik Sendiri di Proyek',  icon: '🔧' },
  { id: 'sewa_vendor', label: 'Sewa Alat dari Vendor',        icon: '🔶' },
  { id: 'consumable', label: 'Consumables',          icon: '🧴' },
  { id: 'safety',     label: 'Safety',               icon: '🦺' },
  { id: 'lain_lain',  label: 'Biaya Lain-Lain',      icon: '📦' },
];

let aktualisasiCategoriesLoaded = false;
let aktualisasiCategoriesLoadPromise: Promise<void> | null = null;

/**
 * Muat kategori aktualisasi dari Directus (project_aktualisasi_category), sekali per sesi
 * (idempoten — panggilan berikutnya no-op kecuali force). Gagal-lunak: fallback statis di
 * atas dipakai apa adanya bila koleksi kosong/gagal dijangkau — nol regresi.
 */
export async function loadAktualisasiCategories(force = false): Promise<typeof AKTUALISASI_CATEGORIES> {
  if (aktualisasiCategoriesLoaded && !force) return AKTUALISASI_CATEGORIES;
  if (aktualisasiCategoriesLoadPromise && !force) {
    await aktualisasiCategoriesLoadPromise;
    return AKTUALISASI_CATEGORIES;
  }
  aktualisasiCategoriesLoadPromise = (async () => {
    try {
      const res = await secureDirectusJson<any>(
        '/items/project_aktualisasi_category?filter[is_active][_eq]=true&sort=sort,id&fields=kode,label,icon&limit=-1'
      );
      const rows = res?.data || [];
      if (rows.length > 0) {
        AKTUALISASI_CATEGORIES.length = 0;
        for (const r of rows) AKTUALISASI_CATEGORIES.push({ id: r.kode, label: r.label, icon: r.icon || '📦' });
      }
    } catch (e) {
      console.warn('[projectAktualisasiApi] gagal memuat kategori aktualisasi, pakai fallback statis:', e);
    } finally {
      aktualisasiCategoriesLoaded = true;
    }
  })();
  await aktualisasiCategoriesLoadPromise;
  return AKTUALISASI_CATEGORIES;
}

const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

/**
 * Fetch nama manpower secara terpisah (menghindari error 403 relational fetch Directus)
 * untuk seluruh baris pengeluaran proyek yang memiliki manpower_id atau format ID di uraian.
 */
async function resolveManpowerMap(rawItems: any[] = []) {
  const manpowerMap = new Map<number, string>();
  const mpIdSet = new Set<number>();

  for (const item of rawItems) {
    const directId = asId(item.manpower_id);
    if (directId) {
      mpIdSet.add(Number(directId));
    }
    if (item.description) {
      const match = item.description.match(/manpower\s*#\s*(\d+)/i);
      if (match && match[1]) {
        mpIdSet.add(Number(match[1]));
      }
    }
  }

  if (mpIdSet.size > 0) {
    try {
      const mpIds = Array.from(mpIdSet);
      const res = await secureDirectusJson<{ data: any[] }>(
        `/items/manpower?filter[id][_in]=${mpIds.join(',')}&fields=id,nama&limit=-1`
      );
      for (const m of (res?.data || [])) {
        if (m.id && m.nama) {
          manpowerMap.set(Number(m.id), m.nama);
        }
      }
    } catch (e) {
      console.warn('Could not fetch manpower names for actual expenses:', e);
    }
  }

  return manpowerMap;
}

function mapExpenseToAktualisasi(item: any, manpowerMap = new Map<number, string>()) {
  if (!item) return null;
  const descRaw = item.description || '';
  const parts = descRaw.split(' | Catatan: ');
  let cleanDesc = parts[0] || '';
  const cleanCatatan = parts[1] || item.catatan || '';

  // Extract manpower info
  const directMpId = asId(item.manpower_id);
  let mpId = directMpId ? Number(directMpId) : null;
  if (!mpId && descRaw) {
    const match = descRaw.match(/manpower\s*#\s*(\d+)/i);
    if (match && match[1]) {
      mpId = Number(match[1]);
    }
  }

  let resolvedPic = item.pic || '';
  if (mpId && manpowerMap.has(mpId)) {
    const mpName = manpowerMap.get(mpId);
    if (!resolvedPic || resolvedPic === '-' || resolvedPic === 'null') {
      resolvedPic = mpName;
    }
    // Sharpen description: gantikan pola `manpower #917` dengan nama asli pekerja
    if (cleanDesc.toLowerCase().includes(`manpower #${mpId}`) || cleanDesc.toLowerCase().includes(`manpower # ${mpId}`)) {
      cleanDesc = cleanDesc.replace(new RegExp(`manpower\\s*#\\s*${mpId}`, 'ig'), mpName);
    }
  }

  return {
    ...item,
    budget_category: item.expense_type || 'operasional',
    aktualisasi_date: item.expense_date,
    actual_amount: parseFloat(item.expense_amount || item.debit_amount || 0),
    description: cleanDesc,
    pic: resolvedPic,
    catatan: cleanCatatan,
    is_manual: item.source === 'aktualisasi'
  };
}

// ==================== GET ====================

export async function getAktualisasiByProject(projectId: number) {
  try {
    const result = await secureDirectusJson<{ data: any[] }>(
      `/items/project_expenses?filter[project_id][_eq]=${projectId}&sort=-expense_date,id&limit=-1`
    );
    const rawItems = result?.data || [];
    const manpowerMap = await resolveManpowerMap(rawItems);
    const items = rawItems.map((item) => mapExpenseToAktualisasi(item, manpowerMap));
    return { data: items, success: true };
  } catch (err: any) {
    return { data: [], success: false, error: err.message };
  }
}

/** Fase 2 RAB & Aktualisasi Terpusat: total aktual per proyek, batch _in (bukan loop per-projectId)
 *  — pola sama seperti getPayrollRunsForProjects di manpowerPayroll.ts. */
export async function getActualTotalsForProjects(projectIds: number[]): Promise<Record<number, number>> {
  if (!projectIds || projectIds.length === 0) return {};
  try {
    const filter = encodeURIComponent(JSON.stringify({ project_id: { _in: projectIds } }));
    const result = await secureDirectusJson<{ data: any[] }>(
      `/items/project_expenses?filter=${filter}&fields=project_id,expense_amount,debit_amount&limit=-1`
    );
    const totals: Record<number, number> = {};
    for (const row of result?.data || []) {
      const pid = Number(row.project_id);
      const amt = Number(row.expense_amount || row.debit_amount || 0);
      totals[pid] = (totals[pid] || 0) + amt;
    }
    return totals;
  } catch (err) {
    console.error('getActualTotalsForProjects:', err);
    return {};
  }
}

export async function getAktualisasiByCategory(projectId: number, category: string) {
  try {
    const filter = encodeURIComponent(JSON.stringify({
      project_id: { _eq: projectId },
      expense_type: { _eq: category }
    }));
    const result = await secureDirectusJson<{ data: any[] }>(
      `/items/project_expenses?filter=${filter}&sort=-expense_date,id&limit=-1`
    );
    const rawItems = result?.data || [];
    const manpowerMap = await resolveManpowerMap(rawItems);
    const items = rawItems.map((item) => mapExpenseToAktualisasi(item, manpowerMap));
    return { data: items, success: true };
  } catch (err: any) {
    return { data: [], success: false, error: err.message };
  }
}

// ==================== CREATE ====================

export async function addAktualisasi(projectId, data) {
  try {
    const qty = parseFloat(data.qty) || 0;
    let unitPrice = parseFloat(data.unit_price) || 0;
    
    // Auto lookup price if 0
    if (unitPrice === 0 && data.reference_number && data.material_name && data.budget_category === 'supplier') {
      unitPrice = await getPriceBySJAndMaterial(data.reference_number, data.material_name);
    }
    
    const actualAmount = qty && unitPrice ? qty * unitPrice : (parseFloat(data.actual_amount) || 0);

    await loadAktualisasiCategories();
    const categoryLabel = AKTUALISASI_CATEGORIES.find((c) => c.id === data.budget_category)?.label || 'Biaya Operasional';

    const descRaw = data.description || '';
    const description = descRaw + (data.catatan ? ` | Catatan: ${data.catatan}` : '');

    const payload = {
      project_id: projectId,
      expense_date: data.aktualisasi_date || new Date().toISOString().split('T')[0],
      expense_type: data.budget_category || 'operasional',
      expense_category: categoryLabel,
      description: description,
      material_name: data.material_name || '',
      material_color: data.material_color || '',
      pic: data.pic || '',
      reference_number: data.reference_number || '',
      qty: qty || null,
      unit: data.unit || '',
      unit_price: unitPrice || null,
      expense_amount: actualAmount,
      debit_amount: actualAmount,
      source: 'aktualisasi'
    };

    try {
      const result = await secureDirectusJson(`/items/project_expenses`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      createDraftExpenseJournalEntry(projectId, payload.expense_type, actualAmount, payload.description || payload.material_name, payload.reference_number).catch(() => {});
      return { data: mapExpenseToAktualisasi(result.data), success: true, message: 'Aktualisasi berhasil ditambahkan' };
    } catch (postErr) {
      // Sinyal lemah/offline (Fase 5, Penajaman Finance Project v2) — antre lokal, JANGAN
      // gagalkan input di lapangan. Error validasi/permission asli tetap dilempar ke pemanggil.
      if (isNetworkFailure(postErr)) {
        enqueue(AKTUALISASI_QUEUE_URL, 'POST', payload);
        return { data: null, success: true, queued: true, message: 'Sinyal lemah — aktualisasi disimpan offline, akan terkirim otomatis saat online.' };
      }
      throw postErr;
    }
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

// ==================== UPDATE ====================

export async function updateAktualisasi(itemId, data) {
  try {
    const qty = parseFloat(data.qty) || 0;
    let unitPrice = parseFloat(data.unit_price) || 0;
    
    // Auto lookup price if 0
    if (unitPrice === 0 && data.reference_number && data.material_name && data.budget_category === 'supplier') {
      unitPrice = await getPriceBySJAndMaterial(data.reference_number, data.material_name);
    }
    
    const actualAmount = qty && unitPrice ? qty * unitPrice : (parseFloat(data.actual_amount) || 0);

    await loadAktualisasiCategories();
    const categoryLabel = AKTUALISASI_CATEGORIES.find((c) => c.id === data.budget_category)?.label || 'Biaya Operasional';

    const descRaw = data.description || '';
    const description = descRaw + (data.catatan ? ` | Catatan: ${data.catatan}` : '');

    const payload = {
      expense_date: data.aktualisasi_date || new Date().toISOString().split('T')[0],
      expense_type: data.budget_category || 'operasional',
      expense_category: categoryLabel,
      description: description,
      material_name: data.material_name || '',
      material_color: data.material_color || '',
      pic: data.pic || '',
      reference_number: data.reference_number || '',
      qty: qty || null,
      unit: data.unit || '',
      unit_price: unitPrice || null,
      expense_amount: actualAmount,
      debit_amount: actualAmount
    };

    const result = await secureDirectusJson(`/items/project_expenses/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return { data: mapExpenseToAktualisasi(result.data), success: true };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

// ==================== DELETE ====================

export async function deleteAktualisasi(itemId) {
  try {
    await secureDirectusJson(`/items/project_expenses/${itemId}`, { method: 'DELETE' });
    return { success: true, message: 'Aktualisasi berhasil dihapus' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== SUMMARY ====================

export async function getAktualisasiSummary(projectId) {
  try {
    const res = await getAktualisasiByProject(projectId);
    if (!res.success) return { data: null, success: false, error: res.error };

    const items = res.data;
    const summary = {};
    let grandTotal = 0;

    await loadAktualisasiCategories();
    for (const cat of AKTUALISASI_CATEGORIES) {
      const catItems = items.filter(i => (i.budget_category || 'operasional') === cat.id);
      const total = catItems.reduce((s, i) => s + (parseFloat(i.actual_amount) || 0), 0);
      summary[cat.id] = { actual: total, count: catItems.length };
      grandTotal += total;
    }

    return { data: { categories: summary, grand_total: grandTotal }, success: true };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

// Gabungan RAB vs Aktualisasi untuk perbandingan
export async function getRABvsAktualisasi(projectId, rabItems = []) {
  try {
    const aktRes = await getAktualisasiByProject(projectId);
    if (!aktRes.success) return { data: null, success: false, error: aktRes.error };

    const aktItems = aktRes.data;
    const summary = {};
    let grandRAB = 0;
    let grandAktual = 0;

    await loadAktualisasiCategories();
    // PRJ-06/PRJ-10: nilai kategori dinormalisasi lewat peta alias yang sama dengan ERP
    // (man_power→jasa, reimbursement→operasional, dst.) — dulu dicocokkan persis sehingga
    // nilai di luar master dibuang diam-diam. RAP Packing List (packing_*) dan header kategori
    // BUKAN bagian Total RAP (K7); jumlahnya dikembalikan terpisah sebagai packing_outside_rap.
    const ids = new Set<string>(AKTUALISASI_CATEGORIES.map((c) => c.id));
    const rabBy: Record<string, number> = {};
    const actBy: Record<string, number> = {};
    const unknown = new Map<string, number>();
    let packingOutsideRap = 0;
    const perRab: Record<string, number> = {}; // PRJ-24: realisasi per baris RAP (rab_budget_id)
    let unlinkedActual = 0;
    let akrualBelumFinal = 0; // PRJ-07: akrual absensi (is_accrual) — tetap dihitung di total, dilaporkan terpisah
    const note = (raw: any, res: { unknown: boolean }) => {
      if (res.unknown) { const k = String(raw ?? ''); unknown.set(k, (unknown.get(k) || 0) + 1); }
    };

    for (const i of rabItems as any[]) {
      if (i.is_category_header) continue;
      const amount = parseFloat(i.planned_amount) || 0;
      if (isPackingCategory(i.budget_category)) { packingOutsideRap += amount; continue; }
      const res = resolveCategoryBucket(i.budget_category, ids);
      note(i.budget_category, res);
      rabBy[res.bucket] = (rabBy[res.bucket] || 0) + amount;
    }
    for (const i of aktItems as any[]) {
      if (i.is_accrual) akrualBelumFinal += parseFloat(i.actual_amount) || 0;
      {
        const link = i.rab_budget_id && typeof i.rab_budget_id === 'object' ? i.rab_budget_id.id : i.rab_budget_id;
        const amt = parseFloat(i.actual_amount) || 0;
        if (link) perRab[String(link)] = (perRab[String(link)] || 0) + amt;
        else unlinkedActual += amt;
      }
      const res = resolveCategoryBucket(i.budget_category, ids);
      note(i.budget_category, res);
      actBy[res.bucket] = (actBy[res.bucket] || 0) + (parseFloat(i.actual_amount) || 0);
    }

    for (const cat of AKTUALISASI_CATEGORIES) {
      const rab = rabBy[cat.id] || 0;
      const actual = actBy[cat.id] || 0;

      summary[cat.id] = {
        rab,
        actual,
        variance: rab - actual,
        variance_pct: rab > 0 ? (((rab - actual) / rab) * 100).toFixed(1) : null
      };
      grandRAB += rab;
      grandAktual += actual;
    }
    if (unknown.size > 0) {
      console.warn('[getRABvsAktualisasi] kategori tak dikenal dimasukkan ke lain_lain:', Object.fromEntries(unknown));
    }

    return {
      data: {
        categories: summary,
        grand_rab: grandRAB,
        grand_actual: grandAktual,
        grand_variance: grandRAB - grandAktual,
        packing_outside_rap: packingOutsideRap,
        akrual_belum_final: akrualBelumFinal,
        per_rab: perRab,
        unlinked_actual: unlinkedActual,
        unknown_categories: Object.fromEntries(unknown)
      },
      success: true
    };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

/**
 * Lookup item price from PO or master data based on SJ (reference number) and material name.
 * @param referenceNumber - No SJ or PO Number
 * @param materialName - Name of the material
 * @returns Price of the material
 */
export async function getPriceBySJAndMaterial(referenceNumber: string, materialName: string): Promise<number> {
  try {
    const sjNumber = (referenceNumber || '').trim();
    const matName = (materialName || '').trim();
    if (!sjNumber || !matName) return 0;

    // 1. Search in stock_transactions first
    try {
      const stockRes = await secureDirectusJson(
        `/items/stock_transactions?filter[_and][0][reference_no][_eq]=${encodeURIComponent(sjNumber)}&filter[_and][1][item_id][nama_barang_lengkap][_eq]=${encodeURIComponent(matName)}&fields=unit_price&limit=1`
      );
      if (stockRes.data && stockRes.data.length > 0 && stockRes.data[0].unit_price) {
        return parseFloat(stockRes.data[0].unit_price) || 0;
      }
    } catch (e) {
      console.warn('Error fetching price from stock_transactions:', e);
    }

    // 2. Search in ciketing_surat_jalan_masuk
    let poNumber = '';
    try {
      const ciketingRes = await secureDirectusJson(
        `/items/ciketing_surat_jalan_masuk?filter[_and][0][no_sj][_eq]=${encodeURIComponent(sjNumber)}&filter[_and][1][nama_barang][_eq]=${encodeURIComponent(matName)}&fields=no_po&limit=1`
      );
      if (ciketingRes.data && ciketingRes.data.length > 0) {
        poNumber = ciketingRes.data[0].no_po;
      }
    } catch (e) {
      console.warn('Error fetching PO from ciketing_surat_jalan_masuk:', e);
    }

    // 3. Search in balaraja_surat_jalan_masuk (if not found in Ciketing)
    if (!poNumber) {
      try {
        const balarajaRes = await secureDirectusJson(
          `/items/balaraja_surat_jalan_masuk?filter[_and][0][no_sj][_eq]=${encodeURIComponent(sjNumber)}&filter[_and][1][nama_barang][_eq]=${encodeURIComponent(matName)}&fields=no_po&limit=1`
        );
        if (balarajaRes.data && balarajaRes.data.length > 0) {
          poNumber = balarajaRes.data[0].no_po;
        }
      } catch (e) {
        console.warn('Error fetching PO from balaraja_surat_jalan_masuk:', e);
      }
    }

    // 4. If we found a PO number, look up the price in purchase_order_supplier_items
    if (poNumber) {
      try {
        const poFilter = {
          _and: [
            {
              _or: [
                { po_id: { po_number: { _eq: poNumber } } },
                { po_id: { po_number: { _eq: poNumber.replace('PO-', '') } } }
              ]
            },
            { item_name: { _eq: matName } }
          ]
        };
        const poItemsRes = await secureDirectusJson(
          `/items/purchase_order_supplier_items?filter=${encodeURIComponent(JSON.stringify(poFilter))}&fields=unit_price&limit=1`
        );
        if (poItemsRes.data && poItemsRes.data.length > 0 && poItemsRes.data[0].unit_price) {
          return parseFloat(poItemsRes.data[0].unit_price) || 0;
        }
      } catch (e) {
        console.warn('Error fetching price from purchase_order_supplier_items:', e);
      }
    }

    // 5. Fallback: maybe they entered the PO number directly in No SJ (referenceNumber)
    try {
      const directPoFilter = {
        _and: [
          {
            _or: [
              { po_id: { po_number: { _eq: sjNumber } } },
              { po_id: { po_number: { _eq: sjNumber.replace('PO-', '') } } }
            ]
          },
          { item_name: { _eq: matName } }
        ]
      };
      const directPoRes = await secureDirectusJson(
        `/items/purchase_order_supplier_items?filter=${encodeURIComponent(JSON.stringify(directPoFilter))}&fields=unit_price&limit=1`
      );
      if (directPoRes.data && directPoRes.data.length > 0 && directPoRes.data[0].unit_price) {
        return parseFloat(directPoRes.data[0].unit_price) || 0;
      }
    } catch (e) {
      console.warn('Error fetching direct PO price:', e);
    }

    // 6. Final fallback: search in identitas_barang (master price)
    try {
      const barangRes = await secureDirectusJson(
        `/items/identitas_barang?filter[nama_barang_lengkap][_eq]=${encodeURIComponent(matName)}&fields=harga_beli,supplier_prices&limit=1`
      );
      if (barangRes.data && barangRes.data.length > 0) {
        const item = barangRes.data[0];
        let defaultPrice = parseFloat(item.harga_beli) || 0;
        
        // Try to look up primary supplier price first
        if (item.supplier_prices) {
          try {
            const prices = typeof item.supplier_prices === 'string' ? JSON.parse(item.supplier_prices) : item.supplier_prices;
            if (Array.isArray(prices) && prices.length > 0) {
              const primary = prices.find((p: any) => p.is_primary) || prices[0];
              if (primary && primary.price_idr) {
                defaultPrice = parseFloat(primary.price_idr) || defaultPrice;
              }
            }
          } catch (jsonErr) {}
        }
        return defaultPrice;
      }
    } catch (e) {
      console.warn('Error fetching master price from identitas_barang:', e);
    }

  } catch (err) {
    console.error('Error in getPriceBySJAndMaterial:', err);
  }
  return 0;
}


/**
 * PRJ-29: kandidat duplikat untuk aktualisasi manual — biaya proyek yang SUDAH tercatat lewat kanal lain (selain input
 * manual) dan PA proyek yang masih berjalan, pada jendela ±7 hari. Dua query kecil; gagal baca => daftar kosong + log
 * (jangan menghalangi input lapangan saat sinyal buruk).
 */
export async function findPossibleDuplicateOutflows(projectId: number | string, amount: number, dateStr: string) {
  const { matchDuplicateOutflows } = await import('$lib/utils/outflowDuplicate');
  if (!(amount > 0)) return [];
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return [];
  const from = new Date(d.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const to = new Date(d.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
  try {
    const [pa, ex] = await Promise.all([
      secureDirectusJson(`/items/pengajuan_anggaran?filter=${enc({ _and: [{ project_id: { _eq: Number(projectId) } }, { total_amount: { _eq: amount } }, { status: { _nin: ['Rejected', 'Cancelled', 'Draft'] } }, { date_created: { _between: [from, to + 'T23:59:59'] } }] })}&fields=id,nomor_pengajuan,total_amount,date_created&limit=5`),
      secureDirectusJson(`/items/project_expenses?filter=${enc({ _and: [{ project_id: { _eq: Number(projectId) } }, { expense_amount: { _eq: amount } }, { expense_date: { _between: [from, to] } }, { _or: [{ source: { _null: true } }, { source: { _neq: 'aktualisasi' } }] }] })}&fields=id,expense_amount,expense_date,description,source&limit=5`)
    ]);
    return matchDuplicateOutflows([
      ...(pa?.data || []).map((r: any) => ({ id: r.id, source: 'pengajuan_anggaran' as const, date: r.date_created, amount: Number(r.total_amount) || 0, label: `Pengajuan ${r.nomor_pengajuan || '#' + r.id}` })),
      ...(ex?.data || []).map((r: any) => ({ id: r.id, source: 'project_expenses' as const, date: r.expense_date, amount: Number(r.expense_amount) || 0, label: `Biaya tercatat${r.source ? ' (' + r.source + ')' : ''}: ${String(r.description || '').slice(0, 40)}` }))
    ], amount, dateStr);
  } catch (e) {
    console.warn('[aktualisasi] cek duplikat gagal, input tetap dilanjutkan:', e);
    return [];
  }
}
