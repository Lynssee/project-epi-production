<!-- src/lib/components/sales/SalesScoreCard.svelte -->
<!-- Kartu Skor & Target Saya (bulan ini) di /sales/hub: omzet SO vs target, kunjungan terverifikasi, SPH menunggu follow-up.
     Hanya baca, 4 query paralel (getMyMonthScorecard). Sumber gagal/target belum diatur ditulis "—", bukan 0 — tidak menyesatkan sales. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getMyMonthScorecard, type MyMonthScorecard } from '$lib/services/sales';
	import { IconTargetArrow, IconMapPin, IconFileDollar } from '@tabler/icons-svelte';

	let card = $state<MyMonthScorecard | null>(null);
	let loading = $state(true);

	const rp = (n: number | null | undefined) => (n == null ? '—' : 'Rp ' + Math.round(n).toLocaleString('id-ID'));
	let pct = $derived(card && card.target && card.target > 0 ? Math.min(999, Math.round((card.omzet / card.target) * 100)) : null);
	let bar = $derived(pct == null ? 0 : Math.min(100, pct));
	let monthLabel = $derived(
		card ? new Date(`${card.period}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : ''
	);

	onMount(async () => {
		const karyawanId = $authStore.karyawanId;
		const salesName = $authStore.karyawanName;
		if (!karyawanId && !salesName) { loading = false; return; }
		try {
			card = await getMyMonthScorecard({ karyawanId: karyawanId ?? null, salesName: salesName ?? null });
		} catch (e) {
			console.warn('[SalesScoreCard] gagal memuat:', e);
		} finally {
			loading = false;
		}
	});
</script>

{#if loading}
	<div class="p-3 rounded-2xl border text-[11px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)" data-testid="sales-scorecard-loading">Memuat skor bulan ini…</div>
{:else if card}
	<section class="p-3 rounded-2xl border space-y-2" style="border-color: var(--sys-sep); background: var(--sys-fill)" data-testid="sales-scorecard" aria-label="Kartu skor dan target saya">
		<div class="flex items-center justify-between">
			<h2 class="text-xs font-bold flex items-center gap-1.5" style="color: var(--sys-label)"><IconTargetArrow size={15} /> Skor &amp; Target Saya — {monthLabel}</h2>
			<a href="/sales/laporan-harian" class="text-[10px] font-semibold text-blue-600 dark:text-blue-400" title="Rekap harian otomatis terisi dari aktivitas Anda">Laporan Harian →</a>
		</div>

		<div>
			<div class="flex items-end justify-between">
				<span class="text-[11px]" style="color: var(--sys-label3)" title="Total Sales Order Anda bulan ini (bukan cancelled).">Omzet SO ({card.jumlahSo} SO)</span>
				<span class="text-sm font-black" style="color: var(--sys-label)">{rp(card.omzet)}</span>
			</div>
			<div class="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-1" aria-hidden="true">
				<div class="h-full rounded-full {pct != null && pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}" style="width: {bar}%"></div>
			</div>
			<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)" data-testid="sales-scorecard-target">
				{#if card.target != null}Target {rp(card.target)} · tercapai <b>{pct ?? 0}%</b>{:else}Target bulan ini belum diatur / tidak terbaca — minta Admin Sales mengisinya.{/if}
			</p>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<a href="/sales" class="p-2 rounded-xl border" style="border-color: var(--sys-sep)" title="Kunjungan terverifikasi SPV dihitung untuk KPI & insentif.">
				<div class="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"><IconMapPin size={13} /> Kunjungan</div>
				<p class="text-sm font-black" style="color: var(--sys-label)">{card.errors.includes('kunjungan') ? '—' : `${card.kunjunganTerverifikasi}/${card.kunjungan}`}</p>
				<p class="text-[10px]" style="color: var(--sys-label3)">terverifikasi / total</p>
			</a>
			<a href="/sales/penawaran" class="p-2 rounded-xl border" style="border-color: var(--sys-sep)" title="SPH berstatus final/terkirim yang belum jadi SO — saatnya follow-up.">
				<div class="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400"><IconFileDollar size={13} /> SPH menunggu</div>
				<p class="text-sm font-black" style="color: var(--sys-label)">{card.errors.includes('sph') ? '—' : card.sphMenunggu}</p>
				<p class="text-[10px]" style="color: var(--sys-label3)">belum jadi SO</p>
			</a>
		</div>
	</section>
{/if}
