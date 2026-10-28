// src/lib/server/aiKnowledgeBase.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiKnowledgeBase.js (erp-epi-1) —
// Knowledge Base / RAG keyword-only, koleksi Directus `ai_knowledge_base` yang
// SAMA (instance dibagi kedua repo). Fase 5, implementation_plan_Modul Asisten AI v3.1.md.

import { directusServerJson } from './directus';

const TOP_K = 3;
const SNIPPET_MAX_LEN = 280;
const CANDIDATE_LIMIT = 20;

interface KbRow {
	id: number;
	title: string;
	category: string;
	content: string;
	keywords: string | null;
}

function tokenize(text: string): string[] {
	return String(text || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 3);
}

function scoreRow(row: KbRow, tokens: string[]): number {
	const haystack = `${row.title || ''} ${row.content || ''} ${row.keywords || ''}`.toLowerCase();
	return tokens.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
}

function snippet(content: string): string {
	const s = String(content || '').trim();
	return s.length > SNIPPET_MAX_LEN ? `${s.slice(0, SNIPPET_MAX_LEN)}…` : s;
}

const BUILTIN_KNOWLEDGE: KbRow[] = [
	// --- Modul Pemasaran & Komersial ---
	{
		id: 101,
		title: 'SOP Digital Asset Management (Marketing DAM)',
		category: 'sop',
		keywords: 'dam digital asset management marketing aset desain brosur catalog katalog brand guidelines guideline logo template materi cetak price list persetujuan approval queue kedaluwarsa expired kategori komersial',
		content:
			'Digital Asset Management (Marketing DAM) diakses di menu Komersial > Marketing DAM (/marketing/assets). Modul ini merupakan repositori terpusat seluruh aset desain & promosi Eltama (brosur, katalog produk cat/alat, brand guidelines, logo, banner, dan price list resmi). Terdiri dari 4 tab utama: 1) Aset: pencarian dan unduh aset aktif berdasarkan kategori, status publikasi, dan akses (publik/rahasia). 2) Persetujuan: antrean verifikasi & approval aset baru oleh manajer sebelum dirilis. 3) Akan Kedaluwarsa: monitoring materi promosi yang mendekati masa habis berlaku (misal price list tahunan/katalog promo) untuk mencegah penyebaran dokumen usang. 4) Kategori: manajemen taksonomi materi desain.'
	},
	{
		id: 102,
		title: 'Panduan Pengelolaan Merchandise & Pameran',
		category: 'manual',
		keywords: 'merchandise pameran souvenir promosi booth expo event expo kalender kaos topi gift packaging komersial marketing',
		content:
			'Pengelolaan souvenir promosi dan inventaris event pameran dikelola di menu Komersial > Merchandise & Pameran (/merchandise). Meliputi katalog merchandise promosi perusahaan (topi, kaos polo, tumbler, kalender, gift set), pencatatan stok tersedia vs terdistribusi ke prospek/klien, serta peminjaman perlengkapan booth pameran/expo.'
	},
	{
		id: 103,
		title: 'Panduan Monitoring Performa Digital Marketing & Konten',
		category: 'manual',
		keywords: 'digital marketing website sosmed media sosial instagram ads iklan meta google analytics linkedin ecommerce traffic posting jadwal konten web content',
		content:
			'Modul Digital Marketing diakses di /digital-marketing. Berfungsi memantau performa kanal digital: 1) Overview & Website: metrik traffic pengunjung, bounce rate, dan konversi web eltamaprimaindo.com via Google Analytics. 2) Media Sosial & LinkedIn: engagement rate, followers growth Instagram/LinkedIn. 3) Iklan (Ads): tracking spend budget vs leads/ROAS. 4) Posting & Web Content: jadwal publikasi konten sosmed dan artikel web. 5) E-Commerce: monitoring etalase marketplace resmi.'
	},
	{
		id: 104,
		title: 'SOP Alur Pipeline CRM & Penjualan Komersial',
		category: 'sop',
		keywords: 'crm sales penjualan pipeline leads prospek quotation penawaran surat penawaran harga so sales order visit survey visit daily customer pelanggan piutang credit limit',
		content:
			'Pengelolaan peluang penjualan dikelola di CRM (/crm) dan Sales (/sales). Alur pipeline: 1) Leads / Prospek masuk di /crm?tab=leads. 2) Tahap Kualifikasi & Survey kebutuhan teknis cat/aplikasi di lapangan (/sales/survey). 3) Penerbitan Quotation (Surat Penawaran Harga resmi) di /crm?tab=quotations atau kalkulator penawaran. 4) Negosiasi & PO Pelanggan diterima -> dibuatkan Sales Order (SO) di /sales/so. Modul Sales juga memantau histori customer, batas kredit (Credit Limit), dan umur piutang dagang (AR).'
	},

	// --- Modul Produksi ---
	{
		id: 105,
		title: 'SOP Alur SPK Produksi & Manajemen Batch Pabrik',
		category: 'sop',
		keywords: 'spk surat perintah kerja produksi alur batch mixing dispersing penimbangan worksheet packaging packing kaleng pail drum requested approved in_progress qc_check completed closed',
		content:
			'Alur SPK Produksi diakses di menu Produksi (/production). Tahapan utama: 1) SPK dibuat (manual atau auto dari SO Customer / kebutuhan restock) status "requested". 2) Pre-check Formula & Ketersediaan Bahan Baku (MRP mengunci stok_terkunci di identitas_barang). 3) Approval SPK -> "approved". 4) Work Sheet Penimbangan & Mixing -> "in_progress". 5) Pemeriksaan QC In-Can & Hasil Uji -> "qc_check". 6) Packaging barang jadi & serah terima gudang -> "completed" / "closed".'
	},
	{
		id: 106,
		title: 'Standar Pengujian QC Cat & Coating (ASTM In-Can & Film Kering)',
		category: 'sop',
		keywords: 'qc quality control pengujian laboratorium parameter uji cat viskositas ku krebs density bj berat jenis ph solid content non-volatile hegman fineness hiding power opacity gloss drying time waktu kering adhesion cross-cut hardness salt spray dft wft',
		content:
			'Standar pengujian mutu cat Eltama: 1) In-Can: Viskositas (KU, ASTM D562, standar 95-115 KU), Density/BJ (g/cm3, ASTM D1475, 1.35-1.55), pH (ASTM E70, 8.0-9.5), Fineness of Grind (Hegman 6-7, ASTM D1210), Solid Content (% wt, ASTM D2369, 45-58%). 2) Film Kering: Hiding Power (>95%, ASTM D2805), Gloss @60 (GU, ASTM D523), Recoat Drying Time (<4 jam, ASTM D1640), Adhesion Cross-Cut (Class 4B-5B, ASTM D3359), Salt Spray (>250 jam, ASTM B117). Pengujian dicatat di /rnd/hasil-uji dan /production?tab=qc.'
	},
	{
		id: 107,
		title: 'Prosedur Rework & Penyesuaian Batch Cat Off-Spec',
		category: 'sop',
		keywords: 'rework off-spec reject penyesuaian batch koreksi viskositas terlalu kental encer warna belang grinding ulang blending perbaikan produksi',
		content:
			'Jika hasil QC batch menyatakan "marginal" atau "gagal", status SPK dialihkan ke Rework (/production?tab=rework). Tindakan koreksi standar: a) Terlalu kental: penambahan solvent terkontrol atau thinner koreksi. b) Terlalu encer: penambahan thickener / rheology modifier bertahap. c) Off-shade warna: penambahan tinting paste/toner sesuai rekomendasi R&D. d) Hegman kasar: re-grinding melalui bead mill/basket mill. Batch rework wajib diuji ulang QC sebelum dirilis.'
	},

	// --- Modul R&D (Research & Development) ---
	{
		id: 108,
		title: 'Struktur Master Formula Cat & Raw Material Costing (RMC) R&D',
		category: 'manual',
		keywords: 'formula master formula cat rmc raw material cost costing komposisi resin binder pigmen extender filler solvent thinner additive bom berat jenis sg batch size versioning revisi rnd',
		content:
			'Master formula dikelola di R&D > Formula (/rnd/formula). Struktur formula cat standar terdiri dari: 1) Resin/Binder (20-40% - pembentuk film & daya rekat), 2) Pigmen & Filler/Extender (30-50% - warna, opacity TiO2, CaCO3, talc, barium sulfate), 3) Solvent/Thinner (10-30% - pelarut xylene, butyl acetate, water), 4) Additive (1-5% - defoamer, dispersant, anti-settling, drier). RMC dihitung otomatis dari HPP bahan baku aktif di /rmc.'
	},
	{
		id: 109,
		title: 'Panduan Troubleshooting 8D & Akar Masalah Komplain Kualitas Cat',
		category: 'sop',
		keywords: 'komplain customer keluhan teknis 8d blistering gelembung peeling mengelupas flaking sagging melorot luntur chalking fish eyes cissing pinholing lambat kering akar masalah solusi perbaikan rnd',
		content:
			'Penanganan komplain teknis kualitas di R&D > Komplain (/rnd/komplain) memakai metode 8D: D0 Registrasi -> D1-D2 Investigasi -> D3 Tindakan Sementara -> D4 Analisis Akar Masalah -> D5-D6 Solusi Permanen -> D7 Pencegahan -> D8 Tutup. Penyebab umum: 1) Blistering: kelembaban tinggi pada substrat / solvent entrapment. 2) Peeling/Flaking: kontaminasi oli/debu pada substrat atau kurang primer. 3) Sagging (melorot): cat terlalu encer atau aplikasi terlalu tebal. 4) Fish Eyes: kontaminasi minyak/silikon pada permukaan sebelum pengecatan.'
	},
	{
		id: 110,
		title: 'Alur Proyek Riset New Product Development (NPD) R&D',
		category: 'sop',
		keywords: 'npd new product development proyek riset produk baru formulasi lab trial batch stability test target launch pic formulator rnd',
		content:
			'Proyek riset produk baru dikelola di R&D > Proyek Riset (/rnd/projects). Tahapan alur NPD: 1) Idea (usulan produk baru / permintaan customer khusus). 2) Development (desain formulasi skala lab). 3) Trial Batch (uji coba batch kecil 1-5 kg). 4) Stability Test (uji penuaan dipercepat / QUV / freeze-thaw). 5) Approved / Launch (rilis formula resmi ke produksi & pembuatan dokumen TDS/MSDS).'
	},
	{
		id: 111,
		title: 'SOP Usulan & Verifikasi Substitusi Bahan Baku Kimia',
		category: 'sop',
		keywords: 'substitusi bahan baku kimia alternatif resin solvent pigmen filler kesetaraan material equivalents cost down kelangkaan stok rnd',
		content:
			'Substitusi bahan baku dikelola di R&D > Substitusi (/rnd/substitution). Digunakan saat terjadi kelangkaan pasokan atau efisiensi biaya. Tim R&D melakukan uji komparatif (viskositas, waktu kering, daya rekat, kestabilan) sebelum menyetujui rasio kesetaraan bahan pengganti.'
	},
	{
		id: 112,
		title: 'SOP Pengecekan & Pengelolaan Dokumen TDS/MSDS',
		category: 'sop',
		keywords: 'tds msds technical data sheet keselamatan spesifikasi teknis produk cat bahan baku formula hasil uji dokumen rnd',
		content:
			'Dokumen TDS (Technical Data Sheet) berisi spesifikasi teknis produk cat (viskositas, densitas, pH, solid content, drying time, gloss, daya sebar). MSDS (Material Safety Data Sheet) memuat data keselamatan GHS 16 seksi. Keduanya diakses di menu R&D > TDS & MSDS (/rnd/tds-msds). Tersedia tombol "Generate TDS Otomatis" dari hasil uji QC dan "Generate MSDS Otomatis" dari formula aktif.'
	},

	// --- Modul Manajemen Proyek Lapangan ---
	{
		id: 113,
		title: 'SOP Manajemen Proyek & Laporan Harian Lapangan (Field Report)',
		category: 'sop',
		keywords: 'proyek project leader lapangan spk proyek rab rap s-curve kurva s progress fisik field report harian logistik packing list manpower timeline adendum',
		content:
			'Manajemen proyek pelapisan cat/coating dikelola di menu Proyek (/proyek / /leader) pada dashboard lapangan (project-epi) dan admin. Alur kerja: 1) Proyek dibuat dari SO Jasa -> penunjukan Project Leader. 2) Penyusunan Rencana Anggaran Biaya (RAB) dan jadwal Timeline / Kurva S. 3) Pengiriman material & alat via Packing List (/packing-list). 4) Project Leader menginput Laporan Harian (Field Report: progres m2, personil kerja, cuaca, kendala di /field-report). 5) Evaluasi berkala RAP vs Aktualisasi Biaya di /rap-aktual.'
	},
	{
		id: 114,
		title: 'Standar QC & Inspeksi Mutu Pengecatan Lapangan (ITP & Blasting/Coating)',
		category: 'sop',
		keywords: 'project quality inspeksi coating blasting itp inspection test plan surface profile anchor pattern dft wft dew point ncr punch list rfi qa qc',
		content:
			'Kontrol kualitas proyek dikelola di menu Inspeksi (/inspection) berdasarkan ITP (Inspection and Test Plan). Tahapan inspeksi: 1) Inspeksi Permukaan: tingkat kebersihan blasting (Sa 2.5) dan profil kekasaran permukaan (anchor profile 40-75 um). 2) Kondisi Lingkungan: suhu substrat min. 3°C di atas Dew Point, kelembaban RH < 85%. 3) Pengukuran Ketebalan: WFT saat aplikasi basah dan DFT film kering sesuai SSPC-PA2. 4) Penerbitan NCR (Non-Conformance Report) untuk ketidaksesuaian dan Punch List sebelum serah terima (BAST).'
	},

	// --- Modul Maintenance & Bengkel Workshop ---
	{
		id: 115,
		title: 'SOP Pemeliharaan Equipment, P2H & Work Order Bengkel',
		category: 'sop',
		keywords: 'maintenance pemeliharaan equipment alat kerja mesin kompresor genset spray pump p2h pemeriksaan harian pm preventive corrective work order wo mtbf mttr bengkel workshop ciketing balaraja',
		content:
			'Pemeliharaan alat kerja & mesin diakses di /maintenance, /perawatan, dan /preventive. Tiga pilar perawatan: 1) P2H (Pemeriksaan & Perawatan Harian): checklist kondisi alat sebelum operasi lapangan oleh mekanik/operator. 2) PM (Preventive Maintenance): servis rutin terjadwal berbasis jam kerja/running hours. 3) Corrective Maintenance: penanganan kerusakan melalui penerbitan tiket Work Order (WO). Keandalan alat diukur dari rasio MTBF (Mean Time Between Failures) dan MTTR (Mean Time To Repair).'
	},
	{
		id: 116,
		title: 'SOP Penanganan Kasus Ganti Rugi Kerusakan Aset (Damage Liability)',
		category: 'sop',
		keywords: 'ganti rugi damage liability aset rusak alat hilang kelalaian investigasi keputusan beban biaya pemotongan gaji cicilan vendor customer',
		content:
			'Penanganan kerusakan/kehilangan aset akibat insiden atau kelalaian dikelola di menu Ganti Rugi Aset (/ganti-rugi). Alur 4 tahap: 1) Kasus Masuk: pelaporan kerusakan/insiden oleh user atau hasil WO bengkel. 2) Investigasi: peninjauan fakta teknis & tingkat kelalaian oleh tim gabungan Maintenance & HRD/GA. 3) Keputusan: penetapan pihak penanggung beban (karyawan, perusahaan, vendor, atau customer). 4) Pelunasan: pelunasan tunai atau skema potong gaji (payroll installment) berkala.'
	},

	// --- Modul HSE (K3 & Lingkungan) ---
	{
		id: 117,
		title: 'SOP Keselamatan, Kesehatan Kerja & Lingkungan (K3 / HSE)',
		category: 'sop',
		keywords: 'hse k3 keselamatan kerja jsa job safety analysis toolbox meeting ptw permit to work izin kerja insiden near miss capa limbah b3 apd smk3 mcu hiradc p2k3',
		content:
			'Sistem Manajemen K3 & Lingkungan dikelola di menu HSE (/hse) dan menu lapangan (/jsa, /toolbox). Prosedur wajib: 1) JSA & Toolbox Meeting: briefing keselamatan harian sebelum pekerjaan site dimulai. 2) Permit to Work (PTW): izin kerja aman untuk risiko tinggi (Hot Work, Confined Space, Ketinggian, Kelistrikan). 3) Pelaporan Insiden & Near-Miss: pelaporan maks 1x24 jam dan tindak lanjut CAPA (Corrective Action). 4) Pengelolaan Limbah B3 (cat bekas, solvent, majun) sesuai manifest lingkungan. 5) Monitoring APD, MCU berkala, evaluasi HIRADC, dan sidang P2K3.'
	},

	// --- Modul Inventory & Pengadaan (Procurement) ---
	{
		id: 118,
		title: 'SOP Manajemen Stok Multi-Gudang & Logistik Surat Jalan',
		category: 'sop',
		keywords: 'inventory stok gudang multi-gudang finish good raw material sparepart stock opname pengeluaran peminjaman surat jalan sji stok kritis reorder packaging barang stock-lapangan',
		content:
			'Manajemen persediaan dikelola di menu /barang, /stock-lapangan, dan /packing-list. Fitur utama: 1) Stok & Multi-Gudang: tracking persediaan di Gudang Pusat, Workshop Ciketing/Balaraja, dan Site Proyek. 2) Stock Opname: rekonsiliasi fisik vs sistem berkala. 3) Reorder Point: peringatan otomatis stok kritis. 4) Keluar Masuk & Logistik: pengeluaran barang berbasis SPK/PR, peminjaman alat, serta penerimaan Surat Jalan (SJI dan manual). 5) Packaging: standar kemasan drum, pail, galon.'
	},
	{
		id: 119,
		title: 'SOP Pengadaan Barang & Jasa (Procurement & Kemitraan)',
		category: 'sop',
		keywords: 'procurement pengadaan pembelian purchase requisition pr rfq penawaran supplier vendor purchase order po control tower goods receipt gr kemitraan subkontraktor requisition',
		content:
			'Pengadaan barang & jasa dikelola di Procurement (/procurement) dan Requisition (/requisition). Alur: 1) Permintaan Pembelian (PR / Requisition) dari departemen/proyek. 2) Permintaan Penawaran (RFQ) & komparasi matriks harga supplier. 3) Penerbitan Purchase Order (PO Supplier) resmi. 4) Control Tower: monitoring estimasi kedatangan & lead time pengiriman. 5) Goods Receipt (GR): penerimaan & verifikasi fisik barang masuk. Kemitraan subkon dikelola di /kemitraan.'
	},

	// --- Modul SDM, Payroll & Portal Karyawan (ESS) ---
	{
		id: 120,
		title: 'SOP HRD, Kebijakan Kontrak PKWT/PKWTT & Penggajian Payroll',
		category: 'sop',
		keywords: 'hrd sdm karyawan absensi geotagging site area payroll gaji lembur kpi sp sanksi disiplin pkwt pkwtt kontrak kerja rekrutmen onboarding',
		content:
			'Manajemen SDM dikelola di menu HRD (/hrga / /manpower). Cakupan: 1) Master Karyawan & Struktur Hirarki. 2) Rekap Absensi: verifikasi presensi harian berbasis koordinat GPS & radius site proyek (/site-checkin). 3) Payroll Terpusat (/payroll-terpusat): kalkulasi gaji pokok, tunjangan, uang makan proyek, lembur terverifikasi, potongan kasbon & PPh21. 4) Kebijakan Kontrak: manajemen masa berlaku PKWT/PKWTT. 5) Evaluasi Kinerja (KPI) dan Sanksi Disiplin (SP 1, 2, 3).'
	},
	{
		id: 121,
		title: 'Panduan Layanan Mandiri Karyawan (Portal Karyawan / ESS)',
		category: 'manual',
		keywords: 'ess portal karyawan mandiri absen masuk pulang cuti izin sakit lembur kasbon reimburse slip gaji pelatihan e-learning kinerja',
		content:
			'Portal Karyawan (Employee Self Service / ESS) diakses di /ess. Fitur mandiri: 1) Presensi: absen masuk & pulang dengan validasi lokasi kamera/GPS. 2) Pengajuan: formulir cuti tahunan, izin sakit, izin per jam, dan lembur. 3) Keuangan: cek saldo & riwayat pinjaman kasbon (/kasbon-terpusat), serta klaim reimbursement biaya. 4) Kinerja & E-Learning: modul pelatihan online mandiri dan penilaian kinerja rekan. 5) Dokumen: unduh slip gaji dan sertifikasi internal.'
	},

	// --- Modul General Affairs (GA) & Fleet Management ---
	{
		id: 122,
		title: 'SOP Operasional General Affairs (GA) & Fleet Kendaraan Logistik',
		category: 'sop',
		keywords: 'ga general affairs mess satpam keamanan consumable fleet armada kendaraan dinas truk booking mobil driver supir surat tugas tracking ekspedisi fleet-booking ga-request ga-checklist',
		content:
			'Operasional GA dan armada kendaraan dikelola di /ga-request, /ga-checklist, /fleet-booking, dan /driver. 1) GA Terpadu: inventaris perlengkapan kantor, pengelolaan mess karyawan proyek/pabrik, jadwal pengamanan satpam, dan tiket permintaan fasilitas (GA Request). 2) Fleet Management: reservasi kendaraan dinas/operasional, jadwal tugas pengemudi (driver), surat tugas pengiriman barang, pemeliharaan berkala STNK/KIR mobil, serta live tracking GPS armada ekspedisi.'
	},

	// --- Modul Legal, Tender & TKDN ---
	{
		id: 123,
		title: 'Panduan Legal, Sertifikasi TKDN & Monitoring Tender LPSE',
		category: 'manual',
		keywords: 'legal legalitas hukum tender lpse e-catalog ecatalog lkpp tkdn sertifikasi kandungan lokal kemitraan mou nda kontrak',
		content:
			'Pengelolaan tender proyek pemerintah dan kepatuhan legal dikelola di menu Legal & Kemitraan (/legal & /kemitraan). Meliputi: 1) TKDN Produk: sertifikasi nilai Tingkat Komponen Dalam Negeri produk cat protective/marine Eltama. 2) e-Catalog LKPP: pendaftaran etalase katalog elektronik pengadaan pemerintah. 3) Tender LPSE: pemantauan peluang lelang proyek BUMN/kementerian. 4) Legal & Partnership: penyimpanan izin usaha, NIB, akta, sertifikat ISO, dan dokumen MoU/NDA kemitraan.'
	},

	// --- Modul Pusat Pengajuan & Approval Terpusat ---
	{
		id: 124,
		title: 'SOP Pusat Pengajuan Anggaran (PA), Requisition & Matriks Approval',
		category: 'sop',
		keywords: 'pusat pengajuan form pengajuan anggaran pa requisition pr pagu anggaran approval persetujuan matriks kewenangan tier level',
		content:
			'Pusat Pengajuan (/pusat-pengajuan / /anggaran) mengatur seluruh permohonan biaya dan barang. Alur: 1) User membuat Pengajuan Anggaran (PA) di /anggaran atau Permintaan Barang (Requisition) di /requisition. 2) Sistem memeriksa ketersediaan Pagu Anggaran proyek/departemen. 3) Permohonan otomatis masuk ke Inbox Approval atasan sesuai Matriks Kewenangan (Tier 1 Leader -> Tier 2 Manager -> Tier 3 Direktur / Finance) dengan jejak audit riwayat persetujuan digital.'
	},

	// --- Modul Dokumen, E-Signature & Keamanan ---
	{
		id: 125,
		title: 'Panduan Arsip Dokumen Digital & Tanda Tangan Elektronik (E-Signature)',
		category: 'manual',
		keywords: 'dokumen arsip digital e-signature tanda tangan signature inbox kiosk verify qr code sertifikat keaslian',
		content:
			'Pengarsipan dan validasi dokumen resmi diakses di menu dokumen dan tanda tangan. Dokumen yang memerlukan persetujuan legal ditandatangani secara digital dengan enkripsi QR code. Setiap pihak penerima dapat memverifikasi keaslian dokumen di /verify/[nomor] untuk melihat stempel waktu dan sertifikat audit trail penandatanganan.'
	}
];

