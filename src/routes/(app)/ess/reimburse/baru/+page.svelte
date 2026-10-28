<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { ajukanReimburse } from '$lib/services/ess/reimburse';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconX } from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import {
		fetchMyVisits,
		getSiteCheckinSettings,
		type VisitPickerOption,
		type SiteCheckinSettings,
		type FieldGateModeMap,
		type SiteCheckinRecord
	} from '$lib/services/siteCheckin';
	import { getQueuedSiteCheckinSubmissions } from '$lib/utils/offlineSiteCheckinQueue';
	import CheckoutDialog from '$lib/components/site-checkin/CheckoutDialog.svelte';

	const KATEGORI_OPTIONS = ['Transport', 'Kesehatan', 'Komunikasi', 'Perjalanan Dinas', 'Lainnya'];
	// G_RMR_VISIT — "4-Gate Site Visit System" Fase 3b (8 Sep 2026)
	const KATEGORI_BUTUH_VISIT = ['Transport', 'Perjalanan Dinas'];

	// Paket 06 §2.6 — kategori alasan pengecualian terstruktur, menggantikan textarea bebas
	// ≥20 karakter (orang awam mengetik "aaaaaaaaaaaaaaaaaaaa" supaya gate lolos tanpa makna).
	const ALASAN_PENGECUALIAN_OPTIONS = [
		'Perjalanan ke kantor cabang/instansi (bukan proyek/customer)',
		'Antar/jemput barang atau dokumen',
		'Lupa check-in di lokasi',
		'HP bermasalah / tidak ada sinyal saat di lokasi',
		'Lainnya (tulis)'
	];

	let kategori = $state('Transport');
	let jumlah = $state('');
	let catatan = $state('');
	let buktiFile = $state<File | null>(null);
	let buktiPreview = $state<string | null>(null);

	let visits = $state<VisitPickerOption[]>([]);
	let loadingVisits = $state(false);
	let visitsLoaded = $state(false);
	let selectedSiteCheckinId = $state<string | null>(null);
	let noVisitMode = $state(false);
	let alasanKategori = $state('');
	let alasanKeterangan = $state('');
	// Paket 02 (offlineSiteCheckinQueue) — kunjungan yang belum tersinkron, belum bisa dipilih.
	let jumlahKunjunganAntre = $state(0);
	// Paket 06 §2.5 — settings & mode gate dari server, UI ikut mode server (Aturan #3).
	let settings = $state<SiteCheckinSettings | null>(null);
	let modeGate = $state<FieldGateModeMap | null>(null);
	// Paket 06 §2.4 — checkout langsung dari picker untuk kunjungan yang masih 'active'.
	let checkoutTarget = $state<VisitPickerOption | null>(null);

	const needsVisitPicker = $derived(KATEGORI_BUTUH_VISIT.includes(kategori));
	const alasanLainnya = $derived(alasanKategori === 'Lainnya (tulis)');
	const alasanValid = $derived.by(() => {
		if (!alasanKategori) return false;
		if (alasanLainnya) return alasanKeterangan.trim().length >= 10;
		return true;
	});
	const visitExceptionText = $derived(
		alasanKategori ? `${alasanKategori}${alasanLainnya ? `: ${alasanKeterangan.trim()}` : ''}` : ''
	);
	const rmrMode = $derived(modeGate?.G_RMR_VISIT ?? 'shadow');
	// Paket 06 §2.5 (Aturan #3) — HANYA 'hard' yang boleh mengunci tombol. Sebelumnya UI
	// mengunci apa pun mode server (bug nyata: soft/shadow tetap tidak bisa submit tanpa
	// kunjungan, padahal server sendiri sudah tidak memblokirnya).
	const gateHard = $derived(rmrMode === 'hard');
	const gateSoftTanpaBukti = $derived(
		needsVisitPicker && !gateHard && rmrMode === 'soft' && !selectedSiteCheckinId && !(noVisitMode && alasanValid)
	);

	async function loadVisitsDanSettings() {
		if (visitsLoaded || loadingVisits) return;
		loadingVisits = true;
		try {
			const settingsRes = await getSiteCheckinSettings().catch(() => null);
			settings = settingsRes?.settings || null;
			modeGate = settingsRes?.mode_gate || null;
			const hari = settings?.visit_picker_hari || 7;
			const res = await fetchMyVisits(hari);
			visits = res.visits || [];
			visitsLoaded = true;
		} catch {
			// gagal-lunak — user tetap bisa pakai jalur "tanpa kunjungan" + alasan
		} finally {
			loadingVisits = false;
		}
		try {
			const antre = await getQueuedSiteCheckinSubmissions();
			jumlahKunjunganAntre = antre.filter((e) => e.type === 'checkin').length;
		} catch {
			jumlahKunjunganAntre = 0;
		}
	}

	$effect(() => {
		if (needsVisitPicker) loadVisitsDanSettings();
	});

	function buildStubCheckinUntukCheckout(v: VisitPickerOption): SiteCheckinRecord {
		return {
			id: v.id,
			karyawan_id: '',
			referensi_id: 0,
			nama_lokasi: v.nama_lokasi,
			tier_absensi: null,
			area_sumber: null,
			area_status: null,
			check_in_at: v.check_in_at,
			check_out_at: null,
			in_geofence: v.in_geofence,
			jarak_in_m: null,
			durasi_menit: v.durasi_menit,
			status: v.status,
			tipe_checkin: v.tipe_checkin
		};
	}

	function handleCheckoutSelesai() {
		checkoutTarget = null;
		visitsLoaded = false;
		loadVisitsDanSettings();
	}

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let compressingBukti = $state(false);

	// Jaring pengaman draf: struk difoto lalu nominalnya diketik dari struk itu —
	// tab dibunuh OS saat kamera terbuka berarti karyawan harus mencari struknya lagi.
	interface ReimburseDraft {
		kategori: string;
		jumlah: string;
		catatan: string;
	}
	const BUKTI_PHOTO_KEY = 'struk';
	const reimbursePersist = createFormPersist<ReimburseDraft>('ess_reimburse_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function reimburseSnapshot(): ReimburseDraft {
		return { kategori, jumlah, catatan };
	}

	onMount(async () => {
		const draft = reimbursePersist.restore();
		if (draft) {
			kategori = draft.kategori;
			jumlah = draft.jumlah;
			catatan = draft.catatan;
			const blob = await reimbursePersist.restorePhoto(BUKTI_PHOTO_KEY);
			if (blob) {
				buktiFile = new File([blob], 'struk.jpg', { type: blob.type || 'image/jpeg' });
				buktiPreview = URL.createObjectURL(buktiFile);
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void reimburseSnapshot();
		if (!draftArmed) return;
		reimbursePersist.save(reimburseSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(reimbursePersist, reimburseSnapshot));

	async function handleBuktiChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		compressingBukti = true;
		errorMsg = '';
		try {
			const compressed = await compressPhoto(file);
			buktiFile = compressed;
			if (buktiPreview) URL.revokeObjectURL(buktiPreview);
			buktiPreview = URL.createObjectURL(compressed);
			await reimbursePersist.savePhoto(BUKTI_PHOTO_KEY, compressed);
		} catch (err: any) {
			console.warn('Gagal memproses foto struk:', err);
			errorMsg = err?.message || 'Foto tidak dapat diproses. Coba ambil ulang foto dengan resolusi standar.';
			input.value = '';
		} finally {
			compressingBukti = false;
		}
	}

	function removeBukti() {
		if (buktiPreview) URL.revokeObjectURL(buktiPreview);
		buktiFile = null;
		buktiPreview = null;
		void reimbursePersist.savePhoto(BUKTI_PHOTO_KEY, new Blob([]));
	}

	let jumlahNumber = $derived(Number(jumlah.replace(/[^0-9]/g, '')) || 0);
	// Paket 06 §2.5 (Aturan #3) — HANYA gate 'hard' yang boleh mengunci tombol. Sebelumnya
	// (bug nyata) visitSatisfied SELALU mengunci tanpa kunjungan/alasan, apa pun mode server.
	let visitSatisfied = $derived(
		!needsVisitPicker || !gateHard || !!selectedSiteCheckinId || (noVisitMode && alasanValid)
	);
	let canSubmit = $derived(!!kategori && jumlahNumber > 0 && visitSatisfied && !submitting && !compressingBukti);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			await ajukanReimburse({
				kategori,
				jumlah: jumlahNumber,
				catatan: catatan.trim(),
				buktiFile,
				siteCheckinId: needsVisitPicker && !noVisitMode ? selectedSiteCheckinId : null,
				visitException: needsVisitPicker && noVisitMode ? visitExceptionText : null
			});
			// Terkirim — draf lokal (termasuk foto struk di IndexedDB) sudah tidak relevan.
			reimbursePersist.clear();
			await reimbursePersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan klaim.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess/reimburse')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Klaim reimbursement terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu persetujuan atasan.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess/reimburse')}>
				Kembali ke Riwayat
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Ajukan Klaim</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!buktiFile} />
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Isi form berikut untuk mengajukan klaim reimbursement</p>

		<div class="flex flex-col gap-4">
			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Kategori</p>
				<div class="grid grid-cols-2 gap-2">
					{#each KATEGORI_OPTIONS as opt}
						<button
							class="h-10 rounded-lg text-[11px] font-bold"
							style={kategori === opt ? 'background: var(--p, var(--g)); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => (kategori = opt)}
						>
							{opt}
						</button>
					{/each}
				</div>
			</div>

			{#if needsVisitPicker}
				<div>
					<div class="flex items-center justify-between mb-1.5">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">
							Kunjungan Terkait {#if gateHard}<span style="color: #DC2626">*</span>{/if}
						</p>
						<button type="button" class="text-[11px] font-semibold" style="color: var(--p, var(--g))" onclick={() => { visitsLoaded = false; loadVisitsDanSettings(); }}>
							{loadingVisits ? 'Memuat…' : 'Muat Ulang'}
						</button>
					</div>
					<!-- Paket 06 §3 — pilih kunjungan yang berhubungan dengan biaya ini. -->
					<p class="text-[10px] mb-1.5" style="color: var(--sys-label4)">
						Pilih kunjungan yang berhubungan dengan biaya ini (maks. {settings?.visit_picker_hari ?? 7} hari terakhir).
					</p>
					{#if !noVisitMode}
						{#if loadingVisits}
						<CircularProgressGauge size={42} strokeWidth={3} label="Memuat daftar kunjungan..." />
						{:else if visits.length === 0 && jumlahKunjunganAntre === 0}
							<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada kunjungan tercatat. Bila biaya ini bukan untuk kunjungan lapangan, pilih alasan di bawah.</p>
						{:else}
							{#if visits.length > 0}
								<select bind:value={selectedSiteCheckinId} class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)">
									<option value={null} disabled selected>Pilih kunjungan…</option>
									{#each visits as v (v.id)}
										<option value={v.id}>
											{v.nama_lokasi || v.id} — {new Date(v.check_in_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}{v.status === 'active' ? ' — ⏳ belum check-out' : ''}
										</option>
									{/each}
								</select>
							{/if}
							{#if selectedSiteCheckinId && visits.find((v) => v.id === selectedSiteCheckinId)?.status === 'active'}
								{@const v = visits.find((x) => x.id === selectedSiteCheckinId)}
								<div class="mt-1.5 p-2.5 rounded-lg flex items-center justify-between gap-2" style="background: #FEF3C7">
									<span class="text-[11px]" style="color: #92400E">⏳ Kunjungan ini belum check-out — wajib selesai dulu sebelum klaim diproses.</span>
									<button type="button" class="text-[11px] font-bold shrink-0" style="color: #92400E" onclick={() => (checkoutTarget = v || null)}>
										Check-out sekarang
									</button>
								</div>
							{/if}
						{/if}
						{#if jumlahKunjunganAntre > 0}
							<p class="text-[10px] mt-1.5" style="color: var(--sys-label4)">
								📱 {jumlahKunjunganAntre} kunjungan menunggu sinyal — akan bisa dipilih setelah terkirim.
							</p>
						{/if}
					{/if}
					<label class="flex items-start gap-2 mt-2 text-[11px]" style="color: var(--sys-label3)">
						<input type="checkbox" checked={noVisitMode} onchange={() => { noVisitMode = !noVisitMode; if (noVisitMode) selectedSiteCheckinId = null; else { alasanKategori = ''; alasanKeterangan = ''; } }} class="mt-0.5" />
						<span>Tidak terkait kunjungan fisik (mis. antar dokumen)</span>
					</label>
					{#if noVisitMode}
						<!-- Paket 06 §2.6 — kategori terstruktur, bukan textarea bebas (cegah "aaaaaaaaaaaaaaaaaaaa"). -->
						<select bind:value={alasanKategori} class="w-full rounded-lg border text-[12px] p-2.5 mt-1.5" style="border-color: var(--sys-sep)">
							<option value="" disabled selected>Pilih alasan…</option>
							{#each ALASAN_PENGECUALIAN_OPTIONS as opt}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
						{#if alasanLainnya}
							<textarea
								bind:value={alasanKeterangan}
								rows="2"
								placeholder="Jelaskan alasan (minimal 10 karakter)…"
								class="w-full rounded-lg border text-[12px] p-2.5 mt-1.5"
								style="border-color: {alasanKeterangan.trim().length >= 10 ? 'var(--sys-sep)' : '#DC2626'}"
							></textarea>
							<p class="text-[10px] mt-0.5" style="color: {alasanKeterangan.trim().length >= 10 ? 'var(--sys-label4)' : '#DC2626'}">
								{alasanKeterangan.trim().length} / 10 karakter minimum
							</p>
						{/if}
					{/if}
					{#if gateSoftTanpaBukti}
						<p class="text-[10px] mt-1.5 font-semibold" style="color: #B45309">
							⚠️ Klaim tanpa kunjungan akan diperiksa lebih teliti oleh Finance.
						</p>
					{/if}
				</div>
			{/if}

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="jumlah">Jumlah (Rp)</label>
				<input id="jumlah" type="text" inputmode="numeric" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" placeholder="0" bind:value={jumlah} />
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="catatan">Catatan</label>
				<textarea id="catatan" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="3" placeholder="Detail klaim (opsional)" bind:value={catatan}></textarea>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Bukti</p>
				{#if compressingBukti}
					<div class="w-28 h-28 rounded-lg border border-dashed flex flex-col items-center justify-center gap-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg-subtle, #f8fafc)">
						<IconLoader2 size={22} class="animate-spin text-blue-600" />
						<span class="text-[10px]" style="color: var(--sys-label3)">Mengompresi...</span>
					</div>
				{:else if buktiPreview}
					<div class="relative w-28 h-28 mb-2">
						<img src={buktiPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
						<button
							type="button"
							class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white shadow-sm"
							style="background: #DC2626"
							onclick={removeBukti}
							aria-label="Hapus foto bukti"
						>
							<IconX size={14} />
						</button>
					</div>
				{:else}
					<label class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
						<IconCamera size={22} style="color: var(--sys-label4)" />
						<span class="text-[10px]" style="color: var(--sys-label4)">Ambil foto</span>
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handleBuktiChange} />
					</label>
				{/if}
			</div>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Klaim
			</button>
		</div>
	{/if}
</div>

<!-- Paket 06 §2.4 — checkout langsung dari picker kunjungan aktif. -->
{#if checkoutTarget}
	<CheckoutDialog
		checkin={buildStubCheckinUntukCheckout(checkoutTarget)}
		onDone={handleCheckoutSelesai}
		onClose={() => (checkoutTarget = null)}
	/>
{/if}
