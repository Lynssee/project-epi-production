// src/lib/data/foxapaintPresets.ts
// Modul Foxapaint Lapangan: Preset standar kimiawi untuk fallback spesifikasi aplikasi lapangan.
// Digunakan saat produk belum memiliki record di foxapaint_product_specs Directus agar tim
// lapangan tetap mendapatkan panduan aplikasi, rasio thinner, dan daya sebar yang aman & presisi.

export interface FoxapaintProductSpec {
	product_category: string | null;
	resin_type: string | null;
	recommended_use: string | null;
	application_method: string[] | null;
	surface_preparation: string | null;
	storage_conditions: string | null;
	shelf_life_months: number | null;
	thinner_type: string | null;
	thinning_ratio: string | null;
	overcoating_min_hours: number | null;
	overcoating_max_hours: number | null;
	flash_point_celsius: number | null;
	coverage_sqm_per_liter: number | null;
	sumber_data: string | null;
}

export const FOXAPAINT_PRESET_SPECS: Record<string, FoxapaintProductSpec> = {
	zinc: {
		product_category: 'Zinc-Rich Epoxy Anti-Corrosive Primer',
		resin_type: 'Zinc Dust Epoxy Primer (>75% Metallic Zinc)',
		recommended_use: 'Primer utama perlindungan galvanis aktif/katodik pada struktur baja kapal, kilang lepas pantai, tiang pancang, pipa bawah tanah, dan jembatan area salinitas tinggi.',
		application_method: ['Airless Spray', 'Kuas'],
		thinner_type: 'Foxathinner 100 (Khusus Epoxy)',
		thinning_ratio: 'Maksimal 5% - 10% (hindari pengenceran berlebih agar suspensi zinc tidak drop)',
		shelf_life_months: 12,
		overcoating_min_hours: 4,
		overcoating_max_hours: null,
		flash_point_celsius: 25,
		coverage_sqm_per_liter: 7.0,
		surface_preparation: 'Grit/Sandblasting wajib Sa 2.5 (ISO 8501-1) dengan profil kekasaran tajam 50-75 µm. Bebas garam dan kelembapan.',
		storage_conditions: 'Simpan di ruangan sejuk dan kering. Aduk merata secara berkala saat aplikasi agar partikel zinc tidak mengendap.',
		sumber_data: 'rekomendasi_standar'
	},
	heat_resistant: {
		product_category: 'High-Temperature Silicone Coating',
		resin_type: 'Silicone Resin / Ceramic Pigmented',
		recommended_use: 'Cat pelindung permukaan logam bersuhu tinggi: cerobong asap pabrik (chimney), pipa uap/boiler, exhaust manifold, ruang bakar, dan perpipaan gas buang.',
		application_method: ['Semprotan Udara', 'Airless Spray', 'Kuas'],
		thinner_type: 'Foxathinner HR (Khusus Heat Resistant)',
		thinning_ratio: '5% - 10% maksimum',
		shelf_life_months: 24,
		overcoating_min_hours: 12,
		overcoating_max_hours: null,
		flash_point_celsius: 27,
		coverage_sqm_per_liter: 8.0,
		surface_preparation: 'Sandblasting Sa 2.5 sangat direkomendasikan untuk memastikan adhesi pada pemuaian termal suhu tinggi.',
		storage_conditions: 'Simpan di ruangan sejuk dan kering, hindari panas berlebih sebelum pengaplikasian.',
		sumber_data: 'rekomendasi_standar'
	},
	polyurethane: {
		product_category: 'Aliphatic Acrylic Polyurethane Finish Coating',
		resin_type: 'Aliphatic Polyurethane (Acrylic-Polyurethane)',
		recommended_use: 'Cat akhir (topcoat) premium dengan ketahanan cuaca & sinar UV tinggi untuk baja struktural luar ruangan, tangki, pipa industri, jembatan, armada, dan alat berat.',
		application_method: ['Airless Spray', 'Semprotan Udara', 'Roller'],
		thinner_type: 'Foxathinner 300 (Khusus PU)',
		thinning_ratio: '5% - 15% sesuai kebutuhan viskositas semprot',
		shelf_life_months: 24,
		overcoating_min_hours: 6,
		overcoating_max_hours: 48,
		flash_point_celsius: 28,
		coverage_sqm_per_liter: 10.0,
		surface_preparation: 'Permukaan harus sudah dilapisi Epoxy Intermediate/Primer yang telah bersih, kering, dan bebas minyak sebelum overcoating interval terlampaui.',
		storage_conditions: 'Kemasan harus selalu tertutup rapat (sensitif terhadap kelembapan udara). Simpan di suhu 20°C - 30°C.',
		sumber_data: 'rekomendasi_standar'
	},
	epoxy: {
		product_category: 'Epoxy Floor & Heavy-Duty Protective Coating',
		resin_type: 'Polyamide Cured Epoxy Resin (Bisphenol-A)',
		recommended_use: 'Pelapis lantai beton industri, pabrik, gudang, koridor rumah sakit, fasilitas pengolahan makanan, serta struktur baja berat di lingkungan korosif sedang-tinggi.',
		application_method: ['Airless Spray', 'Kuas', 'Roller'],
		thinner_type: 'Foxathinner 100 (Khusus Epoxy)',
		thinning_ratio: '5% - 10% (Airless Spray), 10% - 15% (Kuas / Roller)',
		shelf_life_months: 24,
		overcoating_min_hours: 8,
		overcoating_max_hours: 72,
		flash_point_celsius: 30,
		coverage_sqm_per_liter: 8.5,
		surface_preparation: 'Baja: Sandblasting Sa 2.5 (ISO 8501-1) dengan profil kekasaran 40-60 µm. Beton: Curing minimal 28 hari, kadar air < 4%, bebas debu, minyak, dan laitance.',
		storage_conditions: 'Simpan di tempat kering, berventilasi baik, suhu 15°C - 30°C, jauh dari paparan sinar matahari langsung dan percikan api.',
		sumber_data: 'rekomendasi_standar'
	},
	alkyd_primer: {
		product_category: 'Alkyd Anti-Corrosive Primer',
		resin_type: 'Modified Alkyd Resin (Zinc Phosphate Pigmented)',
		recommended_use: 'Primer dasar anti-karat ekonomis untuk konstruksi baja ringan, pintu pagar, teralis jendela, kusen besi, dan perakitan logam industri ringan.',
		application_method: ['Kuas', 'Semprotan Udara', 'Roller'],
		thinner_type: 'Foxathinner 50 (Khusus Alkyd/Synthetic)',
		thinning_ratio: '5% - 15% berdasarkan metode penguasan/penyemprotan',
		shelf_life_months: 24,
		overcoating_min_hours: 8,
		overcoating_max_hours: null,
		flash_point_celsius: 38,
		coverage_sqm_per_liter: 10.0,
		surface_preparation: 'Bersihkan kotoran minyak/gemuk (SSPC-SP 1), hilangkan karat dengan sikat kawat manual/mekanik (St 2 / St 3).',
		storage_conditions: 'Tutup kaleng rapat setelah dibuka, simpan di ruang berventilasi baik suhu 20°C - 35°C.',
		sumber_data: 'rekomendasi_standar'
	},
	acrylic: {
		product_category: 'Acrylic Thermoplastic Finish Coating',
		resin_type: 'Acrylic Thermoplastic',
		recommended_use: 'Cat pelindung luar ruangan cepat kering untuk dinding beton, permukaan logam ringan, marka jalan (roadline), serta ornamen arsitektural.',
		application_method: ['Semprotan Udara', 'Kuas', 'Roller'],
		thinner_type: 'Foxathinner 200 (Khusus Acrylic)',
		thinning_ratio: '10% - 20% berdasarkan metode penguasan atau nozzle semprot',
		shelf_life_months: 24,
		overcoating_min_hours: 4,
		overcoating_max_hours: null,
		flash_point_celsius: 26,
		coverage_sqm_per_liter: 9.0,
		surface_preparation: 'Permukaan bersih dari debu, kotoran, jamur, lumut, minyak, dan cat lama yang mengelupas.',
		storage_conditions: 'Simpan di suhu ruang (maksimal 32°C), sirkulasi udara lancar, terlindung dari sinar matahari langsung.',
		sumber_data: 'rekomendasi_standar'
	},
	generic: {
		product_category: 'Industrial Protective Coating',
		resin_type: 'Generic Acrylic / Alkyd Resin',
		recommended_use: 'Sebagai cat dasar atau cat akhir pelindung untuk permukaan besi, baja konstruksi umum, kayu, dan beton pada lingkungan industri sedang.',
		application_method: ['Kuas', 'Roller', 'Semprotan Udara'],
		thinner_type: 'Foxathinner GP',
		thinning_ratio: '5% - 15% berdasarkan metode aplikasi',
		shelf_life_months: 24,
		overcoating_min_hours: 6,
		overcoating_max_hours: null,
		flash_point_celsius: 27,
		coverage_sqm_per_liter: 9.0,
		surface_preparation: 'Permukaan kering, bersih, bebas debu, minyak, karat lepas, dan kontaminan lainnya.',
		storage_conditions: 'Simpan di area beratap dengan sirkulasi udara baik, jauh dari sumber api terbuka.',
		sumber_data: 'rekomendasi_standar'
	}
};

