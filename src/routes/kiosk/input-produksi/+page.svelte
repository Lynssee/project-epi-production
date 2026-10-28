<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		enqueueProduksiSubmission,
		getQueuedProduksiSubmissions,
		flushProduksiQueue,
		registerProduksiAutoFlush,
		PermanentQueueError,
		recordGagalPermanen,
		getGagalPermanenEntries,
		clearGagalPermanenEntry,
		type QueuedProduksiSubmission,
		type GagalProduksiEntry
	} from '$lib/utils/offlineKioskProduksiQueue';
	// Fase 3 (rencana Draf Otomatis Universal v2) — rute pilot Lapis 1.
	import { autoDraft, clearAutoDraft } from '$lib/utils/autoDraft';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';
	import { TEKS_PRODUKSI } from '$lib/kiosk/teks';
	import KioskNumberField from '$lib/components/kiosk/KioskNumberField.svelte';
	import SisaBatchCard from '$lib/components/kiosk/SisaBatchCard.svelte';
	import { isSatuanDesimal } from '$lib/components/kiosk/kioskNumpad';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCheck,
		IconAlertTriangle,
		IconPackage,
		IconTrash,
		IconFileText,
		IconRefresh,
		IconBarcode
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let loadingSpkDetail = $state(false);
	let spkList = $state<any[]>([]);
	let spkId = $state<number | null>(null);
	let selectedSpkInfo = $state<any | null>(null);

	// Fase 6 (correction_plan_antrean-packing-list-gudang-terpotong, B1) — dulu daftar SPK
	// dibatasi 20 (dari /api/kiosk/home) dan kolom cari HANYA menyaring 20 itu di klien,
	// sehingga SPK ke-21 dst tidak pernah bisa ditemukan walau statusnya aktif. Sekarang
	// search & "Muat lebih banyak" memanggil /api/kiosk/spk (server-side, tidak dibatasi 20).
	const PAGE_SIZE = 20;
	let spkTotal = $state(0);
	let spkError = $state(false);
	let spkOffset = $state(0);
	let searchLoading = $state(false);
	let loadingMore = $state(false);
	let searchTerm = $state('');
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	async function fetchSpkPage(opts: { q?: string; offset?: number; append?: boolean } = {}) {
		const { q = '', offset = 0, append = false } = opts;
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), kelompok: 'berjalan' });
		if (q.trim().length >= 2) params.set('q', q.trim());
		try {
			const res = await fetch(`/api/kiosk/spk?${params.toString()}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			spkList = append ? [...spkList, ...(data.data || [])] : data.data || [];
			spkTotal = data.total ?? spkList.length;
			spkOffset = offset;
			spkError = false;
		} catch (e) {
			// Kegagalan search/load-more TIDAK menimpa spkList yang sudah ada -- operator tetap
			// bisa pakai daftar terakhir yang berhasil dimuat, bukan tiba-tiba kosong.
			spkError = true;
		}
	}

	// File 03 §3.3 — SPK yang belum "Mulai Produksi" (bahan belum dipotong dari stok, keputusan
	// Lead opsi b). Tampil abu-abu, tidak bisa dipilih, dengan tombol "Minta Mulai Produksi".
	let spkBelumMulai = $state<any[]>([]);
	let belumMulaiOpen = $state(false);
	let mintaMulaiBusyId = $state<number | null>(null);
	let mintaMulaiDone = $state<Set<number>>(new Set());

	async function fetchSpkBelumMulai() {
		try {
			const res = await fetch('/api/kiosk/spk?kelompok=belum_mulai&limit=50');
			if (!res.ok) return;
			const data = await res.json();
			spkBelumMulai = data.data || [];
		} catch {
			/* non-fatal — bagian ini murni informasional */
		}
	}

	async function mintaMulaiProduksi(spk: any) {
		mintaMulaiBusyId = spk.id;
		try {
			const res = await fetch('/api/kiosk/spk/minta-mulai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ spkId: spk.id })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				showScanFeedback('err', data?.message || 'Gagal mengirim permintaan. Coba lagi.');
				return;
			}
			mintaMulaiDone = new Set([...mintaMulaiDone, spk.id]);
			showScanFeedback('ok', 'Supervisor sudah diberi tahu. Tunggu sampai SPK pindah ke daftar atas.');
		} catch {
			showScanFeedback('err', 'Gagal terhubung ke server. Coba lagi.');
		} finally {
			mintaMulaiBusyId = null;
		}
	}

	function handleSearchInput() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(async () => {
			searchLoading = true;
			const term = searchTerm.trim();
			if (term.length >= 2) {
				await fetchSpkPage({ q: term, offset: 0 });
			} else {
				// Kata kunci dikosongkan/terlalu pendek -- kembali ke 20 SPK terbaru (bukan hasil
				// pencarian lama yang nyangkut).
				await fetchSpkPage({ offset: 0 });
			}
			searchLoading = false;
		}, 300);
	}

	async function loadMoreSpk() {
		loadingMore = true;
		await fetchSpkPage({ q: searchTerm, offset: spkOffset + PAGE_SIZE, append: true });
		loadingMore = false;
	}

	async function retryLoadSpk() {
		loading = true;
		await fetchSpkPage({ q: searchTerm, offset: 0 });
		loading = false;
	}

	// Fase 3D — shift operator hari ini (read-only, diresolusi server dari shift_roster).
	// "Bukan shift saya?" membuka pilihan manual dari daftar jadwal_kerja lengkap.
	let shiftInfo = $state<{ jadwalKerjaId: string | null; namaJadwal: string | null; jamMasuk: string | null; jamKeluar: string | null } | null>(null);
	let jadwalKerjaOptions = $state<any[]>([]);
	let showShiftOverride = $state(false);
	let jadwalKerjaIdOverride = $state('');

	// Fase 3C — toggle "Batch Tuntas". Kunci ganda: hanya bisa dicentang bila kumulatif > 0
	// (newCumulative, dihitung di bawah), dan WAJIB konfirmasi kedua lewat modal sebelum aktif.
	let markComplete = $state(false);
	let showMarkCompleteConfirm = $state(false);

	// Fase 4B — mesin yang dipakai. TIDAK diturunkan dari master_workstation (tidak ada relasi
	// workstation->equipment di skema live, koreksi rencana lama) -- operator memilih sekali,
	// tersimpan di perangkat ini, dan otomatis terisi untuk sesi-sesi berikutnya.
	// M4 (file 04 §2.5) — dulu key localStorage sama untuk SEMUA operator di perangkat ini,
	// jadi operator shift berikutnya "mewarisi" mesin terakhir yang dipilih orang lain tanpa
	// sadar. Sekarang per-karyawan: `epi_kiosk_produksi_equipment_id:<karyawanId>`.
	const EQUIPMENT_STORAGE_PREFIX = 'epi_kiosk_produksi_equipment_id';
	let karyawanId = $state<number | null>(null);
	let equipmentOptions = $state<{ id: string; code: string; name: string }[]>([]);
	let equipmentId = $state('');
	let showEquipmentPicker = $state(false);

	function equipmentStorageKey(): string | null {
		return karyawanId ? `${EQUIPMENT_STORAGE_PREFIX}:${karyawanId}` : null;
	}

	// Fase 4A — cetak label. Reuse generator HTML yang sudah ada di erp-epi-1 lewat proxy
	// kiosk (lihat api/kiosk/print-label) -- label hanya masuk akal untuk SPK yang baru saja
	// masuk antrean QC/selesai, jadi tombol ini hanya muncul setelah markComplete sukses.
	let printingLabel = $state(false);
	// File 12 §C — qty label dulu hardcode 10; sekarang operator memilih dulu (5/10/20/lainnya)
	// SEBELUM mencetak.
	let showLabelQtyPicker = $state(false);
	let labelQty = $state(10);
	let labelQtyCustom = $state('');

	// R7 — jumlah entri tertunda di antrian offline perangkat ini (lihat offlineKioskProduksiQueue.ts).
	let queuedCount = $state(0);
	// File 03 §3.7 — entri yang gagal PERMANEN (server menolak tegas, mis. SPK sudah ditutup).
	// Ditampilkan terpisah dari "tertunda" supaya operator tahu ini TIDAK akan terkirim sendiri.
	let gagalEntries = $state<GagalProduksiEntry[]>([]);
	let showGagalList = $state(false);
	let unregisterAutoFlush: (() => void) | null = null;

	let outputKg = $state('');
	let rejectKg = $state('');
	let wasteKg = $state('');
	let catatan = $state('');
	let submitting = $state(false);
	// Fase 3 (rencana Draf Otomatis Universal v2) — banner pemulihan Lapis 1. Krusial
	// di Kiosk: operator lapangan tidak bisa "ketik ulang cepat" seperti di desktop.
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);
	let errorMsg = $state('');
	let showSuccess = $state(false);
	let successData = $state<any | null>(null);

	let redirectTimer: ReturnType<typeof setTimeout> | null = null;
	let countdown = $state(3);
	let countdownInterval: ReturnType<typeof setInterval> | null = null;
	// Fase 4A — teks tombol "Kembali ke Beranda" berhenti menghitung mundur begitu redirect
	// otomatis dibatalkan (operator menekan Cetak Label).
	let autoRedirectCancelled = $state(false);

	// Bug 4 — idempotensi submit. Satu UUID per pengisian form, dibuat SEKALI saat SPK dipilih
	// dan baru diganti setelah simpan berhasil. Tanpa ini, retry/tekan-2x membuat baris ganda
	// di spk_daily_log (field unique `client_txn_id` dulu diisi server, jadi tidak pernah menahan).
	let clientTxnId = $state('');

	// Bug 5 — umpan balik hasil scan barcode di halaman ini (lihat handleHardwareScan).
	let scanFeedback = $state<{ tone: 'ok' | 'err'; msg: string } | null>(null);
	let scanFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

	// Fase 2A — klasifikasi alasan reject/waste. Opsi dari system_settings (via selectedSpkInfo),
	// TIDAK diwajibkan — field Directus-nya nullable (Aturan #3, tidak retroaktif ke baris lama).
	let rejectReasons = $state<string[]>([]);
	let wasteReasons = $state<string[]>([]);

	function toggleReason(list: 'reject' | 'waste', reason: string) {
		if (list === 'reject') {
			rejectReasons = rejectReasons.includes(reason)
				? rejectReasons.filter((r) => r !== reason)
				: [...rejectReasons, reason];
		} else {
			wasteReasons = wasteReasons.includes(reason)
				? wasteReasons.filter((r) => r !== reason)
				: [...wasteReasons, reason];
		}
	}

	// Fase 2B — peringatan over-production. Ambang dari system_settings (default 15%). Modal
	// konfirmasi dengan tombol default "Batal" — server TETAP menyimpan & menandai bila operator
	// melanjutkan (Aturan #6: jangan mematikan jalur input), jadi ini jeda-pikir, bukan gate keras.
	let showOverproductionConfirm = $state(false);

	/** Bug 6 — tampilan angka kg. Bulatkan 2 desimal, buang trailing zero, aman terhadap null.
	 *  `spk.quantity` datang dari Directus sebagai string float mentah (mis. "45.7142857142857"). */
	function fmtKg(n: unknown): string {
		const v = Number(n);
		if (!Number.isFinite(v)) return '0';
		return String(Math.round(v * 100) / 100);
	}

	// M2 (file 04 §2.3) — beda "belum diisi" vs "diisi 0". `outputKg` bertipe string ('' saat
	// kosong), jadi ini TIDAK sama dengan `!outputKg` yang juga true untuk "0".
	let outputKosong = $derived(outputKg === '' || outputKg === null || outputKg === undefined);
	// Computed stats
	let numOutput = $derived(Number(outputKg) || 0);
	let numReject = $derived(Number(rejectKg) || 0);
	let numWaste = $derived(Number(wasteKg) || 0);
	let totalInput = $derived(Math.round((numOutput + numReject + numWaste) * 100) / 100);
	// Bug 9 — jangan tampilkan 100% saat form masih kosong; itu menyesatkan operator.
	let hasInput = $derived(totalInput > 0);
	let yieldPct = $derived(hasInput ? Math.round((numOutput / totalInput) * 1000) / 10 : null);

	let newCumulative = $derived(
		selectedSpkInfo ? (selectedSpkInfo.kumulatifOutput || 0) + numOutput : numOutput
	);
	let targetKg = $derived(selectedSpkInfo ? selectedSpkInfo.targetKg || 0 : 0);
	let newProgressPct = $derived(
		targetKg > 0 ? Math.min(100, Math.round((newCumulative / targetKg) * 1000) / 10) : 0
	);

	// Fase 2B — ambang toleransi dari system_settings (dikirim GET /api/kiosk/produksi).
	let overproductionTolerancePct = $derived(selectedSpkInfo?.overproductionTolerancePct ?? 15);
	let willOverproduce = $derived(
		targetKg > 0 && newCumulative > targetKg * (1 + overproductionTolerancePct / 100)
	);
	let overproducePct = $derived(
		targetKg > 0 ? Math.round(((newCumulative - targetKg) / targetKg) * 1000) / 10 : 0
	);

	// Bug 8 — satuan diambil dari SPK, bukan dikunci "kg". Data prod memuat "KG" maupun "kg"
	// pada SPK berbeda, jadi sekalian diseragamkan tampilannya.
	let unitLabel = $derived(String(selectedSpkInfo?.spk?.unit || 'kg').toLowerCase());
	// File 11 §5 — numpad layar mengizinkan koma hanya untuk satuan yang lazim desimal (kg/liter/dst).
	let desimalAktif = $derived(isSatuanDesimal(unitLabel));

	// Bug 7 — langkah tombol cepat mengikuti skala target SPK. Pabrik menjalankan SPK lab 0.2 kg
	// sampai batch 110 kg di saat bersamaan; tombol tetap +10/+50/+100/+500 berarti sekali tekan
	// bisa 5000% dari target. Reject & waste memakai skala yang sama — pada SPK 0.2 kg, "+1"
	// reject juga sudah 500% dari seluruh batch.
	let quickAddSteps = $derived(
		targetKg > 0 && targetKg < 1
			? [0.01, 0.05, 0.1, 0.5]
			: targetKg > 0 && targetKg < 5
				? [0.1, 0.5, 1, 2]
				: targetKg > 0 && targetKg < 50
					? [1, 5, 10, 25]
					: [5, 10, 50, 100]
	);

	function showScanFeedback(tone: 'ok' | 'err', msg: string) {
		scanFeedback = { tone, msg };
		if (scanFeedbackTimer) clearTimeout(scanFeedbackTimer);
		scanFeedbackTimer = setTimeout(() => (scanFeedback = null), 3500);
	}

	/** Bug 5 — kiosk/+layout.svelte menyiarkan setiap hasil scan sebagai event `kiosk-hardware-scan`,
	 *  dan bila TIDAK ADA yang menanganinya layout memaksa pindah ke /kiosk/cek-stok. Halaman ini
	 *  dulu tidak mendengarkan sama sekali, jadi satu pindaian tak sengaja membuang seluruh isian
	 *  operator tanpa peringatan. Handler ini SELALU preventDefault() supaya redirect itu batal. */
	/** H11 (file 03 §3.6) — dulu hanya mencari di spkList (20 baris pertama). SPK ke-21 dst
	 *  yang statusnya aktif dibalas "bukan SPK aktif" walau sebenarnya ada. Sekarang jatuh ke
	 *  server (mencakup seluruh SPK berjalan) kalau tidak ditemukan lokal. */
	async function cariSpkUntukScan(code: string, parsed: ReturnType<typeof parseEpiQr>) {
		let target =
			parsed?.type === 'SPK'
				? spkList.find((s) => String(s.id) === String(parsed.id)) || spkBelumMulai.find((s) => String(s.id) === String(parsed.id))
				: spkList.find((s) => String(s.nomor || '').toUpperCase() === code.toUpperCase()) ||
					spkBelumMulai.find((s) => String(s.nomor || '').toUpperCase() === code.toUpperCase());
		if (target) return target;
		const qs = parsed?.type === 'SPK' ? `id=${parsed.id}` : `q=${encodeURIComponent(code)}&limit=1`;
		const res = await fetch(`/api/kiosk/spk?${qs}`).catch(() => null);
		const row = res?.ok ? (await res.json())?.data?.[0] : null;
		return row || null;
	}

	function handleHardwareScan(ev: Event) {
		ev.preventDefault();
		const code = String((ev as CustomEvent).detail?.code || '').trim();
		if (!code) return;

		// Fase 3B — format resmi lembar SPK: EPI:SPK:<id>:<token> (dicetak Work Sheet
		// erp-epi-1, K3), lewat parseEpiQr yang sama dipakai seluruh label EPI lain —
		// bukan regex lokal per halaman. Nomor SPK polos (mis. RSPK260911848) tetap
		// diterima sebagai fallback supaya lembar lama tanpa QR tetap bisa dipindai/diketik.
		const parsed = parseEpiQr(code);

		cariSpkUntukScan(code, parsed).then((target) => {
			if (!target) {
				showScanFeedback('err', `Kode "${code}" bukan SPK aktif. Isian Anda aman, silakan lanjut.`);
				return;
			}
			if (target.status && target.status !== 'in_progress') {
				showScanFeedback(
					'err',
					`SPK ${target.nomor} belum dimulai. Tekan "Minta Mulai Produksi" di bagian bawah daftar.`
				);
				return;
			}
			if (spkId === target.id) {
				showScanFeedback('ok', `SPK ${target.nomor} memang sudah terpilih.`);
				return;
			}
			if (hasInput) {
				showScanFeedback('err', `Isian belum disimpan. Tekan "Ganti SPK" dulu bila mau pindah ke ${target.nomor}.`);
				return;
			}
			showScanFeedback('ok', `SPK ${target.nomor} terpilih dari hasil scan.`);
			selectSpk(target.id);
		});
	}

	onMount(async () => {
		window.addEventListener('kiosk-hardware-scan', handleHardwareScan);
		try {
			const res = await fetch('/api/kiosk/home');
			if (res.ok) {
				const data = await res.json();
				karyawanId = data.karyawan?.id ?? null;
				// M4 — mesin terakhir yang dipilih operator INI (bukan per perangkat).
				try {
					const key = equipmentStorageKey();
					equipmentId = key ? localStorage.getItem(key) || '' : '';
				} catch {
					/* localStorage tidak tersedia (mode privat dsb) — operator pilih manual tiap sesi */
				}
				// Fase 3D — shift hari ini, sekali per kunjungan halaman.
				shiftInfo = data.shift || null;
				jadwalKerjaOptions = data.jadwalKerjaOptions || [];
				// Fase 4B — daftar mesin produksi.
				equipmentOptions = data.equipmentOptions || [];
			}
			// File 03 §3.3 — daftar SPK sendiri sekarang lewat /api/kiosk/spk (kelompok berjalan
			// utama, belum_mulai terpisah), bukan lagi dari /api/kiosk/home.
			await Promise.all([fetchSpkPage({ offset: 0 }), fetchSpkBelumMulai()]);
			// B1 — auto-pilih hanya bila BENAR-BENAR cuma satu SPK "berjalan" secara total (bukan
			// cuma satu di 20 yang dimuat, dan HANYA dari kelompok berjalan — bukan yang belum
			// dimulai), supaya operator tidak "terjebak" di satu SPK saat sebenarnya ada 2+.
			if (spkTotal === 1 && spkList.length === 1) {
				await selectSpk(spkList[0].id);
			}
		} finally {
			loading = false;
		}

		// R7 — antrian offline: hitung sisa tertunda, coba kirim ulang kalau online, dan
		// pasang auto-flush untuk saat sinyal kembali sementara operator masih di halaman ini.
		gagalEntries = getGagalPermanenEntries();
		await refreshQueuedCount();
		unregisterAutoFlush = registerProduksiAutoFlush(async (entry) => {
			await sendQueuedProduksi(entry);
			await refreshQueuedCount();
		});
		if (navigator.onLine && queuedCount > 0) {
			const hasil = await flushProduksiQueue(sendQueuedProduksi).catch(() => null);
			if (hasil?.permanentlyFailed?.length) {
				recordGagalPermanen(
					hasil.permanentlyFailed.map((e) => ({ client_txn_id: e.client_txn_id, spkId: e.spkId, outputKg: e.outputKg })),
					'SPK sudah ditutup atau ditolak server saat dikirim ulang.'
				);
				gagalEntries = getGagalPermanenEntries();
			}
			await refreshQueuedCount();
		}
	});

	/** Fase 4B — simpan pilihan mesin ke perangkat ini supaya sesi berikutnya tidak perlu pilih lagi. */
	function pilihEquipment(id: string) {
		equipmentId = id;
		showEquipmentPicker = false;
		try {
			const key = equipmentStorageKey();
			if (key) localStorage.setItem(key, id);
		} catch {
			/* non-fatal — cukup dipakai untuk sesi ini saja */
		}
	}

	onDestroy(() => {
		window.removeEventListener('kiosk-hardware-scan', handleHardwareScan);
		if (redirectTimer) clearTimeout(redirectTimer);
		if (countdownInterval) clearInterval(countdownInterval);
		if (scanFeedbackTimer) clearTimeout(scanFeedbackTimer);
		unregisterAutoFlush?.(); // §3.7 item 4 — jangan menumpuk listener 'online' tiap kunjungan halaman
	});

	async function selectSpk(id: number) {
		spkId = id;
		loadingSpkDetail = true;
		errorMsg = '';
		// Bug 4 — UUID transaksi baru untuk pengisian form ini.
		clientTxnId = crypto.randomUUID();
		rejectReasons = [];
		wasteReasons = [];
		try {
			const res = await fetch(`/api/kiosk/produksi?spkId=${id}`);
			if (res.ok) {
				selectedSpkInfo = await res.json();
			} else {
				const found = spkList.find((s) => s.id === id);
				selectedSpkInfo = {
					spk: found,
					targetKg: Number(found?.quantity) || 0,
					kumulatifOutput: 0,
					progressPct: 0
				};
			}
		} catch {
			const found = spkList.find((s) => s.id === id);
			selectedSpkInfo = {
				spk: found,
				targetKg: Number(found?.quantity) || 0,
				kumulatifOutput: 0,
				progressPct: 0
			};
		} finally {
			loadingSpkDetail = false;
		}
	}

	function resetSpk() {
		spkId = null;
		selectedSpkInfo = null;
		outputKg = '';
		rejectKg = '';
		wasteKg = '';
		catatan = '';
		errorMsg = '';
		clientTxnId = '';
		rejectReasons = [];
		wasteReasons = [];
		markComplete = false;
		showShiftOverride = false;
		jadwalKerjaIdOverride = '';
	}

	/** B5 (file 04 §2.1) — checkbox lama bisa TAMPAK tercentang padahal `markComplete` tetap
	 *  `false` (Svelte tidak merender ulang `checked` kalau state tidak berubah), sehingga
	 *  operator melihat ✔ tapi server menerima markComplete:false. Diganti dua tombol pilihan
	 *  eksplisit — state dan tampilan SELALU sama karena keduanya diturunkan dari `markComplete`. */
	function requestMarkComplete() {
		if (newCumulative <= 0) {
			errorMsg = 'Isi jumlah Barang Jadi dulu sebelum menyelesaikan SPK ini.';
			return;
		}
		showMarkCompleteConfirm = true;
	}

	function confirmMarkComplete() {
		markComplete = true;
		showMarkCompleteConfirm = false;
	}

	function cancelMarkComplete() {
		showMarkCompleteConfirm = false;
	}

	function addValue(field: 'output' | 'reject' | 'waste', delta: number) {
		// Bug 6 — pembulatan WAJIB di sini, bukan cuma saat menampilkan: penjumlahan float
		// mentah membuat tiga kali "+0.1" menjadi 0.30000000000000004 di dalam kotak input
		// yang dilihat operator, dan angka itulah yang ikut tersimpan.
		const next = (current: string) => String(Math.round(Math.max(0, (Number(current) || 0) + delta) * 100) / 100);
		if (field === 'output') outputKg = next(outputKg);
		else if (field === 'reject') rejectKg = next(rejectKg);
		else if (field === 'waste') wasteKg = next(wasteKg);
	}

	function clearValue(field: 'output' | 'reject' | 'waste') {
		if (field === 'output') outputKg = '';
		if (field === 'reject') {
			rejectKg = '';
			rejectReasons = [];
		}
		if (field === 'waste') {
			wasteKg = '';
			wasteReasons = [];
		}
	}

	/** File 04 §2.7 — kartu sukses redirect otomatis HANYA bila tidak ada apa pun yang perlu
	 *  dibaca operator dulu. `hasWarning` true (over-produksi, "Batch Tuntas" gagal, atau
	 *  antrean offline) berarti operator wajib menekan tombol sendiri (Aturan #6). */
	function scheduleAutoRedirect(hasWarning: boolean) {
		autoRedirectCancelled = hasWarning;
		if (hasWarning) return;
		countdown = 3;
		countdownInterval = setInterval(() => {
			countdown -= 1;
			if (countdown <= 0 && countdownInterval) clearInterval(countdownInterval);
		}, 1000);
		redirectTimer = setTimeout(() => goto('/kiosk/home'), 3500);
	}

	/** Fase 2B — titik masuk tombol SIMPAN. Bila akan over-produksi, jeda dulu lewat modal
	 *  konfirmasi (default "Batal") sebelum benar-benar mengirim ke server. */
	function submit() {
		errorMsg = '';
		if (!spkId) {
			errorMsg = 'Pilih SPK terlebih dahulu.';
			return;
		}
		// M2 (file 04 §2.3) — `type="number"` mengubah "0" jadi angka 0, dan `!0 === true`
		// mengunci tombol. Shift yang HANYA menghasilkan reject/waste (batch gagal total) tidak
		// bisa melapor kalau outputKosong dianggap sama dengan output=0.
		if (outputKosong || Number(outputKg) < 0) {
			errorMsg = 'Isi Output (kg) dengan angka yang valid (>= 0). Kalau tidak ada barang jadi, isi 0.';
			return;
		}
		if (numOutput === 0 && numReject === 0 && numWaste === 0) {
			errorMsg = 'Isi minimal salah satu: Barang Jadi, Rusak, atau Terbuang.';
			return;
		}
		if (willOverproduce) {
			showOverproductionConfirm = true;
			return;
		}
		doSubmit();
	}

	async function doSubmit() {
		showOverproductionConfirm = false;
		submitting = true;
		try {
			const res = await fetch('/api/kiosk/produksi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					spkId,
					outputKg: numOutput,
					rejectKg: numReject,
					wasteKg: numWaste,
					catatan: catatan.trim() || undefined,
					// Fase 2A — hanya berarti bila kolomnya terisi (dicek juga di server).
					rejectReasons: numReject > 0 ? rejectReasons : undefined,
					wasteReasons: numWaste > 0 ? wasteReasons : undefined,
					// Bug 4 — kunci idempotensi milik pengisian form ini.
					clientTxnId,
					// Fase 3C — sudah lolos kunci ganda di klien; server tetap validasi ulang.
					markComplete,
					// Fase 3D — hanya dikirim bila operator mengoreksi manual "Bukan shift saya?".
					jadwalKerjaIdOverride: showShiftOverride && jadwalKerjaIdOverride ? jadwalKerjaIdOverride : undefined,
					// Fase 4B — mesin dari pilihan tersimpan di perangkat ini.
					equipmentId: equipmentId || undefined
				})
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal menyimpan.');

			clearAutoDraft('kiosk-input-produksi');

			successData = {
				spkNomor: selectedSpkInfo?.spk?.nomor || `SPK #${spkId}`,
				namaBarang: selectedSpkInfo?.spk?.nama_barang || selectedSpkInfo?.spk?.product_id?.nama_barang_lengkap || 'Produk',
				unit: unitLabel,
				outputKg: numOutput,
				rejectKg: numReject,
				wasteKg: numWaste,
				// Bug 4 — server menandai bila baris ini sebenarnya sudah tersimpan sebelumnya
				// (retry / tekan 2x). Operator perlu tahu supaya tidak mengira input hilang.
				duplicate: Boolean(data?.duplicate),
				variance: data?.variance,
				// Fase 2B — server yang memutuskan (bukan dihitung ulang di klien), supaya kartu
				// sukses & notifikasi supervisor selalu sepakat.
				overProduction: data?.overProduction || null,
				// Fase 3C — hasil transisi ke qc_pending (bisa gagal walau log tetap tersimpan).
				markComplete: data?.markComplete || null
			};

			showSuccess = true;
			// File 04 §2.7 — kartu sukses TIDAK boleh lari sendiri kalau ada sesuatu yang perlu
			// dibaca operator (peringatan over-produksi atau hasil "Batch Tuntas" gagal). Operator
			// harus menekan "Saya mengerti" secara sadar, bukan kelewatan karena redirect 3,5 detik.
			scheduleAutoRedirect(Boolean(successData.overProduction) || successData.markComplete?.success === false);
		} catch (e) {
			// R7 — TypeError dari fetch berarti gagal total (offline/jaringan putus), bukan
			// penolakan server. Simpan ke antrian lokal, bukan tampilkan sebagai error yang
			// membuat operator mengira inputnya hilang. Pola sama proof-of-delivery di /scan/[code].
			if (e instanceof TypeError) {
				try {
					await enqueueProduksiSubmission({
						client_txn_id: clientTxnId,
						spkId: Number(spkId),
						outputKg: numOutput,
						rejectKg: numReject,
						wasteKg: numWaste,
						catatan: catatan.trim() || null,
						rejectReasons: numReject > 0 ? rejectReasons : null,
						wasteReasons: numWaste > 0 ? wasteReasons : null,
						markComplete,
						jadwalKerjaIdOverride: showShiftOverride && jadwalKerjaIdOverride ? jadwalKerjaIdOverride : null,
						equipmentId: equipmentId || null,
						createdAt: new Date().toISOString()
					});
					await refreshQueuedCount();
					clearAutoDraft('kiosk-input-produksi');

					successData = {
						spkNomor: selectedSpkInfo?.spk?.nomor || `SPK #${spkId}`,
						namaBarang: selectedSpkInfo?.spk?.nama_barang || selectedSpkInfo?.spk?.product_id?.nama_barang_lengkap || 'Produk',
						unit: unitLabel,
						outputKg: numOutput,
						rejectKg: numReject,
						wasteKg: numWaste,
						duplicate: false,
						variance: null,
						overProduction: null,
						markComplete: null,
						queuedOffline: true
					};
					showSuccess = true;
					// §2.7 — queuedOffline juga wajib dibaca dulu (data belum benar-benar sampai
					// server), jangan redirect otomatis.
					scheduleAutoRedirect(true);
				} catch (queueErr) {
					errorMsg = queueErr instanceof Error ? queueErr.message : 'Gagal menyimpan ke antrian offline.';
				}
			} else {
				errorMsg = e instanceof Error ? e.message : 'Gagal menyimpan hasil produksi.';
			}
		} finally {
			submitting = false;
		}
	}

	/** R7 — kirim ulang satu entri tertunda. Pola sama sendQueuedTap di kiosk/absen-istirahat.
	 *  File 03 §3.7 — 4xx selain 401 (sesi habis)/429 (rate limit) adalah penolakan PERMANEN
	 *  (mis. SPK sudah ditutup): melempar PermanentQueueError supaya factory berhenti mengulang
	 *  entri ini selamanya. 401/429/5xx/jaringan tetap error biasa — entri tetap di antrean. */
	async function sendQueuedProduksi(entry: QueuedProduksiSubmission) {
		const res = await fetch('/api/kiosk/produksi', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				spkId: entry.spkId,
				outputKg: entry.outputKg,
				rejectKg: entry.rejectKg,
				wasteKg: entry.wasteKg,
				catatan: entry.catatan || undefined,
				rejectReasons: entry.rejectReasons || undefined,
				wasteReasons: entry.wasteReasons || undefined,
				clientTxnId: entry.client_txn_id,
				markComplete: entry.markComplete,
				jadwalKerjaIdOverride: entry.jadwalKerjaIdOverride || undefined,
				equipmentId: entry.equipmentId || undefined
			})
		});
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			const msg = data?.message || `HTTP ${res.status}`;
			if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
				throw new PermanentQueueError(msg);
			}
			throw new Error(msg);
		}
	}

	async function refreshQueuedCount() {
		try {
			queuedCount = (await getQueuedProduksiSubmissions()).length;
		} catch {
			queuedCount = 0;
		}
	}

	/** File 12 §C — buka pemilihan qty dulu, sebelum tombol cetak final ditekan. Timer redirect
	 *  otomatis dibatalkan di sini juga, supaya operator tidak dilempar ke beranda saat memilih. */
	function bukaPilihQtyLabel() {
		if (!spkId) return;
		if (redirectTimer) clearTimeout(redirectTimer);
		if (countdownInterval) clearInterval(countdownInterval);
		autoRedirectCancelled = true;
		labelQty = 10;
		labelQtyCustom = '';
		showLabelQtyPicker = true;
	}

	/** File 12 §C — dulu window.open('', '_blank') di kiosk layar penuh: tab baru yang orang awam
	 *  tidak tahu cara menutupnya, DAN tunduk pada pemblokir pop-up (Aturan #5 lama). Diganti
	 *  iframe tersembunyi di halaman yang sama + iframe.contentWindow.print() — operator tetap
	 *  di kiosk, tidak ada tab untuk ditutup, dan TIDAK tunduk pemblokir pop-up (bukan window
	 *  baru), jadi aman dipanggil setelah await tanpa perlu trik user-activation lagi. */
	async function printLabel() {
		if (printingLabel || !spkId) return;
		const qty = labelQtyCustom.trim() ? Number(labelQtyCustom) : labelQty;
		if (!Number.isFinite(qty) || qty < 1 || qty > 100) {
			errorMsg = 'Jumlah label harus angka 1-100.';
			return;
		}
		showLabelQtyPicker = false;
		printingLabel = true;
		try {
			const res = await fetch(`/api/kiosk/print-label?spkId=${spkId}&qty=${qty}`);
			const data = await res.json().catch(() => null);
			if (!res.ok || !data?.html) {
				throw new Error(data?.message || 'Gagal membuat label.');
			}
			const iframe = document.createElement('iframe');
			iframe.style.position = 'fixed';
			iframe.style.right = '0';
			iframe.style.bottom = '0';
			iframe.style.width = '0';
			iframe.style.height = '0';
			iframe.style.border = 'none';
			document.body.appendChild(iframe);
			const doc = iframe.contentWindow?.document;
			if (!doc) throw new Error('Gagal menyiapkan pratinjau cetak.');
			doc.open();
			doc.write(data.html);
			doc.close();
			iframe.contentWindow?.focus();
			iframe.contentWindow?.print();
			// Bersihkan iframe setelah dialog cetak selesai/ditutup — beri jeda supaya browser
			// sempat membuka dialog print sebelum elemen dihapus.
			setTimeout(() => iframe.remove(), 60_000);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencetak label.';
		} finally {
			printingLabel = false;
		}
	}
