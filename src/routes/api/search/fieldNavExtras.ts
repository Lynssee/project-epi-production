// src/routes/api/search/fieldNavExtras.ts
// Fase 1 Pertajam Global Search (Dashboard Lapangan): melengkapi rute halaman
// lapangan yang belum tercatat di fieldNavConfig.ts beserta kamus sinonim &
// toleransi typo tanpa menyalin logika scoreNavEntry.

import {
	tokenize,
	expandTokensWithSynonyms,
	scoreNavEntry,
	normalizeText
} from '$lib/utils/searchMatch';

export interface ExtraFieldNavItem {
	id: string;
	title: string;
	parent: string;
	href: string;
	permissions?: string[];
	keywords: string;
}

export const EXTRA_FIELD_NAV_ITEMS: ExtraFieldNavItem[] = [
	// ── Budaya, Profil & Portal Karyawan (ESS) ──
	{
		id: 'ess-budaya',
		title: 'Budaya EPI (Visi, Misi & Motto)',
		parent: 'Portal Karyawan',
		href: '/ess/budaya',
		permissions: ['access_ess'],
		keywords:
			'visi misi motto nilai inti budaya perusahaan profil pt eltama manifesto pesan direktur semboyan tata nilai'
	},
	{
		id: 'ess-jobdesc',
		title: 'Tugas & Jobdesc Saya',
		parent: 'Portal Karyawan',
		href: '/ess/jobdesc',
		permissions: ['access_ess'],
		keywords: 'jobdesc deskripsi jabatan uraian tugas tanggung jawab kewajiban peran saya'
	},
	{
		id: 'ess-kalender',
		title: 'Kalender & Agenda Saya',
		parent: 'Portal Karyawan',
		href: '/ess/kalender',
		permissions: ['access_ess'],
		keywords: 'kalender jadwal libur cuti bersama agenda kerja saya'
	},
	{
		id: 'ess-shift',
		title: 'Kalender Shift Saya',
		parent: 'Portal Karyawan',
		href: '/ess/shift',
		permissions: ['access_ess'],
		keywords: 'shift jadwal kerja regu malam pagi tukar shift'
	},
	{
		id: 'ess-kehadiran',
		title: 'Riwayat Kehadiran',
		parent: 'Portal Karyawan',
		href: '/ess/kehadiran',
		permissions: ['access_ess'],
		keywords: 'riwayat kehadiran log absensi masuk pulang rekap absen'
	},
	{
		id: 'ess-disiplin',
		title: 'Status Kehadiran & Kedisiplinan',
		parent: 'Portal Karyawan',
		href: '/ess/disiplin',
		permissions: ['access_ess'],
		keywords: 'disiplin terlambat alfa denda potongan kehadiran'
	},
	{
		id: 'ess-sertifikasi',
		title: 'Sertifikasi Saya',
		parent: 'Portal Karyawan',
		href: '/ess/sertifikasi',
		permissions: ['access_ess'],
		keywords: 'sertifikasi kompetensi lisensi keahlian kadaluarsa sertifikat'
	},
	{
		id: 'ess-onboarding',
		title: 'Onboarding Saya',
		parent: 'Portal Karyawan',
		href: '/ess/onboarding',
		permissions: ['access_ess'],
		keywords: 'onboarding orientasi karyawan baru pengenalan budaya wajib'
	},
	{
		id: 'ess-offboarding',
		title: 'Offboarding & Resign',
		parent: 'Portal Karyawan',
		href: '/ess/offboarding',
		permissions: ['access_ess'],
		keywords: 'offboarding resign serah terima aset berhenti kerja'
	},
	{
		id: 'ess-pelatihan-sop',
		title: 'Perpustakaan SOP Perusahaan',
		parent: 'Portal Karyawan › Pelatihan',
		href: '/ess/pelatihan/sop',
		permissions: ['access_ess'],
		keywords: 'sop standar operasional prosedur pedoman kerja aturan lapangan'
	},
	{
		id: 'ess-pelatihan-buku-saku',
		title: 'Buku Saku Cat & Coating',
		parent: 'Portal Karyawan › Pelatihan',
		href: '/ess/pelatihan/buku-saku',
		permissions: ['access_ess'],
		keywords: 'buku saku cat coating dft blasting painting referensi teknis'
	},
	{
		id: 'ess-bookmarks',
		title: 'Pintasan & Bookmark Saya',
		parent: 'Portal Karyawan',
		href: '/ess/bookmarks',
		permissions: ['access_ess'],
		keywords: 'bookmark favorit pintasan shortcut halaman tersimpan'
	},
	{
		id: 'ess-notes',
		title: 'Catatan Kerja Pribadi',
		parent: 'Portal Karyawan',
		href: '/ess/notes',
		permissions: ['access_ess'],
		keywords: 'catatan memo notes to do list pengingat lapangan'
	},
	{
		id: 'ess-dokumen-request',
		title: 'Permintaan Dokumen HRD',
		parent: 'Portal Karyawan',
		href: '/ess/dokumen-request',
		permissions: ['access_ess'],
		keywords: 'minta dokumen surat keterangan kerja paklaring visa'
	},
	{
		id: 'ess-reimburse',
		title: 'Reimbursement Saya',
		parent: 'Portal Karyawan',
		href: '/ess/reimburse',
		permissions: ['access_ess'],
		keywords: 'reimburse klaim nota kwitansi penggantian biaya'
	},
	{
		id: 'ess-kasbon',
		title: 'Kasbon Saya',
		parent: 'Portal Karyawan',
		href: '/ess/kasbon',
		permissions: ['access_ess'],
		keywords: 'kasbon pinjaman uang muka karyawan'
	},
	{
		id: 'ess-petty-cash',
		title: 'Kas Kecil (Petty Cash)',
		parent: 'Portal Karyawan',
		href: '/ess/petty-cash',
		permissions: ['access_ess'],
		keywords: 'petty cash kas kecil dana operasional lapangan'
	},
	{
		id: 'ess-approval',
		title: 'Approval Atasan (ESS)',
		parent: 'Portal Karyawan',
		href: '/ess/approval',
		permissions: ['approve_cuti_ess'],
		keywords: 'approval atasan setujui cuti izin lembur persetujuan'
	},
	{
		id: 'ess-gamifikasi',
		title: 'Poin & Badge Saya',
		parent: 'Portal Karyawan',
		href: '/ess/gamifikasi',
		permissions: ['access_ess'],
		keywords: 'poin badge gamifikasi apresiasi budaya duta'
	},

	// ── Proyek, TBM, Anggaran & Laporan ──
	{
		id: 'tbm-rollcall',
		title: 'TBM Roll-Call Pagi',
		parent: 'Project',
		href: '/tbm-rollcall',
		permissions: ['view_all_projects', 'view_own_projects', 'view_manpower', 'input_laporan'],
		keywords: 'tbm roll call apel pagi briefing keselamatan budaya proyek harian'
	},
	{
		id: 'laporan-general',
		title: 'Daily General Report',
		parent: 'Project › Laporan',
		href: '/laporan/general',
		permissions: ['input_laporan', 'approve_laporan'],
		keywords: 'daily general report laporan umum harian proyek rport'
	},
	{
		id: 'laporan-review',
		title: 'Review Laporan Harian',
		parent: 'Project › Laporan',
		href: '/laporan/review',
		permissions: ['approve_laporan'],
		keywords: 'review verifikasi laporan harian leader'
	},
	{
		id: 'anggaran-baru',
		title: 'Ajukan Anggaran Baru',
		parent: 'Project › Keuangan',
		href: '/anggaran/baru',
		permissions: ['request_budget'],
		keywords: 'ajukan anggaran baru pengajuan dana pa proyek'
	},
	{
		id: 'anggaran-cek-gate',
		title: 'Cek Kesiapan Gate Anggaran',
		parent: 'Project › Keuangan',
		href: '/anggaran/cek-gate',
		permissions: ['request_budget', 'approve_budget'],
		keywords: 'cek gate anggaran kesiapan syarat pencairan'
	},
	{
		id: 'kalkulator-cat',
		title: 'Kalkulator Kebutuhan Cat',
		parent: 'Project › Inventory Proyek',
		href: '/inventory-proyek/kalkulator-cat',
		permissions: ['view_all_projects', 'view_own_projects'],
		keywords: 'kalkulator kebutuhan cat liter m2 luas bidang estimasi'
	},
	{
		id: 'hutang-proyek',
		title: 'Hutang & Kewajiban Proyek',
		parent: 'Project › Keuangan',
		href: '/hutang-proyek',
		permissions: ['view_all_projects', 'view_own_projects', 'request_budget'],
		keywords: 'hutang proyek kasbon piutang kewajiban'
	},

	// ── HSE & Keamanan (Satpam) ──
	{
		id: 'hse-apd',
		title: 'APD Saya',
		parent: 'HSE & Mutu',
		href: '/hse/apd',
		permissions: ['access_hse'],
		keywords: 'apd alat pelindung diri helm sepatu safety rompi k3'
	},
	{
		id: 'hse-b3',
		title: 'Cek MSDS & Bahan B3',
		parent: 'HSE & Mutu',
		href: '/hse/b3',
		permissions: ['access_hse'],
		keywords: 'msds bahan b3 berbahaya kimia safety datasheet'
	},
	{
		id: 'hse-izin-kerja',
		title: 'Izin Kerja (PTW)',
		parent: 'HSE & Mutu',
		href: '/hse/izin-kerja',
		permissions: ['access_hse'],
		keywords: 'ptw permit to work izin kerja aman ketinggian panas'
	},
	{
		id: 'hse-soc',
		title: 'Kartu Observasi Keselamatan (SOC)',
		parent: 'HSE & Mutu',
		href: '/hse/soc',
		permissions: ['access_hse', 'hse_soc_create'],
		keywords: 'soc safety observation card temuan bahaya unsafe act condition'
	},
	{
		id: 'hse-inspeksi',
		title: 'Inspeksi K3 & Checklist',
		parent: 'HSE & Mutu',
		href: '/hse/inspeksi',
		permissions: ['access_hse'],
		keywords: 'inspeksi k3 checklist hse keselamatan lapangan'
	},
	{
		id: 'satpam-gate',
		title: 'Gate Log (Keluar Masuk Orang & Barang)',
		parent: 'HRD & GA › Satpam',
		href: '/satpam/gate',
		permissions: ['access_security', 'gate_log'],
		keywords: 'gate log satpam keluar masuk gerbang barang orang'
	},
	{
		id: 'satpam-tamu',
		title: 'Buku Tamu & Kendaraan',
		parent: 'HRD & GA › Satpam',
		href: '/satpam/tamu',
		permissions: ['access_security', 'visitor_log'],
		keywords: 'buku tamu visitor kendaraan satpam'
	},
	{
		id: 'satpam-patroli',
		title: 'Patroli & Ronda QR',
		parent: 'HRD & GA › Satpam',
		href: '/satpam/patroli',
		permissions: ['access_security', 'patrol_scan'],
		keywords: 'patroli ronda qr scan titik jaga satpam'
	},

	// ── Panduan, Logistik, Sales & Produksi ──
	{
		id: 'panduan-alur',
		title: 'Peta Alur Kerja Sistem',
		parent: 'Panduan & SOP',
		href: '/panduan/alur',
		keywords: 'peta alur kerja sistem flowchart proses sop gate panduan'
	},
	{
		id: 'procurement-lacak',
		title: 'Lacak Pesanan Pembelian',
		parent: 'Inventory & Logistik',
		href: '/procurement/lacak',
		permissions: ['submit_pengajuan_pembelian', 'terima_barang_po'],
		keywords: 'lacak pesanan po pengiriman barang status procurement'
	},
	{
		id: 'driver-check',
		title: 'Cek Kendaraan (P2H) & BBM',
		parent: 'Inventory & Logistik › Driver',
		href: '/driver/check',
		permissions: ['access_driver', 'submit_vehicle_check'],
		keywords: 'p2h cek kendaraan bbm driver mobil truk'
	},
	{
		id: 'sales-penawaran',
		title: 'Kalkulator & Penawaran Sales',
		parent: 'Sales & Marketing',
		href: '/sales/penawaran',
		permissions: ['input_sales'],
		keywords: 'penawaran quotation kalkulator harga sales'
	},
	{
		id: 'stock-opname',
		title: 'Stock Opname Lapangan',
		parent: 'Inventory & Logistik',
		href: '/stock-lapangan/opname',
		permissions: ['view_stock_lapangan', 'input_stock_lapangan'],
		keywords: 'stock opname hitung stok fisik gudang lapangan'
	},
	{
		id: 'notifikasi',
		title: 'Pusat Notifikasi',
		parent: 'Akses Cepat',
		href: '/notifikasi',
		keywords: 'notifikasi pemberitahuan inbox pesan alert'
	}
];

