// src/routes/api/preventive/p2h/export-pdf/+server.ts
// GET ?session_id=... ATAU ?equipment_id=...&date=YYYY-MM-DD
// -> Merender PDF Dossier P2H 1-Unit lengkap dengan tabel item checklist, bukti foto, dan TTD digital via Gotenberg.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerFetch, directusServerJson } from '$lib/server/directus';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { forwardReportEvent } from '$lib/server/reportEventForward';
import { buildP2hUnitPdfHtml } from './p2hPdfHtml.js';

const asId = (v: unknown): string | null => {
	if (v == null || v === '') return null;
	if (typeof v === 'object' && v !== null && 'id' in v) return (v as any).id ? String((v as any).id) : null;
	return String(v);
};

async function fetchBase64Asset(fileId: string | null | undefined, cache: Map<string, string>): Promise<string | null> {
	if (!fileId) return null;
	const clean = String(fileId).trim();
	if (!clean) return null;
	if (clean.startsWith('data:image/')) return clean;
	if (cache.has(clean)) return cache.get(clean) || null;
	try {
		const res = await directusServerFetch(`/assets/${encodeURIComponent(clean)}?width=480&quality=75&fit=inside`);
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		const mime = res.headers.get('content-type') || 'image/jpeg';
		const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
		cache.set(clean, dataUrl);
		return dataUrl;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);

	const sessionId = (event.url.searchParams.get('session_id') || '').trim();
	const equipmentId = (event.url.searchParams.get('equipment_id') || '').trim();
	const date = (event.url.searchParams.get('date') || '').trim();

	if (!sessionId && (!equipmentId || !date)) {
		throw error(400, 'Parameter session_id atau (equipment_id + date) wajib diisi.');
	}

	const sessionFields = [
		'id', 'equipment_id', 'date', 'operator_id', 'overall_result', 'work_order_id',
		'keterangan_tambahan', 'foto_unit', 'gps_lat', 'gps_lng', 'scan_method',
		'hoursmeter', 'signature', 'jam_selesai_pakai', 'signature_selesai',
		'catatan_selesai', 'status_unit_selesai', 'foto_selesai'
	].join(',');

	let session: any = null;
	if (sessionId) {
		const sRes = await directusServerJson<{ data: any }>(
			`/items/p2h_session/${encodeURIComponent(sessionId)}?fields=${sessionFields}`
		).catch(() => null);
		session = sRes?.data || null;
	} else {
		const qs = new URLSearchParams({
			'filter[equipment_id][_eq]': equipmentId,
			'filter[date][_eq]': date,
			fields: sessionFields,
			limit: '1'
		});
		const sRes = await directusServerJson<{ data: any[] }>(`/items/p2h_session?${qs.toString()}`).catch(() => null);
		session = sRes?.data?.[0] || null;
	}

	if (!session) {
		throw error(404, 'Sesi P2H tidak ditemukan.');
	}

	const eqId = asId(session.equipment_id) || equipmentId;
	const opId = asId(session.operator_id);
	const woId = asId(session.work_order_id);

	// Fetch relasi terpisah secara paralel
	const [eqRes, logsRes, tplRes, catRes, opRes, woRes] = await Promise.all([
		eqId
			? directusServerJson<{ data: any }>(`/items/equipment/${encodeURIComponent(eqId)}?fields=id,code,name,category_id,location_id`).catch(() => null)
			: Promise.resolve(null),
		directusServerJson<{ data: any[] }>(
			`/items/p2h_log?filter[p2h_session_id][_eq]=${encodeURIComponent(session.id)}&fields=id,p2h_template_id,result,notes,photo,numeric_value,text_value&limit=-1`
		).catch(() => ({ data: [] })),
		directusServerJson<{ data: any[] }>(
			'/items/p2h_template?fields=id,item_name,sort,is_critical,wajib_foto,nogo_criteria,unit_of_measure&sort=sort&limit=-1'
		).catch(() => ({ data: [] })),
		directusServerJson<{ data: any[] }>('/items/category?fields=id,name,group&limit=-1').catch(() => ({ data: [] })),
		opId
			? directusServerJson<{ data: any }>(`/items/personnel/${encodeURIComponent(opId)}?fields=id,name`).catch(() => null)
			: Promise.resolve(null),
		woId
			? directusServerJson<{ data: any }>(`/items/work_order/${encodeURIComponent(woId)}?fields=id,wo_number,keluhan`).catch(() => null)
			: Promise.resolve(null)
	]);

	const eq = eqRes?.data || { id: eqId, code: '-', name: 'Unit' };
	const locId = asId(eq.location_id);
	const locRes = locId
		? await directusServerJson<{ data: any }>(`/items/location/${encodeURIComponent(locId)}?fields=id,name`).catch(() => null)
		: null;

	const categories = catRes?.data || [];
	const catMap = new Map(categories.map((c: any) => [String(c.id), c]));
	const tplMap = new Map((tplRes?.data || []).map((t: any) => [String(t.id), t]));

	const noGoIds = new Set(
		categories.filter((c: any) => c.group === 'p2h_result' && String(c.name).toLowerCase().trim() === 'no-go').map((c: any) => String(c.id))
	);

	const logs = logsRes?.data || [];
	const checklistItems = logs
		.map((l: any) => {
			const tpl = tplMap.get(String(asId(l.p2h_template_id) || '')) || {};
			const isNoGo = noGoIds.has(String(asId(l.result) || ''));
			return {
				sort: Number.isFinite(Number(tpl.sort)) ? Number(tpl.sort) : 9999,
				itemName: tpl.item_name || 'Item Pengecekan',
				isCritical: Boolean(tpl.is_critical),
				wajibFoto: Boolean(tpl.wajib_foto),
				nogoCriteria: tpl.nogo_criteria || null,
				unitOfMeasure: tpl.unit_of_measure || '',
				result: isNoGo ? 'No-Go' : 'Go',
				notes: String(l.notes || '').trim(),
				photoId: l.photo || null,
				hasPhoto: Boolean(l.photo),
				numericValue: l.numeric_value ?? null,
				textValue: l.text_value ?? null
			};
		})
		.sort((a: any, b: any) => a.sort - b.sort || a.itemName.localeCompare(b.itemName));

	const overallResult =
		noGoIds.has(String(asId(session.overall_result) || '')) || checklistItems.some((i: any) => i.result === 'No-Go')
			? 'No-Go'
			: 'Go';

	// Unduh gambar secara paralel ke base64 dengan cache agar Gotenberg tidak butuh token luar
	const imgCache = new Map<string, string>();
	const photoTasks: Array<{ label: string; result?: string; notes?: string; fileId: string }> = [];
	if (session.foto_unit) photoTasks.push({ label: 'Foto Kondisi Awal Unit', fileId: session.foto_unit });
	if (session.foto_selesai) photoTasks.push({ label: 'Foto Tutup Pemakaian', notes: session.catatan_selesai || '', fileId: session.foto_selesai });
	for (const item of checklistItems) {
		if (item.photoId) {
			photoTasks.push({ label: item.itemName, result: item.result, notes: item.notes, fileId: item.photoId });
		}
	}

	const [resolvedPhotos, startSigSrc, endSigSrc] = await Promise.all([
		Promise.all(
			photoTasks.map(async (pt) => {
				const dataUrl = await fetchBase64Asset(pt.fileId, imgCache);
				return dataUrl ? { label: pt.label, result: pt.result, notes: pt.notes, dataUrl } : null;
			})
		),
		fetchBase64Asset(session.signature, imgCache),
		fetchBase64Asset(session.signature_selesai, imgCache)
	]);

	const html = buildP2hUnitPdfHtml({
		equipment: eq,
		categoryName: catMap.get(String(asId(eq.category_id) || ''))?.name || '-',
		locationName: locRes?.data?.name || '-',
		operatorName: opRes?.data?.name || '-',
		overallResult,
		workOrder: woRes?.data || null,
		session,
		checklistItems,
		photos: resolvedPhotos.filter(Boolean),
		startSigSrc,
		endSigSrc,
		printedBy: user?.email || '-'
	});

	try {
		const buffer = await htmlToPdf(html, { landscape: false, filename: 'p2h-unit.pdf' });
		const safeCode = String(eq.code || eq.name || eqId).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 50);
		forwardReportEvent(event, { catalog_key: 'maintenance-export-pdf', format: 'pdf' });
		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="P2H-${safeCode}-${session.date || date}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[preventive/p2h/export-pdf] gagal render PDF:', e?.message);
		throw error(502, 'Layanan cetak PDF Gotenberg sedang tidak tersedia. Coba lagi sebentar.');
	}
};

export const POST: RequestHandler = async () => json({ message: 'Gunakan GET.' }, { status: 405 });