</script>

{#if showSuccess}
	<div class="success-overlay">
		<div class="success-card">
			<div class="success-icon-wrap">
				<IconCheck size={56} stroke={3} />
			</div>
			<h2>PRODUKSI TERSIMPAN</h2>
			<p class="success-spk">{successData?.spkNomor} — {successData?.namaBarang}</p>

			{#if successData?.duplicate}
				<p class="success-dupe">
					Data ini sudah tersimpan sebelumnya — kami tidak mencatatnya dua kali. Angka di bawah sudah benar.
				</p>
			{/if}

			<!-- R7 — jujur bahwa ini belum sampai ke server, bukan pura-pura sudah tersimpan penuh. -->
			{#if successData?.queuedOffline}
				<p class="success-queued">
					📡 Belum ada sinyal — tersimpan di perangkat ini, akan terkirim otomatis begitu koneksi kembali.
					Jangan tutup kiosk secara paksa sebelum sinyal kembali.
				</p>
			{/if}

			{#if successData?.overProduction}
				<p class="success-overprod">
					Kumulatif {fmtKg(successData.overProduction.kumulatifKg)} {successData?.unit || 'kg'} melebihi
					target {fmtKg(successData.overProduction.targetKg)} {successData?.unit || 'kg'}
					(+{successData.overProduction.pct}%) — supervisor sudah diberi tahu.
				</p>
			{/if}

			<!-- Fase 3C — hasil transisi ke qc_pending. Log produksi di atas SUDAH tersimpan
			     terlepas dari sukses/gagalnya ini (Aturan #6). -->
			{#if successData?.markComplete}
				<p class="success-markcomplete" class:success-markcomplete--err={!successData.markComplete.success}>
					{successData.markComplete.message}
				</p>
			{/if}

			<div class="success-grid">
				<div class="success-item success-item--output">
					<span class="lbl">Output Lolos</span>
					<strong>+{fmtKg(successData?.outputKg)} {successData?.unit || 'kg'}</strong>
				</div>
				<div class="success-item">
					<span class="lbl">Reject</span>
					<strong>{fmtKg(successData?.rejectKg)} {successData?.unit || 'kg'}</strong>
				</div>
				<div class="success-item">
					<span class="lbl">Waste</span>
					<strong>{fmtKg(successData?.wasteKg)} {successData?.unit || 'kg'}</strong>
				</div>
			</div>

			{#if successData?.variance}
				{@const tgt = Number(successData.variance.targetKg) || 0}
				<div class="success-variance">
					<span>Total Kumulatif: <strong>{fmtKg(successData.variance.kumulatifOutputKg)} {successData?.unit || 'kg'}</strong> / {fmtKg(successData.variance.targetKg)} {successData?.unit || 'kg'}</span>
					<div class="prog-bar-bg">
						<div class="prog-bar-fill" style="width: {tgt > 0 ? Math.min(100, Math.round((successData.variance.kumulatifOutputKg / tgt) * 100)) : 0}%"></div>
					</div>
				</div>
			{/if}

			<!-- Fase 4A — cetak label hanya masuk akal untuk batch yang baru lolos ke antrean
			     QC (mark_qc_pending sukses di respons ini), reuse generator label yang sudah ada. -->
			{#if successData?.markComplete?.success}
				<button class="success-btn success-btn--print" onclick={bukaPilihQtyLabel} disabled={printingLabel}>
					{#if printingLabel}
						<IconLoader2 size={18} class="animate-spin" /> Membuka label...
					{:else}
						🖨️ Cetak Label Produk
					{/if}
				</button>
			{/if}

			<button class="success-btn" onclick={() => goto('/kiosk/home')}>
				{autoRedirectCancelled ? 'Kembali ke Beranda' : `Kembali ke Beranda (${countdown}s)`}
			</button>
		</div>
	</div>

	{#if showLabelQtyPicker}
		<div class="label-qty-backdrop" role="dialog" aria-modal="true" onclick={() => (showLabelQtyPicker = false)}>
			<div class="label-qty-card" onclick={(e) => e.stopPropagation()}>
				<h3>Berapa label?</h3>
				<div class="label-qty-options">
					{#each [5, 10, 20] as n}
						<button
							type="button"
							class="label-qty-opt"
							class:active={!labelQtyCustom && labelQty === n}
							onclick={() => { labelQty = n; labelQtyCustom = ''; }}
						>
							{n}
						</button>
					{/each}
					<input
						class="label-qty-custom"
						type="number"
						inputmode="numeric"
						min="1"
						max="100"
						placeholder="Lainnya"
						bind:value={labelQtyCustom}
					/>
				</div>
				<button type="button" class="label-qty-cetak" onclick={printLabel}>Cetak</button>
			</div>
		</div>
	{/if}
{:else}
	<div
		class="kiosk-container"
		data-draft-scope="kiosk-input-produksi"
		use:autoDraft={{ onRestoreAvailable: (info) => (draftRestoreInfo = info) }}
	>
		<FormDraftBar
			restoreInfo={draftRestoreInfo}
			onApplied={() => (draftRestoreInfo = null)}
		/>
		<!-- Top Bar Header -->
		<div class="kiosk-header">
			<button class="back-btn" onclick={() => goto('/kiosk/home')} title="Kembali ke Beranda">
				<IconArrowLeft size={22} />
			</button>
			<div class="header-titles">
				<h1>Input Hasil Produksi</h1>
				<span class="subtitle">Pencatatan real-time output, reject, dan waste operator</span>
			</div>
			<!-- R7 — sisa antrian offline di perangkat ini, supaya operator/supervisor tahu ada
			     data yang belum sampai ke server (bukan tersembunyi diam-diam). -->
			{#if queuedCount > 0}
				<span class="queued-badge" title="Data ini tersimpan di perangkat, menunggu sinyal untuk terkirim">
					📡 {queuedCount} tertunda
				</span>
			{/if}
			{#if gagalEntries.length > 0}
				<button type="button" class="gagal-badge" onclick={() => (showGagalList = !showGagalList)}>
					⚠️ {gagalEntries.length} tidak terkirim — Lihat
				</button>
			{/if}
			{#if spkId}
				<button class="switch-spk-btn" onclick={resetSpk}>
					<IconRefresh size={16} /> Ganti SPK
				</button>
			{/if}
		</div>

		<!-- File 03 §3.7 item 3 — rincian input yang GAGAL PERMANEN (server sudah menolak tegas,
		     bukan sekadar tidak ada sinyal). Operator menunjukkan ini ke supervisor. -->
		{#if showGagalList && gagalEntries.length > 0}
			<div class="gagal-panel">
				<div class="gagal-panel-title">Input tidak terkirim — tunjukkan ke supervisor:</div>
				{#each gagalEntries as g (g.client_txn_id)}
					<div class="gagal-row">
						<span>SPK #{g.spkId} · Output {fmtKg(g.outputKg)} kg · {new Date(g.waktu).toLocaleString('id-ID')}</span>
						<small>{g.alasan}</small>
						<button
							type="button"
							class="gagal-dismiss"
							onclick={() => {
								clearGagalPermanenEntry(g.client_txn_id);
								gagalEntries = getGagalPermanenEntries();
							}}
						>
							Sudah dilihat supervisor
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Fase 3D — banner shift read-only. Operator normalnya tidak perlu memilih apa pun;
		     "Bukan shift saya?" hanya untuk koreksi kasus jarang (tukar shift belum tercatat). -->
		{#if !loading && shiftInfo}
			<div class="shift-banner">
				<span class="shift-banner__label">Shift:</span>
				{#if shiftInfo.namaJadwal}
					<span class="shift-banner__value">
						{shiftInfo.namaJadwal}{#if shiftInfo.jamMasuk && shiftInfo.jamKeluar} ({shiftInfo.jamMasuk}–{shiftInfo.jamKeluar}){/if}
					</span>
				{:else}
					<span class="shift-banner__value shift-banner__value--muted">Belum terdeteksi</span>
				{/if}
				<button type="button" class="shift-banner__link" onclick={() => (showShiftOverride = !showShiftOverride)}>
					Bukan shift saya?
				</button>
				{#if showShiftOverride}
					<select class="shift-banner__select" bind:value={jadwalKerjaIdOverride}>
						<option value="">-- pilih shift yang benar --</option>
						{#each jadwalKerjaOptions as opt}
							<option value={opt.id}>{opt.nama_jadwal}{opt.jam_masuk_normal ? ` (${opt.jam_masuk_normal}-${opt.jam_keluar_normal || ''})` : ''}</option>
						{/each}
					</select>
				{/if}
			</div>
		{/if}

		<!-- Fase 4B — selector mesin. Tersimpan di perangkat ini (localStorage), jadi normalnya
		     operator tidak perlu memilih tiap sesi — hanya sekali per perangkat/pergantian mesin. -->
		{#if !loading && equipmentOptions.length > 0}
			<div class="shift-banner">
				<span class="shift-banner__label">Mesin:</span>
				{#if equipmentId}
					<span class="shift-banner__value">
						{equipmentOptions.find((e) => e.id === equipmentId)?.name || equipmentId}
					</span>
				{:else}
					<span class="shift-banner__value shift-banner__value--muted">Belum dipilih</span>
				{/if}
				<button type="button" class="shift-banner__link" onclick={() => (showEquipmentPicker = !showEquipmentPicker)}>
					{equipmentId ? 'Ubah Mesin' : 'Pilih Mesin'}
				</button>
				{#if showEquipmentPicker}
					<select
						class="shift-banner__select"
						value={equipmentId}
						onchange={(e) => pilihEquipment((e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="">-- pilih mesin --</option>
						{#each equipmentOptions as eq}
							<option value={eq.id}>{eq.code} — {eq.name}</option>
						{/each}
					</select>
				{/if}
			</div>
		{/if}

		{#if loading}
			<div class="py-12 flex justify-center">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memuat SPK Aktif..." sublabel="Sinkronisasi antrean lini produksi" />
			</div>
		{:else if spkError && spkList.length === 0}
			<!-- B1 — kegagalan fetch TIDAK lagi disamakan dengan "tidak ada SPK". Operator diberi
			     tombol untuk coba lagi, bukan dibiarkan mengira line-nya memang kosong. -->
			<div class="empty-box">
				<IconAlertTriangle size={36} />
				<p><strong>Daftar SPK gagal dimuat</strong></p>
				<span>Terjadi gangguan saat mengambil data dari server. Coba lagi, atau hubungi supervisor bila berulang.</span>
				<button class="switch-spk-btn" style="margin-top:12px" onclick={retryLoadSpk}>
					<IconRefresh size={16} /> Coba Lagi
				</button>
			</div>
		{:else if spkList.length === 0}
			<div class="empty-box">
				<IconAlertTriangle size={36} />
				<p><strong>Tidak ada SPK berjalan</strong></p>
				<!-- Teks disamakan dengan filter API (`in_progress` DAN `worksheet_generated`);
				     sebelumnya hanya menyebut in_progress sehingga operator salah lapor. -->
				<span>Belum ada Surat Perintah Kerja (SPK) berstatus "Sedang Dikerjakan" atau "Worksheet Siap" pada lini ini. Hubungi supervisor produksi Anda.</span>
			</div>
		{:else}
			{#if errorMsg}
				<div class="error-banner">
					<IconAlertTriangle size={20} />
					<span>{errorMsg}</span>
				</div>
			{/if}

			<!-- B1 — kegagalan search/muat-lebih-banyak (daftar awal tetap tampil apa adanya). -->
			{#if spkError}
				<div class="error-banner">
					<IconAlertTriangle size={20} />
					<span>Gagal memuat sebagian data SPK. Daftar di bawah mungkin tidak lengkap.</span>
					<button class="switch-spk-btn" onclick={retryLoadSpk}>Coba Lagi</button>
				</div>
			{/if}

			<!-- Bug 5 — umpan balik hasil scan. Tanpa ini operator tidak tahu apa yang terjadi
			     saat memindai, dan dulu justru dilempar keluar halaman tanpa penjelasan. -->
			{#if scanFeedback}
				<div class="scan-banner" class:scan-banner--err={scanFeedback.tone === 'err'}>
					<IconBarcode size={20} />
					<span>{scanFeedback.msg}</span>
				</div>
			{/if}

			<!-- SPK Selection / Active SPK Card -->
			{#if !spkId}
				<div class="spk-picker-section">
					<div class="section-title">Pilih SPK yang sedang dikerjakan:</div>
					<!-- B1 — pencarian server-side (bukan lagi filter di klien atas 20 baris),
					     jadi selalu ditampilkan (bukan hanya saat > 4) supaya operator tahu SPK
					     lain bisa dicari, bukan cuma yang kebetulan termuat. -->
					<input
						class="kiosk-input spk-search-input"
						type="text"
						placeholder="Cari nomor SPK atau nama produk..."
						title="Pencarian mencakup semua SPK aktif, bukan hanya yang sudah dimuat."
						bind:value={searchTerm}
						oninput={handleSearchInput}
					/>
					<div class="spk-total-hint">
						{#if searchLoading}
							Mencari...
						{:else}
							Menampilkan {spkList.length} dari {spkTotal} SPK aktif. Ketik nomor SPK atau nama produk untuk mencari SPK lain.
						{/if}
					</div>
					{#if !searchLoading && spkList.length === 0}
						<div class="spk-search-empty">Tidak ada SPK yang cocok dengan "{searchTerm}".</div>
					{/if}
					<div class="spk-card-grid">
						{#each spkList as spk}
							<button class="spk-card-btn" onclick={() => selectSpk(spk.id)}>
								<div class="spk-card-top">
									<span class="spk-badge">{spk.nomor}</span>
									{#if spk.batch_no}
										<span class="batch-badge">Batch: {spk.batch_no}</span>
									{/if}
								</div>
								<strong class="spk-product-name">{spk.product_id?.nama_barang_lengkap || 'Produk'}</strong>
								<div class="spk-card-bottom">
									<!-- Bug 6+8: quantity dari Directus berupa string float mentah
									     ("45.7142857142857"), dan unit datang campur "KG"/"kg". -->
									<span>Target: <strong>{fmtKg(spk.quantity)} {String(spk.unit || 'kg').toLowerCase()}</strong></span>
									<span class="spk-action-hint">Pilih SPK &rarr;</span>
								</div>
							</button>
						{/each}
					</div>
					{#if spkList.length < spkTotal}
						<button class="switch-spk-btn spk-load-more-btn" onclick={loadMoreSpk} disabled={loadingMore}>
							{#if loadingMore}
								<IconLoader2 size={16} class="animate-spin" /> Memuat...
							{:else}
								Muat lebih banyak ({spkTotal - spkList.length} lagi)
							{/if}
						</button>
					{/if}

					<!-- File 03 §3.3 — SPK yang bahannya belum dipotong dari stok (keputusan Lead
					     opsi b). Tidak bisa dipilih; operator hanya bisa minta supervisor memulainya. -->
					{#if spkBelumMulai.length > 0}
						<button
							type="button"
							class="belum-mulai-toggle"
							onclick={() => (belumMulaiOpen = !belumMulaiOpen)}
							aria-expanded={belumMulaiOpen}
						>
							{belumMulaiOpen ? '▾' : '▸'} Belum dimulai ({spkBelumMulai.length})
						</button>
						{#if belumMulaiOpen}
							<div class="belum-mulai-hint">
								SPK di bawah belum dimulai. Bahan baku belum disiapkan gudang. Tekan "Minta
								Mulai Produksi" supaya supervisor memprosesnya.
							</div>
							<div class="spk-card-grid">
								{#each spkBelumMulai as spk}
									<div class="spk-card-btn spk-card-btn--disabled">
										<div class="spk-card-top">
											<span class="spk-badge">{spk.nomor}</span>
											{#if spk.batch_no}
												<span class="batch-badge">Batch: {spk.batch_no}</span>
											{/if}
										</div>
										<strong class="spk-product-name">{spk.product_id?.nama_barang_lengkap || 'Produk'}</strong>
										<div class="spk-card-bottom">
											<span>Target: <strong>{fmtKg(spk.quantity)} {String(spk.unit || 'kg').toLowerCase()}</strong></span>
										</div>
										{#if mintaMulaiDone.has(spk.id)}
											<span class="minta-mulai-done">✓ Supervisor sudah diberi tahu</span>
										{:else}
											<button
												type="button"
												class="minta-mulai-btn"
												disabled={mintaMulaiBusyId === spk.id}
												onclick={() => mintaMulaiProduksi(spk)}
											>
												{mintaMulaiBusyId === spk.id ? 'Mengirim...' : 'Minta Mulai Produksi'}
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{:else}
				<!-- Active SPK Banner Card -->
				<div class="active-spk-banner">
					{#if loadingSpkDetail}
						<div class="spk-banner-loading">
							<IconLoader2 size={20} class="animate-spin" /> Memuat detail target SPK...
						</div>
					{:else}
						<div class="spk-banner-main">
							<div class="spk-banner-info">
								<div class="spk-badges-row">
									<span class="spk-nomor-tag">{selectedSpkInfo?.spk?.nomor}</span>
									{#if selectedSpkInfo?.spk?.batch_no}
										<span class="spk-batch-tag">Batch {selectedSpkInfo.spk.batch_no}</span>
									{/if}
								</div>
								<h2 class="spk-product-title">
									{selectedSpkInfo?.spk?.nama_barang || selectedSpkInfo?.spk?.product_id?.nama_barang_lengkap || 'Produk'}
								</h2>
							</div>

							<div class="spk-target-stats">
								<div class="stat-col">
									<span class="stat-lbl">Target SPK</span>
									<span class="stat-val">{fmtKg(targetKg)} {unitLabel}</span>
								</div>
								<div class="stat-divider"></div>
								<div class="stat-col">
									<span class="stat-lbl">Sudah Jadi</span>
									<span class="stat-val stat-val--done">{fmtKg(selectedSpkInfo?.kumulatifOutput)} {unitLabel}</span>
								</div>
								<div class="stat-divider"></div>
								<div class="stat-col">
									<span class="stat-lbl">Sisa</span>
									<span class="stat-val stat-val--remaining">{fmtKg(selectedSpkInfo?.sisaKg)} {unitLabel}</span>
								</div>
							</div>
						</div>

						<!-- Progress Bar -->
						<div class="spk-progress-row">
							<div class="prog-track">
								<div
									class="prog-fill prog-fill--base"
									style="width: {selectedSpkInfo?.progressPct || 0}%"
								></div>
								{#if numOutput > 0 && targetKg > 0}
									<div
										class="prog-fill prog-fill--delta"
										style="width: {newProgressPct}%"
									></div>
								{/if}
							</div>
							<span class="prog-pct-text">
								{selectedSpkInfo?.progressPct || 0}%
								{#if numOutput > 0 && targetKg > 0 && newProgressPct > (selectedSpkInfo?.progressPct || 0)}
									<span class="delta-text"> &rarr; {newProgressPct}%</span>
								{/if}
							</span>
						</div>
					{/if}
				</div>

				<!-- Numeric Input Cards: Output, Reject, Waste -->
				<div class="metrics-grid">
					<!-- 1. Output Lolos QC (Hero Emerald Card) -->
					<div class="metric-card metric-card--output">
						<div class="metric-card-header">
							<div class="metric-icon metric-icon--output">
								<IconPackage size={22} />
							</div>
							<div class="metric-header-text">
								<label for="input-output" class="metric-title">{TEKS_PRODUKSI.labelOutput}</label>
								<span class="metric-hint">Hasil produksi bagus siap pakai — tombol cepat menyesuaikan ukuran batch SPK ini</span>
							</div>
						</div>

						<div class="input-row">
							<KioskNumberField
								id="input-output"
								bind:value={outputKg}
								judul={TEKS_PRODUKSI.labelOutput}
								satuan={unitLabel}
								desimal={desimalAktif}
							/>
						</div>

						<!-- Bug 7 — langkah mengikuti skala target SPK, bukan angka tetap. -->
						<div class="quick-buttons">
							{#each quickAddSteps as step}
								<button type="button" class="q-btn" onclick={() => addValue('output', step)}>+{step}</button>
							{/each}
							<button type="button" class="q-btn q-btn--clear" onclick={() => clearValue('output')}>C</button>
						</div>
					</div>

					<!-- 2. Reject Gagal QC (Rose Card) -->
					<div class="metric-card metric-card--reject">
						<div class="metric-card-header">
							<div class="metric-icon metric-icon--reject">
								<IconAlertTriangle size={22} />
							</div>
							<div class="metric-header-text">
								<label for="input-reject" class="metric-title">{TEKS_PRODUKSI.labelReject}</label>
								<span class="metric-hint">Barang cacat / tidak lolos spek</span>
							</div>
						</div>

						<div class="input-row">
							<KioskNumberField
								id="input-reject"
								bind:value={rejectKg}
								judul={TEKS_PRODUKSI.labelReject}
								satuan={unitLabel}
								desimal={desimalAktif}
							/>
						</div>

						<!-- Bug 7 — reject ikut skala target: pada SPK 0.2 kg, "+1" saja sudah 500% batch. -->
						<div class="quick-buttons">
							{#each quickAddSteps as step}
								<button type="button" class="q-btn" onclick={() => addValue('reject', step)}>+{step}</button>
							{/each}
							<button type="button" class="q-btn q-btn--clear" onclick={() => clearValue('reject')}>C</button>
						</div>

						<!-- Fase 2A — chip alasan reject, muncul hanya bila ada angka reject. Boleh
						     lebih dari satu, opsional (tidak memblokir SIMPAN). -->
						{#if numReject > 0 && (selectedSpkInfo?.rejectReasonOptions || []).length > 0}
							<div class="reason-section">
								<span class="reason-hint">Alasan reject (opsional, boleh lebih dari satu):</span>
								<div class="reason-chip-row">
									{#each selectedSpkInfo.rejectReasonOptions as reason}
										<button
											type="button"
											class="reason-chip reason-chip--reject"
											class:reason-chip--active={rejectReasons.includes(reason)}
											onclick={() => toggleReason('reject', reason)}
										>
											{reason}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<!-- 3. Waste Sisa/Tumpahan (Amber Card) -->
					<div class="metric-card metric-card--waste">
						<div class="metric-card-header">
							<div class="metric-icon metric-icon--waste">
								<IconTrash size={22} />
							</div>
							<div class="metric-header-text">
								<label for="input-waste" class="metric-title">{TEKS_PRODUKSI.labelWaste}</label>
								<span class="metric-hint">Tumpahan & kerak dibuang</span>
							</div>
						</div>

						<div class="input-row">
							<KioskNumberField
								id="input-waste"
								bind:value={wasteKg}
								judul={TEKS_PRODUKSI.labelWaste}
								satuan={unitLabel}
								desimal={desimalAktif}
							/>
						</div>

						<!-- Bug 7 — waste ikut skala target, sama alasannya dengan reject. -->
						<div class="quick-buttons">
							{#each quickAddSteps as step}
								<button type="button" class="q-btn" onclick={() => addValue('waste', step)}>+{step}</button>
							{/each}
							<button type="button" class="q-btn q-btn--clear" onclick={() => clearValue('waste')}>C</button>
						</div>

						<!-- Fase 2A — chip alasan waste, sama pola dengan reject. -->
						{#if numWaste > 0 && (selectedSpkInfo?.wasteReasonOptions || []).length > 0}
							<div class="reason-section">
								<span class="reason-hint">Alasan waste (opsional, boleh lebih dari satu):</span>
								<div class="reason-chip-row">
									{#each selectedSpkInfo.wasteReasonOptions as reason}
										<button
											type="button"
											class="reason-chip reason-chip--waste"
											class:reason-chip--active={wasteReasons.includes(reason)}
											onclick={() => toggleReason('waste', reason)}
										>
											{reason}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Fase 4 — catat sisa batch (cat tersisa) sebagai kandidat pakai ulang; tidak mengubah stok. -->
				<SisaBatchCard spkId={spkId} />

				<!-- Live Balance & Yield Indicator -->
				<div class="balance-bar">
					<div class="balance-item">
						<span class="balance-lbl">{TEKS_PRODUKSI.labelTotalBahan}</span>
						<strong class="balance-val">{fmtKg(totalInput)} {unitLabel}</strong>
					</div>
					<div class="balance-divider"></div>
					<div class="balance-item">
						<span class="balance-lbl">{TEKS_PRODUKSI.labelYield}</span>
						<!-- Bug 9 — form kosong dulu menampilkan "100% Lolos QC", seolah-olah sudah
						     ada hasil sempurna. Sekarang netral sampai ada angka yang diisi. -->
						{#if yieldPct === null}
							<span class="yield-tag yield-neutral" title="Isi Barang Jadi/Rusak/Terbuang dulu untuk melihat persentase">— Belum ada data</span>
						{:else}
							<span class="yield-tag" class:yield-green={yieldPct >= 95} class:yield-amber={yieldPct >= 85 && yieldPct < 95} class:yield-red={yieldPct < 85}>
								{yieldPct}%
							</span>
						{/if}
					</div>
					{#if numReject > 0 || numWaste > 0}
						<div class="balance-divider"></div>
						<div class="balance-item">
							<span class="balance-lbl">Total Kerugian:</span>
							<strong class="loss-val">{fmtKg(numReject + numWaste)} {unitLabel} ({(((numReject + numWaste) / (totalInput || 1)) * 100).toFixed(1)}%)</strong>
						</div>
					{/if}
				</div>

				<!-- Catatan Tambahan (Kompak) -->
				<!-- Fase 2C — riwayat input terakhir. Data ini SUDAH dikirim API sejak awal
				     (recentLogs), murni belum pernah dirender di UI — kemenangan tercepat, nol
				     biaya query tambahan. -->
				{#if (selectedSpkInfo?.recentLogs || []).length > 0}
					<div class="history-section">
						<div class="history-header">
							<IconFileText size={18} />
							<span>Riwayat Input Terakhir (SPK ini)</span>
						</div>
						<span class="history-hint">
							Untuk serah-terima shift — pastikan hasil shift sebelumnya sudah masuk sebelum Anda input.
						</span>
						<div class="history-list">
							{#each selectedSpkInfo.recentLogs as log}
								<div class="history-row">
									<span class="history-row__date">{log.tanggal}</span>
									<span class="history-row__by">{log.input_by || '—'}</span>
									<span class="history-row__nums">
										<strong class="hn-output">+{fmtKg(log.output_kg)}</strong>
										{#if Number(log.reject_kg) > 0}<span class="hn-reject">R {fmtKg(log.reject_kg)}</span>{/if}
										{#if Number(log.waste_kg) > 0}<span class="hn-waste">W {fmtKg(log.waste_kg)}</span>{/if}
										{unitLabel}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="notes-section">
					<div class="notes-header">
						<IconFileText size={18} />
						<label for="input-catatan">Catatan Produksi (opsional):</label>
					</div>
					<input
						id="input-catatan"
						class="kiosk-input notes-input"
						type="text"
						placeholder="Contoh: Mesin sempat mati 10 menit, batch bahan agak kental..."
						bind:value={catatan}
					/>
				</div>

				<!-- Fase 3C / File 04 §2.1 — pilihan selesai. Menyambungkan SPK ke antrean Kiosk QC
				     saat disimpan. Kunci ganda: kumulatif > 0 (dicek di requestMarkComplete) + modal
				     konfirmasi eksplisit di bawah sebelum benar-benar aktif. -->
				<fieldset class="finish-choice" aria-label="Apakah SPK ini sudah selesai semua?">
					<legend>Apakah produksi SPK ini sudah <b>selesai semua</b>?</legend>
					<div class="finish-choice-buttons">
						<button type="button" class="finish-btn" class:active={!markComplete} onclick={() => (markComplete = false)}>
							⏳ Belum, masih lanjut
						</button>
						<button type="button" class="finish-btn finish-btn--done" class:active={markComplete} onclick={requestMarkComplete}>
							✅ Sudah selesai semua
						</button>
					</div>
					{#if markComplete}
						<p class="finish-choice-hint">SPK akan masuk antrean Kiosk QC untuk diperiksa setelah SIMPAN ditekan.</p>
					{/if}
				</fieldset>

				<!-- Action Submit Footer -->
				<div class="action-footer">
					<button
						class="submit-btn"
						class:submit-btn--complete={markComplete}
						disabled={submitting || outputKosong || Number(outputKg) < 0 || (numOutput === 0 && numReject === 0 && numWaste === 0)}
						onclick={submit}
					>
						{#if submitting}
							<IconLoader2 size={24} class="animate-spin" />
							<span>Menyimpan Hasil Produksi...</span>
						{:else if markComplete}
							<IconCheck size={24} stroke={3} />
							<span>SIMPAN & SELESAIKAN SPK ({fmtKg(numOutput)} {unitLabel})</span>
						{:else}
							<IconCheck size={24} stroke={3} />
							<span>SIMPAN HASIL PRODUKSI ({fmtKg(numOutput)} {unitLabel})</span>
						{/if}
					</button>
				</div>

				<!-- Fase 3C — kunci kedua: konfirmasi eksplisit sebelum toggle benar-benar aktif. -->
				{#if showMarkCompleteConfirm}
					<div class="overprod-modal-backdrop" onclick={cancelMarkComplete}>
						<div class="overprod-modal" onclick={(e) => e.stopPropagation()}>
							<IconAlertTriangle size={32} class="overprod-icon" />
							<h3>Selesaikan SPK Ini?</h3>
							<p>
								SPK <strong>{selectedSpkInfo?.spk?.nomor}</strong> akan masuk antrean
								<strong>Kiosk QC</strong> setelah Anda menekan SIMPAN. Tindakan ini sulit dibatalkan
								dari kiosk — pastikan produksi memang sudah tuntas.
							</p>
							<div class="overprod-modal__actions">
								<button class="overprod-btn overprod-btn--cancel" onclick={cancelMarkComplete}>
									Belum, Batal
								</button>
								<button class="overprod-btn overprod-btn--confirm" onclick={confirmMarkComplete}>
									Ya, Ini Sudah Tuntas
								</button>
							</div>
						</div>
					</div>
				{/if}

				<!-- Fase 2B — jeda konfirmasi over-production. Tombol default "Batal" (Aturan #6:
				     ini bukan gate keras, server tetap menyimpan bila operator melanjutkan). -->
				{#if showOverproductionConfirm}
					<div class="overprod-modal-backdrop" onclick={() => (showOverproductionConfirm = false)}>
						<div class="overprod-modal" onclick={(e) => e.stopPropagation()}>
							<IconAlertTriangle size={32} class="overprod-icon" />
							<h3>Output Melebihi Target?</h3>
							<p>
								Total akan menjadi <strong>{fmtKg(newCumulative)} {unitLabel}</strong>, sekitar
								<strong>{overproducePct > 0 ? overproducePct : 0}%</strong> di atas target
								<strong>{fmtKg(targetKg)} {unitLabel}</strong>. Yakin ini bukan salah ketik?
							</p>
							<div class="overprod-modal__actions">
								<button class="overprod-btn overprod-btn--cancel" onclick={() => (showOverproductionConfirm = false)}>
									Batal, Cek Lagi
								</button>
								<button class="overprod-btn overprod-btn--confirm" onclick={doSubmit}>
									Ya, Tetap Simpan
								</button>
							</div>
						</div>
					</div>
				{/if}
			{/if}
		{/if}
	</div>
{/if}

<style>
	/* Reset & Shell Layout */
	.kiosk-container {
		padding: 1rem 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		max-width: 100%;
		margin: 0;
		box-sizing: border-box;
		min-height: 100%;
		color: #0f172a;
	}

	/* Header */
	.kiosk-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #e2e8f0;
	}
	.back-btn {
		background: #ffffff;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.65rem;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #1e293b;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 1px 2px rgba(0,0,0,0.05);
	}
	.back-btn:hover {
		background: #f1f5f9;
		border-color: #94a3b8;
	}
	.header-titles {
		flex: 1;
	}
	h1 {
		font-size: 1.35rem;
		font-weight: 800;
		margin: 0;
		color: #0f172a;
		letter-spacing: -0.02em;
	}
	.subtitle {
		font-size: 0.85rem;
		color: #64748b;
		display: block;
		margin-top: 0.15rem;
	}
	.switch-spk-btn {
		background: #ffffff;
		border: 1.5px solid #cbd5e1;
		color: #334155;
		font-size: 0.85rem;
		font-weight: 700;
		padding: 0.5rem 0.9rem;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	/* R7 — badge sisa antrian offline */
	.queued-badge {
		background: #eff6ff;
		border: 1.5px solid #93c5fd;
		color: #1d4ed8;
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.gagal-badge {
		background: #fef2f2;
		border: 1.5px solid #fca5a5;
		color: #b91c1c;
		font-size: 0.8rem;
		font-weight: 800;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		white-space: nowrap;
		cursor: pointer;
	}
	.gagal-panel {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.75rem;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.gagal-panel-title {
		font-weight: 800;
		color: #991b1b;
	}
	.gagal-row {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: #ffffff;
		border: 1px solid #fecaca;
		border-radius: 0.6rem;
		padding: 0.6rem 0.75rem;
	}
	.gagal-row small {
		color: #7f1d1d;
	}
	.gagal-dismiss {
		align-self: flex-start;
		min-height: 40px;
		background: #fff;
		border: 1.5px solid #b91c1c;
		color: #b91c1c;
		font-weight: 700;
		border-radius: 0.5rem;
		padding: 0 0.9rem;
		cursor: pointer;
	}
	.switch-spk-btn:hover {
		background: #f8fafc;
		border-color: #94a3b8;
	}

	/* Center Loading & Empty */
	.center-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
		gap: 0.75rem;
		color: #64748b;
		font-weight: 600;
	}
	.empty-box {
		background: #ffffff;
		border: 2px dashed #cbd5e1;
		border-radius: 1rem;
		padding: 2.5rem 1.5rem;
		text-align: center;
		color: #64748b;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.empty-box strong {
		color: #1e293b;
		font-size: 1.1rem;
	}
	.empty-box span {
		max-width: 480px;
		font-size: 0.9rem;
		line-height: 1.4;
	}
	.error-banner {
		background: #fef2f2;
		border: 1.5px solid #fecaca;
		color: #b91c1c;
		padding: 0.85rem 1.25rem;
		border-radius: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-weight: 600;
		font-size: 0.95rem;
	}

	/* Bug 5 — umpan balik hasil scan barcode di halaman ini */
	.scan-banner {
		background: #ecfdf5;
		border: 1.5px solid #a7f3d0;
		color: #047857;
		padding: 0.85rem 1.25rem;
		border-radius: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-weight: 600;
		font-size: 0.95rem;
	}
	.scan-banner--err {
		background: #fff7ed;
		border-color: #fed7aa;
		color: #c2410c;
	}

	/* SPK Picker Grid (When picking) */
	.spk-picker-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.section-title {
		font-size: 1rem;
		font-weight: 700;
		color: #334155;
	}
	.spk-card-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1rem;
	}
	.spk-card-btn {
		background: #ffffff;
		border: 2px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 1.1rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
		box-shadow: 0 1px 3px rgba(0,0,0,0.04);
	}
	.spk-card-btn:hover {
		border-color: #16a34a;
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(22,163,74,0.12);
	}
	.spk-card-btn--disabled {
		cursor: default;
		background: #f8fafc;
		border-color: #e2e8f0;
		opacity: 0.85;
	}
	.spk-card-btn--disabled:hover {
		border-color: #e2e8f0;
		transform: none;
		box-shadow: 0 1px 3px rgba(0,0,0,0.04);
	}
	.belum-mulai-toggle {
		align-self: flex-start;
		background: none;
		border: none;
		color: #475569;
		font-weight: 700;
		font-size: 0.95rem;
		cursor: pointer;
		padding: 0.4rem 0;
	}
	.belum-mulai-hint {
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		color: #475569;
		font-size: 0.88rem;
		padding: 0.65rem 0.85rem;
		border-radius: 0.6rem;
	}
	.minta-mulai-btn {
		width: 100%;
		min-height: 46px;
		background: #f59e0b;
		color: #0f172a;
		border: none;
		border-radius: 0.6rem;
		font-weight: 800;
		cursor: pointer;
	}
	.minta-mulai-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.minta-mulai-done {
		color: #15803d;
		font-weight: 700;
		font-size: 0.88rem;
	}
	.spk-card-top {
		display: flex;
		gap: 0.5rem;
		width: 100%;
	}
	.spk-badge {
		background: #eff6ff;
		color: #1d4ed8;
		font-size: 0.85rem;
		font-weight: 800;
		padding: 0.25rem 0.5rem;
		border-radius: 0.35rem;
	}
	.batch-badge {
		background: #f1f5f9;
		color: #475569;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 0.35rem;
	}
	.spk-product-name {
		font-size: 1.05rem;
		color: #0f172a;
		font-weight: 700;
		line-height: 1.35;
	}
	.spk-card-bottom {
		display: flex;
		justify-content: space-between;
		width: 100%;
		font-size: 0.9rem;
		color: #64748b;
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px dashed #e2e8f0;
	}
	.spk-action-hint {
		color: #16a34a;
		font-weight: 700;
	}

	/* Active SPK Card */
	.active-spk-banner {
		background: #ffffff;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.85rem;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		box-shadow: 0 1px 3px rgba(0,0,0,0.03);
	}
	.spk-banner-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #64748b;
		font-size: 0.9rem;
	}
	.spk-banner-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}
	.spk-banner-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.spk-badges-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.spk-nomor-tag {
		background: #0284c7;
		color: white;
		font-weight: 800;
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border-radius: 0.35rem;
		letter-spacing: 0.02em;
	}
	.spk-batch-tag {
		background: #e0f2fe;
		color: #0369a1;
		font-weight: 700;
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		border-radius: 0.35rem;
	}
	.spk-product-title {
		font-size: 1.15rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
	}
	.spk-target-stats {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.65rem;
		padding: 0.6rem 1rem;
	}
	.stat-col {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.stat-lbl {
		font-size: 0.75rem;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.stat-val {
		font-size: 1rem;
		font-weight: 800;
		color: #1e293b;
	}
	.stat-val--done {
		color: #16a34a;
	}
	.stat-val--remaining {
		color: #d97706;
	}
	.stat-divider {
		width: 1px;
		height: 28px;
		background: #cbd5e1;
	}

	/* SPK Progress Row */
	.spk-progress-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.prog-track {
		flex: 1;
		height: 10px;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
		position: relative;
	}
	.prog-fill {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		border-radius: 999px;
		transition: width 0.3s ease;
	}
	.prog-fill--base {
		background: #16a34a;
		z-index: 2;
	}
	.prog-fill--delta {
		background: #86efac;
		z-index: 1;
	}
	.prog-pct-text {
		font-size: 0.85rem;
		font-weight: 800;
		color: #1e293b;
		min-width: 70px;
		text-align: right;
	}
	.delta-text {
		color: #16a34a;
	}

	/* Metrics Grid */
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}
	@media (max-width: 820px) {
		.metrics-grid {
			grid-template-columns: 1fr;
		}
	}

	/* Metric Card */
	.metric-card {
		background: #ffffff;
		border: 2px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.metric-card:focus-within {
		box-shadow: 0 4px 14px rgba(0,0,0,0.06);
	}
	.metric-card--output {
		border-color: #bbf7d0;
		background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 40%);
	}
	.metric-card--output:focus-within {
		border-color: #16a34a;
	}
	.metric-card--reject {
		border-color: #fecdd3;
		background: linear-gradient(180deg, #fff1f2 0%, #ffffff 40%);
	}
	.metric-card--reject:focus-within {
		border-color: #e11d48;
	}
	.metric-card--waste {
		border-color: #fed7aa;
		background: linear-gradient(180deg, #fff7ed 0%, #ffffff 40%);
	}
	.metric-card--waste:focus-within {
		border-color: #ea580c;
	}

	.metric-card-header {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.metric-icon {
		width: 38px;
		height: 38px;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.metric-icon--output {
		background: #dcfce7;
		color: #15803d;
	}
	.metric-icon--reject {
		background: #ffe4e6;
		color: #be123c;
	}
	.metric-icon--waste {
		background: #ffedd5;
		color: #c2410c;
	}
	.metric-header-text {
		display: flex;
		flex-direction: column;
	}
	.metric-title {
		font-size: 0.95rem;
		font-weight: 800;
		color: #0f172a;
		cursor: pointer;
	}
	.metric-hint {
		font-size: 0.78rem;
		color: #64748b;
	}

	/* Input Row & Input Isolation (Protects from dark mode leak) */
	.input-row {
		display: flex;
		align-items: center;
		position: relative;
	}
	.kiosk-input {
		width: 100%;
		padding: 0.85rem 3.5rem 0.85rem 1rem;
		font-size: 1.35rem;
		font-weight: 800;
		background-color: #ffffff !important;
		color: #0f172a !important;
		border: 2px solid #cbd5e1;
		border-radius: 0.65rem;
		box-sizing: border-box;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		-moz-appearance: textfield;
	}
	.kiosk-input::-webkit-outer-spin-button,
	.kiosk-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.kiosk-input:focus {
		outline: none;
		border-color: #16a34a;
		box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
	}
	.metric-card--reject .kiosk-input:focus {
		border-color: #e11d48;
		box-shadow: 0 0 0 3px rgba(225, 29, 72, 0.15);
	}
	.metric-card--waste .kiosk-input:focus {
		border-color: #ea580c;
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.15);
	}
	.kiosk-input--hero {
		font-size: 1.6rem;
		color: #15803d !important;
		font-weight: 900;
	}
	.unit-badge {
		position: absolute;
		right: 1rem;
		font-size: 0.95rem;
		font-weight: 800;
		color: #94a3b8;
		pointer-events: none;
	}

	/* Quick Increment Buttons */
	.quick-buttons {
		display: flex;
		gap: 0.35rem;
	}
	.q-btn {
		flex: 1;
		padding: 0.5rem 0.2rem;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		border-radius: 0.4rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: #334155;
		cursor: pointer;
		transition: all 0.12s ease;
	}
	.q-btn:hover {
		background: #e2e8f0;
		color: #0f172a;
	}
	.q-btn:active {
		transform: scale(0.94);
	}
	.q-btn--clear {
		flex: 0 0 36px;
		background: #fee2e2;
		border-color: #fca5a5;
		color: #b91c1c;
	}
	.q-btn--clear:hover {
		background: #fecaca;
	}

	/* Balance & Yield Bar */
	.balance-bar {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.65rem;
		padding: 0.75rem 1.25rem;
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex-wrap: wrap;
		box-shadow: 0 1px 2px rgba(0,0,0,0.03);
	}
	.balance-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.balance-lbl {
		color: #64748b;
		font-weight: 600;
	}
	.balance-val {
		color: #0f172a;
		font-size: 1.05rem;
	}
	.balance-divider {
		width: 1px;
		height: 22px;
		background: #e2e8f0;
	}
	.yield-tag {
		font-weight: 800;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.85rem;
	}
	.yield-green {
		background: #dcfce7;
		color: #15803d;
	}
	.yield-amber {
		background: #fef3c7;
		color: #b45309;
	}
	.yield-red {
		background: #fee2e2;
		color: #b91c1c;
	}
	/* Bug 9 — keadaan netral saat form masih kosong (bukan hijau 100%) */
	.yield-neutral {
		background: #f1f5f9;
		color: #64748b;
	}
	.loss-val {
		color: #b91c1c;
		font-size: 0.95rem;
	}

	/* Fase 2A — chip alasan reject/waste */
	.reason-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.35rem;
		border-top: 1px dashed #e2e8f0;
	}
	.reason-hint {
		font-size: 0.75rem;
		color: #64748b;
		font-weight: 600;
	}
	.reason-chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.reason-chip {
		background: #f8fafc;
		border: 1.5px solid #cbd5e1;
		color: #475569;
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		cursor: pointer;
		min-height: 44px;
		transition: all 0.12s ease;
	}
	.reason-chip--reject.reason-chip--active {
		background: #ffe4e6;
		border-color: #fb7185;
		color: #9f1239;
	}
	.reason-chip--waste.reason-chip--active {
		background: #ffedd5;
		border-color: #fb923c;
		color: #9a3412;
	}

	/* Fase 2C — Riwayat Input Terakhir */
	.history-section {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.65rem;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.history-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #334155;
		font-size: 0.9rem;
		font-weight: 800;
	}
	.history-hint {
		font-size: 0.78rem;
		color: #64748b;
		margin-bottom: 0.2rem;
	}
	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 180px;
		overflow-y: auto;
	}
	.history-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.45rem 0.6rem;
		background: #f8fafc;
		border-radius: 0.5rem;
		font-size: 0.85rem;
	}
	.history-row__date {
		font-weight: 700;
		color: #334155;
		flex-shrink: 0;
	}
	.history-row__by {
		color: #64748b;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.history-row__nums {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 700;
		color: #334155;
		flex-shrink: 0;
	}
	.hn-output {
		color: #15803d;
	}
	.hn-reject {
		color: #be123c;
		font-size: 0.8rem;
	}
	.hn-waste {
		color: #c2410c;
		font-size: 0.8rem;
	}

	/* Fase 2B — modal konfirmasi over-production */
	.overprod-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		z-index: 200;
	}
	.overprod-modal {
		background: #ffffff;
		border-radius: 1.1rem;
		padding: 1.75rem 1.5rem;
		max-width: 420px;
		width: 100%;
		text-align: center;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
	}
	:global(.overprod-icon) {
		color: #d97706;
		margin-bottom: 0.5rem;
	}
	.overprod-modal h3 {
		margin: 0 0 0.5rem;
		font-size: 1.15rem;
		font-weight: 900;
		color: #0f172a;
	}
	.overprod-modal p {
		margin: 0;
		font-size: 0.92rem;
		color: #475569;
		line-height: 1.5;
	}
	.overprod-modal__actions {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}
	.overprod-btn {
		min-height: 52px;
		border-radius: 0.7rem;
		font-weight: 800;
		font-size: 0.95rem;
		border: none;
		cursor: pointer;
	}
	.overprod-btn--cancel {
		background: #16a34a;
		color: #ffffff;
	}
	.overprod-btn--confirm {
		background: #f1f5f9;
		color: #64748b;
		border: 1.5px solid #cbd5e1;
	}

	/* Notes Section */
	.notes-section {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.65rem;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.notes-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #64748b;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.notes-input {
		font-size: 0.95rem;
		font-weight: 500;
		padding: 0.6rem 0.85rem;
	}

	/* Submit Action Footer */
	.action-footer {
		padding-top: 0.5rem;
		padding-bottom: 1.5rem;
	}
	.submit-btn {
		width: 100%;
		min-height: 62px;
		background: #16a34a;
		color: #ffffff;
		border: none;
		border-radius: 0.85rem;
		font-size: 1.25rem;
		font-weight: 900;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(22, 163, 74, 0.35);
		transition: all 0.15s ease;
		letter-spacing: 0.02em;
	}
	.submit-btn:hover:not(:disabled) {
		background: #15803d;
		box-shadow: 0 6px 16px rgba(22, 163, 74, 0.45);
		transform: translateY(-1px);
	}
	.submit-btn:active:not(:disabled) {
		transform: scale(0.98);
	}
	.submit-btn:disabled {
		background: #94a3b8;
		box-shadow: none;
		cursor: not-allowed;
		opacity: 0.75;
	}

	/* Success Overlay */
	.success-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.85);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		z-index: 100;
	}
	.success-card {
		background: #ffffff;
		border-radius: 1.25rem;
		padding: 2.25rem 2rem;
		max-width: 480px;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.85rem;
		box-shadow: 0 20px 40px rgba(0,0,0,0.3);
		color: #0f172a;
	}
	.success-icon-wrap {
		width: 80px;
		height: 80px;
		background: #dcfce7;
		color: #16a34a;
		border-radius: 999px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.25rem;
	}
	.success-card h2 {
		font-size: 1.45rem;
		font-weight: 900;
		color: #0f172a;
		margin: 0;
	}
	.success-spk {
		font-size: 0.95rem;
		color: #64748b;
		margin: 0;
		font-weight: 600;
	}
	/* R7 — keterangan saat entri masuk antrian offline, bukan tersimpan penuh di server */
	.success-queued {
		background: #eff6ff;
		border: 1.5px solid #93c5fd;
		color: #1e40af;
		padding: 0.6rem 0.9rem;
		border-radius: 0.6rem;
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.4;
		margin: 0.5rem 0 0;
	}
	/* Bug 4 — keterangan saat submit ulang terdeteksi (bukan error, bukan pula data baru) */
	.success-dupe {
		background: #eff6ff;
		border: 1.5px solid #bfdbfe;
		color: #1d4ed8;
		padding: 0.6rem 0.9rem;
		border-radius: 0.6rem;
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.4;
		margin: 0.5rem 0 0;
	}
	.success-overprod {
		background: #fffbeb;
		border: 1.5px solid #fde68a;
		color: #92400e;
		padding: 0.6rem 0.9rem;
		border-radius: 0.6rem;
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.4;
		margin: 0.5rem 0 0;
	}
	/* Fase 3C — hasil transisi qc_pending di kartu sukses */
	.success-markcomplete {
		background: #eef2ff;
		border: 1.5px solid #c7d2fe;
		color: #3730a3;
		padding: 0.6rem 0.9rem;
		border-radius: 0.6rem;
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.4;
		margin: 0.5rem 0 0;
	}
	.success-markcomplete--err {
		background: #fef2f2;
		border-color: #fecaca;
		color: #b91c1c;
	}

	/* Fase 3D — banner shift read-only */
	.shift-banner {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.6rem;
		padding: 0.5rem 0.9rem;
		font-size: 0.85rem;
	}
	.shift-banner__label {
		color: #64748b;
		font-weight: 700;
	}
	.shift-banner__value {
		color: #0f172a;
		font-weight: 800;
	}
	.shift-banner__value--muted {
		color: #94a3b8;
		font-weight: 600;
	}
	.shift-banner__link {
		margin-left: auto;
		background: none;
		border: none;
		color: #0284c7;
		font-weight: 700;
		font-size: 0.8rem;
		cursor: pointer;
		text-decoration: underline;
		min-height: 32px;
	}
	.shift-banner__select {
		width: 100%;
		padding: 0.5rem;
		border: 1.5px solid #cbd5e1;
		border-radius: 0.5rem;
		font-size: 0.85rem;
		color: #0f172a;
		background: #ffffff;
	}

	/* Fase 3A — cari SPK */
	.spk-search-input {
		font-size: 0.95rem !important;
		font-weight: 600 !important;
		padding: 0.65rem 1rem !important;
	}
	.spk-search-empty {
		color: #64748b;
		font-size: 0.9rem;
		padding: 1rem;
		text-align: center;
	}
	/* B1 — penanda "Menampilkan X dari Y" + tombol Muat Lebih Banyak */
	.spk-total-hint {
		color: #64748b;
		font-size: 0.82rem;
		margin: 0.35rem 0.15rem 0.75rem;
	}
	.spk-load-more-btn {
		width: 100%;
		justify-content: center;
		margin-top: 0.75rem;
	}

	/* Fase 3C — toggle Batch Tuntas */
	.finish-choice {
		border: 1.5px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 0.85rem 1rem;
		margin: 0;
	}
	.finish-choice legend {
		font-size: 0.92rem;
		font-weight: 700;
		color: #334155;
		padding: 0 0.3rem;
	}
	.finish-choice-buttons {
		display: flex;
		gap: 0.6rem;
	}
	.finish-btn {
		flex: 1;
		min-height: 56px;
		border: 2px solid #e2e8f0;
		background: #f8fafc;
		color: #475569;
		font-weight: 800;
		font-size: 0.98rem;
		border-radius: 0.65rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.finish-btn.active {
		background: #eef2ff;
		border-color: #6366f1;
		color: #312e81;
	}
	.finish-btn--done.active {
		background: #dcfce7;
		border-color: #16a34a;
		color: #14532d;
	}
	.finish-choice-hint {
		margin: 0.6rem 0 0;
		font-size: 0.85rem;
		color: #64748b;
	}
	.submit-btn--complete {
		background: #4f46e5;
		box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
	}
	.submit-btn--complete:hover:not(:disabled) {
		background: #4338ca;
		box-shadow: 0 6px 16px rgba(79, 70, 229, 0.45);
	}

	.success-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		width: 100%;
		margin: 0.75rem 0;
	}
	.success-item {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.65rem;
		padding: 0.65rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.success-item .lbl {
		font-size: 0.75rem;
		color: #64748b;
		font-weight: 600;
	}
	.success-item strong {
		font-size: 1.05rem;
		color: #1e293b;
	}
	.success-item--output {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.success-item--output strong {
		color: #15803d;
	}
	.success-variance {
		width: 100%;
		background: #f8fafc;
		border: 1px dashed #cbd5e1;
		border-radius: 0.65rem;
		padding: 0.65rem 0.85rem;
		font-size: 0.85rem;
		color: #475569;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.prog-bar-bg {
		width: 100%;
		height: 8px;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
	}
	.prog-bar-fill {
		height: 100%;
		background: #16a34a;
		border-radius: 999px;
	}
	.success-btn {
		width: 100%;
		min-height: 52px;
		background: #16a34a;
		color: white;
		border: none;
		border-radius: 0.75rem;
		font-weight: 800;
		font-size: 1rem;
		cursor: pointer;
		margin-top: 0.5rem;
		transition: background 0.15s ease;
	}
	.success-btn:hover {
		background: #15803d;
	}
	.label-qty-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		z-index: 16000;
	}
	.label-qty-card {
		background: #fff;
		color: #0f172a;
		border-radius: 1rem;
		padding: 1.5rem;
		max-width: 360px;
		width: 100%;
	}
	.label-qty-card h3 { margin: 0 0 1rem; font-size: 1.1rem; font-weight: 800; }
	.label-qty-options { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.label-qty-opt {
		flex: 1;
		min-width: 60px;
		min-height: 56px;
		border: 2px solid #cbd5e1;
		background: #f8fafc;
		color: #334155;
		font-weight: 800;
		font-size: 1.1rem;
		border-radius: 0.7rem;
		cursor: pointer;
	}
	.label-qty-opt.active { background: #4f46e5; border-color: #4f46e5; color: #fff; }
	.label-qty-custom {
		flex: 1;
		min-width: 90px;
		min-height: 56px;
		border: 2px solid #cbd5e1;
		border-radius: 0.7rem;
		text-align: center;
		font-size: 1.05rem;
	}
	.label-qty-cetak {
		width: 100%;
		min-height: 56px;
		margin-top: 1.25rem;
		background: #16a34a;
		color: #fff;
		border: none;
		border-radius: 0.75rem;
		font-weight: 800;
		font-size: 1.05rem;
		cursor: pointer;
	}
	/* Fase 4A — tombol cetak label, terpisah warna dari CTA utama */
	.success-btn--print {
		background: #4f46e5;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.success-btn--print:hover {
		background: #4338ca;
	}
	.success-btn--print:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
</style>
