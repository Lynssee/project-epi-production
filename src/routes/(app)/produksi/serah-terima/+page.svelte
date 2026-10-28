<!-- src/routes/(app)/produksi/serah-terima/+page.svelte -->
<!-- R5 (rekomendasi audit "Pertajam Modul Kiosk Produksi v2", 12 Sep 2026) — Serah-terima shift
     produksi. Koleksi shift_handover sudah ada di Directus, UI-nya BELUM ADA sama sekali
     sebelum halaman ini (bukan sekadar "sambung" seperti diasumsikan dokumen rencana).
     Permission: reuse `input_produksi_harian` (orang yang sama yang input produksi harian
     yang serah-terima shift) -- tidak membuat kunci permission baru yang butuh assignment
     role terpisah sebelum siapa pun bisa memakai halaman ini. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchKaryawanOptions,
		fetchMyShiftSummary,
		formatSummaryText,
		createShiftHandover,
		fetchPendingHandoversForMe,
		fetchMyHandoverHistory,
		confirmShiftHandover,
		type KaryawanOption,
		type ShiftSummary,
		type HandoverRow
	} from '$lib/services/shiftHandoverApi';
	import { IconLoader2, IconArrowRight, IconArrowLeft, IconCheck, IconClipboardText } from '@tabler/icons-svelte';

	let activeTab = $state<'serahkan' | 'terima'>('terima');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_produksi_harian', roles)) {
			goto('/');
		}
	});

	// --- Serahkan Shift ---
	let loadingSummary = $state(true);
	let summary = $state<ShiftSummary | null>(null);
	let catatanKeluar = $state('');
	let karyawanOptions = $state<KaryawanOption[]>([]);
	let penerimaId = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let submitSuccess = $state(false);
	let myHistory = $state<HandoverRow[]>([]);

	// --- Terima Shift ---
	let loadingPending = $state(true);
	let pendingList = $state<HandoverRow[]>([]);
	let confirmingId = $state<number | null>(null);
	let catatanMasukByThread = $state<Record<number, string>>({});

	async function loadServahkanData() {
		loadingSummary = true;
		try {
			const karyawanId = $authStore.karyawanId;
			if (!karyawanId) return;
			const [s, options, history] = await Promise.all([
				fetchMyShiftSummary(karyawanId),
				fetchKaryawanOptions(),
				fetchMyHandoverHistory(karyawanId)
			]);
			summary = s;
			catatanKeluar = formatSummaryText(s);
			karyawanOptions = options.filter((k) => k.id !== karyawanId);
			myHistory = history;
		} finally {
			loadingSummary = false;
		}
	}

	async function loadTerimaData() {
		loadingPending = true;
		try {
			const karyawanId = $authStore.karyawanId;
			if (!karyawanId) return;
			pendingList = await fetchPendingHandoversForMe(karyawanId);
		} finally {
			loadingPending = false;
		}
	}

	function switchTab(tab: 'serahkan' | 'terima') {
		activeTab = tab;
		if (tab === 'serahkan' && !summary) loadServahkanData();
		if (tab === 'terima' && pendingList.length === 0) loadTerimaData();
	}

	// Muat data tab default saat halaman dibuka.
	$effect(() => {
		if ($authStore.karyawanId && loadingPending && pendingList.length === 0) {
			loadTerimaData();
		}
	});

	async function submitHandover() {
		const karyawanId = $authStore.karyawanId;
		if (!karyawanId || !penerimaId) {
			submitError = 'Pilih siapa yang menerima shift ini dulu.';
			return;
		}
		submitting = true;
		submitError = '';
		try {
			await createShiftHandover({
				karyawanKeluarId: karyawanId,
				karyawanMasukId: Number(penerimaId),
				shiftLabel: summary?.namaJadwal || null,
				catatanKeluar: catatanKeluar.trim() || 'Tidak ada catatan.'
			});
			submitSuccess = true;
			penerimaId = '';
			await loadServahkanData();
			setTimeout(() => (submitSuccess = false), 4000);
		} catch (e) {
			submitError = e instanceof Error ? e.message : 'Gagal mengirim serah-terima.';
		} finally {
			submitting = false;
		}
	}

	async function confirmOne(id: number) {
		confirmingId = id;
		try {
			await confirmShiftHandover(id, catatanMasukByThread[id]?.trim() || null);
			pendingList = pendingList.filter((h) => h.id !== id);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Gagal konfirmasi terima shift.');
		} finally {
			confirmingId = null;
		}
	}

	function namaOf(rel: HandoverRow['karyawan_keluar_id']) {
		return typeof rel === 'object' ? rel.nama_karyawan : `#${rel}`;
	}

	function formatWaktu(iso: string | null) {
		if (!iso) return '-';
		return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>Serah-Terima Shift — EPI</title>
</svelte:head>

<div class="mx-auto max-w-lg p-4 pb-24">
	<div class="mb-1 flex items-center gap-2">
		<IconClipboardText size={20} class="text-blue-600" />
		<h1 class="text-lg font-bold text-gray-900">Serah-Terima Shift</h1>
	</div>
	<p class="mb-4 text-xs text-gray-500">
		Ringkasan output/reject/waste terisi otomatis dari data produksi shift Anda hari ini.
		Tab "Terima Shift" berisi serah-terima yang menunggu konfirmasi Anda; tab "Serahkan Shift"
		untuk mengirim ringkasan ke rekan shift berikutnya. Ringkasan otomatis hanya muncul untuk
		shift yang sudah tercatat lewat Fase 3D (jadwal kerja) — shift lama akan kosong, bukan bug.
	</p>

	<div class="mb-4 flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm font-semibold">
		<button
			class="flex-1 rounded-md py-2 transition-colors {activeTab === 'terima' ? 'bg-white shadow text-blue-700' : 'text-gray-500'}"
			onclick={() => switchTab('terima')}
		>
			Terima Shift {#if pendingList.length > 0}<span class="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{pendingList.length}</span>{/if}
		</button>
		<button
			class="flex-1 rounded-md py-2 transition-colors {activeTab === 'serahkan' ? 'bg-white shadow text-blue-700' : 'text-gray-500'}"
			onclick={() => switchTab('serahkan')}
		>
			Serahkan Shift
		</button>
	</div>

	{#if activeTab === 'terima'}
		{#if loadingPending}
		<div class="flex flex-col items-center justify-center py-10">
			<CircularProgressGauge size={50} strokeWidth={4} label="Memuat item pending..." />
		</div>
		{:else if pendingList.length === 0}
			<p class="py-10 text-center text-sm text-gray-400">Tidak ada serah-terima yang menunggu Anda terima.</p>
		{:else}
			<div class="space-y-3">
				{#each pendingList as h (h.id)}
					<div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
						<div class="mb-1 flex items-center justify-between text-xs text-gray-500">
							<span>Dari <strong class="text-gray-800">{namaOf(h.karyawan_keluar_id)}</strong></span>
							<span>{formatWaktu(h.date_created)}</span>
						</div>
						{#if h.shift_label}<p class="mb-1 text-xs font-semibold text-amber-700">Shift: {h.shift_label}</p>{/if}
						<p class="mb-3 whitespace-pre-line text-sm text-gray-800">{h.catatan_keluar || '(tanpa catatan)'}</p>
						<textarea
							bind:value={catatanMasukByThread[h.id]}
							placeholder="Catatan Anda saat menerima (opsional)..."
							rows="2"
							class="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
						></textarea>
						<button
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-bold text-white disabled:opacity-60"
							disabled={confirmingId === h.id}
							onclick={() => confirmOne(h.id)}
						>
							{#if confirmingId === h.id}
								<IconLoader2 size={16} class="animate-spin" /> Mengonfirmasi...
							{:else}
								<IconCheck size={16} /> Konfirmasi Terima
							{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		{#if loadingSummary}
		<div class="flex flex-col items-center justify-center py-10">
			<CircularProgressGauge size={50} strokeWidth={4} label="Memuat ringkasan serah terima..." />
		</div>
		{:else}
			<div class="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
				<p class="mb-1 text-xs font-semibold text-blue-700">
					{summary?.namaJadwal || 'Shift belum terdeteksi dari roster'}
				</p>
				{#if summary && summary.entriCount > 0}
					<div class="grid grid-cols-3 gap-2 text-center">
						<div><p class="text-lg font-bold text-green-700">{summary.outputKg}</p><p class="text-[10px] text-gray-500">Output (kg)</p></div>
						<div><p class="text-lg font-bold text-red-600">{summary.rejectKg}</p><p class="text-[10px] text-gray-500">Reject (kg)</p></div>
						<div><p class="text-lg font-bold text-amber-600">{summary.wasteKg}</p><p class="text-[10px] text-gray-500">Waste (kg)</p></div>
					</div>
				{:else}
					<p class="text-xs text-gray-500">Belum ada entri produksi tercatat untuk shift ini hari ini.</p>
				{/if}
			</div>

			<label for="catatan-keluar" class="mb-1 block text-xs text-gray-500">Catatan serah-terima (boleh diedit)</label>
			<textarea
				id="catatan-keluar"
				bind:value={catatanKeluar}
				rows="4"
				class="mb-3 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
			></textarea>

			<label for="penerima" class="mb-1 block text-xs text-gray-500">Serahkan ke</label>
			<select id="penerima" bind:value={penerimaId} class="mb-3 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm">
				<option value="">-- pilih penerima shift --</option>
				{#each karyawanOptions as k (k.id)}
					<option value={String(k.id)}>{k.nama_karyawan}</option>
				{/each}
			</select>

			{#if submitError}<p class="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">{submitError}</p>{/if}
			{#if submitSuccess}<p class="mb-2 rounded-lg bg-green-50 p-2 text-xs text-green-700">Serah-terima terkirim, menunggu dikonfirmasi.</p>{/if}

			<button
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
				disabled={submitting || !penerimaId}
				onclick={submitHandover}
			>
				{#if submitting}
					<IconLoader2 size={16} class="animate-spin" /> Mengirim...
				{:else}
					<IconArrowRight size={16} /> Kirim Serah-Terima
				{/if}
			</button>

			{#if myHistory.length > 0}
				<div class="mt-5">
					<p class="mb-2 text-xs font-semibold text-gray-500">Riwayat serah-terima Anda</p>
					<div class="space-y-2">
						{#each myHistory as h (h.id)}
							<div class="rounded-lg border border-gray-100 p-2 text-xs">
								<div class="flex items-center justify-between">
									<span>Ke <strong>{namaOf(h.karyawan_masuk_id)}</strong> — {formatWaktu(h.date_created)}</span>
									{#if h.diterima}
										<span class="rounded-full bg-green-100 px-2 py-0.5 font-bold text-green-700">Diterima</span>
									{:else}
										<span class="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">Menunggu</span>
									{/if}
								</div>
								{#if h.catatan_masuk}<p class="mt-1 text-gray-500">Catatan penerima: {h.catatan_masuk}</p>{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	{/if}
</div>
