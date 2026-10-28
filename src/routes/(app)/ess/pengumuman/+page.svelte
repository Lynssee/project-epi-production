<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getPengumumanList, markPengumumanRead, type PengumumanItem } from '$lib/services/ess/pengumuman';
	import { IconLoader2, IconAlertTriangle, IconSpeakerphone, IconChevronDown } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let pengumuman = $state<PengumumanItem[]>([]);
	let expandedId = $state<string | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getPengumumanList();
			pengumuman = res.pengumuman;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat pengumuman.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function toggleExpand(item: PengumumanItem) {
		expandedId = expandedId === item.id ? null : item.id;
		if (!item.is_read) {
			try {
				await markPengumumanRead(item.id);
				pengumuman = pengumuman.map((p) => (p.id === item.id ? { ...p, is_read: true } : p));
			} catch (err) {
				console.error('Gagal menandai pengumuman terbaca:', err);
			}
		}
	}

	function formatDate(dateStr: string) {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return dateStr;
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Pengumuman</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Info & kebijakan dari HR</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pengumuman perusahaan..." />
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
	{:else if pengumuman.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
				<IconSpeakerphone size={32} class="text-slate-400" />
			</div>
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada pengumuman.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each pengumuman as item (item.id)}
				<div class="glass-panel rounded-2xl overflow-hidden transition-all duration-300 {expandedId === item.id ? 'shadow-lg border-blue-200/50' : 'hover-lift'}">
					<button class="w-full text-left p-5 focus:outline-none flex items-start gap-4" onclick={() => toggleExpand(item)}>
						<div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 {item.is_read ? 'bg-slate-100 text-slate-500' : 'gradient-bg text-white shadow-md animate-pulse'}">
							<IconSpeakerphone size={20} />
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-start justify-between gap-2">
								<p class="text-base {item.is_read ? 'font-bold' : 'font-extrabold'} leading-tight" style="color: var(--sys-label)">{item.judul}</p>
								<IconChevronDown size={18} class="transition-transform duration-300 shrink-0 mt-0.5 {expandedId === item.id ? 'rotate-180 text-blue-600' : ''}" style="color: var(--sys-label4)" />
							</div>
							<div class="flex items-center gap-2 mt-2">
								<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100" style="color: var(--sys-label3)">{item.kategori}</span>
								<span class="text-xs font-medium" style="color: var(--sys-label4)">&middot; {formatDate(item.tanggal_mulai)}</span>
								{#if !item.is_read}
									<span class="w-2 h-2 rounded-full bg-red-500 ml-1 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
								{/if}
							</div>
						</div>
					</button>
					{#if expandedId === item.id}
						<div class="px-5 pb-5 pt-2 ml-[3.25rem]">
							<div class="text-sm font-medium leading-relaxed whitespace-pre-line p-4 rounded-xl bg-slate-50/50 border border-slate-200/50" style="color: var(--sys-label)">
								{item.isi}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
