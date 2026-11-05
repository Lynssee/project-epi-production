<!-- src/lib/components/project/FieldActionBanner.svelte -->
<!-- Banner Aksi & Kendala Terintegrasi di Dashboard Lapangan (Mobile-First) -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import {
		fetchActiveDirectivesForProject,
		acknowledgeDirective,
		type ProjectActionItem
	} from '$lib/services/projectActionApi';
	import FieldResolutionModal from './FieldResolutionModal.svelte';
	import FieldIssueReportModal from './FieldIssueReportModal.svelte';
	import {
		IconAlertTriangle,
		IconBolt,
		IconCheck,
		IconClock,
		IconCamera,
		IconChevronDown,
		IconChevronUp,
		IconShieldExclamation,
		IconCircleCheck,
		IconRefresh,
		IconInfoCircle,
		IconFlame,
		IconFileDescription
	} from '@tabler/icons-svelte';

	interface Props {
		projectId: number | string;
		actor: { id: string; nama: string };
		onRefreshNeeded?: () => void;
	}

	let { projectId, actor, onRefreshNeeded }: Props = $props();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let items = $state<ProjectActionItem[]>([]);
	let expandedItemId = $state<number | null>(null);
	let acknowledgingId = $state<number | null>(null);

	// Modal states
	let showReportModal = $state(false);
	let itemForResolution = $state<ProjectActionItem | null>(null);

	// Derived metrics
	let activeItems = $derived(items.filter((i) => i.status !== 'closed' && i.status !== 'rejected'));
	let criticalItems = $derived(
		activeItems.filter((i) => i.tingkat_urgensi === 'kritis' || i.is_gate_blocker)
	);
	let pendingResolution = $derived(
		activeItems.filter((i) => i.status === 'open' || i.status === 'in_progress')
	);
	let waitingVerification = $derived(activeItems.filter((i) => i.status === 'resolved'));

	export async function loadItems() {
		if (!projectId) return;
		loading = true;
		error = null;
		try {
			const res = await fetchActiveDirectivesForProject(Number(projectId));
			items = res;
		} catch (err: any) {
			console.error('FieldActionBanner: Gagal memuat instruksi:', err);
			error = err?.message || 'Gagal memuat instruksi & kendala';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadItems();
	});

	async function handleAcknowledge(item: ProjectActionItem) {
		if (!confirm(`Terima & mulai tindak lanjuti instruksi "${item.judul}"?`)) return;
		acknowledgingId = item.id;
		try {
			await acknowledgeDirective(item.id, actor, item);
			await loadItems();
			onRefreshNeeded?.();
			if (typeof (window as any)?.__showToast === 'function') {
				(window as any).__showToast('Instruksi berhasil diterima. Status: Sedang Dikerjakan', 'success');
			}
		} catch (err: any) {
			alert('Gagal menerima instruksi: ' + (err?.message || 'Terjadi kesalahan'));
		} finally {
			acknowledgingId = null;
		}
	}

	function toggleExpand(id: number) {
		expandedItemId = expandedItemId === id ? null : id;
	}

	function getUrgensiBadge(urgensi: string) {
		switch (urgensi) {
			case 'kritis':
				return { bg: 'bg-rose-500/20 text-rose-300 border-rose-500/40', label: '🚨 KRITIS', pulse: true };
			case 'tinggi':
				return { bg: 'bg-orange-500/20 text-orange-300 border-orange-500/40', label: '⚡ TINGGI', pulse: false };
			case 'sedang':
				return { bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40', label: 'SEDANG', pulse: false };
			default:
				return { bg: 'bg-slate-500/20 text-slate-300 border-slate-500/40', label: 'NORMAL', pulse: false };
		}
	}

	function getStatusBadge(status: string) {
		switch (status) {
			case 'open':
				return { bg: 'bg-amber-500/20 text-amber-300 border-amber-500/30', label: 'Menunggu Ditindaklanjuti' };
			case 'in_progress':
				return { bg: 'bg-sky-500/20 text-sky-300 border-sky-500/30', label: 'Sedang Dikerjakan' };
			case 'resolved':
				return { bg: 'bg-purple-500/20 text-purple-300 border-purple-500/30', label: 'Menunggu Verifikasi Pusat' };
			case 'closed':
				return { bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', label: 'Selesai & Diverifikasi' };
			default:
				return { bg: 'bg-slate-500/20 text-slate-300 border-slate-500/30', label: status };
		}
	}

	function formatTanggal(tglStr?: string) {
		if (!tglStr) return '-';
		try {
			const d = new Date(tglStr);
			return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return tglStr;
		}
	}
</script>

<div class="field-action-hub-container mb-4">
	<!-- KARTU UTAMA BANNER -->
	<div
		class="rounded-2xl border transition-all duration-300 overflow-hidden shadow-lg {criticalItems.length > 0
			? 'bg-gradient-to-r from-rose-950/80 via-slate-900/90 to-rose-950/80 border-rose-500/60 ring-2 ring-rose-500/30'
			: activeItems.length > 0
				? 'bg-gradient-to-r from-amber-950/60 via-slate-900/90 to-slate-900/90 border-amber-500/40'
				: 'bg-slate-900/80 border-slate-800'}"
	>
		<!-- Top Bar Header -->
		<div class="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5">
			<div class="flex items-start sm:items-center gap-3">
				<div
					class="p-2.5 rounded-xl shrink-0 {criticalItems.length > 0
						? 'bg-rose-500/30 text-rose-400 animate-pulse'
						: activeItems.length > 0
							? 'bg-amber-500/20 text-amber-400'
							: 'bg-emerald-500/20 text-emerald-400'}"
				>
					{#if criticalItems.length > 0}
						<IconShieldExclamation size={24} />
					{:else if activeItems.length > 0}
						<IconBolt size={24} />
					{:else}
						<IconCircleCheck size={24} />
					{/if}
				</div>

				<div>
					<div class="flex items-center gap-2 flex-wrap">
						<span class="text-xs font-bold tracking-wider uppercase text-white flex items-center gap-1.5">
							⚡ Komando Direksi &amp; Kendala Lapangan
						</span>
						{#if criticalItems.length > 0}
							<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500 text-white animate-pulse">
								{criticalItems.length} KRITIS / GATE BLOCKER
							</span>
						{:else if activeItems.length > 0}
							<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/30 text-amber-300 border border-amber-500/40">
								{activeItems.length} AKTIF
							</span>
						{:else}
							<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
								CLEAR / TIDAK ADA KENDALA
							</span>
						{/if}
					</div>

					<p class="text-xs text-slate-300 mt-0.5">
						{#if criticalItems.length > 0}
							Terdapat kendala kritis atau instruksi yang menahan peralihan fase proyek (Gate Blocker).
						{:else if activeItems.length > 0}
							Instruksi manajemen kantor atau kendala lapangan yang sedang berjalan.
						{:else}
							Semua instruksi manajemen telah diverifikasi dan tidak ada kendala aktif saat ini.
						{/if}
					</p>
				</div>
			</div>

			<!-- Quick Action Buttons -->
			<div class="flex items-center gap-2 self-end sm:self-auto shrink-0">
				<button
					type="button"
					onclick={() => (showReportModal = true)}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white text-xs font-bold shadow-md shadow-rose-900/40 active:scale-95 transition-all"
				>
					<IconFlame size={15} class="animate-bounce" />
					<span>Lapor Kendala (SOS)</span>
				</button>

				<button
					type="button"
					onclick={loadItems}
					disabled={loading}
					class="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
					title="Segarkan daftar"
				>
					<IconRefresh size={16} class={loading ? 'animate-spin' : ''} />
				</button>
			</div>
		</div>

		<!-- LIST ACTION ITEMS -->
		{#if activeItems.length > 0}
			<div class="divide-y divide-white/5 max-h-96 overflow-y-auto">
				{#each activeItems as item (item.id)}
					{@const urgBadge = getUrgensiBadge(item.tingkat_urgensi)}
					{@const stBadge = getStatusBadge(item.status)}
					{@const isExpanded = expandedItemId === item.id}
					<div class="p-3.5 sm:p-4 hover:bg-white/[0.02] transition-colors">
						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
							<div class="flex-1 min-w-0">
								<!-- Badges Bar -->
								<div class="flex items-center gap-1.5 flex-wrap mb-1.5">
									<span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
										{item.nomor_dokumen}
									</span>
									<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full border {urgBadge.bg} {urgBadge.pulse ? 'animate-pulse' : ''}">
										{urgBadge.label}
									</span>
									<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border {stBadge.bg}">
										{stBadge.label}
									</span>
									{#if item.is_gate_blocker}
										<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-900/50 text-rose-300 border border-rose-500/50">
											⛔ Gate Blocker
										</span>
									{/if}
									{#if item.target_selesai}
										<span class="text-[10px] text-slate-400 flex items-center gap-1 ml-auto sm:ml-0">
											<IconClock size={12} />
											<span>Target: {formatTanggal(item.target_selesai)}</span>
										</span>
									{/if}
								</div>

								<!-- Judul & Deskripsi Singkat -->
								<h4 class="text-sm font-bold text-white leading-snug">
									{item.judul}
								</h4>
								<p class="text-xs text-slate-300 mt-1 line-clamp-2 leading-relaxed">
									{item.deskripsi}
								</p>
							</div>

							<!-- Action Buttons Group -->
							<div class="flex items-center gap-2 self-end sm:self-center shrink-0 mt-2 sm:mt-0">
								<!-- Tombol Terima (Acknowledge) jika open -->
								{#if item.status === 'open'}
									<button
										type="button"
										onclick={() => handleAcknowledge(item)}
										disabled={acknowledgingId === item.id}
										class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white text-xs font-extrabold shadow-md shadow-amber-950/40 transition-all active:scale-95 animate-pulse"
										title="Konfirmasi bahwa Anda telah membaca instruksi Direksi dan siap melaksanakan"
									>
										<IconCheck size={15} />
										<span>{acknowledgingId === item.id ? 'Memproses...' : '✅ Paham & Siap Laksanakan'}</span>
									</button>
								{/if}

								<!-- Tombol Selesaikan / Kirim Bukti jika open / in_progress -->
								{#if item.status === 'open' || item.status === 'in_progress' || item.status === 'acknowledged'}
									<button
										type="button"
										onclick={() => (itemForResolution = item)}
										class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-950/40 transition-all active:scale-95"
										title="Laporkan bahwa arahan ini sudah selesai dilaksanakan"
									>
										<IconCamera size={14} />
										<span>Laporkan Sudah Dilaksanakan</span>
									</button>
								{:else if item.status === 'pending_verification' || item.status === 'resolved'}
									<span class="text-xs text-purple-300 italic px-2 py-1 bg-purple-950/50 rounded-lg border border-purple-500/20">
										Menunggu Verifikasi Direksi/Admin
									</span>
								{/if}

								<!-- Detail Toggle -->
								<button
									type="button"
									onclick={() => toggleExpand(item.id)}
									class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
									title={isExpanded ? 'Tutup Detail' : 'Buka Detail'}
								>
									{#if isExpanded}
										<IconChevronUp size={16} />
									{:else}
										<IconChevronDown size={16} />
									{/if}
								</button>
							</div>
						</div>

						<!-- EXPANDED DETAIL DRAWER -->
						{#if isExpanded}
							<div transition:slide={{ duration: 200 }} class="mt-3 pt-3 border-t border-white/5 text-xs text-slate-300 space-y-2">
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-black/20 p-2.5 rounded-xl border border-white/5">
									<div>
										<span class="text-slate-400">Pembuat:</span>
										<span class="text-slate-200 font-medium ml-1">{item.pembuat_nama || '-'}</span>
									</div>
									<div>
										<span class="text-slate-400">PIC Pelaksana:</span>
										<span class="text-slate-200 font-medium ml-1">{item.pic_pelaksana_nama || '-'}</span>
									</div>
									<div>
										<span class="text-slate-400">Kategori:</span>
										<span class="text-slate-200 font-medium ml-1 capitalize">{item.kategori?.replace(/_/g, ' ') || '-'}</span>
									</div>
									<div>
										<span class="text-slate-400">Dampak:</span>
										<span class="text-slate-200 font-medium ml-1 capitalize">{item.dampak?.replace(/_/g, ' ') || '-'}</span>
									</div>
								</div>

								<!-- Catatan Penyelesaian Jika Ada -->
								{#if item.catatan_penyelesaian}
									<div class="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
										<div class="font-bold text-emerald-300 flex items-center gap-1 mb-1">
											<IconCheck size={14} /> Catatan Penyelesaian Lapangan:
										</div>
										<p class="text-slate-200 whitespace-pre-wrap">{item.catatan_penyelesaian}</p>
									</div>
								{/if}

								<!-- Foto Lampiran Masalah Jika Ada -->
								{#if item.lampiran_masalah && item.lampiran_masalah.length > 0}
									<div>
										<div class="font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
											<IconFileDescription size={14} /> Lampiran Masalah / Referensi:
										</div>
										<div class="flex gap-2 overflow-x-auto pb-1">
											{#each item.lampiran_masalah as imgId}
												<a
													href="/api/directus/assets/{imgId}"
													target="_blank"
													rel="noreferrer"
													class="block w-16 h-16 rounded-lg overflow-hidden border border-white/10 shrink-0 hover:opacity-80 transition-opacity bg-black"
												>
													<img
														src="/api/directus/assets/{imgId}?width=128&height=128&fit=cover"
														alt="Lampiran Masalah"
														class="w-full h-full object-cover"
													/>
												</a>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Bukti Penyelesaian Jika Ada -->
								{#if item.bukti_penyelesaian && item.bukti_penyelesaian.length > 0}
									<div>
										<div class="font-semibold text-emerald-400 mb-1.5 flex items-center gap-1">
											<IconCamera size={14} /> Foto Bukti Penyelesaian Lapangan:
										</div>
										<div class="flex gap-2 overflow-x-auto pb-1">
											{#each item.bukti_penyelesaian as imgId}
												<a
													href="/api/directus/assets/{imgId}"
													target="_blank"
													rel="noreferrer"
													class="block w-16 h-16 rounded-lg overflow-hidden border border-emerald-500/30 shrink-0 hover:opacity-80 transition-opacity bg-black"
												>
													<img
														src="/api/directus/assets/{imgId}?width=128&height=128&fit=cover"
														alt="Bukti Selesai"
														class="w-full h-full object-cover"
													/>
												</a>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- MODAL BUKTI PENYELESAIAN -->
{#if itemForResolution}
	<FieldResolutionModal
		actionItem={itemForResolution}
		{actor}
		onClose={() => (itemForResolution = null)}
		onSuccess={() => {
			itemForResolution = null;
			loadItems();
			onRefreshNeeded?.();
			if (typeof (window as any)?.__showToast === 'function') {
				(window as any).__showToast('Bukti penyelesaian berhasil dikirim ke kantor pusat!', 'success');
			}
		}}
	/>
{/if}

<!-- MODAL LAPOR KENDALA (SOS) -->
{#if showReportModal}
	<FieldIssueReportModal
		projectId={Number(projectId)}
		{actor}
		onClose={() => (showReportModal = false)}
		onSuccess={(created) => {
			showReportModal = false;
			loadItems();
			onRefreshNeeded?.();
			if (typeof (window as any)?.__showToast === 'function') {
				(window as any).__showToast(`Kendala darurat #${created.nomor_dokumen} berhasil dilaporkan!`, 'success');
			}
		}}
	/>
{/if}
