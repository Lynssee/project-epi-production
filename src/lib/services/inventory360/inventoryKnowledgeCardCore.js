// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeCardCore.js
// Inventory 360° — inti pengambilan data kartu, dipakai KLIEN (secureDirectusJson) dan SERVER (directusServerJson)
// lewat injeksi `fetchJson`. Satu sumber logika → kartu di layar dan evaluasi gate di server tidak bisa berbeda.
// Tanpa import server/klien: hanya modul murni.
//
// Aturan #2: fetch dipisah per koleksi — profil → barang (hanya yang perlu) → profil model → template.

// Impor RELATIF (bukan $lib): berkas ini disalin byte-identik ke project-epi (src/lib/services/inventory360/) dan
// dijaga tes kontrak inventory360.contract.test.js. Ubah di sini → salin ke sana.
import { resolveKnowledgeTemplate } from './inventoryKnowledgeDefaults.js';
import { CONTENT_FIELDS } from './inventoryKnowledgeScore.js';

const MEDIA_FIELDS = ['foto_ids', 'diagram_id', 'manual_file', 'video_url'];

export const CARD_FIELDS = [
  'id', 'item_id', 'group_id', 'template_id', 'status', 'is_kritis', 'wajib_training', 'training_program_id', 'skor_kelengkapan',
  'sumber_data', 'review_due_date', 'verified_by', ...CONTENT_FIELDS.filter((f) => !MEDIA_FIELDS.includes(f))
].join(',');

export const TEMPLATE_FIELDS =
  'id,nama,parent_category_id,sub_category_id,spec_fields,sections_aktif,context_map,min_score_verified,is_kritis_default,status,catatan,date_updated';

const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function normalizeTemplateRow(row) {
  return {
    ...row,
    spec_fields: asArray(row?.spec_fields),
    sections_aktif: asArray(row?.sections_aktif),
    context_map: asObject(row?.context_map),
    min_score_verified: row?.min_score_verified ?? 70,
    is_kritis_default: !!row?.is_kritis_default,
    status: row?.status || 'active'
  };
}

/** @param {(path:string)=>Promise<any>} fetchJson */
export async function fetchTemplatesWith(fetchJson) {
  const res = await fetchJson(`/items/inventory_knowledge_template?limit=-1&sort=nama&fields=${TEMPLATE_FIELDS}`);
  return (res?.data || []).map(normalizeTemplateRow);
}

const inList = (ids) => ids.map((i) => encodeURIComponent(i)).join(',');

/**
 * Ambil kartu untuk sekumpulan id barang.
 * @param {{ fetchJson:(path:string)=>Promise<any>, loadTemplates:()=>Promise<object[]> }} deps
 * @param {number[]} ids
 * @returns {Promise<Map<number,{itemId:number, source:'item'|'group'|'none', profile:object|null, template:object|null, groupId:string|null, href:string}>>}
 */
export async function fetchCardsWith({ fetchJson, loadTemplates }, ids) {
  const profRes = await fetchJson(`/items/inventory_knowledge_profile?limit=-1&filter[item_id][_in]=${inList(ids)}&fields=${CARD_FIELDS}`);
  const byItem = new Map((profRes?.data || []).map((p) => [p.item_id, p]));
  const templates = await loadTemplates();
  const tplById = new Map(templates.map((t) => [t.id, t]));

  // Barang tanpa profil sendiri (atau template profilnya hilang) → perlu kategori & grup untuk template/profil model.
  const needRows = ids.filter((id) => !byItem.has(id) || (byItem.get(id).template_id != null && !tplById.has(byItem.get(id).template_id)));
  const rows = new Map();
  if (needRows.length) {
    const r = await fetchJson(`/items/identitas_barang?limit=-1&filter[id][_in]=${inList(needRows)}&fields=id,parent_category,sub_category,item_group_id`);
    for (const row of r?.data || []) rows.set(row.id, row);
  }

  // Profil model (equipment): hanya untuk barang tanpa profil sendiri yang punya grup.
  const groupIds = [...new Set(needRows.filter((id) => !byItem.has(id)).map((id) => rows.get(id)?.item_group_id).filter(Boolean))];
  const byGroup = new Map();
  if (groupIds.length) {
    const g = await fetchJson(`/items/inventory_knowledge_profile?limit=-1&filter[group_id][_in]=${inList(groupIds)}&fields=${CARD_FIELDS}`);
    for (const p of g?.data || []) byGroup.set(p.group_id, p);
  }

  const out = new Map();
  for (const id of ids) {
    const row = rows.get(id);
    let source = 'none';
    let profile = null;
    let groupId = null;
    if (byItem.has(id)) {
      source = 'item';
      profile = byItem.get(id);
    } else if (row?.item_group_id && byGroup.has(row.item_group_id)) {
      source = 'group';
      groupId = row.item_group_id;
      profile = byGroup.get(groupId);
    }
    const template =
      (profile?.template_id != null ? tplById.get(profile.template_id) : null) ||
      resolveKnowledgeTemplate(templates, { parentCategoryId: row?.parent_category ?? null, subCategoryId: row?.sub_category ?? null });
    out.set(id, { itemId: id, source, profile, template, groupId, href: source === 'group' ? `/inventory/360/model/${groupId}` : `/inventory/360/${id}` });
  }
  return out;
}
