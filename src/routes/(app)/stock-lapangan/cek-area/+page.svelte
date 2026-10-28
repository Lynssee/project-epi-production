<!-- src/routes/(app)/stock-lapangan/cek-area/+page.svelte -->
<!-- Fase 3 (Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2, 20 Agu 2026):
     entry point Cek Area/Genba -- scan QR rak, input kode manual, riwayat & ringkasan hari ini. -->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchRecentCekArea, type RecentCekArea } from '$lib/services/cekAreaApi';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { IconQrcode, IconClipboardCheck, IconHistory, IconLoader2, IconChevronLeft } from '@tabler/icons-svelte';

	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let showScanner = $state(false);
	let scanError = $state('');

	function onScanDetect(raw: string) {
		showScanner = false;
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'LOC') {
			scanError = 'Ini bukan QR lokasi gudang/rak. Arahkan kamera ke label QR di rak.';
			return;
		}
		goto(`/scan/${encodeURIComponent(raw)}`);
	}

	let manualCode = $state('');
	function submitManualCode() {
		const trimmed = manualCode.trim();
		if (!trimmed) return;
		// Boleh ID rak langsung (angka) atau kode lengkap EPI:LOC:<id>.
		if (/^\d+$/.test(trimmed)) {
			goto(`/stock-lapangan/cek-area/${trimmed}`);
		} else {
			goto(`/scan/${encodeURIComponent(trimmed)}`);
		}
	}

	let canSubmit = $derived(
		hasPermission($authStore.roleId, 'verify_area_inventory', $rolesStore)
	);

	let loading = $state(true);
	let recent = $state<RecentCekArea[]>([]);
	let todayCount = $state(0);

	onMount(async () => {
		try {
			recent = await fetchRecentCekArea(5);
			const todayStr = new Date().toISOString().split('T')[0];
			todayCount = recent.filter((r) => r.date_created?.startsWith(todayStr)).length;
			// Ringkasan hari ini butuh hitungan penuh, bukan cuma 5 teratas -- ambil terpisah kalau perlu lebih.
			if (recent.length === 5 && recent.every((r) => r.date_created?.startsWith(todayStr))) {
				const more = await fetchRecentCekArea(50);
				todayCount = more.filter((r) => r.date_created?.startsWith(todayStr)).length;
			}
		} finally {
			loading = false;
		}
	});

	const STATUS_LABEL: Record<string, { label: string; color: string }> = {
		match: { label: 'Sesuai', color: '#16a34a' },
		selisih: { label: 'Selisih', color: '#d97706' },
		mismatch: { label: 'Mismatch', color: '#dc2626' }
	};
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-4 py-4 flex items-center gap-3">
			<button class="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center" onclick={() => goto('/stock-lapangan')} aria-label="Kembali">
				<IconChevronLeft size={18} />
			</button>
			<div class="w-11 h-11 rounded-2xl bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/20 text-white">
				<IconClipboardCheck size={22} />
			</div>
			<div>
				<h1 class="text-lg font-black" style="color: var(--sys-label)">Cek Area / Genba</h1>
				<p class="text-xs font-medium" style="color: var(--sys-label3)">Hitung fisik dulu, baru isi. Kalau tidak ketemu, isi 0 — jangan dikosongkan.</p>
			</div>
		</div>
	</div>

	{#if showScanner && QrScannerModal}
		<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}
	{#if scanError}
		<div class="px-4 pt-2"><p class="text-[11px] text-center" style="color: #DC2626">{scanError}</p></div>
	{/if}

	<div class="flex-1 overflow-y-auto px-4 py-6 pb-24">
		<div class="max-w-md mx-auto w-full space-y-4">
			{#if !canSubmit}
				<div class="rounded-xl p-3 text-xs" style="background:#fffbeb; border:1px solid #fde68a; color:#92400e">
					Anda bisa scan &amp; lihat detail rak, tapi hasil cek-area hanya bisa dikirim oleh PIC rak tersebut atau SPV ke atas.
				</div>
			{/if}

			<button
				class="w-full rounded-2xl py-6 flex flex-col items-center gap-2 text-white shadow-lg shadow-teal-500/20"
				style="background: linear-gradient(135deg,#0d9488,#0f766e)"
				onclick={async () => { await loadQrScannerModal(); scanError = ''; showScanner = true; }}
			>
				<IconQrcode size={32} />
				<span class="text-sm font-bold">Scan QR Rak</span>
			</button>

			<div class="flex items-center gap-2">
				<div class="flex-1 h-px bg-slate-200"></div>
				<span class="text-[10px] text-slate-400 font-bold uppercase">atau</span>
				<div class="flex-1 h-px bg-slate-200"></div>
			</div>

			<div class="glass-panel rounded-2xl p-4 border border-white/50 shadow-sm">
				<label class="block text-[10px] font-bold uppercase mb-1.5" style="color: var(--sys-label3)">Input Kode Manual</label>
				<div class="flex gap-2">
					<input
						type="text"
						placeholder="ID rak atau kode EPI:LOC:..."
						bind:value={manualCode}
						class="flex-1 rounded-lg px-3 py-2 text-sm border border-slate-200"
					/>
					<button class="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-bold" onclick={submitManualCode}>Buka</button>
				</div>
			</div>

			<div class="glass-panel rounded-2xl p-4 border border-white/50 shadow-sm text-center">
				{#if loading}
					<CircularProgressGauge size={48} strokeWidth={4} label="Memuat area gudang..." />
				{:else}
					<p class="text-2xl font-black text-teal-600">{todayCount}</p>
					<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Area Dicek Hari Ini</p>
				{/if}
			</div>

			<div>
				<div class="flex items-center gap-2 mb-2 px-1">
					<IconHistory size={16} class="text-slate-500" />
					<h2 class="text-sm font-bold" style="color: var(--sys-label)">5 Riwayat Terakhir</h2>
				</div>
				{#if loading}
					<CircularProgressGauge size={40} strokeWidth={3} label="Memuat data rak..." />
				{:else if recent.length === 0}
					<p class="text-xs text-center text-slate-400 py-4">Belum ada riwayat cek-area.</p>
				{:else}
					<div class="glass-panel rounded-2xl border border-white/50 shadow-sm divide-y divide-slate-100">
						{#each recent as r}
							<button class="w-full flex items-center justify-between px-4 py-3 text-left" onclick={() => goto(`/stock-lapangan/cek-area/${r.gudang_id}`)}>
								<div>
									<p class="text-xs font-bold" style="color: var(--sys-label)">{r.gudang_nama}</p>
									<p class="text-[10px] text-slate-400">{new Date(r.date_created).toLocaleString('id-ID')}</p>
								</div>
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:{STATUS_LABEL[r.status]?.color || '#6b7280'}22; color:{STATUS_LABEL[r.status]?.color || '#6b7280'}">
									{STATUS_LABEL[r.status]?.label || r.status}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