/**
 * Deteksi cerdas sistem kimiawi produk berdasarkan nama kode dan kategori QC.
 * Mengembalikan preset spesifikasi yang tepat untuk acuan teknis lapangan jika belum ada data lab.
 */
export function detectPresetSpec(namaKode: string, kategoriQc?: string | null): FoxapaintProductSpec {
	const text = `${namaKode || ''} ${kategoriQc || ''}`.toLowerCase();

	// 1. Zinc-Rich Primer
	if (text.includes('zinc') || text.includes('katodik') || text.includes('galvanis') || text.includes('anode')) {
		return { ...FOXAPAINT_PRESET_SPECS.zinc };
	}

	// 2. Heat Resistant (Silicone)
	if (text.includes('heat') || text.includes('silicone') || text.includes('tahan panas') || text.includes('chimney') || text.includes('exhaust')) {
		return { ...FOXAPAINT_PRESET_SPECS.heat_resistant };
	}

	// 3. Polyurethane (PU Topcoat)
	if (
		text.includes('polyurethane') ||
		text.includes('pu ') ||
		text.includes('pu-') ||
		text.includes('aliphatic') ||
		text.includes('pu_topcoat') ||
		text.includes('topcoat')
	) {
		return { ...FOXAPAINT_PRESET_SPECS.polyurethane };
	}

	// 4. Epoxy (2K Floor, Heavy Duty, Lining, etc)
	if (
		text.includes('ecc') ||
		text.includes('epoxy') ||
		text.includes('foxachem') ||
		text.includes('ep-') ||
		text.includes('ep ') ||
		text.includes('floor') ||
		text.includes('sl ') ||
		text.includes('self leveling') ||
		text.includes('coal tar') ||
		text.includes('coaltar') ||
		text.includes('tank lining') ||
		text.includes('hardener') ||
		text.includes('polyamide')
	) {
		return { ...FOXAPAINT_PRESET_SPECS.epoxy };
	}

	// 5. Alkyd Primer
	if (
		text.includes('alkyd') ||
		text.includes('synthetic') ||
		text.includes('sintetik') ||
		text.includes('enamel') ||
		text.includes('cat minyak') ||
		text.includes('primer besi')
	) {
		return { ...FOXAPAINT_PRESET_SPECS.alkyd_primer };
	}

	// 6. Acrylic Finish
	if (text.includes('acrylic') || text.includes('akrilik') || text.includes('roadline') || text.includes('marka')) {
		return { ...FOXAPAINT_PRESET_SPECS.acrylic };
	}

	// Fallback umum industri
	return { ...FOXAPAINT_PRESET_SPECS.generic };
}
