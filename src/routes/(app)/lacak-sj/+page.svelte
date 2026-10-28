<script lang="ts">
	// src/routes/(app)/lacak-sj/+page.svelte
	// Lacak Surat Jalan — daftar SJ yang berkaitan dengan saya (proyek saya / saya driver).
	// Tracking SJ v2 Fase 4.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { IconLoader2, IconChevronRight, IconTruck, IconAlertTriangle } from '@tabler/icons-svelte';

	let loading = $state(true);
	let err = $state('');
	let items = $state<any[]>([]);
	let stageFilter = $state(page.url.searchParams.get('stage') || '');
	// SJ-06: jumlah SJ yang perlu dicek muat (chip "Perlu Verifikasi") + apakah akun berhak memverifikasi
	let perluCount = $state(0);
	let bisaVerifikasi = $state(false);
	// SJH-17 §4.3: akun berhak memakai fitur driver tapi belum tertaut ke master driver Fleet -> SJ yang
	// dibawa tidak akan muncul. Banner hanya untuk akun berizin 'access_driver' (Project Leader biasa tak
	// perlu ditakut-takuti). API mengirim driver_linked.
	let driverLinked = $state(true);
	const perluTautDriver = $derived(
		!driverLinked && !!$authStore.roleId && hasPermission($authStore.roleId, 'access_driver', $rolesStore)
	);

	const STAGES = [
		['', 'Semua'], ['perlu_verifikasi', 'Perlu Verifikasi'], ['disiapkan', 'Disiapkan'], ['dimuat', 'Dimuat'],
		['menunggu_gerbang', 'Menunggu Gerbang'], ['lolos_gerbang', 'Lolos Gerbang'],
		['dalam_perjalanan', 'Dalam Perjalanan'], ['tiba_lokasi', 'Tiba Lokasi'],
		['diterima', 'Diterima'], ['selisih', 'Selisih']
	];

	async function load() {
		loading = true; err = '';
		try {
			const url = stageFilter ? `/api/lacak-sj?stage=${stageFilter}` : '/api/lacak-sj';
			const res = await fetch(url);
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal memuat.');
			items = d.items || [];
			driverLinked = d.driver_linked !== false;
			perluCount = Number(d.perlu_verifikasi_count) || 0;
			bisaVerifikasi = !!d.bisa_verifikasi;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function ageText(m: number | null) {
		if (m == null) return '';
		if (m >= 1440) return Math.floor(m / 1440) + ' hari';
		if (m >= 60) return Math.floor(m / 60) + ' jam';
		return m + ' mnt';
	}
</script>

<div class="wrap">
	<h1><IconTruck size={22} /> Lacak Surat Jalan</h1>
	<p class="hint">Yang tampil: SJ proyek Anda dan SJ yang Anda drivernya. <b>"Perlu cek muat"</b> = barang belum Anda cocokkan dengan SJ sebelum SJ dicetak — buka SJ-nya lalu tekan <b>Cek Barang Sebelum Kirim</b>.</p>

	<div class="chips">
		{#each STAGES as [val, lbl]}
			{#if val !== 'perlu_verifikasi' || bisaVerifikasi || stageFilter === 'perlu_verifikasi'}
				<button class="chip" class:on={stageFilter === val} onclick={() => { stageFilter = val; load(); }}>{lbl}{#if val === 'perlu_verifikasi' && perluCount > 0} ({perluCount}){/if}</button>
			{/if}
		{/each}
	</div>

	{#if perluTautDriver}
		<div class="banner warn" role="alert">
			<IconAlertTriangle size={18} />
			<span>Akun Anda belum tertaut ke data driver Fleet, jadi SJ yang Anda bawa tidak akan muncul di sini. Hubungi admin Fleet untuk menautkan akun Anda.</span>
		</div>
	{/if}

	{#if loading}
		<div class="center"><IconLoader2 size={28} class="spin" /></div>
	{:else if err}
		<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>
	{:else if items.length === 0}
		<p class="muted">Tidak ada Surat Jalan.</p>
	{:else}
		<ul>
			{#each items as sj}
				<li>
					<button class="row" onclick={() => goto(`/lacak-sj/${sj.id}`)}>
						<div class="main">
							<div class="no">{sj.nomor_sj} {#if sj.is_driver}<span class="tag">driver</span>{/if}
								{#if sj.perlu_verifikasi}<span class="tag warn">Perlu cek muat</span>{:else if sj.terverifikasi}<span class="tag ok">✓ Dicek</span>{/if}</div>
							<div class="sub">{sj.tujuan || 'Tujuan —'}</div>
						</div>
						<div class="right">
							<span class="stage">{sj.stage_label}</span>
							{#if sj.age_min != null}<span class="age">{ageText(sj.age_min)}</span>{/if}
						</div>
						<IconChevronRight size={18} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.wrap { max-width: 640px; margin: 0 auto; padding: 1rem; }
	h1 { display: flex; align-items: center; gap: 0.5rem; font-size: 1.4rem; margin: 0 0 0.25rem; }
	.hint { font-size: 0.85rem; color: #64748b; margin: 0 0 0.75rem; }
	.chips { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 0.5rem; }
	.chip { flex: 0 0 auto; padding: 0.35rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font-size: 0.8rem; color: #475569; }
	.chip.on { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
	.center { display: flex; justify-content: center; padding: 2rem; }
	.banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; font-size: 0.85rem; }
	.banner.warn { background: #fffbeb; color: #b45309; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.muted { color: #94a3b8; }
	ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.row { width: 100%; display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 0.9rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; background: #fff; text-align: left; }
	.main { flex: 1; min-width: 0; }
	.no { font-weight: 600; font-size: 0.95rem; }
	.tag { font-size: 0.65rem; background: #dbeafe; color: #1d4ed8; padding: 0 0.35rem; border-radius: 4px; vertical-align: middle; }
	.tag.warn { background: #ffedd5; color: #c2410c; }
	.tag.ok { background: #dcfce7; color: #15803d; }
	.sub { color: #64748b; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.right { display: flex; flex-direction: column; align-items: flex-end; }
	.stage { font-size: 0.8rem; font-weight: 600; color: #334155; }
	.age { font-size: 0.72rem; color: #94a3b8; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
