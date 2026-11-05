// src/lib/utils/fieldProjectStepper.ts
// Stepper 5 Tahap Proyek Lapangan (K3, SJM, Blasting/QC, Daily Report, BAST)
// Memberi panduan eksekusi sekuensial untuk mandor, supervisor, & Project Leader.
import type { FlowSummary } from './processMyTasks';

export interface StageQuickLink {
	label: string;
	href: string;
	icon: string;
}

export interface StageGate {
	key: string;
	label: string;
	mode: 'hard' | 'warn' | 'shadow';
}

export interface ProjectStage {
	id: number;
	key: string;
	title: string;
	shortTitle: string;
	icon: string;
	badge: string;
	fokus: string;
	sopKeywords: string[];
	procedureType?: 'field_ops' | 'emergency_qhse' | 'administrative' | 'management_gate';
	gates: StageGate[];
	actions: StageQuickLink[];
	checkpoints: string[];
}

export const FIELD_SALES_STAGE: ProjectStage = {
	id: 0,
	key: 'sales_akuisisi',
	title: '0. Akuisisi & Penjualan Lapangan (Sales Journey)',
	shortTitle: 'Sales & Kunjungan',
	icon: '🤝',
	badge: 'Tahap Sales · Akuisisi',
	fokus: 'Kunjungan prospecting, survey lokasi/kebutuhan coating, penyusunan estimasi/penawaran (SPH), dan konfirmasi pesanan (PO) pelanggan.',
	sopKeywords: ['sales', 'prospek', 'kunjungan', 'survey', 'penawaran', 'sph', 'quotation', 'po'],
	procedureType: 'field_ops',
	gates: [
		{ key: 'G_SALES_VISIT_GEOTAG', label: 'Check-in GPS & Foto Bukti Kunjungan di Lokasi', mode: 'hard' },
		{ key: 'G_SPH_MIN_MARGIN', label: 'Batas Minimal Margin Penawaran Harga', mode: 'warn' },
		{ key: 'G_SO_CREDIT_LIMIT', label: 'Plafon Kredit & Riwayat Piutang Pelanggan', mode: 'warn' }
	],
	actions: [
		{ label: 'Input Prospek Baru', href: '/sales/prospek/baru', icon: '👤' },
		{ label: 'Form Survey Kebutuhan', href: '/sales/survey/baru', icon: '📋' },
		{ label: 'Buat Penawaran (SPH)', href: '/sales/penawaran/baru', icon: '📑' },
		{ label: 'Status PO & Pesanan', href: '/sales/po', icon: '📦' }
	],
	checkpoints: [
		'Lokasi GPS check-in tercatat akurat dengan foto timestamp di depan plang/gerbang proyek',
		'Kebutuhan cat, luas bidang (m2), dan estimasi waktu pengerjaan dicatat di form survey',
		'Margin harga telah diverifikasi sebelum penawaran resmi dikirim ke calon pelanggan'
	]
};

