<!-- src/routes/(app)/pusat-pengajuan/atur-tampilan/+page.svelte -->
<!-- R10 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): Field Dashboard Config Panel — -->
<!-- supervisor lapangan atur visibilitas & urutan kartu Pusat Pengajuan, tanpa akses admin ERP. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';

	const toast = {
		success: (m: string) => typeof window !== 'undefined' && (window as any).__showToast?.(m, 'success'),
		error: (m: string) => typeof window !== 'undefined' && (window as any).__showToast?.(m, 'error')
	};
	import { IconArrowLeft, IconChevronUp, IconChevronDown, IconLoader2 } from '@tabler/icons-svelte';
	import { fetchFieldKatalog, setKatalogAktif, saveKatalogUrutan, type KatalogRow } from '$lib/services/pengajuanKatalogApi';

	const KATEGORI_LABEL: Record<string, string> = {
		proyek: 'Proyek',
		hrd: 'HRD & Absensi',
		keuangan: 'Keuangan',
		operasional: 'Operasional',
		lainnya: 'Lainnya'
	};
	const KATEGORI_ORDER = ['proyek', 'hrd', 'keuangan', 'operasional', 'lainnya'];

	let allowed = $state(false);
	let checked = $state(false);
	$effect(() => {
		if (!$authStore.checked) return;
		allowed = hasPermission($authStore.roleId, 'admin_panel', $rolesStore, $authStore.roleIds);
		checked = true;
		if (checked && !allowed) goto('/pusat-pengajuan');
	});

	let loading = $state(true);
	let error = $state('');
	let rows = $state<KatalogRow[]>([]);
	let savingId = $state<number | null>(null);

	async function load() {
		loading = true;
		error = '';
		try {
			rows = await fetchFieldKatalog();
		} catch (e: any) {
			error = e?.message || 'Gagal memuat katalog pengajuan.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	let grouped = $derived.by(() => {
		const map: Record<string, KatalogRow[]> = {};
		for (const r of rows) {
			const k = r.kategori || 'lainnya';
			(map[k] ||= []).push(r);
		}
		for (const k in map) map[k].sort((a, b) => a.urutan - b.urutan);
		return KATEGORI_ORDER.filter((k) => map[k]?.length).map((k) => ({ key: k, label: KATEGORI_LABEL[k] || k, items: map[k] }));
	});

	async function toggleAktif(row: KatalogRow) {
		const next = !row.aktif;
		savingId = row.id;
		try {
			await setKatalogAktif(row.id, next);
			row.aktif = next;
			rows = [...rows];
			toast.success(`${row.label} ${next ? 'ditampilkan' : 'disembunyikan'}.`);
		} catch (e: any) {
			toast.error(e?.message || 'Gagal menyimpan.');
		} finally {
			savingId = null;
		}
	}

	async function move(kategori: string, index: number, dir: 1 | -1) {
		const items = grouped.find((g) => g.key === kategori)?.items;
		if (!items) return;
		const target = index + dir;
		if (target < 0 || target >= items.length) return;
		const a = items[index];
		const b = items[target];
		const swappedUrutan = [{ id: a.id, urutan: b.urutan }, { id: b.id, urutan: a.urutan }];
		savingId = a.id;
		try {
			await saveKatalogUrutan(swappedUrutan);
			a.urutan = swappedUrutan[0].urutan;
			b.urutan = swappedUrutan[1].urutan;
			rows = [...rows];
		} catch (e: any) {
			toast.error(e?.message || 'Gagal menyimpan urutan.');
		} finally {
			savingId = null;
		}
	}
</script>

<svelte:head><title>Atur Tampilan Pusat Pengajuan</title></svelte:head>

{#if checked && allowed}
	<div class="w-full max-w-2xl mx-auto p-4 md:p-6 pb-28">
		<div class="flex items-center gap-3 mb-2">
			<button onclick={() => goto('/pusat-pengajuan')} class="p-2 -ml-2 rounded-full hover:bg-black/5">
				<IconArrowLeft size={20} />
			</button>
			<h1 class="text-xl font-extrabold tracking-tight" style="color: var(--sys-label)">Atur Tampilan</h1>
		</div>
		<p class="text-xs mb-5" style="color: var(--sys-label3)">
			Sembunyikan atau urutkan ulang kartu yang tampil di Pusat Pengajuan tim lapangan Anda —
			tanpa perlu akses admin ERP. Kartu yang disembunyikan tetap ada datanya, hanya tidak
			ditampilkan sebagai pintasan. Label, ikon, dan tautan form TIDAK bisa diubah di sini
			(itu wiring teknis, tetap dikelola admin).
		</p>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat setelan tampilan pengajuan..." />
		</div>
		{:else if error}
			<p class="text-sm text-red-600">{error}</p>
		{:else}
			<div class="space-y-5">
				{#each grouped as group (group.key)}
					<div>
						<p class="text-xs font-bold uppercase tracking-wide mb-2" style="color: var(--sys-label4)">{group.label}</p>
						<div class="space-y-2">
							{#each group.items as row, idx (row.id)}
								<div
									class="flex items-center gap-2 p-3 rounded-xl border"
									class:opacity-50={!row.aktif}
									style="border-color: var(--sys-sep); background: var(--sys-bg2)"
								>
									<div class="flex flex-col shrink-0">
										<button
											class="p-0.5 disabled:opacity-20"
											disabled={idx === 0 || savingId !== null}
											onclick={() => move(group.key, idx, -1)}
										><IconChevronUp size={14} /></button>
										<button
											class="p-0.5 disabled:opacity-20"
											disabled={idx === group.items.length - 1 || savingId !== null}
											onclick={() => move(group.key, idx, 1)}
										><IconChevronDown size={14} /></button>
									</div>
									<span class="text-xl shrink-0">{row.ikon || '📄'}</span>
									<div class="flex-1 min-w-0">
										<p class="text-sm font-semibold truncate" style="color: var(--sys-label)">{row.label}</p>
										{#if row.deskripsi_singkat}
											<p class="text-[11px] truncate" style="color: var(--sys-label4)">{row.deskripsi_singkat}</p>
										{/if}
									</div>
									<button
										role="switch"
										aria-checked={row.aktif}
										disabled={savingId === row.id}
										onclick={() => toggleAktif(row)}
										class="relative shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-50"
										style={row.aktif ? 'background: var(--blue, #3b82f6)' : 'background: var(--sys-fill)'}
									>
										<span
											class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
											style={row.aktif ? 'transform: translateX(16px)' : ''}
										></span>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
