// src/lib/server/grandPoLapangan.ts
// SERVER-ONLY. Grand PO Fase 5 (lapangan): data kartu "Paket Grand PO" + "Material dari Customer" untuk
// ringkasan satu proyek. READ-ONLY, TANPA field Rupiah. Aturan #2: query per-koleksi terpisah (tanpa relasi
// bersarang); kegagalan sebuah bagian dilaporkan lewat `warnings`, tidak dianggap "kosong" diam-diam.

import { directusServerJson } from './directus';
import {
	buildPaketMembers,
	buildMaterialItems,
	buildPilihanProduk,
	buildRekonsiliasi,
	sjStatus,
	estimasiTiba,
	idOf,
	type AnggotaPaket,
	type BarisMaterial,
	type RingkasSj,
	type BarisRekon,
	type PilihanProduk
} from '$lib/utils/grandPoLapangan';

const inList = (ids: Array<number | string | null | undefined>) =>
	[...new Set(ids.filter((x) => x !== null && x !== undefined && x !== ''))].join(',');

async function readList<T = any>(path: string, label: string, warnings: string[]): Promise<T[]> {
	try {
		const res = await directusServerJson<{ data: T[] }>(path);
		return Array.isArray(res?.data) ? res.data : [];
	} catch (e) {
		console.error(`[grandPoLapangan] gagal ambil ${label}:`, (e as Error)?.message);
		warnings.push(`Data ${label} gagal dimuat — tampilan bisa tidak lengkap.`);
		return [];
	}
}

export interface PaketLapangan {
	grand_po_id: number;
	nama: string;
	nomor_gpo: string | null;
	anggota: AnggotaPaket[];
}

export interface MaterialLapangan {
	so_id: number;
	nomor_po: string;
	memasok_belum_ditentukan: boolean;
	items: BarisMaterial[];
	surat_jalan: RingkasSj[];
	estimasi_tiba: string;
}

export interface RekonLapangan {
	baris: BarisRekon[];
	/** Catatan coating log yang belum terhubung ke produk PO (tidak ikut hitungan). */
	tanpa_produk: number;
	/** Catatan ber-satuan beda dari PO (tidak dijumlahkan). */
	satuan_beda: number;
	toleransi_pct: number;
}

export interface GrandPoLapanganResult {
	paket: PaketLapangan[];
	material: MaterialLapangan[];
	/** Fase 6: Dikirim vs Dipakai vs Sisa per produk (null bila tidak ada material / log gagal dibaca). */
	rekonsiliasi: RekonLapangan | null;
	/** Fase 6: pilihan produk untuk form coating log. */
	pilihan_produk: PilihanProduk[];
	warnings: string[];
}

/** Semua SO milik proyek: PO utama (projects.so_customer_id) + PO saudara (so_customer.project_id). */
async function resolveProjectSoIds(projectId: number, warnings: string[]): Promise<Set<number>> {
	const [siblings, project] = await Promise.all([
		readList(`/items/so_customer?filter[project_id][_eq]=${projectId}&limit=-1&fields=id`, 'SO proyek', warnings),
		readList(`/items/projects?filter[id][_eq]=${projectId}&limit=1&fields=id,so_customer_id`, 'Proyek', warnings)
	]);
	const ids = new Set<number>();
	for (const s of siblings) ids.add(Number(s.id));
	const primary = idOf(project[0]?.so_customer_id);
	if (primary != null) ids.add(primary);
	return ids;
}

