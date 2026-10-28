<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { getNotifikasiList, markNotifikasiRead, getNotifikasiPdfBlob, downloadNotifikasiPdf, type NotifikasiItem } from '$lib/services/notifikasiApi';
	import { IconLoader2, IconAlertTriangle, IconBell, IconFileTypePdf, IconChevronDown } from '@tabler/icons-svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let notifikasi = $state<NotifikasiItem[]>([]);
	let filterRead = $state<'all' | 'unread' | 'read'>('all');
	let expandedId = $state<number | null>(null);
	let downloadingId = $state<number | null>(null);
	let previewBlob = $state<Blob | null>(null);
	let previewTitle = $state<string>('');
	let showPreviewModal = $state(false);
	let showingCached = $state(false);
	let cachedAt = $state<string | null>(null);

	const MODUL_LABELS: Record<string, string> = { ga: 'GA', sales: 'Sales' };

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getNotifikasiList({ read: filterRead === 'all' ? undefined : filterRead === 'read' });
			notifikasi = res.notifikasi;
			showingCached = res.fromCache ?? false;
			cachedAt = res.cachedAt ?? null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat notifikasi.';
		} finally {
			loading = false;
		}
	}

	async function toggleExpand(item: NotifikasiItem) {
		expandedId = expandedId === item.id ? null : item.id;
		if (!item.read) {
			try {
				await markNotifikasiRead(item.id);
				notifikasi = notifikasi.map((n) => (n.id === item.id ? { ...n, read: true } : n));
			} catch (err) {
				console.error('Gagal menandai notifikasi terbaca:', err);
			}
		}
	}

	function openAction(item: NotifikasiItem) {
		if (item.action_url) goto(item.action_url);
	}

	async function doDownload(item: NotifikasiItem, e: MouseEvent) {
		e.stopPropagation();
		downloadingId = item.id;
		try {
			const blob = await getNotifikasiPdfBlob(item.id);
			previewBlob = blob;
			previewTitle = `Notifikasi-${item.id}-${item.title || 'Dokumen'}.pdf`;
			showPreviewModal = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat PDF.';
		} finally {
			downloadingId = null;
		}
	}

	function formatDate(dateStr: string) {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return dateStr;
		return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	$effect(() => {
		filterRead;
		load();
	});
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Notifikasi</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Semua pemberitahuan untuk Anda</p>
	</div>

	<div class="flex items-center gap-2 mb-5">
		{#each [{ v: 'all', l: 'Semua' }, { v: 'unread', l: 'Belum Dibaca' }, { v: 'read', l: 'Sudah Dibaca' }] as tab}
			<button
				class="text-xs font-bold px-3 py-1.5 rounded-full transition-all {filterRead === tab.v ? 'text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}"
				style={filterRead === tab.v ? 'background: var(--g)' : ''}
				onclick={() => (filterRead = tab.v as typeof filterRead)}
			>
				{tab.l}
			</button>
		{/each}
	</div>

	{#if showingCached}
		<div class="mb-3 px-3 py-2 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
			📴 Offline — menampilkan data terakhir tersimpan{cachedAt ? ` (${new Date(cachedAt).toLocaleString('id-ID')})` : ''}.
		</div>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat notifikasi..." />
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
	{:else if notifikasi.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
				<IconBell size={32} class="text-slate-400" />
			</div>
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Tidak ada notifikasi.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each notifikasi as item (item.id)}
				<div class="glass-panel rounded-2xl overflow-hidden transition-all duration-300 {expandedId === item.id ? 'shadow-lg border-blue-200/50' : 'hover-lift'}">
					<button class="w-full text-left p-5 focus:outline-none flex items-start gap-4" onclick={() => toggleExpand(item)}>
						<div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 {item.read ? 'bg-slate-100 text-slate-500' : 'gradient-bg text-white shadow-md'}">
							<IconBell size={20} />
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-start justify-between gap-2">
								<p class="text-base {item.read ? 'font-bold' : 'font-extrabold'} leading-tight" style="color: var(--sys-label)">{item.title}</p>
								<IconChevronDown size={18} class="transition-transform duration-300 shrink-0 mt-0.5 {expandedId === item.id ? 'rotate-180 text-blue-600' : ''}" style="color: var(--sys-label4)" />
							</div>
							<div class="flex items-center gap-2 mt-2 flex-wrap">
								{#if item.module}
									<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100" style="color: var(--sys-label3)">{MODUL_LABELS[item.module] || item.module}</span>
								{/if}
								<span class="text-xs font-medium" style="color: var(--sys-label4)">&middot; {formatDate(item.created_at)}</span>
								{#if !item.read}
									<span class="w-2 h-2 rounded-full bg-red-500 ml-1 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
								{/if}
							</div>
						</div>
					</button>
					{#if expandedId === item.id}
						<div class="px-5 pb-5 pt-2 ml-[3.25rem] flex flex-col gap-3">
							<div class="text-sm font-medium leading-relaxed whitespace-pre-line p-4 rounded-xl bg-slate-50/50 border border-slate-200/50" style="color: var(--sys-label)">
								{item.message}
							</div>
							<div class="flex items-center gap-2 flex-wrap">
								{#if item.attachment_file_id}
									<button
										class="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
										onclick={(e) => doDownload(item, e)}
										disabled={downloadingId === item.id}
									>
										<IconFileTypePdf size={14} />
										{downloadingId === item.id ? 'Mengunduh...' : 'Unduh PDF'}
									</button>
								{/if}
								{#if item.action_url}
									<button class="text-xs font-bold px-3 py-1.5 rounded-lg text-white gradient-bg" onclick={() => openAction(item)}>
										Buka Detail
									</button>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<PdfBlobViewer
		src={previewBlob}
		title={previewTitle}
		show={showPreviewModal}
		onClose={() => {
			showPreviewModal = false;
			previewBlob = null;
		}}
	/>
</div>