/** Cari entri basis pengetahuan relevan, format siap-sisip ke system prompt. '' bila tak ada/gagal. */
export async function getKnowledgeContext(userMessage: string, targetApp: 'admin' | 'field'): Promise<string> {
	const tokens = [...new Set(tokenize(userMessage))].slice(0, 6);
	if (!tokens.length) return '';

	let rows: KbRow[] = [];
	try {
		const filter = {
			_and: [
				{ is_active: { _eq: true } },
				{ _or: [{ target_app: { _eq: targetApp } }, { target_app: { _eq: 'both' } }] },
				{ _or: tokens.flatMap((t) => [{ title: { _icontains: t } }, { content: { _icontains: t } }, { keywords: { _icontains: t } }]) }
			]
		};
		const qs = new URLSearchParams({
			filter: JSON.stringify(filter),
			fields: 'id,title,category,content,keywords',
			limit: String(CANDIDATE_LIMIT)
		});
		const res = await directusServerJson<{ data?: KbRow[] }>(`/items/ai_knowledge_base?${qs.toString()}`);
		rows = res?.data || [];
	} catch (e: any) {
		console.error('[aiKnowledgeBase] gagal mencari Directus (fallback ke built-in):', e?.message);
	}

	const relevantBuiltin = BUILTIN_KNOWLEDGE.filter((b) => scoreRow(b, tokens) > 0);
	const combined = [...rows, ...relevantBuiltin];
	if (!combined.length) return '';

	const top = combined
		.map((r) => ({ row: r, score: scoreRow(r, tokens) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, TOP_K);
	if (!top.length) return '';

	const lines = top.map(({ row }, i) => `${i + 1}. [${row.title}] ${snippet(row.content)} (referensi: Knowledge Base > "${row.title}")`);
	return `Basis pengetahuan terkait (SOP/manual/FAQ internal — gunakan bila relevan, sebutkan referensinya):\n${lines.join('\n')}`;
}
