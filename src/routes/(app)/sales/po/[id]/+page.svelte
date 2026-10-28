<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getSOForPO,
		getPODocuments,
		uploadPoDocument,
		type PODocImage
	} from '$lib/services/salesPo';
	import {
		enqueuePoUpload,
		registerPoUploadAutoFlush,
		flushPoUploadQueue
	} from '$lib/utils/offlineSalesPoQueue';
	import { IconArrowLeft, IconCamera, IconLoader2, IconCheck, IconWifiOff, IconClock, IconAlertCircle, IconAlertTriangle, IconFileText } from '@tabler/icons-svelte';
	import { secureAssetSrc, openSecureAsset } from '$lib/actions/secureAsset';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { fetchCustomerLifecycleFacts, type CustomerLifecycleFacts } from '$lib/services/customerLifecycleApi';
	import LifecycleStepper from '$lib/components/LifecycleStepper.svelte';

	let soId = $derived(Number($page.params.id));

	let loading = $state(true);
	let uploading = $state(false);
	let errorMsg = $state('');
	let queuedNotice = $state('');
	let so = $state<any | null>(null);
	let images = $state<PODocImage[]>([]);
	let fileInputEl: HTMLInputElement | undefined = $state();
	let isOnline = $state(true);

	// Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L1) — stepper read-only.
	let lifecycleFacts = $state<CustomerLifecycleFacts | null>(null);
	async function loadLifecycle() {
		if (!so?.id) return;
		try {
			lifecycleFacts = await fetchCustomerLifecycleFacts({ id: so.id, kode_customer: so.kode_customer });
		} catch (e) {
			console.error('[sales/po] gagal memuat lifecycle:', e);
		}
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	function formatRupiah(n: number): string {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			so = await getSOForPO(soId);
			if (!so) {
				errorMsg = 'SO tidak ditemukan.';
				return;
			}
			images = await getPODocuments(soId);
			loadLifecycle();
		} catch (e: any) {
			errorMsg = e.message;
		} finally {
			loading = false;
		}
	}

	async function sendQueuedEntry(entry: any) {
		await uploadPoDocument(entry.soId, entry.photoBlob, entry.photoName, entry.uploadedBy);
	}

	async function onPhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		if (files.length === 0) return;

		uploading = true;
		errorMsg = '';
		queuedNotice = '';
		const uploadedBy = $authStore.karyawanName || $authStore.user?.email || 'Sales Lapangan';
		let queuedCount = 0;

		for (const file of files) {
			// R9 — foto PO dari HP bisa 5-8MB; kompres dulu (pola sama dgn ess/attendance,
			// Stock Lapangan) supaya hemat storage & bandwidth Directus. Gagal kompres ->
			// tetap unggah ukuran asli (compressPhoto sudah fallback sendiri).
			const compressed = await compressPhoto(file);
			try {
				await uploadPoDocument(soId, compressed, file.name, uploadedBy);
			} catch (err) {
				// Sinyal buruk atau request gagal — simpan ke antrian, jangan dianggap error ke user
				await enqueuePoUpload({
					client_txn_id: crypto.randomUUID(),
					soId,
					photoBlob: compressed,
					photoName: file.name,
					uploadedBy,
					createdAt: new Date().toISOString()
				});
				queuedCount++;
			}
		}

		uploading = false;
		input.value = '';
		if (queuedCount > 0) {
			queuedNotice = `${queuedCount} foto tidak terkirim (sinyal) — tersimpan di HP, otomatis terkirim saat online.`;
		}
		await load();
	}

	onMount(() => {
		isOnline = navigator.onLine;
		window.addEventListener('online', () => (isOnline = true));
		window.addEventListener('offline', () => (isOnline = false));
		registerPoUploadAutoFlush(sendQueuedEntry);
		flushPoUploadQueue(sendQueuedEntry).then(load);
		load();
	});
</script>

