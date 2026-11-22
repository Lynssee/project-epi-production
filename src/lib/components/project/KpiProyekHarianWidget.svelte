<!-- src/lib/components/project/KpiProyekHarianWidget.svelte
     Kartu KPI harian Leader/PM di beranda lapangan: Health Score tiap proyek aktif yang dipimpin + banner peringatan bila ada indikator kritis.
     Komponen mandiri, non-blocking (pola PengecualianProyekWidget). Sumber: erp-epi /api/project/health-mine (dihitung dari data nyata, cache 2 menit).
     Tidak tampil bila akun tak memimpin proyek berjalan. Gagal muat = pesan kecil + "Coba lagi", bukan layar kosong. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchMyProjectHealth, needsAttention, PILLAR_LABELS, type MyHealthData } from '$lib/services/projectHealthMine';

	let loading = $state(true);
	let data = $state<MyHealthData | null>(null);
	let errorMsg = $state('');
	let expanded = $state(false);

	async function load(force = false) {
		loading = true;
		errorMsg = '';
		try {
			data = await fetchMyProjectHealth(force);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat.';
		} finally {
			loading = false;
		}
	}
	onMount(() => load());

	const projects = $derived(data?.projects ?? []);
	const alerts = $derived(projects.filter(needsAttention));
	const sehat = $derived(data?.config?.bandSehat ?? 85);
	const perhatian = $derived(data?.config?.bandPerhatian ?? 70);
	const color = (s: number | null) => (s == null ? 'var(--tx3, #888)' : s >= sehat ? 'var(--g, #16a34a)' : s >= perhatian ? 'var(--am, #d97706)' : 'var(--re, #dc2626)');
</script>

{#if loading}
	<div class="khw khw-muted">Menghitung KPI proyek…</div>
{:else if errorMsg}
	<div class="khw khw-muted">{errorMsg} <button class="khw-link" onclick={() => load(true)}>Coba lagi</button></div>
{:else if projects.length > 0}
	<section class="khw" aria-label="KPI proyek hari ini">
		{#if alerts.length}
			<div class="khw-alert" role="alert" data-testid="khw-alert">
				🚨 <strong>{alerts.length} proyek perlu perhatian:</strong>
				{alerts.map((p) => p.name).join(', ')}
			</div>
		{/if}
		<header class="khw-head">
			<strong>📊 KPI Proyek Saya</strong>
			<button class="khw-link" onclick={() => load(true)} title="Hitung ulang (server menyimpan hasil ±2 menit)">Segarkan</button>
		</header>
		<p class="khw-hint">Skor 0–100 dari data laporan harian, absensi, biaya, mutu & K3. Ketuk proyek untuk membukanya. “—” = datanya belum ada (bukan nol).</p>
		{#each projects as p (p.id)}
			<div class="khw-card" style="border-left-color: {color(p.health.score)}">
				<button class="khw-title" onclick={() => goto(`/proyek/${p.id}`)}>
					<span class="khw-name">{p.name}</span>
					<span class="khw-score" style="color: {color(p.health.score)}">{p.health.score ?? '—'}</span>
				</button>
				<div class="khw-pills">
					{#each Object.entries(PILLAR_LABELS) as [k, label] (k)}
						<span class="khw-pill" style="color: {color(p.pillars[k]?.score ?? null)}" title={p.pillars[k]?.error ? `Sumber gagal dibaca: ${p.pillars[k].error}` : `${p.pillars[k]?.terukur ?? 0}/${p.pillars[k]?.total ?? 0} indikator terukur`}>{label} {p.pillars[k]?.score ?? '—'}{p.pillars[k]?.error ? '⚠' : ''}</span>
					{/each}
				</div>
				{#if p.shadow}
					<div class="khw-shadow" title={p.shadow.catatan} data-testid="khw-shadow">
						{#if p.shadow.dataKurang}
							⚠️ <strong>Data Kurang</strong> — kelengkapan data {p.shadow.kepatuhan.pct}%, skor di atas kurang layak dipercaya.
						{:else if p.shadow.scoreBaru != null}
							Dengan kepatuhan data ({p.shadow.kepatuhan.pct}%): <strong>{p.shadow.scoreBaru}</strong>{#if p.shadow.delta != null && p.shadow.delta !== 0} ({p.shadow.delta > 0 ? '+' : ''}{p.shadow.delta}){/if}
						{/if}
						<span class="khw-shadow-tag">uji coba</span>
					</div>
				{/if}
				{#if p.kritis.length}
					<ul class="khw-kritis">{#each (expanded ? p.kritis : p.kritis.slice(0, 2)) as k (k.code)}<li>{k.label}</li>{/each}</ul>
				{/if}
			</div>
		{/each}
		{#if projects.some((p) => p.kritis.length > 2)}
			<button class="khw-link" onclick={() => (expanded = !expanded)}>{expanded ? 'Ringkas' : 'Lihat semua indikator kritis'}</button>
		{/if}
		<p class="khw-hint">Posisi per {data?.asOf ?? '—'}.</p>
	</section>
{/if}

<style>
	.khw { margin: 0.75rem 0; padding: 0.75rem; border-radius: 12px; background: var(--card, #fff); border: 1px solid var(--bd, #e5e7eb); }
	.khw-muted { font-size: 0.8rem; color: var(--tx3, #888); border: none; background: transparent; padding: 0.25rem 0; }
	.khw-alert { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 8px; padding: 0.5rem 0.6rem; font-size: 0.8rem; margin-bottom: 0.5rem; }
	.khw-head { display: flex; justify-content: space-between; align-items: center; }
	.khw-hint { font-size: 0.75rem; color: var(--tx3, #888); margin: 0.25rem 0 0.5rem; }
	.khw-card { border-left: 4px solid; padding: 0.4rem 0.6rem; margin-bottom: 0.4rem; background: var(--bg2, #f9fafb); border-radius: 6px; }
	.khw-title { display: flex; justify-content: space-between; align-items: center; width: 100%; background: none; border: none; text-align: left; padding: 0.15rem 0; cursor: pointer; font-weight: 600; }
	.khw-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.khw-score { font-size: 1.25rem; font-weight: 800; margin-left: 0.5rem; }
	.khw-pills { display: flex; flex-wrap: wrap; gap: 0.25rem 0.6rem; font-size: 0.72rem; font-weight: 600; }
	.khw-shadow { margin-top: 0.3rem; font-size: 0.72rem; color: var(--tx3, #666); }
	.khw-shadow-tag { margin-left: 0.3rem; padding: 0 0.3rem; border: 1px dashed var(--bd, #bbb); border-radius: 4px; font-size: 0.65rem; }
	.khw-kritis { margin: 0.3rem 0 0; padding-left: 1.1rem; font-size: 0.75rem; color: var(--re, #dc2626); }
	.khw-link { background: none; border: none; color: var(--g, #2563eb); cursor: pointer; padding: 0; text-decoration: underline; font-size: inherit; }
</style>
