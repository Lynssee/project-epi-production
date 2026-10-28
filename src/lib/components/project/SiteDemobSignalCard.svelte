<!-- src/lib/components/project/SiteDemobSignalCard.svelte -->
<!-- Sinyal Demobilisasi Lapangan (Fase 4 Site Clearance Gate):
     Tampil saat progres fisik proyek mencapai 100% atau status proyek complete/selesai.
     Memperingatkan Project Leader bila masih ada alat pinjaman atau manpower SPK aktif
     yang belum didemobilisasi, sebelum Finance/Admin menyetujui BAST 100% / Invoice pelunasan. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import directus, { handleDirectusError } from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { fetchActiveLoansForProject, type LoanRow } from '$lib/services/loanChecklist';
	import {
		IconAlertTriangle,
		IconCheck,
		IconChevronDown,
		IconChevronUp,
		IconTools,
		IconUsers,
		IconArrowRight,
		IconLoader2,
		IconRefresh
	} from '@tabler/icons-svelte';

	let {
		projectId,
		project,
		onTabSwitch
	}: {
		projectId: number | string;
		project: any;
		onTabSwitch?: (tab: string, subTab?: string) => void;
	} = $props();

	let loading = $state(false);
	let loaded = $state(false);
	let showDetails = $state(false);

	let activeLoans = $state<LoanRow[]>([]);
	let activeManpower = $state<Array<{ id: number; nama: string; jabatan: string; nomor_spk: string }>>([]);

	// Kondisi pemicu: progres fisik >= 100% atau status proyek complete/selesai
	let isPhysicalComplete = $derived.by(() => {
		const prog = parseFloat(String(project?.total_progress || '0'));
		const status = String(project?.status || '').toLowerCase().trim();
		return prog >= 100 || status === 'complete' || status === 'done' || status === 'selesai' || status === 'menunggu verifikasi';
	});

	let hasOutstanding = $derived(activeLoans.length > 0 || activeManpower.length > 0);

	async function loadClearanceData() {
		const pid = Number(projectId);
		if (!pid) return;

		loading = true;
		try {
			// 1. Ambil alat pinjaman aktif via loanChecklist service
			const loansPromise = fetchActiveLoansForProject(pid).catch(() => []);

			// 2. Ambil penugasan manpower aktif (separated relation fetching)
			const mpPromise = (async () => {
				const rows = (await directus.request(
					readItems('manpower_assignment', {
						filter: { project_id: { _eq: pid }, status: { _eq: 'aktif' } },
						fields: ['id', 'manpower_id', 'jabatan', 'nomor_spk'],
						limit: -1
					})
				)) as any[];

				if (!rows || rows.length === 0) return [];

				// Query nama personil terpisah dari tabel manpower
				const mIds = [...new Set(rows.map((r) => (typeof r.manpower_id === 'object' ? r.manpower_id?.id : r.manpower_id)).filter(Boolean))];
				const nameMap = new Map<string, string>();
				if (mIds.length > 0) {
					try {
						const mpDetails = (await directus.request(
							readItems('manpower', {
								filter: { id: { _in: mIds } },
								fields: ['id', 'nama'],
								limit: -1
							})
						)) as any[];
						for (const m of mpDetails || []) {
							nameMap.set(String(m.id), m.nama || `Personel #${m.id}`);
						}
					} catch {
						/* non-fatal fallback */
					}
				}

				return rows.map((r) => {
					const rawId = typeof r.manpower_id === 'object' ? r.manpower_id?.id : r.manpower_id;
					return {
						id: r.id,
						nama: nameMap.get(String(rawId)) || (typeof r.manpower_id === 'object' && r.manpower_id?.nama ? r.manpower_id.nama : `Personel #${rawId}`),
						jabatan: r.jabatan || 'Teknisi',
						nomor_spk: r.nomor_spk || '-'
					};
				});
			})().catch(() => []);

			const [loans, mpList] = await Promise.all([loansPromise, mpPromise]);
			activeLoans = loans;
			activeManpower = mpList;
			loaded = true;
		} catch (e) {
			handleDirectusError(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (projectId && isPhysicalComplete) {
			loadClearanceData();
		}
	});
</script>

{#if isPhysicalComplete}
	<div class="px-4 pt-3">
		{#if loading && !loaded}
			<div class="flex items-center gap-2 p-3 rounded-xl border border-gray-200 bg-white/70 text-[12px] text-gray-500">
				<IconLoader2 size={16} class="animate-spin text-blue-500" />
				<span>Memeriksa kelengkapan site clearance demobilisasi...</span>
			</div>
		{:else if hasOutstanding}
			<div class="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/30 p-3.5 shadow-sm text-[12px]">
				<!-- Header Card -->
				<div class="flex items-start justify-between gap-2">
					<div class="flex items-start gap-2.5">
						<div class="mt-0.5 rounded-lg bg-amber-200/80 dark:bg-amber-800/50 p-1.5 text-amber-800 dark:text-amber-200 shrink-0">
							<IconAlertTriangle size={18} />
						</div>
						<div>
							<div class="flex items-center gap-2 flex-wrap">
								<h3 class="font-bold text-[13px] text-amber-950 dark:text-amber-100">
									Sinyal Demobilisasi &amp; Site Clearance (Progres 100%)
								</h3>
								<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900 border border-amber-300">
									Gate BAST Tertahan
								</span>
							</div>
							<p class="mt-1 text-amber-800 dark:text-amber-200/90 leading-relaxed">
								Pekerjaan fisik telah 100%. Untuk penerbitan <b>BAST 100%</b> dan <b>Invoice Pelunasan</b>, seluruh alat pinjaman wajib dikembalikan ke gudang dan SPK personil diselesaikan atau dialihkan.
							</p>
						</div>
					</div>
					<button
						onclick={loadClearanceData}
						class="text-amber-700 hover:text-amber-900 p-1 shrink-0"
						title="Segarkan data"
					>
						<IconRefresh size={14} class={loading ? 'animate-spin' : ''} />
					</button>
				</div>

				<!-- Ringkasan Temuan -->
				<div class="grid grid-cols-2 gap-2 mt-3">
					<div class="flex items-center gap-2.5 p-2 rounded-lg bg-white/80 dark:bg-white/5 border border-amber-200 dark:border-amber-800/50">
						<IconTools size={16} class="text-amber-600 shrink-0" />
						<div>
							<div class="text-[10px] text-gray-500 uppercase font-semibold">Alat Pinjaman Aktif</div>
							<div class="font-bold text-[13px] text-gray-900 dark:text-gray-100">
								{activeLoans.length} unit
							</div>
						</div>
					</div>
					<div class="flex items-center gap-2.5 p-2 rounded-lg bg-white/80 dark:bg-white/5 border border-amber-200 dark:border-amber-800/50">
						<IconUsers size={16} class="text-amber-600 shrink-0" />
						<div>
							<div class="text-[10px] text-gray-500 uppercase font-semibold">Personil SPK Aktif</div>
							<div class="font-bold text-[13px] text-gray-900 dark:text-gray-100">
								{activeManpower.length} orang
							</div>
						</div>
					</div>
				</div>

				<!-- Accordion Rincian Barang / Manpower -->
				<div class="mt-2.5">
					<button
						onclick={() => (showDetails = !showDetails)}
						class="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:underline"
					>
						{#if showDetails}
							<IconChevronUp size={14} /> Sembunyikan Rincian Alat &amp; Personil
						{:else}
							<IconChevronDown size={14} /> Lihat Rincian Alat &amp; Personil ({activeLoans.length + activeManpower.length} item)
						{/if}
					</button>

					{#if showDetails}
						<div class="mt-2 space-y-2 p-2.5 rounded-lg bg-white/90 dark:bg-gray-900/80 border border-amber-200 dark:border-amber-800/50 text-[11px]">
							{#if activeLoans.length > 0}
								<div>
									<div class="font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
										<IconTools size={13} class="text-amber-600" /> Daftar Alat Pinjaman Belum Kembali:
									</div>
									<ul class="space-y-1 pl-4 list-disc text-gray-600 dark:text-gray-400">
										{#each activeLoans as l}
											<li>
												<span class="font-medium text-gray-800 dark:text-gray-200">
													{l.equipment?.name || 'Unit Alat'}
												</span>
												{#if l.equipment?.code}
													<span class="text-gray-500">({l.equipment.code})</span>
												{/if}
												{#if l.start_date}
													<span class="text-[10px] text-gray-400">· Dipinjam: {l.start_date}</span>
												{/if}
											</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if activeManpower.length > 0}
								<div class={activeLoans.length > 0 ? 'pt-2 border-t border-gray-100 dark:border-gray-800' : ''}>
									<div class="font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
										<IconUsers size={13} class="text-amber-600" /> Daftar Personil SPK Aktif:
									</div>
									<ul class="space-y-1 pl-4 list-disc text-gray-600 dark:text-gray-400">
										{#each activeManpower as m}
											<li>
												<span class="font-medium text-gray-800 dark:text-gray-200">{m.nama}</span>
												<span class="text-gray-500">({m.jabatan})</span>
												<span class="text-[10px] text-gray-400">· SPK: {m.nomor_spk}</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Tombol Aksi Cepat Lapangan -->
				<div class="mt-3 flex items-center gap-2 flex-wrap">
					<button
						onclick={() => onTabSwitch ? onTabSwitch('manpower', 'manpower-spk') : goto(`/proyek/${projectId}`)}
						class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] shadow-sm transition"
					>
						<IconUsers size={13} /> Selesaikan SPK Manpower
					</button>
					<button
						onclick={() => goto(`/proyek/${projectId}/closeout`)}
						class="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-white/10 hover:bg-amber-100 text-amber-900 dark:text-amber-200 font-semibold text-[11px] transition"
					>
						Checklist Closeout <IconArrowRight size={13} />
					</button>
					<button
						onclick={() => onTabSwitch ? onTabSwitch('keuangan', 'kontrak') : goto(`/proyek/${projectId}`)}
						class="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-800 dark:text-blue-200 font-semibold text-[11px] transition"
					>
						Ajukan BAST / Standby
					</button>
				</div>
			</div>
		{:else if loaded}
			<div class="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-green-200 bg-green-50/80 dark:bg-green-950/20 text-[11px] text-green-800 dark:text-green-300">
				<div class="flex items-center gap-2">
					<IconCheck size={16} class="text-green-600 shrink-0" />
					<span><b>Site Clearance Lengkap:</b> Seluruh alat telah dikembalikan &amp; personil selesai. Siap diproses BAST Final &amp; Invoice Pelunasan.</span>
				</div>
				<button
					onclick={() => goto(`/proyek/${projectId}/closeout`)}
					class="font-semibold text-green-700 hover:underline shrink-0"
				>
					Buka Closeout &rarr;
				</button>
			</div>
		{/if}
	</div>
{/if}
