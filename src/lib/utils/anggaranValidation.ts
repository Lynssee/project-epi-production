// PRJ-25 — validasi pra-kirim form Pengajuan Anggaran lapangan, dikumpulkan SEKALIGUS (bukan alert() satu per satu).
// Fungsi MURNI: aturannya sama dengan rangkaian `if (...) { alert(...); return; }` yang dulu ada di handleSubmit —
// hanya bentuk keluarannya yang berubah (daftar kesalahan dengan anchor field). Aturan baru jangan ditambah di sini
// tanpa persetujuan; rule ini sengaja identik dengan perilaku sebelumnya.

export type Severity = 'error' | 'warning';
export interface FormIssue {
	field: string;
	anchorId: string;
	message: string;
	severity: Severity;
}

export interface ValidationItem {
	name: string;
	price: number | string;
	kategori_item: string;
}

export interface ValidationInput {
	tujuanPengajuan: string;
	atasNama: boolean;
	atasNamaPemohonId: unknown;
	atasNamaAlasan: string;
	penerimaDanaNama: string;
	paymentMethod: string;
	bankName: string;
	bankAccountNumber: string;
	bankAccountName: string;
	items: ValidationItem[];
	mixedRowCount: number;
	categoriesLoaded: boolean;
	selectedCategoryKode: string | null;
	categoryFields: Array<{ field_key: string; field_label: string; field_type: string; is_required?: boolean }>;
	dynamicValues: Record<string, any>;
	isPettyCashCategory: boolean;
	pettyCashFundId: unknown;
	projectRequired: boolean;
	selectedProject: string;
	projectRequiredLabel: string;
	isRilisHutang: boolean;
	hasSelectedPayableInvoice: boolean;
	rilisNominal: number;
	sisaHutang: number;
	needsAttachment: boolean;
	hasLampiran: boolean;
	hasLampiranException: boolean;
	minExceptionNoteLength: number;
	uploadingLampiran: boolean;
	bbmSplitEnabled: boolean;
	bbmSplits: Array<{ project_id?: unknown; persentase?: unknown }>;
	formatCurrency: (n: number) => string;
}

const NUMERIC_NAME = (s: string) => /^[\d.,\s]+$/.test(s) || /^Rp\.?\s*[\d.,]+$/i.test(s);

