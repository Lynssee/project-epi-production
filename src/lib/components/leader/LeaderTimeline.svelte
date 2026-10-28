<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { getMyTimeline, type TimelineProject } from '$lib/services/plDelegation';

	let { karyawanId, karyawanName }: { karyawanId: number | null; karyawanName: string | null } = $props();

	// Jendela tampilan: 2 minggu ke belakang + 10 minggu ke depan. Fase awal/akhir 7 hari sama dengan
	// bobot kickoff/finishing di mesin rekomendasi delegasi (erp-epi: project.delegasi.timeline).
	const BACK_DAYS = 14;
	const SPAN_DAYS = 84;
	const PHASE_DAYS = 7;
	const DAY = 86400000;

	let items = $state<TimelineProject[]>([]);
	let loading = $state(true);
	let open = $state(true);

	const todayMs = (() => {
		const d = new Date();
		return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
	})();
	const winStart = todayMs - BACK_DAYS * DAY;
	const winEnd = winStart + SPAN_DAYS * DAY;

	function toMs(v: string | null): number | null {
		if (!v) return null;
		const t = Date.parse(v.slice(0, 10));
		return Number.isNaN(t) ? null : t;
	}

	function pct(ms: number): number {
		return Math.max(0, Math.min(100, ((ms - winStart) / (winEnd - winStart)) * 100));
	}

	function bar(p: TimelineProject) {
		const s = toMs(p.start_date);
		const e = toMs(p.end_date);
		if (s == null && e == null) return null;
		const from = s ?? e! - 14 * DAY;
		const to = e ?? s! + 14 * DAY;
		if (to < winStart || from > winEnd) return { outside: true as const, from, to };
		const left = pct(from);
		const width = Math.max(1.5, pct(to) - left);
		return { outside: false as const, left, width, from, to };
	}

	const weeks = Array.from({ length: SPAN_DAYS / 7 + 1 }, (_, i) => winStart + i * 7 * DAY);
	const todayPct = pct(todayMs);

	function fmt(ms: number) {
		return new Date(ms).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' });
	}

	let totalPekerja = $derived(items.reduce((n, p) => n + (p.manpowerAktif || 0), 0));

	// Minggu kickoff lebih dari satu proyek dalam jendela sama = tabrakan mobilisasi
	let collisions = $derived.by(() => {
		const starts = items.map((p) => toMs(p.start_date)).filter((v): v is number => v != null && v >= todayMs - PHASE_DAYS * DAY);
		let n = 0;
		for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) if (Math.abs(starts[i] - starts[j]) <= PHASE_DAYS * DAY) n++;
		return n;
	});

	onMount(async () => {
		items = await getMyTimeline(karyawanId, karyawanName);
		loading = false;
	});
</script>

{#if loading || items.length > 0}
	<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--sys-sep)">
		<button class="w-full flex items-center justify-between" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="text-[13px] font-bold" style="color: var(--sys-label)">Jadwal Saya{items.length ? ` (${items.length} proyek, ${totalPekerja} pekerja)` : ''}</span>
			<span class="text-[11px]" style="color: var(--sys-label3)">{open ? 'Sembunyikan' : 'Tampilkan'}</span>
		</button>
		{#if open}
			<p class="text-[11px] mt-1 mb-2.5" style="color: var(--sys-label3)">
				Garis merah = hari ini. Bagian gelap di awal = minggu kickoff/mobilisasi (paling sibuk), di akhir = finishing.
			</p>
			{#if loading}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat jadwal kickoff proyek..." />
			{:else}
				{#if collisions > 0}
					<p class="text-[11px] mb-2 font-semibold" style="color: #DC2626">
						&#9888; {collisions} pasang proyek kickoff berdekatan. Siapkan mobilisasi lebih awal atau minta pendamping.
					</p>
				{/if}
				<div class="overflow-x-auto">
					<div class="min-w-[560px]">
						<div class="relative h-4 mb-1">
							{#each weeks as w, i (w)}
								{#if i % 2 === 0}
									<span class="absolute text-[9px]" style="left: {pct(w)}%; color: var(--sys-label4)">{fmt(w)}</span>
								{/if}
							{/each}
						</div>
						<div class="flex flex-col gap-1.5">
							{#each items as p (p.id)}
								{@const b = bar(p)}
								<div>
									<p class="text-[11px] truncate" style="color: var(--sys-label2)">
										{p.name}{p.lokasi_kota ? ` · ${p.lokasi_kota}` : ''}{p.manpowerAktif > 0 ? ` · ${p.manpowerAktif} pekerja` : ''}
									</p>
									<div class="relative h-3.5 rounded" style="background: var(--pl)">
										<div class="absolute top-0 bottom-0 w-px z-10" style="left: {todayPct}%; background: #DC2626"></div>
										{#if !b}
											<span class="absolute inset-0 flex items-center px-1.5 text-[9px]" style="color: var(--sys-label4)">tanggal belum diisi</span>
										{:else if b.outside}
											<span class="absolute inset-0 flex items-center px-1.5 text-[9px]" style="color: var(--sys-label4)">
												{fmt(b.from)} &ndash; {fmt(b.to)} (di luar jendela)
											</span>
										{:else}
											<Tooltip text={`${fmt(b.from)} - ${fmt(b.to)}`} position="top" class="absolute top-0 bottom-0" style="left: {b.left}%; width: {b.width}%">
											<div class="absolute inset-0 rounded overflow-hidden" style="background: var(--g)">
												<div class="absolute left-0 top-0 bottom-0" style="width: {Math.min(100, ((PHASE_DAYS * DAY) / Math.max(DAY, b.to - b.from)) * 100)}%; background: rgba(0,0,0,0.35)"></div>
												<div class="absolute right-0 top-0 bottom-0" style="width: {Math.min(100, ((PHASE_DAYS * DAY) / Math.max(DAY, b.to - b.from)) * 100)}%; background: rgba(255,255,255,0.45)"></div>
											</div>
											</Tooltip>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/if}
