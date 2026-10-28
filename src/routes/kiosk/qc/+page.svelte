<!-- src/routes/kiosk/qc/+page.svelte -->
<!-- Fase 1-4, rencana Kiosk QC Produksi (8-9 Sep 2026) §6. 3 layar: pilih SPK -> input parameter
  (foto wajib per parameter, tanpa indikator hijau/merah live -- §3.5.2) -> ringkasan (badge
  pass/fail dihitung sekali di sini, bukan per keystroke) -> overlay nama besar 3 detik.
  Fase 3: suhu/RH diisi MANUAL (pertanyaan kunci Fase 3 dijawab -- tidak ada infra sensor IoT
  di lini produksi ini, sesuai fallback yang disarankan dokumen sendiri), sekali per submission
  (kondisi ruang uji, bukan per parameter -- field suhu_uji/rh_uji di qc_results memang berlaku
  di level baris tapi nilainya sama untuk semua baris dalam satu sesi uji).
  Fase 4: kalau ada parameter gagal, overlay sukses menawarkan quick-flag rework (boolean
  sederhana, §7 Fase 4 -- BUKAN createRework() penuh) sebelum redirect ke home. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconCheck, IconCamera, IconAlertTriangle } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';
	import SampelPertinggalCard from '$lib/components/kiosk/SampelPertinggalCard.svelte';
	import { prepareKioskPhoto } from '$lib/kiosk/kioskPhoto';

	type Spec = {
		id: number;
		parameter: string;
		satuan: string;
		min_value: number | null;
		max_value: number | null;
		wajib: boolean;
		tahap: string | null;
		_lapisan?: string;
		_lapisan_label?: string;
		kondisi_uji?: string;
		suhu_uji_c?: number | null;
		versi?: number;
		tds_min_value?: number | null;
		tds_max_value?: number | null;
		kode_fg_id?: number | null;
		customer_id?: number | null;
		untuk_customer?: boolean;
	};
	type Entry = {
		qc_spec_id: number;
		parameter: string;
		satuan: string;
		min_value: number | null;
		max_value: number | null;
		wajib: boolean;
		value: string;
		notes: string;
		fotoFile: File | null;
		fotoPreviewUrl: string | null;
		fotoProcessing?: boolean;
		_lapisan?: string;
		_lapisan_label?: string;
		kondisi_uji?: string;
		suhu_uji_c?: number | null;
		versi?: number;
		tds_min_value?: number | null;
		tds_max_value?: number | null;
		kode_fg_id?: number | null;
		customer_id?: number | null;
		untuk_customer?: boolean;
	};

	let step = $state<'pilih-spk' | 'parameter' | 'ringkasan' | 'sukses'>('pilih-spk');
	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');

	let spkList = $state<any[]>([]);
	let selectedSpk = $state<any | null>(null);
	let entries = $state<Entry[]>([]);
	let operatorNama = $state('');
	let instruksiProduksi = $state('');

	let hasilRingkasan = $state<{ lulus: number; marginal: number; gagal: number } | null>(null);
	let clientTxnId = '';
	let suhuUji = $state('');
	let rhUji = $state('');
	// Fase 6C — tahap produksi saat sampel diambil (opsional). Dipakai gate G_PRD_INPROCESS_QC_STAGES: tahap lanjutan
	// (mis. Letdown) belum boleh jalan sebelum tahap wajib (mis. Grinding) lulus uji.
	const TAHAP_PRODUKSI = [
		{ v: 'premix', l: 'Premix' },
		{ v: 'grinding', l: 'Grinding' },
		{ v: 'letdown', l: 'Letdown' },
		{ v: 'tinting', l: 'Tinting' },
		{ v: 'final', l: 'Final' }
	];
	let tahapUji = $state('');

	// Fase 4 -- quick-flag rework (BUKAN createRework() penuh, §7 Fase 4). Hanya ditawarkan
	// kalau ADA parameter gagal -- kalau semua lulus, auto-redirect seperti biasa.
	// Fase 6.1 (rencana lifecycle produksi v2, 15 Sep 2026): kategori defect + foto WAJIB,
	// pengganti boolean+catatan bebas.
	let showReworkPrompt = $state(false);
	let reworkNote = $state('');
	let reworkCategory = $state('');
	let reworkFotoFile = $state<File | null>(null);
	let reworkFotoPreviewUrl = $state<string | null>(null);
	let reworkSubmitting = $state(false);
	let reworkFlagged = $state(false);
	let reworkError = $state('');
	let reworkClientTxnId = '';
	let redirectTimer: ReturnType<typeof setTimeout> | null = null;

	// Draf Otomatis (Fase 5 Lapis 2): entries adalah array JS dinamis (nilai ukur +
	// catatan per parameter spec), tidak tertangkap Lapis 1. Foto TIDAK ikut disimpan
	// (kiosk tablet dipakai bergilir, foto bukti alat ukur idealnya diambil ulang saat
	// benar-benar melanjutkan sesi) -- operator diminta ambil ulang, konsisten dengan
	// pola lampiran di form admin lain. Scope per SPK; purge saat ganti operator = Fase 6.
	interface QcDraft {
		entries: { qc_spec_id: number; value: string; notes: string }[];
		suhuUji: string;
		rhUji: string;
	}
	let qcPersist: ReturnType<typeof createFormPersist<QcDraft>> | null = null;
	let qcPersistScopeId: number | null = null;
	let qcSaveTriggerCleanup: (() => void) | null = null;
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);
	let draftArmed = $state(false);

	function snapshotQcDraft(): QcDraft {
		return {
			entries: entries.map((e) => ({ qc_spec_id: e.qc_spec_id, value: e.value, notes: e.notes })),
			suhuUji,
			rhUji
		};
	}

	function applyQcDraft(draft: QcDraft) {
		if (draft.suhuUji) suhuUji = draft.suhuUji;
		if (draft.rhUji) rhUji = draft.rhUji;
		if (Array.isArray(draft.entries) && draft.entries.length) {
			const byId = new Map(draft.entries.map((e) => [e.qc_spec_id, e]));
			entries = entries.map((e) => {
				const saved = byId.get(e.qc_spec_id);
				if (!saved) return e;
				return { ...e, value: saved.value ?? e.value, notes: saved.notes ?? e.notes };
			});
		}
	}

	function checkQcDraft() {
		if (!qcPersist) return;
		const draft = qcPersist.restore();
		if (!draft) return;
		draftRestoreInfo = {
			savedAt: qcPersist.savedAt(),
			apply: () => applyQcDraft(draft),
			discard: () => qcPersist?.clear()
		};
	}

	const DEFECT_CATEGORIES = [
		{ value: 'paint_quality', label: 'Kualitas Cat' },
		{ value: 'contamination', label: 'Kontaminasi' },
		{ value: 'application', label: 'Masalah Aplikasi' },
		{ value: 'packaging', label: 'Kemasan' },
		{ value: 'other', label: 'Lainnya' }
	];

	// §3.5.3 minta "nama + foto operator" di overlay sukses -- overlay ini cuma nama besar.
	// Beda dari absen-istirahat (pola rujukan §6 poin 4) yang memang punya momen kamera live
	// (scan QR badge per-tap) sehingga snapshot alami diambil di situ; kiosk QC memakai sesi
	// badge+PIN yang sudah terverifikasi sejak login, tidak ada momen kamera per-transaksi utk
	// diambil snapshotnya. Kontrol sosial (nama tampil besar) tetap ada; kalau foto operator
	// live dianggap perlu juga, itu perlu keputusan produk terpisah (tambah langkah kamera).

	/** Bug 6 — tampilan angka kg. Bulatkan 2 desimal, buang trailing zero, aman terhadap null.
	 *  `spk.quantity` datang dari Directus sebagai string float mentah (mis. "45.7142857142857"). */
	function fmtKg(n: unknown): string {
		const v = Number(n);
		if (!Number.isFinite(v)) return '0';
		return String(Math.round(v * 100) / 100);
	}

	function specsToEntries(specs: Spec[], isCustomer = false): Entry[] {
		return specs.map((s) => ({
			qc_spec_id: s.id,
			parameter: s.parameter,
			satuan: s.satuan,
			min_value: s.min_value,
			max_value: s.max_value,
			wajib: !!s.wajib,
			value: '',
			notes: '',
			fotoFile: null,
			fotoPreviewUrl: null,
			_lapisan: s._lapisan || (isCustomer ? 'customer' : 'internal'),
			_lapisan_label: s._lapisan_label || (isCustomer ? 'CUSTOMER' : 'INTERNAL'),
			kondisi_uji: s.kondisi_uji,
			suhu_uji_c: s.suhu_uji_c,
			versi: s.versi || 1,
			tds_min_value: s.tds_min_value,
			tds_max_value: s.tds_max_value,
			kode_fg_id: s.kode_fg_id,
			customer_id: s.customer_id,
			untuk_customer: isCustomer
		}));
	}

	async function loadSpkList() {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/kiosk/qc');
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat daftar SPK.');
			spkList = data.spkList || [];
			operatorNama = data.karyawan?.nama || '';
			// File 08 §2.4 — auto-pilih hanya kalau SPK tunggal itu BELUM diuji. Kalau sudah
			// diuji, tetap tampilkan daftar supaya operator melihat tanda "sudah diuji" dulu.
			if (spkList.length === 1 && !spkList[0].qcRingkas) {
				await pilihSpk(spkList[0]);
			}
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat daftar SPK.';
		} finally {
			loading = false;
		}
	}

	async function pilihSpk(spk: any) {
		// File 08 §2.4 — SPK yang sudah diuji tetap boleh diuji ulang (Aturan #6, jangan
		// mematikan jalur tanpa alternatif), tapi operator wajib sadar dulu.
		if (
			spk.qcRingkas &&
			!confirm(`SPK ${spk.nomor} sudah diuji (${spk.qcRingkas.total} parameter). Uji ulang hanya kalau diminta QA. Lanjut?`)
		) {
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/kiosk/qc?spkId=${spk.id}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat spesifikasi QC.');
			selectedSpk = data.selectedSpk;
			instruksiProduksi = data.instruksi_produksi || '';
			const internalEntries = specsToEntries(data.internal || data.specs || [], false);
			const customerEntries = specsToEntries(data.customer || [], true);
			entries = [...internalEntries, ...customerEntries];
			if (entries.length === 0) {
				errorMsg = 'Produk ini belum punya spesifikasi QC aktif. Hubungi R&D/Supervisor.';
				return;
			}
			if (spk.qcRingkas) entries = entries.map((e) => ({ ...e, notes: e.notes || 'Uji ulang' }));
			clientTxnId = crypto.randomUUID();
			tahapUji = '';
			step = 'parameter';

			qcSaveTriggerCleanup?.();
			draftArmed = false;
			draftRestoreInfo = null;
			qcPersistScopeId = selectedSpk.id;
			qcPersist = createFormPersist<QcDraft>(`kiosk_qc_${selectedSpk.id}`);
			qcSaveTriggerCleanup = registerFormPersistSaveTriggers(qcPersist, snapshotQcDraft);
			checkQcDraft();
			draftArmed = true;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat spesifikasi QC.';
		} finally {
			loading = false;
		}
	}

	// File 08 §2.1 — foto kamera tablet (2-5 MB) dikirim apa adanya sebelumnya; QC 8 parameter
	// berarti satu request 16-40 MB, ditolak 413 sebelum BODY_SIZE_LIMIT dinaikkan (file 10) dan
	// tetap lambat di jaringan pabrik walau sudah dinaikkan. Kompres dulu di klien.
	async function onFotoChange(idx: number, e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		entries[idx] = { ...entries[idx], fotoProcessing: true };
		try {
			const small = await prepareKioskPhoto(file);
			if (entries[idx].fotoPreviewUrl) URL.revokeObjectURL(entries[idx].fotoPreviewUrl!);
			entries[idx] = { ...entries[idx], fotoFile: small, fotoPreviewUrl: URL.createObjectURL(small), fotoProcessing: false };
		} catch (err) {
			entries[idx] = { ...entries[idx], fotoProcessing: false };
			errorMsg = err instanceof Error ? err.message : 'Foto gagal diproses.';
		}
	}

	// File 08 §2.3 — parameter TANPA tanda wajib dulu tetap dipaksa diisi+foto di sini walau UI
	// (tanda `*`) sudah bilang "opsional". Sekarang benar-benar opsional: hanya parameter
	// `wajib` yang diharuskan; kalau parameter non-wajib diisi, foto tetap wajib menyertainya.
	function validasiSebelumRingkasan(): string | null {
		if (entries.some((e) => e.fotoProcessing)) return 'Tunggu foto selesai diproses.';
		for (const e of entries) {
			const kosong = e.value === '' || e.value == null;
			if (e.wajib && kosong) return `Parameter wajib "${e.parameter}" belum diisi.`;
			if (!kosong && Number.isNaN(Number(e.value))) return `Nilai "${e.parameter}" harus angka.`;
			if (!kosong && !e.fotoFile) return `Parameter "${e.parameter}" sudah diisi — tambahkan foto alat ukurnya.`;
		}
		if (!entries.some((e) => e.value !== '' && e.value != null)) return 'Isi minimal satu parameter.';
		return null;
	}

	function keRingkasan() {
		const err = validasiSebelumRingkasan();
		if (err) {
			errorMsg = err;
			return;
		}
		errorMsg = '';
		// Badge pass/fail DIHITUNG SEKALI di sini (bukan live per keystroke, §3.5.2) --
		// perhitungan verdict resmi tetap server-side saat submit, ini hanya preview kasar
		// untuk membantu operator sadar sebelum kirim.
		let lulus = 0, marginal = 0, gagal = 0;
		for (const e of entries) {
			// §2.3 — parameter opsional yang dikosongkan TIDAK dihitung ke ringkasan pass/fail.
			if (e.value === '' || e.value == null) continue;
			const v = Number(e.value);
			const min = e.min_value, max = e.max_value;
			const inRange = (min == null || v >= min) && (max == null || v <= max);
			if (inRange) lulus++;
			else {
				const span = (max ?? min ?? 1) - (min ?? max ?? 0) || 1;
				const tol = Math.abs(span) * 0.05;
				const dekat = (min != null && v < min && v >= min - tol) || (max != null && v > max && v <= max + tol);
				dekat ? marginal++ : gagal++;
			}
		}
		hasilRingkasan = { lulus, marginal, gagal };
		step = 'ringkasan';
	}

	async function submitHasil() {
		if (!selectedSpk) return;
		submitting = true;
		errorMsg = '';
		try {
			const form = new FormData();
			form.append('spkId', String(selectedSpk.id));
			const productId = selectedSpk.product_id?.id ?? selectedSpk.product_id;
			if (productId) form.append('productId', String(productId));
			form.append('clientTxnId', clientTxnId);
			form.append(
				'kondisiUji',
				JSON.stringify({
					suhuUji: suhuUji !== '' ? Number(suhuUji) : null,
					rhUji: rhUji !== '' ? Number(rhUji) : null,
					stage: tahapUji || null
				})
			);
			// §2.3 — kirim HANYA entri yang benar-benar terisi (parameter opsional yang dikosongkan
			// tidak dikirim sama sekali, bukan value:NaN). Index foto memakai index di ARRAY YANG
			// DIKIRIM (terisi), bukan index asli di `entries`, supaya server bisa memasangkan
			// entries[i] <-> foto_i dengan benar.
			const terisi = entries.filter((e) => e.value !== '' && e.value != null);
			form.append(
				'entries',
				JSON.stringify(
					terisi.map((e) => ({
						qc_spec_id: e.qc_spec_id,
						parameter: e.parameter,
						satuan: e.satuan,
						min_value: e.min_value,
						max_value: e.max_value,
						value: Number(e.value),
						notes: e.notes || null,
						spec_lapisan: e._lapisan || null,
						spec_versi: e.versi || 1,
						spec_min_asli: e.tds_min_value ?? e.min_value,
						spec_max_asli: e.tds_max_value ?? e.max_value,
						spec_satuan: e.satuan || null,
						spec_suhu_c: e.suhu_uji_c ?? null,
						kondisi_uji: e.kondisi_uji || null,
						kode_fg_id: e.kode_fg_id || null,
						customer_id: e.customer_id || null,
						untuk_customer: !!e.untuk_customer
					}))
				)
			);
			terisi.forEach((e, i) => {
				if (e.fotoFile) form.append(`foto_${i}`, e.fotoFile);
			});

			const res = await fetch('/api/kiosk/qc', { method: 'POST', body: form });
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal mengirim hasil QC.');

			qcPersist?.clear();
			draftRestoreInfo = null;
			step = 'sukses';
			if (hasilRingkasan && hasilRingkasan.gagal > 0) {
				// Ada parameter gagal -- tawarkan quick-flag rework dulu, jangan auto-redirect
				// supaya operator sempat memutuskan (bukan kelewat karena buru-buru 3 detik).
				reworkClientTxnId = crypto.randomUUID();
				showReworkPrompt = true;
			} else {
				redirectTimer = setTimeout(() => goto('/kiosk/home'), 3000);
			}
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mengirim hasil QC.';
		} finally {
			submitting = false;
		}
	}

	let reworkFotoProcessing = $state(false);
	async function onReworkFotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		reworkFotoProcessing = true;
		try {
			const small = await prepareKioskPhoto(file);
			if (reworkFotoPreviewUrl) URL.revokeObjectURL(reworkFotoPreviewUrl);
			reworkFotoFile = small;
			reworkFotoPreviewUrl = URL.createObjectURL(small);
		} catch (err) {
			reworkError = err instanceof Error ? err.message : 'Foto gagal diproses.';
		} finally {
			reworkFotoProcessing = false;
		}
	}

	async function submitFlagRework() {
		if (!selectedSpk) return;
		reworkError = '';
		if (!reworkCategory) {
			reworkError = 'Pilih kategori defect dulu.';
			return;
		}
		if (!reworkFotoFile) {
			reworkError = 'Foto defect wajib dilampirkan.';
			return;
		}
		reworkSubmitting = true;
		try {
			const form = new FormData();
			form.append('spkId', String(selectedSpk.id));
			form.append('defectCategory', reworkCategory);
			if (reworkNote.trim()) form.append('note', reworkNote.trim());
			form.append('foto', reworkFotoFile);
			form.append('clientTxnId', reworkClientTxnId);

			const res = await fetch('/api/kiosk/qc/flag-rework', { method: 'POST', body: form });
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.message || 'Gagal menandai untuk rework.');
			}
			reworkFlagged = true;
			showReworkPrompt = false;
			redirectTimer = setTimeout(() => goto('/kiosk/home'), 2500);
		} catch (e) {
			// Fatal untuk aksi ini (beda dari versi lama) -- Fase 6.1 mewajibkan kategori+foto,
			// jadi operator perlu tahu kalau gagal supaya bisa coba lagi, bukan diam-diam terlewat.
			reworkError = e instanceof Error ? e.message : 'Gagal menandai untuk rework.';
		} finally {
			reworkSubmitting = false;
		}
	}

	function lewatiFlagRework() {
		showReworkPrompt = false;
		redirectTimer = setTimeout(() => goto('/kiosk/home'), 1500);
	}

	$effect(() => {
		void entries;
		void suhuUji;
		void rhUji;
		if (!draftArmed || !qcPersist) return;
		qcPersist.save(snapshotQcDraft());
	});

	onMount(loadSpkList);
	onDestroy(() => {
		if (redirectTimer) clearTimeout(redirectTimer);
		if (reworkFotoPreviewUrl) URL.revokeObjectURL(reworkFotoPreviewUrl);
		qcSaveTriggerCleanup?.();
	});