export async function loadGrandPoLapangan(projectId: number): Promise<GrandPoLapanganResult> {
	const warnings: string[] = [];
	const empty: GrandPoLapanganResult = { paket: [], material: [], rekonsiliasi: null, pilihan_produk: [], warnings };

	const soIds = await resolveProjectSoIds(projectId, warnings);
	if (soIds.size === 0) return empty;

	// 1) Anggota paket yang memuat SO proyek ini. Gagal di sini = tidak bisa memutuskan → lempar (bukan "tidak ada paket").
	const mine = await directusServerJson<{ data: any[] }>(
		`/items/grand_po_members?filter[so_customer_id][_in]=${inList([...soIds])}&filter[status][_eq]=aktif&limit=-1&fields=id,grand_po_id`
	);
	const grandPoIds = [...new Set((mine?.data || []).map((m) => idOf(m.grand_po_id)).filter((x): x is number => x != null))];
	if (grandPoIds.length === 0) return empty;

	const [headers, allMembers] = await Promise.all([
		readList(`/items/grand_po?filter[id][_in]=${inList(grandPoIds)}&filter[status][_neq]=batal&limit=-1&fields=id,nama,nomor_gpo,status`, 'Grand PO', warnings),
		readList(
			`/items/grand_po_members?filter[grand_po_id][_in]=${inList(grandPoIds)}&filter[status][_eq]=aktif&sort=urutan,id&limit=-1&fields=id,grand_po_id,so_customer_id,peran,memasok_member_id`,
			'anggota Grand PO', warnings)
	]);
	const liveGpoIds = new Set(headers.map((h) => Number(h.id)));
	const members = allMembers.filter((m) => liveGpoIds.has(idOf(m.grand_po_id) as number));
	if (members.length === 0) return { ...empty };

	const memberSoIds = members.map((m) => idOf(m.so_customer_id));
	const soList = await readList(
		`/items/so_customer?filter[id][_in]=${inList(memberSoIds)}&limit=-1&fields=id,nomor_so,nomor_po_customer,project_id`,
		'SO Customer', warnings);
	const soById = new Map(soList.map((s) => [Number(s.id), s]));

	const otherProjectIds = soList.map((s) => idOf(s.project_id)).filter((x): x is number => x != null && x !== projectId);
	const projectIdsToLoad = [...new Set([projectId, ...otherProjectIds])];
	const projects = await readList(`/items/projects?filter[id][_in]=${inList(projectIdsToLoad)}&limit=-1&fields=id,name,status,total_progress`, 'Proyek paket', warnings);
	const projectById = new Map(projects.map((p) => [Number(p.id), p]));

	const paket: PaketLapangan[] = headers.map((h) => {
		const ms = members.filter((m) => idOf(m.grand_po_id) === Number(h.id));
		return {
			grand_po_id: Number(h.id),
			nama: h.nama,
			nomor_gpo: h.nomor_gpo || null,
			anggota: buildPaketMembers({ members: ms, soById, projectById, thisProjectId: projectId, thisProjectSoIds: soIds })
		};
	});

	// 2) Material yang memasok proyek ini: memasok_member_id menunjuk PO milik proyek ini, atau belum ditentukan.
	const memberById = new Map(members.map((m) => [Number(m.id), m]));
	const materialMembers = members.filter((m) => {
		if (m.peran !== 'material') return false;
		const supplierId = idOf(m.memasok_member_id);
		if (supplierId == null) return true;
		const supplier = memberById.get(supplierId);
		return supplier ? soIds.has(idOf(supplier.so_customer_id) as number) : false;
	});
	if (materialMembers.length === 0) return { ...empty, paket };

	const matSoIds = materialMembers.map((m) => idOf(m.so_customer_id) as number);
	const [details, sjs] = await Promise.all([
		readList(`/items/so_customer_details?filter[so_customer_id][_in]=${inList(matSoIds)}&sort=id&limit=-1&fields=id,so_customer_id,product_id,nama_barang,qty,jumlah_pcs,packing,input_unit`, 'item PO material', warnings),
		readList(`/items/surat_jalan?filter[so_customer_id][_in]=${inList(matSoIds)}&sort=id&limit=-1&fields=id,so_customer_id,nomor_sj,status,track_stage,received_at,date_created`, 'Surat Jalan material', warnings)
	]);
	const sjIds = sjs.map((s) => s.id);
	const sjItems = sjIds.length
		? await readList(`/items/surat_jalan_items?filter[surat_jalan_id][_in]=${inList(sjIds)}&limit=-1&fields=id,surat_jalan_id,so_detail_id,qty_delivered,qty_gr_received,cancelled_at`, 'item Surat Jalan', warnings)
		: [];
	const sjById = new Map(sjs.map((s) => [Number(s.id), s]));

	const material: MaterialLapangan[] = materialMembers.map((m) => {
		const soId = idOf(m.so_customer_id) as number;
		const so = soById.get(soId);
		const myDetails = details.filter((d) => idOf(d.so_customer_id) === soId);
		const detailIds = new Set(myDetails.map((d) => Number(d.id)));
		const mySjItems = sjItems.filter((it) => detailIds.has(idOf(it.so_detail_id) as number));
		const items = buildMaterialItems({ details: myDetails, sjItems: mySjItems, sjById });
		const surat_jalan: RingkasSj[] = sjs
			.filter((s) => idOf(s.so_customer_id) === soId)
			.map((s) => ({ id: Number(s.id), nomor_sj: s.nomor_sj, status: sjStatus(s), tanggal: s.received_at ? String(s.received_at).slice(0, 10) : s.date_created ? String(s.date_created).slice(0, 10) : null }));
		const sisa = items.reduce((t, i) => t + i.qty_belum, 0);
		return {
			so_id: soId,
			nomor_po: String(so?.nomor_po_customer || so?.nomor_so || `SO #${soId}`),
			memasok_belum_ditentukan: idOf(m.memasok_member_id) == null,
			items,
			surat_jalan,
			estimasi_tiba: estimasiTiba(surat_jalan, sisa)
		};
	});


	// Fase 6: pemakaian (coating log proyek ini) vs kiriman. Log gagal dibaca → rekonsiliasi dihilangkan + warning
	// (bukan "dipakai 0" palsu yang membuat sisa tampak utuh).
	const allItems = material.flatMap((m) => m.items);
	const pilihan_produk = buildPilihanProduk(allItems);
	let rekonsiliasi: RekonLapangan | null = null;
	if (pilihan_produk.length) {
		const [logs, tol] = await Promise.all([
			readListStrict(`/items/project_coating_log?filter[project_id][_eq]=${projectId}&limit=-1&fields=id,product_id,qty_used,satuan`, 'coating log', warnings),
			getToleransiPct()
		]);
		if (logs) {
			const r = buildRekonsiliasi({ items: allItems, logs, toleransiPct: tol });
			rekonsiliasi = { baris: r.baris, tanpa_produk: r.tanpaProduk, satuan_beda: r.satuanBeda, toleransi_pct: tol };
		}
	}

	return { paket, material, rekonsiliasi, pilihan_produk, warnings };
}

/** Seperti readList tapi mengembalikan null (bukan []) bila gagal, agar pemanggil bisa membedakan "kosong" dari "gagal". */
async function readListStrict<T = any>(path: string, label: string, warnings: string[]): Promise<T[] | null> {
	try {
		const res = await directusServerJson<{ data: T[] }>(path);
		return Array.isArray(res?.data) ? res.data : [];
	} catch (e) {
		console.error(`[grandPoLapangan] gagal ambil ${label}:`, (e as Error)?.message);
		warnings.push(`Data ${label} gagal dimuat — rekonsiliasi pemakaian tidak ditampilkan.`);
		return null;
	}
}

/** Toleransi rekonsiliasi (%): app_settings module=project key=grand_po_recon_tolerance_pct, default 5. */
async function getToleransiPct(): Promise<number> {
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: string }> }>(
			'/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=grand_po_recon_tolerance_pct&limit=1&fields=setting_value'
		);
		const n = Number(res?.data?.[0]?.setting_value);
		return Number.isFinite(n) && n >= 0 ? n : 5;
	} catch {
		return 5;
	}
}
