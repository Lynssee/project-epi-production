// src/routes/api/panduan/content/+server.ts
// GET: konten panduan PUBLISHED dari Directus (koleksi panduan_*, SATU
// Directus yang sama dengan erp-epi-1), dibentuk ulang PERSIS sama dengan
// shape modulDokumentasi/kategoriModul di panduan.ts — §6 Fase 1 wiring baca
// (implementation_plan_panduan pertajam.md). project-epi TIDAK punya
// alurKerja/faqGlobal (fitur itu cuma ada di erp-epi-1), jadi tidak
// disertakan di sini.
//
// Hanya baca konten PUBLISHED (status='published', is_active=true) — draft
// dari editor (§6 Fase 2, erp-epi-1 /settings/panduan-editor, Super Admin
// saja) tidak pernah tampil ke user lapangan lewat endpoint ini.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const TARGET_APP = 'project-epi';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const appFilter = `${TARGET_APP},both`;

	const [catsRes, modsRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(`/items/panduan_categories?filter[target_app][_in]=${appFilter}&filter[is_active][_eq]=true&sort=urutan&limit=-1`),
		directusServerJson<{ data: any[] }>(`/items/panduan_modules?filter[target_app][_in]=${appFilter}&filter[status][_eq]=published&sort=urutan&limit=-1`)
	]);
	const cats = catsRes?.data || [];
	const mods = modsRes?.data || [];
	const modIds = mods.map((m) => m.id);
	const modIdFilter = modIds.length ? `&filter[module_id][_in]=${modIds.join(',')}` : '';

	const [stepsRes, faqRes] = await Promise.all([
		modIds.length ? directusServerJson<{ data: any[] }>(`/items/panduan_steps?sort=urutan&limit=-1${modIdFilter}`) : Promise.resolve({ data: [] }),
		modIds.length ? directusServerJson<{ data: any[] }>(`/items/panduan_faq?sort=urutan&limit=-1${modIdFilter}`) : Promise.resolve({ data: [] })
	]);

	const stepsByModule = new Map<number, any[]>();
	for (const s of stepsRes?.data || []) {
		if (!stepsByModule.has(s.module_id)) stepsByModule.set(s.module_id, []);
		stepsByModule.get(s.module_id)!.push({ judul: s.judul, isi: s.isi || '', tips: s.tips || '', blocks: s.blocks || null });
	}
	const faqByModule = new Map<number, any[]>();
	for (const f of faqRes?.data || []) {
		if (!faqByModule.has(f.module_id)) faqByModule.set(f.module_id, []);
		faqByModule.get(f.module_id)!.push({ tanya: f.tanya, jawab: f.jawab || '' });
	}

	const modulDokumentasi = mods.map((m) => ({
		id: m.slug,
		nama: m.nama,
		kategori: m.kategori_slug || '',
		deskripsi: m.deskripsi || '',
		icon: m.icon || '',
		href: m.href || '',
		langkah: stepsByModule.get(m.id) || [],
		faq: faqByModule.get(m.id) || []
	}));

	const kategoriModul = cats.map((c) => ({ id: c.slug, label: c.nama, emoji: c.emoji || '' }));

	return json({ success: true, data: { kategoriModul, modulDokumentasi } });
};
