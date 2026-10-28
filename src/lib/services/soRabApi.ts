import { UNIT_LABELS } from '$lib/shared/unitMaster';
import { normalizeRapCategoryKey } from '$lib/shared/rapCategory';
import { secureDirectusJson, getIdToken } from './secureDirectus';

export const RAB_CATEGORIES = [
  { id: 'operasional', label: 'Biaya Operasional',  icon: '💰' },
  { id: 'supplier',   label: 'Supplier / Material', icon: '🎨' },
  { id: 'jasa',       label: 'Jasa / Subkon',       icon: '👷' },
  { id: 'sewa_alat',  label: 'Sewa Alat Internal',  icon: '🔧' },
  { id: 'consumable', label: 'Consumables',          icon: '🧴' },
  { id: 'safety',     label: 'Safety',               icon: '🦺' },
  { id: 'lain_lain',  label: 'Biaya Lain-Lain',      icon: '📦' },
];

// PRJ-26: satu master satuan (kembar erp-epi finance/unitMaster.js) — bukan daftar sendiri.
export const RAB_UNITS = UNIT_LABELS;

// ==================== HEADER so_rab ====================

export async function getRabBySOId(soCustomerId) {
  try {
    const filter = encodeURIComponent(JSON.stringify({ so_customer_id: { _eq: soCustomerId } }));
    const result = await secureDirectusJson(`/items/so_rab?filter=${filter}&limit=1`);
    return { data: (result.data || [])[0] || null, success: true };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function createRab(soCustomerId) {
  try {
    const result = await secureDirectusJson(`/items/so_rab`, {
      method: 'POST',
      body: JSON.stringify({ so_customer_id: soCustomerId, status: 'draft' })
    });
    return { data: result.data, success: true, message: 'RAP berhasil dibuat' };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function updateRab(rabId, data) {
  try {
    const payload = { ...data };
    delete payload.id;
    delete payload.so_customer_id;
    delete payload.date_created;
    const result = await secureDirectusJson(`/items/so_rab/${rabId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return { data: result.data, success: true };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function submitRab(rabId, submittedBy) {
  try {
    const result = await secureDirectusJson(`/items/so_rab/${rabId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'submitted', submitted_by: submittedBy, submitted_at: new Date().toISOString() })
    });
    return { data: result.data, success: true, message: 'RAP berhasil diajukan untuk approval' };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function approveRab(rabId, approvedBy) {
  try {
    const result = await secureDirectusJson(`/items/so_rab/${rabId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString(), rejection_note: null })
    });
    return { data: result.data, success: true, message: 'RAP berhasil disetujui' };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function rejectRab(rabId, rejectedBy, note) {
  try {
    const result = await secureDirectusJson(`/items/so_rab/${rabId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft', rejection_note: note || 'Ditolak tanpa catatan', approved_by: null, approved_at: null })
    });
    return { data: result.data, success: true, message: 'RAP ditolak dan dikembalikan ke draft' };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

// ==================== ITEMS project_budgets (RAB Items) ====================

export async function getRabItems(rabId) {
  try {
    const result = await secureDirectusJson(`/items/project_budgets?filter[so_rab_id][_eq]=${rabId}&sort=id&limit=-1`);
    return { data: result.data || [], success: true };
  } catch (err) {
    return { data: [], success: false, error: err.message };
  }
}

/** Total RAP per proyek (PRJ-10, K7): baris project_budgets dengan kategori BUKAN packing_* dan bukan header.
 *  Dua sumber, query dipisah (Aturan #2): (1) baris ber-project_id; (2) baris ber-so_rab_id yang project_id-nya
 *  masih kosong (RAP dibuat dari SO sebelum project ada) — dipetakan lewat SO milik proyek. Definisi ini
 *  HARUS sama dengan ERP (projectPaguHelper / rapTotals) supaya angka konsisten lintas dashboard. */
export async function getRabTotalsForProjects(projectIds: number[]): Promise<Record<number, number>> {
  if (!projectIds || projectIds.length === 0) return {};
  const totals: Record<number, number> = {};
  // _or(_null, ...) karena _nstarts_with/_neq di SQL membuang baris ber-NULL (sinkron dgn erp-epi `src/lib/finance/rapTotals.js`).
  const nonPacking = {
    _and: [
      { _or: [{ budget_category: { _null: true } }, { budget_category: { _nstarts_with: 'packing_' } }] },
      { _or: [{ is_category_header: { _null: true } }, { is_category_header: { _eq: false } }] }
    ]
  };
  try {
    const filter = encodeURIComponent(JSON.stringify({ project_id: { _in: projectIds }, ...nonPacking }));
    const result = await secureDirectusJson(
      `/items/project_budgets?filter=${filter}&fields=project_id,planned_amount&limit=-1`
    );
    for (const row of result.data || []) {
      const pid = Number(row.project_id);
      totals[pid] = (totals[pid] || 0) + Number(row.planned_amount || 0);
    }
  } catch (err) {
    console.error('getRabTotalsForProjects (project_id):', err);
    return {};
  }

  // Baris RAP tanpa project_id: cari lewat SO proyek -> so_rab. Gagal di sini tidak membuang total di atas.
  try {
    const ids = projectIds.join(',');
    const [soRes, projRes] = await Promise.all([
      secureDirectusJson(`/items/so_customer?filter[project_id][_in]=${ids}&fields=id,project_id&limit=-1`),
      secureDirectusJson(`/items/projects?filter[id][_in]=${ids}&fields=id,so_customer_id&limit=-1`)
    ]);
    const projectBySo = new Map<number, number>();
    for (const r of soRes.data || []) if (r.id && r.project_id) projectBySo.set(Number(r.id), Number(r.project_id));
    for (const r of projRes.data || []) {
      const so = r.so_customer_id && typeof r.so_customer_id === 'object' ? r.so_customer_id.id : r.so_customer_id;
      if (so && !projectBySo.has(Number(so))) projectBySo.set(Number(so), Number(r.id));
    }
    if (projectBySo.size === 0) return totals;

    const rabRes = await secureDirectusJson(
      `/items/so_rab?filter[so_customer_id][_in]=${[...projectBySo.keys()].join(',')}&fields=id,so_customer_id&limit=-1`
    );
    const projectByRab = new Map<number, number>();
    for (const r of rabRes.data || []) {
      const so = r.so_customer_id && typeof r.so_customer_id === 'object' ? r.so_customer_id.id : r.so_customer_id;
      const pid = projectBySo.get(Number(so));
      if (pid) projectByRab.set(Number(r.id), pid);
    }
    if (projectByRab.size === 0) return totals;

    const f2 = encodeURIComponent(JSON.stringify({ so_rab_id: { _in: [...projectByRab.keys()] }, project_id: { _null: true }, ...nonPacking }));
    const orphan = await secureDirectusJson(`/items/project_budgets?filter=${f2}&fields=so_rab_id,planned_amount&limit=-1`);
    for (const row of orphan.data || []) {
      const rabId = row.so_rab_id && typeof row.so_rab_id === 'object' ? row.so_rab_id.id : row.so_rab_id;
      const pid = projectByRab.get(Number(rabId));
      if (pid) totals[pid] = (totals[pid] || 0) + Number(row.planned_amount || 0);
    }
  } catch (err) {
    console.error('getRabTotalsForProjects (baris tanpa project_id) — total bisa kurang:', err);
  }
  return totals;
}

export async function getRabItemsByCategory(rabId, category) {
  try {
    const filter = encodeURIComponent(JSON.stringify({ so_rab_id: { _eq: rabId }, budget_category: { _eq: category } }));
    const result = await secureDirectusJson(`/items/project_budgets?filter=${filter}&sort=id&limit=-1`);
    return { data: result.data || [], success: true };
  } catch (err) {
    return { data: [], success: false, error: err.message };
  }
}

export async function addRabItem(rabId, data) {
  try {
    const qty = parseFloat(data.qty) || 0;
    const unitPrice = parseFloat(data.unit_price) || 0;
    const plannedAmount = qty && unitPrice ? qty * unitPrice : (parseFloat(data.planned_amount) || 0);

    let soCustomerId = data.so_customer_id || null;
    if (!soCustomerId && rabId) {
      const rabData = await secureDirectusJson(`/items/so_rab/${rabId}?fields=so_customer_id`).catch(() => null);
      const rawSo = rabData?.data?.so_customer_id;
      soCustomerId = typeof rawSo === 'object' ? rawSo?.id : rawSo;
    }

    const payload = {
      so_rab_id: rabId,
      so_customer_id: soCustomerId,
      project_id: null,
      budget_category: data.budget_category || 'operasional',
      description: data.description || '',
      material_name: data.material_name || '',
      material_color: data.material_color || '',
      pic: data.pic || '',
      qty: qty || null,
      unit: data.unit || '',
      unit_price: unitPrice || null,
      koefisien: parseFloat(data.koefisien) || 1,
      planned_amount: plannedAmount,
      actual_amount: 0,
      variance: plannedAmount,
      payment_type: data.payment_type || 'sekali',
      payment_reminder_date: data.payment_reminder_date || null,
      recurrence_period: data.payment_type === 'berulang' ? (data.recurrence_period || null) : null,
      note: data.note || ''
    };

    const packingCategories = ['supplier', 'sewa_alat', 'consumable', 'safety'];
    if (packingCategories.includes(payload.budget_category)) {
      payload.packing_status = 'draft';
    }

    const result = await secureDirectusJson(`/items/project_budgets`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return { data: result.data, success: true, message: 'Item RAP berhasil ditambahkan' };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function updateRabItem(itemId, data) {
  try {
    const payload = { ...data };
    delete payload.id;
    delete payload.so_rab_id;
    delete payload.so_customer_id;
    delete payload.project_id;

    if (payload.qty !== undefined) payload.qty = payload.qty ? parseFloat(payload.qty) : null;
    if (payload.unit_price !== undefined) payload.unit_price = payload.unit_price ? parseFloat(payload.unit_price) : null;
    if (payload.koefisien !== undefined) payload.koefisien = parseFloat(payload.koefisien) || 1;

    const qty = parseFloat(payload.qty) || 0;
    const unitPrice = parseFloat(payload.unit_price) || 0;
    if (qty && unitPrice) payload.planned_amount = qty * unitPrice;
    else if (payload.planned_amount !== undefined) payload.planned_amount = parseFloat(payload.planned_amount) || 0;

    if (payload.planned_amount !== undefined) {
      payload.variance = payload.planned_amount - (parseFloat(payload.actual_amount) || 0);
    }

    if (payload.payment_type !== 'berulang') payload.recurrence_period = null;

    const result = await secureDirectusJson(`/items/project_budgets/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return { data: result.data, success: true };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

export async function deleteRabItem(itemId) {
  try {
    await secureDirectusJson(`/items/project_budgets/${itemId}`, { method: 'DELETE' });
    return { success: true, message: 'Item RAP berhasil dihapus' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== SUMMARY ====================

export async function getRabSummary(rabId) {
  try {
    const res = await getRabItems(rabId);
    if (!res.success) return { data: null, success: false, error: res.error };

    const items = res.data;
    const summary = {};
    let grandTotal = 0;

    for (const cat of RAB_CATEGORIES) {
      const catItems = items.filter(i => (i.budget_category || 'operasional') === cat.id);
      const total = catItems.reduce((s, i) => s + (parseFloat(i.planned_amount) || 0), 0);
      summary[cat.id] = { rab: total, count: catItems.length };
      grandTotal += total;
    }

    return { data: { categories: summary, grand_total: grandTotal }, success: true };
  } catch (err) {
    return { data: null, success: false, error: err.message };
  }
}

// ==================== LOAD FULL RAB (header + items) ====================

export async function loadFullRab(soCustomerId) {
  try {
    const rabRes = await getRabBySOId(soCustomerId);
    if (!rabRes.success) return { rab: null, items: [], success: false, error: rabRes.error };

    if (!rabRes.data) {
      return { rab: null, items: [], success: true };
    }

    const rab = rabRes.data;
    const itemsRes = await getRabItems(rab.id);

    return {
      rab,
      items: itemsRes.data || [],
      success: true
    };
  } catch (err) {
    return { rab: null, items: [], success: false, error: err.message };
  }
}

// ==================== SEEDING OTOMATIS (Fase 3) ====================
// Logika seeding HANYA hidup di rapSeeder.js (erp-epi-1) — di sini cuma relay,
// lihat src/routes/api/project/rap-seed/+server.ts.

export async function getRapTemplates() {
	try {
		const result = await secureDirectusJson(`/items/rap_templates?filter[active][_eq]=true&sort=sort&limit=-1`);
		return { data: result.data || [], success: true };
	} catch (err) {
		return { data: [], success: false, error: err.message };
	}
}

export async function seedRapFromSO(soCustomerId: number, templateId: number) {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/project/rap-seed', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ soCustomerId, templateId })
		});
		const result = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(result?.message || 'Gagal seed RAP');
		return { data: result, success: true };
	} catch (err: any) {
		return { data: null, success: false, error: err.message };
	}
}

export async function getRabStatusForSOs(soCustomerIds) {
  try {
    if (!soCustomerIds?.length) return { data: {}, success: true };
    const filter = encodeURIComponent(JSON.stringify({ so_customer_id: { _in: soCustomerIds } }));
    const result = await secureDirectusJson(`/items/so_rab?filter=${filter}&fields=id,so_customer_id,status&limit=-1`);
    const map = {};
    for (const r of result.data || []) {
      const soId = typeof r.so_customer_id === 'object' ? r.so_customer_id?.id : r.so_customer_id;
      map[soId] = { rabId: r.id, status: r.status };
    }
    return { data: map, success: true };
  } catch (err) {
    return { data: {}, success: false, error: err.message };
  }
}

export interface RapPosOption {
  id: number;
  label: string;
  bucket: string;
  rap: number;
  terpakai: number;
}

/**
 * Pos RAP proyek untuk dropdown "Pos RAP" di form PA (PRJ-24): baris RAP bukan header & bukan packing_* (K7),
 * lengkap dengan terpakai (realisasi yang sudah tertaut). Dua query terpisah (Aturan #2); gagal → [] + log.
 */
export async function getRapPosOptions(projectId: number): Promise<RapPosOption[]> {
  try {
    const f = encodeURIComponent(JSON.stringify({
      _and: [
        { project_id: { _eq: projectId } },
        { _or: [{ budget_category: { _null: true } }, { budget_category: { _nstarts_with: 'packing_' } }] },
        { _or: [{ is_category_header: { _null: true } }, { is_category_header: { _eq: false } }] }
      ]
    }));
    const [bud, exp] = await Promise.all([
      secureDirectusJson(`/items/project_budgets?filter=${f}&fields=id,budget_category,material_name,description,category_label,planned_amount&sort=id&limit=-1`),
      secureDirectusJson(`/items/project_expenses?filter[project_id][_eq]=${projectId}&filter[rab_budget_id][_nnull]=true&fields=rab_budget_id,expense_amount,debit_amount&limit=-1`)
    ]);
    const used: Record<string, number> = {};
    for (const e of exp.data || []) {
      const k = String(e.rab_budget_id && typeof e.rab_budget_id === 'object' ? e.rab_budget_id.id : e.rab_budget_id);
      used[k] = (used[k] || 0) + (parseFloat(e.expense_amount) || parseFloat(e.debit_amount) || 0);
    }
    return (bud.data || []).map((b: any) => ({
      id: b.id,
      label: String(b.material_name || b.description || b.category_label || `Pos #${b.id}`).trim(),
      bucket: normalizeRapCategoryKey(b.budget_category),
      rap: parseFloat(b.planned_amount) || 0,
      terpakai: used[String(b.id)] || 0
    }));
  } catch (e) {
    console.error('getRapPosOptions:', e);
    return [];
  }
}