export function collectErrors(v: ValidationInput): FormIssue[] {
	const out: FormIssue[] = [];
	const err = (field: string, anchorId: string, message: string) => out.push({ field, anchorId, message, severity: 'error' });
	const warn = (field: string, anchorId: string, message: string) => out.push({ field, anchorId, message, severity: 'warning' });

	if (!v.tujuanPengajuan.trim()) err('tujuan', 'f-tujuan', 'Judul pengajuan harus diisi.');
	if (v.atasNama && (!v.atasNamaPemohonId || v.atasNamaAlasan.trim().length < 10)) {
		err('atas_nama', 'f-atasnama', 'Pengajuan atas nama: pilih pemohon (anggota proyek) dan isi alasan darurat minimal 10 karakter.');
	}
	if (!v.penerimaDanaNama.trim()) err('penerima', 'f-penerima', 'Nama penerima dana harus diisi.');
	if (v.paymentMethod === 'Transfer' && (!v.bankName.trim() || !v.bankAccountNumber.trim() || !v.bankAccountName.trim())) {
		err('rekening', 'f-rekening', 'Informasi rekening bank harus diisi lengkap.');
	}

	const valid = v.items.map((it, i) => ({ it, i })).filter(({ it }) => it.name.trim());
	if (valid.length === 0) {
		err('items', 'f-items', 'Minimal 1 rincian item harus diisi.');
	} else {
		for (const { it, i } of valid) {
			if (NUMERIC_NAME(it.name.trim())) {
				err(`item_${i}_nama`, `f-item-${i}`, `Nama item "${it.name}" tidak boleh hanya berupa angka atau nominal. Masukkan nama/deskripsi barang atau jasa (contoh: "Upah SPV", "Semen", "BBM"); nominal di kolom Harga Satuan.`);
			}
		}
		for (const { it, i } of valid) {
			if (!it.price || Number(it.price) <= 0) err(`item_${i}_harga`, `f-item-${i}`, `Harga satuan untuk item "${it.name}" harus lebih dari 0.`);
		}
		const tanpaKategori = valid.filter(({ it }) => !it.kategori_item);
		if (tanpaKategori.length > 0) {
			err('item_kategori', `f-item-${tanpaKategori[0].i}`, `${tanpaKategori.length} rincian item belum dipilih kategorinya. Pilih kategori tiap item agar Finance bisa membukukan ke akun yang benar.`);
		}
	}

	if (v.mixedRowCount > 0) {
		warn('item_campuran', 'f-items', `${v.mixedRowCount} baris tampak berisi lebih dari satu pos biaya. Sebaiknya dipisah (tombol "✂️ Pisahkan Otomatis") agar Finance bisa membukukan ke akun yang benar dan pengajuan tidak tertahan.`);
	}

	if (v.categoriesLoaded && !v.selectedCategoryKode) err('kategori', 'f-kategori', 'Pilih kategori pengajuan terlebih dahulu.');

	for (const f of v.categoryFields) {
		if (!f.is_required) continue;
		const val = v.dynamicValues[f.field_key];
		const empty =
			f.field_type === 'daterange'
				? !val || !val.dari || !val.sampai
				: val === undefined || val === null || val === '' || (typeof val === 'number' && Number.isNaN(val));
		if (empty) err(`dyn_${f.field_key}`, `f-dyn-${f.field_key}`, `Lengkapi "${f.field_label}" pada bagian field tambahan kategori ini.`);
	}

	if (v.isPettyCashCategory && !v.pettyCashFundId) {
		err('pc_fund', 'pc-fund-target', 'Pilih "Dana kas kecil yang diisi ulang" terlebih dahulu. Untuk meminta uang belanja kecil, gunakan menu Kas Kecil, bukan form ini.');
	}
	if (v.projectRequired && !v.selectedProject) err('proyek', 'f-proyek', `Untuk kategori ${v.projectRequiredLabel}, Proyek Terkait wajib dipilih.`);

	if (v.isRilisHutang) {
		if (!v.hasSelectedPayableInvoice) err('rilis_invoice', 'f-rilis', 'Pilih tagihan supplier yang diminta rilis pembayarannya.');
		else if (!v.rilisNominal || v.rilisNominal <= 0) err('rilis_nominal', 'f-rilis', 'Nominal rilis tidak valid.');
		else if (v.rilisNominal > v.sisaHutang) {
			err('rilis_nominal', 'f-rilis', `Nominal rilis (${v.formatCurrency(v.rilisNominal)}) melebihi sisa hutang tagihan ini (${v.formatCurrency(v.sisaHutang)}).`);
		}
	}

	if (v.needsAttachment && !v.hasLampiran && !v.hasLampiranException) {
		err('lampiran', 'f-lampiran', `Kategori Operasional wajib melampirkan minimal 1 dokumen bukti, ATAU isi alasan pengecualian (keterangan minimal ${v.minExceptionNoteLength} karakter) di bawah.`);
	}
	if (v.uploadingLampiran) err('upload', 'f-lampiran', 'Tunggu lampiran selesai diunggah.');

	if (v.bbmSplitEnabled) {
		const total = v.bbmSplits.reduce((s, r) => s + (parseFloat(String(r.persentase)) || 0), 0);
		if (v.bbmSplits.length < 2 || v.bbmSplits.some((r) => !r.project_id) || Math.abs(total - 100) > 0.5) {
			err('bbm_split', 'f-bbm', 'Alokasi split BBM belum valid — pastikan minimal 2 proyek dipilih dan total persentase tepat 100%.');
		}
	}
	return out;
}

export const hasBlockingError = (issues: FormIssue[]) => issues.some((i) => i.severity === 'error');
