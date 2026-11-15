<script lang="ts">
	// Kartu identitas pemegang/peminjam unit (hasil scan barcode equipment). Dipakai sheet scan (Fase 2) dan
	// halaman P2H (Fase 3). Tanpa foto => avatar inisial. Semua teks lewat fallback agar tidak crash pada data kosong.
	import type { PersonCard } from '$lib/services/equipmentVerify';

	let {
		person,
		title,
		lines = [],
		tone = 'neutral'
	}: { person: PersonCard | null; title: string; lines?: (string | null | undefined)[]; tone?: 'neutral' | 'ok' | 'warn' } = $props();

	const initials = $derived(
		(person?.nama || '?')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
	const border = $derived(tone === 'ok' ? '#86EFAC' : tone === 'warn' ? '#FCA5A5' : 'var(--sys-sep)');
	const visibleLines = $derived((lines || []).filter((l): l is string => !!l));
</script>

<div class="flex items-center gap-3 rounded-2xl p-3 text-left" style="background: var(--sys-fill, #f1f5f9); border: 1px solid {border}">
	<div class="w-14 h-14 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style="background: var(--gl)">
		{#if person?.fotoDataUrl}
			<img src={person.fotoDataUrl} alt={person.nama} class="w-full h-full object-cover" />
		{:else}
			<span class="text-[16px] font-bold" style="color: var(--g)">{initials}</span>
		{/if}
	</div>
	<div class="min-w-0">
		<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label3)">{title}</p>
		<p class="text-[14px] font-bold truncate" style="color: var(--sys-label)">{person?.nama || 'Belum tercatat'}</p>
		{#if person && (person.divisi || person.posisi)}
			<p class="text-[11px] truncate" style="color: var(--sys-label3)">{[person.divisi, person.posisi].filter(Boolean).join(' · ')}</p>
		{/if}
		{#each visibleLines as l}
			<p class="text-[11px] truncate" style="color: var(--sys-label3)">{l}</p>
		{/each}
	</div>
</div>
