<!-- src/lib/components/project/FieldActionAlertWidget.svelte -->
<!-- Widget Notifikasi Mandiri untuk Dashboard Utama Lapangan (+page.svelte) -->
<!-- Menampilkan Komando Direksi & Kendala Mendesak. Nol tampil bila tidak ada. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { type ProjectActionItem } from '$lib/services/projectActionApi';
	import { authStore } from '$lib/stores/auth';
	import { IconArrowRight, IconBolt, IconClock, IconRefresh, IconCheck, IconX } from '@tabler/icons-svelte';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';

	let loading = $state(true);
	let urgentItems = $state<Array<ProjectActionItem & { nama_proyek?: string }>>([]);
	let selectedGlobalDirective = $state<ProjectActionItem | null>(null);

	async function loadUrgentItems() {
		loading = true;
		try {
			// Query item yang open / in_progress: instruksi manajemen, kendala kritis, atau gate blocker
			const filterObj: Record<string, any> = {
				status: { _in: ['open', 'in_progress'] },
				_or: [
					{ kategori: { _eq: 'instruksi_manajemen' } },
					{ tingkat_urgensi: { _in: ['kritis', 'kritis_darurat', 'tinggi'] } },
					{ is_gate_blocker: { _eq: true } }
				]
			};

			const itemsRes = await directus.request(
				readItems('project_action_items', {
					filter: filterObj as any,
					sort: ['-tingkat_urgensi', '-date_created'] as any,
					limit: 10,
					fields: [
						'id',
						'project_id',
						'nomor_dokumen',
						'kategori',
						'tingkat_urgensi',
						'dampak',
						'judul',
						'deskripsi',
						'target_selesai',
						'status',
						'is_gate_blocker',
						'pembuat_nama',
						'date_created'
					] as any
				})
			);

			const list = (itemsRes || []) as ProjectActionItem[];

			if (list.length > 0) {
				// Relasi terpisah untuk mengambil nama proyek
				const projectIds = Array.from(new Set(list.map((i) => i.project_id).filter(Boolean)));
				let projectMap: Record<number, string> = {};

				if (projectIds.length > 0) {
					try {
						const projectsRes = await directus.request(
							readItems('projects', {
								filter: { id: { _in: projectIds } } as any,
								fields: ['id', 'name'] as any
							})
						);
						(projectsRes || []).forEach((p: any) => {
							projectMap[p.id] = p.name;
						});
					} catch (pErr) {
						console.warn('Gagal memuat nama proyek untuk widget kendala:', pErr);
					}
				}

				urgentItems = list.map((item) => ({
					...item,
					nama_proyek: item.project_id
						? projectMap[item.project_id] || `Proyek #${item.project_id}`
						: '📢 Komando Global Direksi (Semua Proyek)'
				}));
			} else {
				urgentItems = [];
			}
		} catch (err) {
			console.warn('FieldActionAlertWidget: Error memuat kendala:', err);
			urgentItems = [];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadUrgentItems();
	});

	function handleClick(item: ProjectActionItem & { nama_proyek?: string }) {
		if (item.project_id) {
			goto(`/proyek/${item.project_id}`);
		} else {
			selectedGlobalDirective = item;
		}
	}
</script>

