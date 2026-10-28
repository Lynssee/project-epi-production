<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getLemburStatus, type LemburRecord } from '$lib/services/ess/lembur';
	import { registerStatusPolling } from '$lib/utils/statusPolling';
	import { IconLoader2, IconPlus, IconAlertTriangle, IconFileExport } from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let riwayat = $state<LemburRecord[]>([]);

	// Fase 6 (open-source plan, "status approval real-time") — status lembur diubah
	// admin dari dashboard lain (approve/reject), field employee sebelumnya harus
	// refresh manual untuk lihat hasilnya. Polling senyap (tanpa spinner) saat tab
	// fokus/online + tiap 60 detik -- lihat statusPolling.ts untuk kenapa bukan WebSocket.
	async function load({ silent = false } = {}) {
		if (!silent) loading = true;
		errorMsg = '';
		try {
			const res = await getLemburStatus();
			riwayat = res.riwayat;
		} catch (err: any) {
			if (!silent) errorMsg = err?.message || 'Gagal memuat data lembur.';
		} finally {
			if (!silent) loading = false;
		}
	}

	onMount(() => {
		load();
		const unregister = registerStatusPolling(() => load({ silent: true }));
		return unregister;
	});

	function statusColor(status: string) {
		if (status === 'Disetujui') return { bg: 'var(--gg)', text: 'var(--ggd)' };
		if (status === 'Ditolak') return { bg: 'var(--rel)', text: 'var(--red)' };
		return { bg: 'var(--aml)', text: 'var(--amd)' };
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '-';
		const parts = dateStr.split('-');
		if (parts.length !== 3) return dateStr;
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${parseInt(parts[2])} ${monthNames[parseInt(parts[1]) - 1] || parts[1]} ${parts[0]}`;
	}

	let sheetOpen = $state(false);
	const exportColumns = [
		{ key: 'tanggal', label: 'Tanggal' },
		{ key: 'jam_mulai', label: 'Jam Mulai' },
		{ key: 'jam_selesai', label: 'Jam Selesai' },
		{ key: 'status', label: 'Status' },
		{ key: 'alasan', label: 'Alasan' },
		{ key: 'catatan', label: 'Catatan Approval' }
	];
	const exportRows = $derived(
		riwayat.map((r) => ({
			tanggal: formatDate(r.tanggal),
			jam_mulai: r.jam_mulai ?? '-',
			jam_selesai: r.jam_selesai ?? '-',
			status: r.status ?? '-',
			alasan: r.alasan ?? '-',
			catatan: r.catatan_approval ?? '-'
		}))
	);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Lembur Saya</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Riwayat & pengajuan lembur</p>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<button
				class="w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 disabled:opacity-40 hover:scale-105 transition-transform"
				onclick={() => (sheetOpen = true)}
				disabled={riwayat.length === 0}
				aria-label="Ekspor riwayat lembur"
				title="Ekspor riwayat lembur (PDF / CSV)"
			>
				<IconFileExport size={20} />
			</button>
			<button
				class="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white gradient-bg btn-pulse hover:scale-105 transition-transform shadow-lg"
				onclick={() => goto('/ess/lembur/baru')}
				aria-label="Ajukan lembur baru"
			>
				<IconPlus size={24} />
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data lembur..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if riwayat.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada pengajuan lembur.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#each riwayat as r (r.id)}
				{@const c = statusColor(r.status)}
				<div class="hover-lift glass-panel rounded-2xl p-5 relative overflow-hidden flex flex-col">
					<div class="flex items-center justify-between mb-3 relative z-10">
						<h3 class="text-base font-bold" style="color: var(--sys-label)">{formatDate(r.tanggal)}</h3>
						<span class="text-xs font-bold px-3 py-1 rounded-full border shadow-sm" style="background: {c.bg}; color: {c.text}; border-color: {c.text}20">{r.status}</span>
					</div>
					<div class="mb-3 relative z-10">
						<span class="px-2.5 py-1 rounded-lg text-sm font-bold bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-2 w-fit">
							<IconLoader2 size={16} class="text-blue-500" />
							{r.jam_mulai} — {r.jam_selesai}
						</span>
					</div>
					{#if r.alasan}
						<p class="text-sm bg-white/50 p-3 rounded-xl border border-white/20 mb-1 relative z-10" style="color: var(--sys-label)">{r.alasan}</p>
					{/if}
					{#if r.status === 'Ditolak' && r.catatan_approval}
						<p class="text-xs mt-3 px-3 py-2 rounded-xl border relative z-10" style="background: var(--rel); color: var(--red); border-color: var(--re)"><strong>Catatan Penolakan:</strong> {r.catatan_approval}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<EssExportSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	judul="Riwayat Lembur Saya"
	filename="lembur-saya"
	columns={exportColumns}
	rows={exportRows}
/>