export const FIELD_PROJECT_STAGES: ProjectStage[] = [
	{
		id: 1,
		key: 'pra_mobilisasi',
		title: '1. Pra-Mobilisasi & K3 (HSE)',
		shortTitle: 'Pra-Mob & K3',
		icon: '🦺',
		badge: 'Tahap 1 · Persiapan Site',
		fokus: 'Pemeriksaan kelayakan APD, Tool Box Meeting, dan verifikasi Job Safety Analysis (JSA) sebelum tim memulai pekerjaan di site proyek.',
		sopKeywords: ['jsa', 'k3', 'pra-mobilisasi', 'hse', 'safety', 'darurat'],
		procedureType: 'emergency_qhse',
		gates: [
			{ key: 'G_JSA_APPROVED', label: 'JSA Disetujui Pengawas K3 & Safety Officer', mode: 'hard' }
		],
		actions: [
			{ label: 'Cek Pra-Mobilisasi', href: '/pra-mobilisasi', icon: '📋' },
			{ label: 'Form JSA & K3', href: '/jsa', icon: '🦺' },
			{ label: 'Toolbox Meeting', href: '/toolbox', icon: '🗣️' }
		],
		checkpoints: [
			'Kesiapan APD lengkap seluruh personil (helm, kacamata, respirator, safety shoes)',
			'Form JSA telah ditandatangani Site Supervisor & Pengawas K3 Owner',
			'Izin kerja (Work Permit) aktif dan terpasang di lokasi kerja'
		]
	},
	{
		id: 2,
		key: 'logistik_sjm',
		title: '2. Logistik & Penerimaan Surat Jalan (SJM)',
		shortTitle: 'Logistik & SJM',
		icon: '🚚',
		badge: 'Tahap 2 · Material Masuk',
		fokus: 'Penerimaan pasir blasting, cat primer/finish, thinner di pos satpam site. Scan QR Surat Jalan Masuk dan verifikasi fisik drum/pail.',
		sopKeywords: ['surat jalan', 'sjm', 'logistik', 'inventory', 'penerimaan', 'pengiriman'],
		procedureType: 'field_ops',
		gates: [
			{ key: 'G_SJ_BUKTI_KIRIM', label: 'Foto Tanda Terima Satpam & QR Scan Ekspedisi', mode: 'hard' },
			{ key: 'G_PO_TERIMA_BUKTI', label: 'Kesesuaian Volume Barang vs PO Pembelian', mode: 'warn' }
		],
		actions: [
			{ label: 'Penerimaan SJM', href: '/sji', icon: '📦' },
			{ label: 'Lacak SJ & Posisi', href: '/lacak-sj', icon: '🔍' },
			{ label: 'Stok Material Site', href: '/stock-lapangan', icon: '🏭' },
			{ label: 'Mutasi Barang', href: '/mutasi-barang', icon: '🔄' }
		],
		checkpoints: [
			'Nomor batch cat & masa kadaluarsa (shelf life) sesuai Certificate of Analysis (CoA)',
			'Kondisi kemasan pail/drum utuh tanpa bocor/penyok berat',
			'Surat Jalan di-scan barcode & foto tanda terima diunggah langsung'
		]
	},
	{
		id: 3,
		key: 'blasting_coating_qc',
		title: '3. Eksekusi Blasting, Coating & QC Hold Point',
		shortTitle: 'Blasting & QC',
		icon: '⚙️',
		badge: 'Tahap 3 · Eksekusi Inti',
		fokus: 'Sandblasting permukaan (standar Sa 2.5), uji debu/garam, aplikasi primer/intermediate/topcoat, dan inspeksi ketebalan cat (DFT) bersama QC Owner.',
		sopKeywords: ['blasting', 'coating', 'inspeksi', 'qc', 'painting', 'dft', 'cat'],
		procedureType: 'field_ops',
		gates: [
			{ key: 'G_QC_HOLD_POINT', label: 'QC Sign-off Sebelum Aplikasi Cat Lapisan Lanjutan', mode: 'hard' },
			{ key: 'G_DEW_POINT_ENV', label: 'Suhu Permukaan Min +3°C di Atas Dew Point (Titik Embun)', mode: 'hard' }
		],
		actions: [
			{ label: 'Input Inspeksi QC', href: '/inspection', icon: '🔍' },
			{ label: 'Daily Execution', href: '/field-report', icon: '📊' }
		],
		checkpoints: [
			'Profil kekasaran permukaan (surface profile) 50-75 mikron sesuai spesifikasi',
			'Kelembaban udara (RH) < 85% dan tidak sedang hujan di area terbuka',
			'Ketebalan film kering (DFT) diukur dengan elcometer terkalibrasi dan dicatat di form QC'
		]
	},
	{
		id: 4,
		key: 'daily_report_manpower',
		title: '4. Laporan Harian, Cuaca & Manpower Lapangan',
		shortTitle: 'Laporan & Upah',
		icon: '📝',
		badge: 'Tahap 4 · Progres & SDM',
		fokus: 'Pencatatan luasan bidang selesai (m2), konsumsi cat & pasir, log cuaca per 3 jam, absensi mandor/tukang, dan pertanggungjawaban upah harian.',
		sopKeywords: ['laporan harian', 'daily report', 'manpower', 'upah', 'spj', 'absensi'],
		procedureType: 'field_ops',
		gates: [
			{ key: 'G_DAILY_REPORT_CUTOFF', label: 'Submit Daily Report Maksimal Pukul 22:00 Tiap Hari', mode: 'warn' },
			{ key: 'G_MANPOWER_ATTENDANCE', label: 'Presensi Tenaga Kerja Wajib Sinkron dengan SPJ Upah', mode: 'warn' }
		],
		actions: [
			{ label: 'Isi Daily Report', href: '/field-report', icon: '📝' },
			{ label: 'Data Manpower', href: '/manpower', icon: '👷' },
			{ label: 'SPJ Upah Lapangan', href: '/spj-upah', icon: '💰' }
		],
		checkpoints: [
			'Foto dokumentasi progres sebelum, proses aplikasi, dan sesudah pengerjaan',
			'Pencatatan log cuaca (hujan/terik/lembab) jika terjadi stand-by kerja',
			'Daftar hadir tukang & mandor divalidasi oleh Project Leader'
		]
	},
	{
		id: 5,
		key: 'bast_closing_demobilisasi',
		title: '5. BAST, Retur Material & Demobilisasi',
		shortTitle: 'BAST & Retur',
		icon: '🏁',
		badge: 'Tahap 5 · Serah Terima & Penutupan',
		fokus: 'Joint inspection akhir bersama owner, penandatanganan BAST 100%, pengembalian sisa material & drum kosong, penarikan mesin kompresor, dan evaluasi proyek.',
		sopKeywords: ['bast', 'retur', 'closing', 'demobilisasi', 'evaluasi', 'biaya'],
		procedureType: 'management_gate',
		gates: [
			{ key: 'G_BAST_SIGNED', label: 'BAST Ditandatangani Owner & Project Leader', mode: 'hard' },
			{ key: 'G_RETUR_MATERIAL_CLEAR', label: 'Rekonsiliasi Sisa Material & Alat Selesai', mode: 'warn' }
		],
		actions: [
			{ label: 'Evaluasi & Closing', href: '/closing-evaluasi-terpusat', icon: '📑' },
			{ label: 'Retur Material & Alat', href: '/mutasi-barang', icon: '🔄' },
			{ label: 'Rekap Biaya Lapangan', href: '/biaya-lapangan', icon: '💵' }
		],
		checkpoints: [
			'BAST ditandatangani tanpa pending punch-list kritis',
			'Sisa cat & drum kosong dihitung dan dibuatkan surat jalan retur',
			'Pertanggungjawaban kasbon lapangan diserahkan ke finance pusat'
		]
	}
];