{#if !loading && urgentItems.length > 0}
	<div
		transition:slide={{ duration: 250 }}
		class="mb-4 rounded-2xl border border-amber-500/50 bg-gradient-to-r from-amber-950/70 via-slate-900/90 to-indigo-950/70 p-4 shadow-xl ring-2 ring-amber-500/20"
	>
		<div class="flex items-center justify-between gap-3 mb-3 border-b border-white/10 pb-2.5">
			<div class="flex items-center gap-2.5">
				<div class="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 animate-pulse">
					<IconBolt size={22} />
				</div>
				<div>
					<div class="flex items-center gap-2 flex-wrap">
						<span class="text-xs font-extrabold uppercase tracking-wider text-white">
							⚡ Komando Direksi &amp; Arahan Manajemen
						</span>
						<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500 text-black">
							{urgentItems.length} ARAHAN AKTIF
						</span>
					</div>
					<p class="text-[11px] text-slate-300 mt-0.5">
						Instruksi manajemen kantor pusat dan kendala kritis yang membutuhkan perhatian Anda.
					</p>
				</div>
			</div>

			<button
				type="button"
				onclick={loadUrgentItems}
				class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
				title="Segarkan arahan"
			>
				<IconRefresh size={14} class={loading ? 'animate-spin' : ''} />
			</button>
		</div>

		<div class="space-y-2">
			{#each urgentItems as item (item.id)}
				{@const isDirective = item.kategori === 'instruksi_manajemen'}
				{@const isCritical = item.tingkat_urgensi === 'kritis' || item.tingkat_urgensi === 'kritis_darurat' || item.is_gate_blocker}
				<div
					class="p-3 rounded-xl bg-black/30 border {isCritical ? 'border-rose-500/40 hover:border-rose-500' : 'border-white/5 hover:border-amber-500/40'} transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer"
					onclick={() => handleClick(item)}
					role="button"
					tabindex="0"
					onkeydown={(e) => {
						if (e.key === 'Enter') handleClick(item);
					}}
				>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-1 flex-wrap">
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full {item.project_id ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-500/40' : 'bg-amber-500/30 text-amber-200 border border-amber-500/40'}">
								{item.nama_proyek}
							</span>
							{#if isDirective}
								<span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-400 text-black">
									⚡ ARAHAN DIREKSI
								</span>
							{/if}
							{#if isCritical}
								<span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-rose-600 text-white animate-pulse">
									🚨 KRITIS
								</span>
							{/if}
							{#if item.status === 'open'}
								<span class="text-[10px] font-bold text-amber-300">
									● Belum Dikonfirmasi
								</span>
							{/if}
						</div>
						<h4 class="text-xs font-bold text-white line-clamp-1">
							{item.judul}
						</h4>
						<p class="text-[11px] text-slate-300 line-clamp-1 mt-0.5">
							{item.deskripsi}
						</p>
					</div>

					<div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
						<span class="text-[11px] text-amber-300 font-bold inline-flex items-center gap-1">
							{item.project_id ? 'Buka Proyek' : 'Lihat Arahan'} <IconArrowRight size={13} />
						</span>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- Modal Global Directive Pop-up jika arahan lintas proyek diklik -->
{#if selectedGlobalDirective}
	<div
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
	>
		<div class="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-3.5 text-white">
			<div class="flex items-center justify-between border-b border-white/10 pb-2.5">
				<span class="text-xs font-extrabold uppercase text-amber-400 tracking-wider flex items-center gap-1.5">
					<span>📢</span>
					<span>Komando Direksi Perseroan</span>
				</span>
				<button
					type="button"
					onclick={() => (selectedGlobalDirective = null)}
					class="p-1 text-slate-400 hover:text-white"
				>
					<IconX size={18} />
				</button>
			</div>

			<div>
				<h3 class="text-base font-bold text-white leading-snug">
					{selectedGlobalDirective.judul}
				</h3>
				<p class="text-[11px] text-slate-400 mt-1">
					Diterbitkan oleh: <strong>{selectedGlobalDirective.pembuat_nama || 'Direksi / Manajemen'}</strong>
				</p>
			</div>

			<div class="p-3 bg-white/5 rounded-xl text-xs text-slate-200 whitespace-pre-line leading-relaxed border border-white/5">
				{selectedGlobalDirective.deskripsi}
			</div>

			{#if selectedGlobalDirective.target_selesai}
				<div class="text-[11px] text-amber-300 flex items-center gap-1.5 font-medium">
					<IconClock size={14} />
					<span>Batas Waktu Pelaksanaan: <strong>{selectedGlobalDirective.target_selesai}</strong></span>
				</div>
			{/if}

			<div class="flex justify-end pt-2">
				<button
					type="button"
					onclick={() => (selectedGlobalDirective = null)}
					class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs shadow-md transition-all"
				>
					Tutup &amp; Siap Laksanakan
				</button>
			</div>
		</div>
	</div>
{/if}
