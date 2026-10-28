<script lang="ts">
	// src/routes/kiosk/papan-sj/+page.svelte
	// Papan Pantau Surat Jalan — layar TV gudang. Read-only, auto-refresh 60 dtk.
	// Sesi kiosk badge+PIN (Q4). Tracking SJ v2 Fase 3b.
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { IconArrowLeft, IconRefresh } from '@tabler/icons-svelte';

	let columns = $state<any[]>([]);
	let updatedAt = $state<string>('');
	let err = $state('');
	let timer: ReturnType<typeof setInterval> | null = null;

	async function load() {
		try {
			const res = await fetch('/api/kiosk/papan-sj');
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal memuat papan.');
			columns = d.columns || [];
			updatedAt = new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
			err = '';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		}
	}

	onMount(() => {
		load();
		timer = setInterval(load, 60_000);
	});
	onDestroy(() => timer && clearInterval(timer));
</script>

<div class="board">
	<header>
		<button class="back" onclick={() => goto('/kiosk/home')}><IconArrowLeft size={16} /> Kembali</button>
		<h1>Papan Pantau Surat Jalan</h1>
		<span class="upd"><IconRefresh size={14} /> {updatedAt || '—'}</span>
	</header>

	{#if err}<div class="err">{err}</div>{/if}

	<div class="cols">
		{#each columns as col}
			<div class="col">
				<div class="colhead">{col.label} <span class="cnt">{col.count}</span></div>
				<div class="cards">
					{#each col.cards as c}
						<div class="card {c.tone}">
							<div class="cno">{c.nomor_sj}</div>
							<div class="cmeta">{c.driver || '—'}</div>
							<div class="cage">{c.age_min == null ? '—' : c.age_min >= 60 ? Math.floor(c.age_min / 60) + ' jam' : c.age_min + ' mnt'}</div>
						</div>
					{/each}
					{#if col.cards.length === 0}<div class="empty">—</div>{/if}
				</div>
			</div>
		{/each}
	</div>

	<footer>
		<span class="lg green">Hijau: dalam waktu</span>
		<span class="lg yellow">Kuning: mendekati batas</span>
		<span class="lg red">Merah: lewat batas</span>
	</footer>
</div>

<style>
	.board { min-height: 100vh; background: #0f172a; color: #e2e8f0; padding: 1rem 1.25rem; display: flex; flex-direction: column; }
	header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
	header h1 { font-size: 1.6rem; margin: 0; flex: 1; }
	.back { display: inline-flex; align-items: center; gap: 0.3rem; background: none; border: none; color: #94a3b8; font-size: 0.85rem; }
	.upd { display: inline-flex; align-items: center; gap: 0.3rem; color: #94a3b8; font-size: 0.85rem; }
	.err { background: #7f1d1d; color: #fecaca; padding: 0.5rem 0.75rem; border-radius: 0.5rem; margin-bottom: 0.75rem; }
	.cols { flex: 1; display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.75rem; }
	.col { background: #1e293b; border-radius: 0.75rem; padding: 0.6rem; display: flex; flex-direction: column; min-width: 0; }
	.colhead { font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.5rem; color: #cbd5e1; }
	.colhead .cnt { float: right; background: #334155; border-radius: 999px; padding: 0 0.5rem; font-size: 0.8rem; }
	.cards { display: flex; flex-direction: column; gap: 0.4rem; overflow-y: auto; }
	.card { background: #0f172a; border-left: 4px solid #22c55e; border-radius: 0.4rem; padding: 0.45rem 0.55rem; }
	.card.yellow { border-left-color: #eab308; }
	.card.red { border-left-color: #ef4444; }
	.cno { font-weight: 700; font-size: 0.95rem; }
	.cmeta { color: #94a3b8; font-size: 0.78rem; }
	.cage { color: #cbd5e1; font-size: 0.78rem; }
	.empty { color: #475569; text-align: center; padding: 0.5rem; }
	footer { display: flex; gap: 1.25rem; margin-top: 0.75rem; font-size: 0.8rem; color: #94a3b8; }
	.lg::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 0.35rem; vertical-align: middle; }
	.lg.green::before { background: #22c55e; }
	.lg.yellow::before { background: #eab308; }
	.lg.red::before { background: #ef4444; }
</style>