const STAGE_STORAGE_KEY = 'epi_field_project_active_stage';

export function getStageById(id: number): ProjectStage | undefined {
	if (id === 0) return FIELD_SALES_STAGE;
	return FIELD_PROJECT_STAGES.find((s) => s.id === id);
}

export function findStageForKeyword(keyword: string): ProjectStage | undefined {
	const needle = keyword.trim().toLowerCase();
	if (!needle) return undefined;
	return FIELD_PROJECT_STAGES.find((s) =>
		s.title.toLowerCase().includes(needle) ||
		s.shortTitle.toLowerCase().includes(needle) ||
		s.sopKeywords.some((k) => needle.includes(k) || k.includes(needle))
	);
}

/** Filter daftar alur ringkas yang cocok dengan tahap proyek aktif */
export function getMatchingFlowsForStage(stage: ProjectStage, flows: FlowSummary[]): FlowSummary[] {
	if (!flows || flows.length === 0) return [];
	return flows.filter((f) => {
		const title = (f.title || '').toLowerCase();
		const code = (f.sop_code || '').toLowerCase();
		const sub = (f.sub_kategori || '').toLowerCase();

		const matchesKeyword = stage.sopKeywords.some((k) =>
			title.includes(k) || code.includes(k) || sub.includes(k)
		);
		const matchesProcedure = stage.procedureType ? f.procedure_type === stage.procedureType : true;
		return matchesKeyword || matchesProcedure;
	});
}

export function saveSelectedStage(storage: Pick<Storage, 'setItem'> | null, stageId: number): void {
	try {
		storage?.setItem(STAGE_STORAGE_KEY, String(stageId));
	} catch {
		// kuota penuh / mode privat diabaikan
	}
}

export function loadSelectedStage(storage: Pick<Storage, 'getItem'> | null, defaultId = 1): number {
	try {
		const val = storage?.getItem(STAGE_STORAGE_KEY);
		const parsed = Number(val);
		if (Number.isInteger(parsed) && parsed >= 1 && parsed <= FIELD_PROJECT_STAGES.length) {
			return parsed;
		}
	} catch {
		// fallback
	}
	return defaultId;
}

/**
 * Memberikan fallback tindakan cepat (deep-links) jika suatu langkah SOP belum memiliki actions eksplisit.
 */
export function inferFieldActionsForNode(label: string, desc = ''): StageQuickLink[] {
	const text = `${label} ${desc}`.toLowerCase();
	const out: StageQuickLink[] = [];

	if (text.match(/inspeksi|qc|blasting|coating|dft|profil permukaan|cat /)) {
		out.push({ label: 'Inspeksi QC', href: '/inspection', icon: '🔍' });
	}
	if (text.match(/surat jalan|sjm|penerimaan|ekspedisi|satpam|pos satpam/)) {
		out.push({ label: 'Penerimaan SJM', href: '/sji', icon: '📦' });
	}
	if (text.match(/laporan harian|daily report|log cuaca|progres /)) {
		out.push({ label: 'Daily Report', href: '/field-report', icon: '📝' });
	}
	if (text.match(/jsa|k3|apd|toolbox|keselamatan|izin kerja/)) {
		out.push({ label: 'Form JSA & K3', href: '/jsa', icon: '🦺' });
	}
	if (text.match(/upah|spj|tukang|manpower|tenaga kerja/)) {
		out.push({ label: 'Upah & Manpower', href: '/spj-upah', icon: '💰' });
	}
	if (text.match(/retur|sisa material|drum kosong/)) {
		out.push({ label: 'Retur Material', href: '/mutasi-barang', icon: '🔄' });
	}
	if (text.match(/bast|closing|evaluasi akhir/)) {
		out.push({ label: 'Closing & BAST', href: '/closing-evaluasi-terpusat', icon: '📑' });
	}
	if (text.match(/biaya|kasbon|nota lapangan/)) {
		out.push({ label: 'Biaya Lapangan', href: '/biaya-lapangan', icon: '💵' });
	}

	return out.slice(0, 3);
}

