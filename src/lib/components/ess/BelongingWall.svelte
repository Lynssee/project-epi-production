<script lang="ts">
	// "Wall of Belonging" di beranda ESS lapangan (Fase 3): milestone rekan di sekitar hari ini + ucapan 1 ketuk.
	// Fail-soft: tak ada milestone / error → tidak tampil.
	import { onMount } from 'svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { getBelongingWall, kirimUcapanBelonging, type WallEventItem, type SpotlightWallItem } from '$lib/services/ess/budaya';

	const EMOJI = ['💪', '🎉', '👏', '❤️'];
	const TIPE_ICON: Record<string, string> = { birthday: '🎂', anniversary: '🏅', probation_end: '✅', wedding_anniv: '💍', newborn: '👶', promotion: '🚀', achievement: '🏆' };

	let loading = $state(true);
	let events = $state<WallEventItem[]>([]);
	let spotlight = $state<SpotlightWallItem[]>([]);
	let busyId = $state<number | null>(null);
	let error = $state('');
	let terbuka = $state(true);

	onMount(async () => {
		try {
			const w = await getBelongingWall();
			events = w.events;
			spotlight = w.spotlight ?? [];
		} catch (e: any) {
			console.warn('[BelongingWall] gagal memuat:', e?.message);
		} finally {
			loading = false;
		}
	});

	function tgl(d: string | null) {
		if (!d) return '';
		const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
		return isNaN(x.getTime()) ? '' : x.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
	}

	async function kirim(ev: WallEventItem, emoji: string) {
		if (busyId != null || ev.emoji_saya || ev.milik_saya) return;
		busyId = ev.id;
		error = '';
		try {
			const r = await kirimUcapanBelonging(ev.id, emoji);
			events = events.map((e) => (e.id === ev.id ? { ...e, emoji_saya: r.emoji || emoji, jumlah_ucapan: e.jumlah_ucapan + (r.sudah ? 0 : 1) } : e));
		} catch (e: any) {
			error = e?.message || 'Gagal mengirim ucapan.';
		} finally {
			busyId = null;
		}
	}
</script>

{#if !loading && (events.length || spotlight.length)}
	<section class="rounded-3xl p-4 sm:p-5 border" style="background: rgba(244,63,94,0.08); border-color: rgba(244,63,94,0.30)" aria-label="Wall of Belonging">
		<button type="button" class="w-full flex items-center justify-between text-left" onclick={() => (terbuka = !terbuka)}>
			<span class="text-[11px] font-bold uppercase tracking-wider" style="color: #be123c">🎉 Wall of Belonging — momen rekan kita</span>
			<span class="text-xs" style="color: #be123c">{terbuka ? '▲' : '▼'}</span>
		</button>
		{#if terbuka}
			{#each spotlight as sp (sp.id)}
				<article class="mt-3 rounded-2xl p-3 border" style="background: var(--sys-bg2); border-color: rgba(245,158,11,0.45)">
					<p class="text-[11px] font-bold uppercase tracking-wider" style="color: #b45309">🏆 Kebanggaan Proyek</p>
					<p class="text-sm font-bold mt-0.5" style="color: var(--sys-label)">{sp.judul}</p>
					{#if sp.foto_id}
						<img class="mt-2 max-h-48 w-full rounded-xl object-cover" alt={sp.judul} use:secureAssetSrc={`/assets/${sp.foto_id}?width=640`} />
					{/if}
					<p class="text-xs mt-1 whitespace-pre-wrap" style="color: var(--sys-label2)">{sp.ringkasan}</p>
					{#if sp.pemimpin_nama || sp.kru_nama.length}
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">{sp.pemimpin_nama ? `PL: ${sp.pemimpin_nama}` : ''}{sp.pemimpin_nama && sp.kru_nama.length ? ' · ' : ''}{sp.kru_nama.length ? `Kru: ${sp.kru_nama.join(', ')}` : ''}</p>
					{/if}
				</article>
			{/each}
			<ul class="mt-3 space-y-2">
				{#each events as ev (ev.id)}
					<li class="rounded-2xl p-3 border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<p class="text-sm font-bold" style="color: var(--sys-label)">{TIPE_ICON[ev.tipe] || '🎉'} {ev.judul}</p>
						<p class="text-[11px]" style="color: var(--sys-label3)">{tgl(ev.tanggal_event)}{ev.tahun_ke ? ` · ke-${ev.tahun_ke}` : ''} · {ev.jumlah_ucapan} ucapan</p>
						{#if ev.milik_saya}
							<p class="text-xs mt-1" style="color: #be123c">Ini momen Anda — rekan-rekan sedang mengucapkan selamat 🙌</p>
						{:else if ev.emoji_saya}
							<p class="text-xs mt-1 text-emerald-600">Ucapan Anda terkirim {ev.emoji_saya}</p>
						{:else}
							<div class="mt-2 flex gap-2">
								{#each EMOJI as e}
									<button type="button" class="w-11 h-10 rounded-xl border text-xl disabled:opacity-50" style="background: var(--sys-bg); border-color: var(--sys-sep)" disabled={busyId === ev.id} aria-label={`Kirim ${e}`} onclick={() => kirim(ev, e)}>{e}</button>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#if error}<p class="text-xs mt-2 text-red-600">{error}</p>{/if}
		{/if}
	</section>
{/if}
