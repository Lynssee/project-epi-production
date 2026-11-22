<script lang="ts">
	// Alert "Target Merah" di beranda ESS: muncul bila PROYEKSI skor Anda untuk bulan/kuartal/tahun ini diperkirakan
	// tidak mencapai target yang sudah disetujui atasan. Memakai data yang sama dengan kartu "Target & Proyeksi Saya"
	// (cache 2 menit, tanpa panggilan tambahan). Dapat ditutup untuk hari ini. Gagal / tidak ada masalah => tidak tampil.
	import { onMount } from 'svelte';
	import { getTargetSaya, HORIZON_LABEL, type TargetSayaHorizon } from '$lib/services/ess/targetSaya';

	const KEY = 'target-merah-ditutup';
	let masalah = $state<TargetSayaHorizon[]>([]);
	let ditutup = $state(false);

	const hariIni = () => new Date().toISOString().slice(0, 10);

	onMount(async () => {
		try { ditutup = localStorage.getItem(KEY) === hariIni(); } catch { /* opsional */ }
		const d = await getTargetSaya();
		if (!d.available) return;
		// Hanya horizon yang berarti bagi karyawan (bukan mingguan: proyeksi dihitung dari data bulanan).
		masalah = (d.horizons || []).filter((h) => h.horizonType !== 'weekly' && h.target && h.forecast && (h.status === 'off_track' || h.status === 'at_risk'));
	});

	const merah = $derived(masalah.some((h) => h.status === 'off_track'));
	const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : Math.round(v * 10) / 10);

	function tutup() {
		ditutup = true;
		try { localStorage.setItem(KEY, hariIni()); } catch { /* opsional */ }
	}
</script>

{#if masalah.length > 0 && !ditutup}
	<div
		class="rounded-2xl border p-3{merah ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}"
		role="status"
		data-testid="target-merah-banner"
	>
		<div class="flex items-start justify-between gap-2">
			<p class="text-[13px] font-bold {merah ? 'text-red-800' : 'text-amber-800'}">
				{merah ? '🔴 Target belum terkejar' : '🟡 Target berisiko'}
			</p>
			<button type="button" class="text-[11px] text-slate-500 underline shrink-0" onclick={tutup} aria-label="Tutup peringatan untuk hari ini">Tutup hari ini</button>
		</div>
		<ul class="mt-1 text-[12px] {merah ? 'text-red-700' : 'text-amber-700'} space-y-0.5">
			{#each masalah as h (h.horizonType)}
				<li>{HORIZON_LABEL[h.horizonType]}: perkiraan skor <b>{fmt(h.forecast?.value)}</b> dari target <b>{fmt(h.target?.target)}</b>.</li>
			{/each}
		</ul>
		<p class="mt-1 text-[11px] text-slate-500">Perkiraan dari tren skor final Anda — bukan nilai akhir. Lihat rinciannya dan apa yang bisa dikejar di <a class="underline font-semibold" href="/ess/kinerja">Kinerja Saya</a>.</p>
	</div>
{/if}