const TYPO_ALIASES: Record<string, string> = {
	rport: 'report',
	reprot: 'report',
	propganda: 'propaganda',
	jobdes: 'jobdesc',
	budya: 'budaya',
	vsi: 'visi',
	msisi: 'misi',
	p2h: 'p2h'
};

const EXTRA_SYNONYMS: Record<string, string[]> = {
	visi: ['misi', 'motto', 'budaya', 'nilai inti', 'perusahaan', 'direktur'],
	misi: ['visi', 'motto', 'budaya', 'nilai inti', 'perusahaan'],
	motto: ['visi', 'misi', 'budaya', 'semboyan'],
	budaya: ['visi', 'misi', 'motto', 'nilai inti', 'propaganda', 'perusahaan'],
	propaganda: ['budaya', 'tbm', 'visi', 'misi'],
	perusahaan: ['visi', 'misi', 'budaya', 'sop', 'pt eltama'],
	jobdesc: ['uraian tugas', 'deskripsi jabatan', 'tugas saya'],
	report: ['laporan', 'daily', 'general'],
	laporan: ['report', 'daily', 'general'],
	alur: ['peta alur', 'flowchart', 'sop', 'panduan'],
	sop: ['prosedur', 'panduan', 'buku saku', 'aturan']
};

function hasItemPermission(item: ExtraFieldNavItem, permissions: string[], isSuperAdmin: boolean): boolean {
	if (isSuperAdmin || permissions.includes('*')) return true;
	if (!item.permissions || item.permissions.length === 0) return true;
	return item.permissions.some((p) => permissions.includes(p));
}