</script>

{#if step === 'sukses'}
	<div class="success-overlay">
		<IconCheck size={80} />
		{#if operatorNama}<p class="success-nama">{operatorNama}</p>{/if}
		<p class="success-title">TERSIMPAN</p>
		{#if hasilRingkasan && hasilRingkasan.gagal + hasilRingkasan.marginal > 0}
			<p class="success-sub">
				{hasilRingkasan.gagal + hasilRingkasan.marginal} dari {hasilRingkasan.lulus + hasilRingkasan.marginal + hasilRingkasan.gagal} parameter
				di luar spec — diteruskan ke QA untuk keputusan lanjut (release / rework).
			</p>
		{/if}

		{#if showReworkPrompt}
			<div class="rework-prompt">
				<p class="rework-prompt-title">Tandai batch ini untuk ditinjau rework?</p>
				<p class="rework-prompt-hint">Sekadar sinyal untuk QA/supervisor — bukan keputusan final, bukan proses rework otomatis. Kategori & foto defect wajib diisi.</p>

				{#if reworkError}
					<p class="rework-error">{reworkError}</p>
				{/if}

				<select class="rework-category" bind:value={reworkCategory}>
					<option value="" disabled>Pilih kategori defect...</option>
					{#each DEFECT_CATEGORIES as c (c.value)}
						<option value={c.value}>{c.label}</option>
					{/each}
				</select>

				<label class="rework-foto-label">
					<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onReworkFotoChange} />
					{#if reworkFotoPreviewUrl}
						<img src={reworkFotoPreviewUrl} alt="Preview defect" class="rework-foto-preview" />
					{:else}
						<span class="rework-foto-placeholder"><IconCamera size={22} /> Ambil Foto Defect</span>
					{/if}
				</label>

				<textarea class="rework-note" rows="2" placeholder="Catatan singkat (opsional)" bind:value={reworkNote}></textarea>
				<div class="rework-buttons">
					<button class="rework-btn rework-btn--skip" onclick={lewatiFlagRework} disabled={reworkSubmitting}>Lewati</button>
					<button class="rework-btn rework-btn--flag" onclick={submitFlagRework} disabled={reworkSubmitting || reworkFotoProcessing}>
						{reworkSubmitting ? 'Menandai...' : reworkFotoProcessing ? 'Memproses foto...' : 'Tandai untuk Rework'}
					</button>
				</div>
			</div>
		{:else if reworkFlagged}
			<p class="rework-flagged-note">✓ Ditandai untuk rework — supervisor/QA akan meninjau.</p>
		{/if}
	</div>
{:else}
	<div class="wrap">
		<div class="header">
			<button
				class="back"
				onclick={() => (step === 'pilih-spk' ? goto('/kiosk/home') : (step = step === 'ringkasan' ? 'parameter' : 'pilih-spk'))}
			>
				<IconArrowLeft size={22} />
			</button>
			<h1>Input Hasil QC</h1>
		</div>

		{#if errorMsg}<div class="error"><IconAlertTriangle size={18} />{errorMsg}</div>{/if}

		{#if loading}
			<div class="py-12 flex justify-center">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memuat SPK Siap QC..." sublabel="Sinkronisasi antrean uji mutu" />
			</div>
		{:else if step === 'pilih-spk'}
			<p class="hint">Pilih SPK yang mau diuji. Kalau tidak ada di daftar, batch belum ditandai selesai produksi — hubungi supervisor.</p>
			{#if spkList.length === 0}
				<div class="empty-state">Belum ada SPK menunggu QC saat ini.</div>
			{:else}
				{@const belumDiuji = spkList.filter((s) => !s.qcRingkas)}
				{@const sudahDiuji = spkList.filter((s) => s.qcRingkas)}
				<div class="spk-list">
					{#each belumDiuji as spk}
						<button class="spk-btn" onclick={() => pilihSpk(spk)}>
							<strong>{spk.nomor}</strong>
							<span>{spk.product_id?.nama_barang_lengkap || '-'} · {fmtKg(spk.quantity)} {spk.unit}</span>
						</button>
					{/each}
				</div>
				{#if sudahDiuji.length > 0}
					<p class="hint hint--muted">Sudah diuji — menunggu keputusan QA (lolos / perlu rework):</p>
					<div class="spk-list">
						{#each sudahDiuji as spk}
							<button class="spk-btn spk-btn--tested" onclick={() => pilihSpk(spk)}>
								<strong>{spk.nomor}</strong>
								<span>{spk.product_id?.nama_barang_lengkap || '-'} · {fmtKg(spk.quantity)} {spk.unit}</span>
								<span class="spk-tested-tag">
									Diuji {spk.qcRingkas.terakhir ? new Date(spk.qcRingkas.terakhir).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''}
									{spk.qcRingkas.gagal > 0 ? `· ${spk.qcRingkas.gagal} parameter gagal` : ''}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
		{:else if step === 'parameter'}
			<p class="hint">Isi hasil ukur sebenarnya dan foto alat ukurnya. Nilai di luar rentang bukan larangan kirim — itu tanda QA perlu tahu lebih cepat.</p>
			<FormDraftBar
				restoreInfo={draftRestoreInfo}
				onApplied={() => (draftRestoreInfo = null)}
			/>
			<div class="kondisi-uji">
				<span class="kondisi-uji-label">Kondisi Ruang Uji (opsional)</span>
				<div class="kondisi-uji-row">
					<label class="kondisi-field">
						<span>Suhu (°C)</span>
						<input class="input" type="number" inputmode="decimal" placeholder="mis. 28" bind:value={suhuUji} />
					</label>
					<label class="kondisi-field">
						<span>Kelembaban / RH (%)</span>
						<input class="input" type="number" inputmode="decimal" placeholder="mis. 65" bind:value={rhUji} />
					</label>
				</div>
			</div>
			<div class="tahap-uji">
				<span class="kondisi-uji-label">Tahap Produksi Saat Sampel Diambil (opsional)</span>
				<div class="tahap-chips">
					{#each TAHAP_PRODUKSI as t}
						<button type="button" class="tahap-chip" class:tahap-chip--aktif={tahapUji === t.v} onclick={() => (tahapUji = tahapUji === t.v ? '' : t.v)}>{t.l}</button>
					{/each}
				</div>
				<span class="tahap-hint">Pilih tahap agar sistem bisa memeriksa urutan uji (mis. Grinding harus lulus sebelum Letdown).</span>
			</div>
			<SampelPertinggalCard spkId={selectedSpk?.id ?? null} />
			{#if instruksiProduksi}
				<div class="instruksi-box">
					<IconAlertTriangle size={24} class="instruksi-icon" />
					<div class="instruksi-content">
						<strong>Instruksi Khusus Customer:</strong>
						<p>{instruksiProduksi}</p>
					</div>
				</div>
			{/if}
			<div class="param-list">
				{#each entries as entry, i}
					<div class="param-card" class:param-card--customer={entry.untuk_customer}>
						<div class="param-head">
							<div class="param-title-group">
								<strong>{entry.parameter}</strong>
								{#if entry.untuk_customer}
									<span class="customer-badge">🟠 Spek Customer</span>
								{:else if entry._lapisan_label}
									<span class="lapisan-badge">{entry._lapisan_label}</span>
								{/if}
							</div>
							<span class="wajib-badge" class:wajib-badge--opsional={!entry.wajib}>
								{entry.wajib ? 'WAJIB' : 'Boleh dilewati'}
							</span>
							<span class="satuan">{entry.satuan}</span>
						</div>
						{#if entry.min_value != null || entry.max_value != null}
							<p class="range-hint">Rentang spec: {entry.min_value ?? '-'} – {entry.max_value ?? '-'} {entry.satuan}</p>
						{/if}
						<input
							class="input"
							type="number"
							inputmode="decimal"
							placeholder="Nilai hasil ukur"
							bind:value={entry.value}
						/>
						<label class="foto-btn" class:has-foto={!!entry.fotoPreviewUrl}>
							<IconCamera size={20} />
							{#if entry.fotoProcessing}
								Memproses foto…
							{:else}
								{entry.fotoPreviewUrl ? 'Foto tersimpan — ganti?' : 'Foto bukti alat ukur'}
							{/if}
							<input type="file" accept="image/*" capture="environment" class="hidden" disabled={entry.fotoProcessing} onchange={(e) => onFotoChange(i, e)} />
						</label>
						{#if entry.fotoPreviewUrl}
							<img src={entry.fotoPreviewUrl} alt="Bukti {entry.parameter}" class="foto-preview" />
						{/if}
						<textarea class="notes" rows="2" placeholder="Catatan (opsional)" bind:value={entry.notes}></textarea>
					</div>
				{/each}
			</div>
			<button class="submit" disabled={entries.some((e) => e.fotoProcessing)} onclick={keRingkasan}>LANJUT KE RINGKASAN</button>
		{:else if step === 'ringkasan'}
			<p class="hint">Periksa sekali lagi sebelum kirim — hasil yang sudah terkirim tercatat permanen atas nama Anda.</p>
			{#if suhuUji !== '' || rhUji !== ''}
				<p class="kondisi-uji-ringkasan">
					Kondisi ruang: {suhuUji !== '' ? `${suhuUji}°C` : '-'}{rhUji !== '' ? ` | RH ${rhUji}%` : ''}
				</p>
			{/if}
			{#if hasilRingkasan}
				<div class="ringkasan-badges">
					<span class="badge badge--lulus">{hasilRingkasan.lulus} Lulus</span>
					{#if hasilRingkasan.marginal > 0}<span class="badge badge--marginal">{hasilRingkasan.marginal} Marginal</span>{/if}
					{#if hasilRingkasan.gagal > 0}<span class="badge badge--gagal">{hasilRingkasan.gagal} Gagal</span>{/if}
				</div>
			{/if}
			<div class="ringkasan-list">
				{#each entries as entry}
					<div class="ringkasan-row">
						<div>
							<span>{entry.parameter}</span>
							{#if entry.untuk_customer}
								<span class="customer-badge-sm">Customer</span>
							{/if}
						</div>
						<span class="ringkasan-value">{entry.value} {entry.satuan}</span>
						<IconCheck size={16} />
					</div>
				{/each}
			</div>
			<p class="foto-count">{entries.filter((e) => e.fotoFile).length} dari {entries.length} parameter sudah ada foto.</p>
			<button class="submit" disabled={submitting} onclick={submitHasil}>
				{submitting ? 'Mengirim...' : 'KIRIM HASIL QC'}
			</button>
		{/if}
	</div>
{/if}

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.header { display: flex; align-items: center; gap: 0.75rem; }
	.back { background: #e2e8f0; border: none; border-radius: 0.5rem; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
	h1 { font-size: 1.35rem; font-weight: 800; margin: 0; color: #0f172a; }
	.center { display: flex; justify-content: center; padding: 3rem; }
	.hint { color: #475569; font-size: 0.95rem; margin: 0; }
	.error { background: #fef2f2; color: #b91c1c; padding: 0.75rem; border-radius: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
	.empty-state { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 1.5rem; text-align: center; color: #64748b; }

	.spk-list { display: flex; flex-direction: column; gap: 0.75rem; }
	.spk-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; padding: 1rem 1.25rem; border-radius: 0.75rem; border: 2px solid #cbd5e1; background: white; cursor: pointer; font-size: 1rem; }
	.spk-btn strong { font-size: 1.05rem; }
	.spk-btn span { color: #64748b; }
	.hint--muted { color: #94a3b8; font-size: 0.85rem; margin-top: 0.5rem; }
	.spk-btn--tested { background: #f8fafc; border-color: #e2e8f0; }
	.spk-tested-tag { color: #b45309; font-weight: 700; font-size: 0.82rem; }

	.instruksi-box {
		background: #fefce8; border: 2px solid #facc15; border-radius: 0.75rem; padding: 0.85rem 1rem;
		display: flex; align-items: flex-start; gap: 0.75rem; color: #854d0e;
	}
	.instruksi-icon { flex-shrink: 0; color: #ca8a04; margin-top: 0.1rem; }
	.instruksi-content strong { font-size: 0.95rem; font-weight: 800; display: block; margin-bottom: 0.2rem; }
	.instruksi-content p { margin: 0; font-size: 0.9rem; line-height: 1.4; color: #713f12; }

	.kondisi-uji { border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.kondisi-uji-label { font-size: 0.8rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; }
	.kondisi-uji-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
	.kondisi-field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: #475569; }
	.kondisi-field .input { padding: 0.6rem; font-size: 1rem; }

	.param-list { display: flex; flex-direction: column; gap: 1rem; }
	.param-card { border: 2px solid #e2e8f0; border-radius: 0.75rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.param-card--customer { border-color: #fdba74; background: #fffbf5; }
	.param-head { display: flex; justify-content: space-between; align-items: baseline; }
	.param-title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.param-head strong { font-size: 1.05rem; color: #0f172a; }
	.customer-badge { font-size: 0.72rem; font-weight: 800; background: #ffedd5; color: #c2410c; padding: 0.15rem 0.5rem; border-radius: 999px; }
	.lapisan-badge { font-size: 0.72rem; font-weight: 700; background: #f3e8ff; color: #7e22ce; padding: 0.15rem 0.5rem; border-radius: 999px; }
	.customer-badge-sm { font-size: 0.65rem; font-weight: 700; background: #ffedd5; color: #c2410c; padding: 0.1rem 0.4rem; border-radius: 999px; margin-left: 0.35rem; }
	.satuan { color: #64748b; font-size: 0.85rem; margin-left: auto; }
	.wajib-badge {
		background: #fef2f2; color: #b91c1c; font-size: 0.7rem; font-weight: 800;
		padding: 0.15rem 0.5rem; border-radius: 999px; letter-spacing: 0.02em;
	}
	.wajib-badge--opsional { background: #f1f5f9; color: #64748b; }
	.range-hint { margin: 0; font-size: 0.85rem; color: #7c3aed; }
	.input { padding: 0.9rem; font-size: 1.15rem; border: 2px solid #e2e8f0; border-radius: 0.75rem; }
	.input:focus { outline: none; border-color: #7c3aed; }
	.foto-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; border: 2px dashed #cbd5e1; border-radius: 0.75rem; cursor: pointer; font-size: 0.9rem; color: #475569; }
	.foto-btn.has-foto { border-color: #16a34a; color: #16a34a; border-style: solid; }
	.hidden { display: none; }
	.foto-preview { width: 100%; max-height: 160px; object-fit: cover; border-radius: 0.5rem; }
	.notes { padding: 0.6rem; font-size: 0.9rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; resize: none; }

	.kondisi-uji-ringkasan { font-size: 0.85rem; color: #7c3aed; margin: 0; font-weight: 600; }
	.ringkasan-badges { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.badge { padding: 0.4rem 0.75rem; border-radius: 999px; font-weight: 800; font-size: 0.85rem; }
	.badge--lulus { background: #dcfce7; color: #166534; }
	.badge--marginal { background: #fef3c7; color: #92400e; }
	.badge--gagal { background: #fee2e2; color: #991b1b; }
	.ringkasan-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.ringkasan-row { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.75rem; background: #f8fafc; border-radius: 0.5rem; font-size: 0.9rem; }
	.ringkasan-value { font-weight: 700; color: #0f172a; }
	.foto-count { font-size: 0.85rem; color: #64748b; margin: 0; }

	.submit { min-height: 64px; background: #7c3aed; color: white; font-weight: 800; font-size: 1.15rem; border: none; border-radius: 0.75rem; cursor: pointer; margin-top: 0.5rem; }
	.submit:disabled { opacity: 0.6; }

	.success-overlay {
		position: fixed; inset: 0; background: #16a34a; color: white;
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; z-index: 50; padding: 2rem; text-align: center;
	}
	.success-nama { font-size: 1.5rem; font-weight: 800; margin: 0; }
	.success-title { font-size: 2rem; font-weight: 900; margin: 0; }
	.success-sub { font-size: 1rem; max-width: 360px; margin: 0; }

	.rework-prompt {
		width: 100%; max-width: 360px; background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 0.75rem; padding: 1rem; margin-top: 0.5rem; text-align: left;
	}
	.rework-prompt-title { font-size: 1rem; font-weight: 800; margin: 0 0 0.25rem; }
	.rework-prompt-hint { font-size: 0.8rem; opacity: 0.9; margin: 0 0 0.6rem; }
	.rework-error { font-size: 0.85rem; font-weight: 700; color: #fecaca; margin: 0 0 0.5rem; }
	.rework-category {
		width: 100%; padding: 0.6rem; font-size: 0.9rem; border: none; border-radius: 0.5rem;
		box-sizing: border-box; margin-bottom: 0.5rem; color: #1e293b;
	}
	.rework-foto-label {
		display: flex; align-items: center; justify-content: center; cursor: pointer;
		border: 1px dashed rgba(255, 255, 255, 0.5); border-radius: 0.5rem; margin-bottom: 0.5rem;
		min-height: 44px; overflow: hidden;
	}
	.rework-foto-placeholder { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; padding: 0.5rem; }
	.rework-foto-preview { width: 100%; max-height: 140px; object-fit: cover; display: block; }
	.rework-note { width: 100%; padding: 0.6rem; font-size: 0.9rem; border: none; border-radius: 0.5rem; resize: none; box-sizing: border-box; }
	.rework-buttons { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
	.rework-btn { flex: 1; min-height: 44px; border: none; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; }
	.rework-btn--skip { background: rgba(255, 255, 255, 0.2); color: white; }
	.rework-btn--flag { background: #f59e0b; color: #1e293b; }
	.rework-btn:disabled { opacity: 0.6; }
	.rework-flagged-note { font-size: 0.9rem; opacity: 0.95; margin-top: 0.25rem; }
	.tahap-uji {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.tahap-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.tahap-chip {
		min-height: 52px;
		padding: 0 1.25rem;
		font-size: 1.05rem;
		font-weight: 600;
		border: 2px solid #cbd5e1;
		border-radius: 999px;
		background: white;
		color: #0f172a;
	}
	.tahap-chip--aktif {
		background: #0369a1;
		border-color: #0369a1;
		color: white;
	}
	.tahap-hint {
		font-size: 0.85rem;
		color: #475569;
	}
</style>
