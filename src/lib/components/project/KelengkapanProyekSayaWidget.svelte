<!-- src/lib/components/project/KelengkapanProyekSayaWidget.svelte
     Kartu "Yang harus saya lengkapi hari ini" Leader di beranda lapangan: maks 5 butir (kekurangan data & tinjauan status) dari proyek yang dipimpin.
     Komponen mandiri, non-blocking (pola KpiProyekHarianWidget). Sumber: erp-epi /api/project/completeness?scope=mine (cache 5 menit).
     Tidak tampil bila akun tak memimpin proyek. Gagal muat = pesan kecil + "Coba lagi", bukan layar kosong / bukan "semua lengkap". -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchMyCompleteness, fetchLeaderRanking, buildTodoItems, type MyCompletenessData, type LeaderRankingData } from '$lib/services/projectCompletenessMine';

	let loading = $state(true);
	let data = $state<MyCompletenessData | null>(null);
	let errorMsg = $state('');
	let showAll = $state(false);

	async function load(force = false) {
		loading = true;
		errorMsg = '';
		try {
			data = await fetchMyCompleteness(force);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat.';
		} finally {
			loading = false;
		}
	}
	let rank = $state<LeaderRankingData | null>(null);
	let rankOpen = $state(false);
	// Peringkat sekunder & non-blocking: gagal = disembunyikan (tidak mengganggu daftar tindakan).
	async function loadRank(force = false) {
		try { rank = await fetchLeaderRanking(force); } catch { rank = null; }
	}
	onMount(() => { load(); loadRank(); });

	const todo = $derived(buildTodoItems(data?.rows, showAll ? 50 : 5));
	const hasProjects = $derived((data?.rows?.length ?? 0) > 0);
	const sla = (h: number | null) => (h == null ? '' : h >= 48 && h % 24 === 0 ? `${h / 24} hari` : `${h} jam`);
	const dot = (s: string) => (s === 'kritis' || s === 'tinggi' ? '#dc2626' : s === 'sedang' ? '#d97706' : '#94a3b8');
</script>

{#if loading}
	<div class="kps kps-muted">Memeriksa kelengkapan proyek…</div>
{:else if errorMsg}
	<div class="kps kps-muted">{errorMsg} <button class="kps-link" onclick={() => load(true)}>Coba lagi</button></div>
{:else if hasProjects}
	<section class="kps" aria-label="Yang harus saya lengkapi hari ini">
		<header class="kps-head">
			<strong>🧩 Yang harus saya lengkapi hari ini</strong>
			<button class="kps-link" onclick={() => load(true)} title="Periksa ulang (server menyimpan hasil ±5 menit)">Segarkan</button>
		</header>
		<p class="kps-hint">Data & laporan wajib proyek Anda yang belum lengkap. Ketuk butir untuk membuka proyeknya. Hilang otomatis setelah data diisi.</p>
		{#if todo.total === 0}
			<div class="kps-ok">✅ Semua data wajib proyek Anda sudah lengkap.</div>
		{:else}
			<ul class="kps-list">
				{#each todo.shown as it, i (it.projectId + ':' + it.label + ':' + i)}
					<li>
						<button class="kps-item" onclick={() => goto(`/proyek/${it.projectId}`)}>
							<span class="kps-dot" style="background: {dot(it.severity)}"></span>
							<span class="kps-body">
								<span class="kps-label">{#if it.kind === 'anomali'}⚠️ {/if}{it.label}</span>
								<span class="kps-meta">{it.projectName} · {it.action}{it.slaHours ? ` · tenggat ${sla(it.slaHours)}` : ''}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if todo.total > 5}
				<button class="kps-link" onclick={() => (showAll = !showAll)}>{showAll ? 'Ringkas' : `Lihat semua (${todo.total})`}</button>
			{/if}
		{/if}
		{#if todo.waitingReview > 0}
			<p class="kps-hint">ℹ️ {todo.waitingReview} proyek berstatus “waiting” sudah lewat tanggal mulai — mohon ubah statusnya (atau tanggal mulainya) bila sudah berjalan/batal.</p>
		{/if}
		{#if rank?.me}
			<div class="kps-rank">
				<button class="kps-link" onclick={() => (rankOpen = !rankOpen)} aria-expanded={rankOpen}>
					🏅 Peringkat kelengkapan Anda: #{rank.me.rank} dari {rank.total} leader ({rank.me.avgPct}%)
				</button>
				{#if rankOpen}
					<ol class="kps-rank-list">
						{#each rank.ranking as e (e.rank + e.name)}
							<li class:me={e.isMe}><span>#{e.rank} {e.name}{e.isMe ? ' (Anda)' : ''}</span><span>{e.avgPct}% · {e.projects} proyek</span></li>
						{/each}
					</ol>
					<p class="kps-hint">Rata-rata kelengkapan proyek berjalan (tanpa “waiting”). Ini ukuran kelengkapan data, bukan nilai kinerja.{rank.partial ? ' Sebagian sumber data gagal dibaca.' : ''}</p>
				{/if}
			</div>
		{/if}
		{#if data?.warnings?.length}
			<p class="kps-hint">⚠️ Sebagian sumber data gagal dibaca; hasil bisa kurang lengkap.</p>
		{/if}
	</section>
{/if}

<style>
	.kps { margin: 0.75rem 0; padding: 0.75rem; border-radius: 12px; background: var(--card, #fff); border: 1px solid var(--bd, #e5e7eb); }
	.kps-muted { font-size: 0.8rem; color: var(--tx3, #888); border: none; background: transparent; padding: 0.25rem 0; }
	.kps-head { display: flex; justify-content: space-between; align-items: center; }
	.kps-hint { font-size: 0.75rem; color: var(--tx3, #888); margin: 0.25rem 0 0.5rem; }
	.kps-ok { font-size: 0.85rem; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.5rem 0.6rem; }
	.kps-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
	.kps-item { display: flex; gap: 0.5rem; align-items: flex-start; width: 100%; text-align: left; background: var(--bg2, #f9fafb); border: none; border-radius: 6px; padding: 0.45rem 0.6rem; cursor: pointer; }
	.kps-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 0.3rem; flex: none; }
	.kps-body { display: flex; flex-direction: column; min-width: 0; }
	.kps-label { font-size: 0.85rem; font-weight: 600; }
	.kps-meta { font-size: 0.72rem; color: var(--tx3, #888); }
	.kps-rank { margin-top: 0.4rem; }
	.kps-rank-list { list-style: none; margin: 0.3rem 0; padding: 0; font-size: 0.78rem; }
	.kps-rank-list li { display: flex; justify-content: space-between; padding: 0.15rem 0.4rem; border-radius: 4px; }
	.kps-rank-list li.me { background: var(--bg2, #f0f9ff); font-weight: 700; }
	.kps-link { background: none; border: none; color: var(--g, #2563eb); cursor: pointer; padding: 0; text-decoration: underline; font-size: 0.75rem; }
</style>