<svelte:head>
	<title>PO {so?.nomor_so || ''} — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 pb-24" style="background: var(--sys-bg)">
	<button class="flex items-center gap-1.5 text-sm font-semibold mb-4" style="color: var(--sys-label2)" onclick={() => goto('/sales/po')}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian PO / Sales Order..." />
		</div>
	{:else if errorMsg && !so}
		<div class="rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-3 py-2">{errorMsg}</div>
	{:else if so}
		<div class="rounded-xl border p-3.5 mb-4 shadow-2xs" style="border-color: var(--sys-separator); background: var(--sys-bg-elevated)">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0 flex-1">
					<div class="font-mono text-sm font-bold flex items-center gap-2" style="color: var(--sys-label)">
						<span>{so.nomor_so}</span>
						{#if so.so_type}
							<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-sans uppercase font-bold">
								{so.so_type}
							</span>
						{/if}
					</div>
					<div class="text-xs font-medium mt-1" style="color: var(--sys-label2)">
						{so.customer_name || so.kode_customer}
					</div>
				</div>
				<div class="text-right shrink-0">
					<div class="text-sm font-black" style="color: var(--sys-label)">{formatRupiah(so.grand_total)}</div>
					{#if so.tanggal_so}
						<div class="text-[10px] mt-0.5" style="color: var(--sys-label3)">
							{new Date(so.tanggal_so).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
						</div>
					{/if}
				</div>
			</div>

			<div class="mt-2.5 pt-2 border-t flex flex-col gap-1 text-[11px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
				<div class="flex items-center justify-between">
					<span>No. PO Customer:</span>
					<strong class="font-mono" style="color: var(--sys-label)">{so.nomor_po_customer || '(Belum tercatat)'}</strong>
				</div>
				{#if so.penawaran_number || so.penawaran_id}
					<div class="flex items-center justify-between">
						<span>Dasar SPH/Penawaran:</span>
						<strong class="font-mono text-blue-600 dark:text-blue-400">
							{so.penawaran_number || `#${so.penawaran_id}`}
						</strong>
					</div>
				{/if}
			</div>
		</div>

		<!-- Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L1) -->
		<div class="rounded-xl border p-3 mb-4" style="border-color: var(--sys-separator); background: var(--sys-bg-elevated)">
			<div class="text-xs font-semibold mb-2" style="color: var(--sys-label2)">🧭 Lifecycle SO Ini</div>
			<LifecycleStepper facts={lifecycleFacts} {so} />
		</div>

		<!-- Status Verifikasi Fisik PO Customer (Gate G_SO_PO_VERIFIED) -->
		{#if so.po_status === 'terverifikasi'}
			<div class="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs p-3.5 mb-4 shadow-2xs">
				<div class="flex items-center gap-2 font-bold mb-1">
					<span class="text-base">✅</span>
					<span class="text-sm">Dokumen PO Sah &amp; Terverifikasi</span>
				</div>
				<p class="leading-relaxed text-[11.5px] text-emerald-800 dark:text-emerald-300">
					Dokumen fisik PO customer telah diverifikasi oleh tim Admin Kontrak / Legal pusat. Order ini telah memenuhi gate verifikasi dokumen dan siap diproses ke tahap SPK / Workshop / Lapangan.
				</p>
				{#if so.po_verified_by || so.po_verified_at}
					<div class="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-900/60 text-[11px] text-emerald-800 dark:text-emerald-400">
						Diverifikasi oleh: <strong>{so.po_verified_by || 'Admin Pusat'}</strong>
						{#if so.po_verified_at}
							· {new Date(so.po_verified_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
						{/if}
					</div>
				{/if}
			</div>
		{:else if so.po_status === 'terupload'}
			<div class="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 text-xs p-3.5 mb-4 shadow-2xs">
				<div class="flex items-center gap-2 font-bold mb-1">
					<IconClock size={16} class="text-indigo-600 dark:text-indigo-400" />
					<span class="text-sm">Menunggu Verifikasi Admin</span>
				</div>
				<p class="leading-relaxed text-[11.5px] text-indigo-800 dark:text-indigo-300">
					Foto dokumen PO berhasil diunggah dari lapangan. Saat ini dokumen sedang dalam antrean pengecekan fisik (nomor PO, stempel basah/TTD resmi, dan rincian harga) oleh tim Admin Pusat.
				</p>
			</div>
		{:else if so.po_status === 'revisi'}
			<div class="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs p-3.5 mb-4 shadow-2xs">
				<div class="flex items-center gap-2 font-bold mb-1">
					<span class="text-base">⚠️</span>
					<span class="text-sm">Perbaikan / Revisi Dokumen PO Diperlukan</span>
				</div>
				<p class="leading-relaxed text-[11.5px] text-rose-800 dark:text-rose-300">
					Catatan Admin: <strong>{so.po_verify_note || 'Dokumen belum memenuhi syarat sah PO.'}</strong>
				</p>
				<p class="text-[11px] text-rose-700 dark:text-rose-400 mt-1 font-medium">
					Silakan foto ulang dokumen PO customer yang jelas dan sesuai catatan di atas, lalu unggah kembali melalui tombol di bawah.
				</p>
			</div>
		{:else}
			<div class="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300 text-xs p-3.5 mb-4 shadow-2xs">
				<div class="flex items-center gap-2 font-bold mb-1">
					<IconFileText size={16} class="text-slate-600 dark:text-slate-400" />
					<span class="text-sm">Dokumen PO Belum Dilampirkan</span>
				</div>
				<p class="leading-relaxed text-[11.5px] text-slate-600 dark:text-slate-400">
					Order ini belum memiliki lampiran foto PO dari customer. Ambil foto dokumen PO resmi sekarang agar admin dapat memverifikasi dan melanjutkan ke proses SPK.
				</p>
			</div>
		{/if}

		<!-- Panduan Foto PO Customer yang Sah (Anti-Revisi) -->
		<div class="rounded-xl border p-3.5 mb-4 bg-sky-50/50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800/80">
			<div class="flex items-center gap-1.5 text-xs font-bold text-sky-900 dark:text-sky-200 mb-1.5">
				<span>📋</span>
				<span>Panduan Dokumen PO yang Sah (Anti-Revisi)</span>
			</div>
			<ul class="text-[11px] text-sky-800 dark:text-sky-300 space-y-1 list-disc pl-4">
				<li><strong>Nomor PO Customer:</strong> Harus tercetak jelas di lembar PO.</li>
				<li><strong>Legalitas Resmi:</strong> Tanda tangan pejabat berwenang &amp; stempel basah / QR tanda tangan customer.</li>
				<li><strong>Kesesuaian Nilai:</strong> Nilai total &amp; item pekerjaan sesuai dengan kesepakatan penawaran harga.</li>
				<li><strong>Kualitas Foto:</strong> Ambil foto tegak lurus, pencahayaan cukup, seluruh sudut kertas terlihat.</li>
			</ul>
		</div>

		{#if so.credit_status === 'hold'}
			<div class="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs p-3.5 mb-4 shadow-2xs">
				<div class="flex items-center gap-2 font-bold mb-1">
					<span>⚠️</span>
					<span class="text-sm">Status: Tertahan Credit Hold</span>
				</div>
				<p class="leading-relaxed text-[11.5px] text-amber-800 dark:text-amber-300">
					SO ini belum dapat diproses ke Workshop/Pabrik karena limit kredit atau termin invoice customer sedang ditinjau oleh Finance &amp; Management.
				</p>
				{#if so.catatan && so.catatan.includes('[HOLD]')}
					<div class="mt-2 pt-2 border-t border-amber-200 dark:border-amber-900/60 font-semibold text-[11px] text-amber-900 dark:text-amber-100">
						Catatan Admin/Finance: {so.catatan}
					</div>
				{/if}
			</div>
		{/if}

		{#if !isOnline}
			<div class="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-medium px-3 py-2 mb-3">
				<IconWifiOff size={16} />
				Tidak ada sinyal. Foto tersimpan di HP dan otomatis terkirim saat online.
			</div>
		{/if}

		{#if queuedNotice}
			<div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs px-3 py-2 mb-3">{queuedNotice}</div>
		{/if}
		{#if errorMsg}
			<div class="rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-3 py-2 mb-3">{errorMsg}</div>
		{/if}

		<input
			bind:this={fileInputEl}
			type="file"
			accept="image/*"
			capture="environment"
			multiple
			class="hidden"
			onchange={onPhotoChange}
		/>
		<button
			class="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60 mb-1"
			disabled={uploading}
			onclick={() => fileInputEl?.click()}
		>
			{#if uploading}
				<IconLoader2 size={16} class="animate-spin" /> Mengunggah…
			{:else}
				<IconCamera size={16} /> Foto / Unggah Dokumen PO
			{/if}
		</button>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
			Foto seluruh halaman PO, pastikan nomor PO dan nilainya terbaca. Bisa lebih dari satu foto.
		</p>

		{#if images.length > 0}
			<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold" style="color: var(--sys-label2)">
				<IconCheck size={14} class="text-emerald-600 dark:text-emerald-400" /> {images.length} foto terunggah
			</div>
			<div class="grid grid-cols-3 gap-2">
				{#each images as img (img.id)}
					<button
						class="aspect-4/3 rounded-lg overflow-hidden border"
						style="border-color: var(--sys-separator)"
						onclick={() => openSecureAsset(img.file_id?.id)}
					>
						<img use:secureAssetSrc={img.file_id?.id} alt="Dokumen PO" class="w-full h-full object-cover" />
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>