function normalizeWithTypos(rawQuery: string): string {
	const norm = normalizeText(rawQuery);
	if (!norm) return '';
	return norm
		.split(/\s+/)
		.map((t) => TYPO_ALIASES[t] || t)
		.join(' ');
}

function buildAltQueries(tokens: string[]): string[] {
	const alts = new Set<string>();
	for (let i = 0; i < tokens.length; i++) {
		const syns = EXTRA_SYNONYMS[tokens[i]];
		if (!syns) continue;
		for (const syn of syns.slice(0, 6)) {
			const next = [...tokens];
			next[i] = syn;
			alts.add(next.join(' '));
			alts.add(syn);
		}
	}
	return Array.from(alts);
}

export function searchExtraFieldNav(rawQuery: string, permissions: string[], isSuperAdmin: boolean) {
	const cleaned = normalizeWithTypos(rawQuery);
	if (!cleaned) return [];
	const tokens = tokenize(cleaned);
	const expanded = expandTokensWithSynonyms(tokens);
	const altQueries = buildAltQueries(tokens).map((qAlt) => {
		const altTokens = tokenize(qAlt);
		return { qAlt, altTokens, altExpanded: expandTokensWithSynonyms(altTokens) };
	});

	const matches: Array<{
		entity: string;
		source: string;
		id: string;
		title: string;
		subtitle: string;
		score: number;
		url: string;
	}> = [];

	for (const item of EXTRA_FIELD_NAV_ITEMS) {
		if (!hasItemPermission(item, permissions, isSuperAdmin)) continue;
		let score = scoreNavEntry(
			{ title: item.title, parent: item.parent, keywords: item.keywords, href: item.href },
			cleaned,
			tokens,
			expanded
		);
		if (score === 0 && altQueries.length) {
			for (const { qAlt, altTokens, altExpanded } of altQueries) {
				const altScore = scoreNavEntry(
					{ title: item.title, parent: item.parent, keywords: item.keywords, href: item.href },
					qAlt,
					altTokens,
					altExpanded
				);
				if (altScore > 0) {
					score = Math.max(score, Math.max(12, Math.round(altScore * 0.72)));
				}
			}
		}
		if (score > 0) {
			matches.push({
				entity: 'Menu & Halaman Lainnya',
				source: 'field_nav_extra',
				id: item.id,
				title: item.title,
				subtitle: item.parent,
				score,
				url: item.href
			});
		}
	}

	return matches.sort((a, b) => b.score - a.score).slice(0, 8);
}
