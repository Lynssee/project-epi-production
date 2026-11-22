<!-- src/lib/components/project/ProyeksiPenyelesaianCard.svelte
     Fase 5 (Target & Forecast) — "Proyeksi Penyelesaian" proyek: estimasi tanggal selesai dari laju progres 14 hari terakhir vs rencana Kurva S.
     Memakai loader Kendali Harian yang SAMA (cache 2 menit) → tidak menambah panggilan API. TANPA nominal rupiah. Hanya penanda, tidak memblokir. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadKendaliHarian, type KendaliHarianRaw } from '$lib/services/kendaliHarianApi';
	import { hitungProyeksiPenyelesaian, type ProyeksiStatus } from '$lib/utils/proyeksiPenyelesaian';

	let { projectId }: { projectId: number | string } = $props();

	let raw = $state<KendaliHarianRaw | null>(null);
	let loading = $state(true);
	let gagal = $state(false);

	onMount(async () => {
		try {
			raw = await loadKendaliHarian(projectId);
		} catch {
			gagal = true;
		} finally {
			loading = false;
		}
	});

	const ready = $derived(raw && raw.applicable && raw.show.scurve && raw.scurve ? raw : null);
	const hasil = $derived(ready && ready.scurve ? hitungProyeksiPenyelesaian(ready.scurve.actual, ready.scurve.baseline, ready.today) : null);

	const TONE: Record<ProyeksiStatus, { cls: string; label: string }> = {
		selesai: { cls: 'bg-emerald-100 text-emerald-800', label: 'Selesai' },
		lebih_cepat: { cls: 'bg-emerald-100 text-emerald-800', label: 'Lebih cepat dari rencana' },
		sesuai: { cls: 'bg-sky-100 text-sky-800', label: 'Sesuai rencana' },
		terlambat: { cls: 'bg-rose-100 text-rose-800', label: 'Berpotensi terlambat' },
		stagnan: { cls: 'bg-amber-100 text-amber-800', label: 'Progres stagnan' },
		tidak_cukup_data: { cls: 'bg-slate-100 text-slate-600', label: 'Data belum cukup' }
	};
	const tgl = (ymd: string | null) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
</script>

{#if !loading && !gagal && hasil}
	<section class="rounded-2xl bg-white border border-slate-200 p-4 mb-4" data-testid="proyeksi-penyelesaian">
		<div class="flex items-start justify-between gap-2 mb-1">
			<h3 class="text-sm font-bold text-slate-800">Proyeksi Penyelesaian</h3>
			<span class="px-2 py-0.5 rounded-full text-[10px] font-bold {TONE[hasil.status].cls}">{TONE[hasil.status].label}</span>
		</div>
		<p class="text-[11px] text-slate-500 mb-3">Estimasi dari laju progres {hasil.windowDays} hari terakhir dibanding rencana Kurva S. Perkiraan — berubah mengikuti kondisi lapangan.</p>
		{#if hasil.status === 'tidak_cukup_data'}
			<p class="text-xs text-slate-600">Belum cukup riwayat progres (minimal ±7 hari pelaporan) untuk memproyeksikan tanggal selesai.</p>
		{:else if hasil.status === 'stagnan'}
			<p class="text-xs text-slate-600">Progres saat ini <strong>{hasil.progressNow}%</strong> dan tidak naik pada {hasil.windowDays} hari terakhir — tanggal selesai belum dapat diproyeksikan. Cek kendala di Laporan Harian.</p>
		{:else}
			<div class="grid grid-cols-3 gap-2 text-center">
				<div class="rounded-xl bg-slate-50 p-2"><div class="text-[10px] text-slate-500">Progres</div><div class="text-base font-black text-slate-800">{hasil.progressNow}%</div></div>
				<div class="rounded-xl bg-slate-50 p-2"><div class="text-[10px] text-slate-500">Proyeksi selesai</div><div class="text-xs font-black text-slate-800">{tgl(hasil.proyeksiSelesai)}</div></div>
				<div class="rounded-xl bg-slate-50 p-2"><div class="text-[10px] text-slate-500">Rencana selesai</div><div class="text-xs font-black text-slate-800">{tgl(hasil.rencanaSelesai)}</div></div>
			</div>
			{#if hasil.selisihHari != null && hasil.status !== 'selesai'}
				<p class="text-[11px] mt-2 {hasil.selisihHari > 3 ? 'text-rose-700' : 'text-slate-600'}">
					{hasil.selisihHari > 0 ? `Diproyeksikan ${hasil.selisihHari} hari lebih lambat dari rencana.` : hasil.selisihHari < 0 ? `Diproyeksikan ${Math.abs(hasil.selisihHari)} hari lebih cepat dari rencana.` : 'Diproyeksikan tepat sesuai rencana.'}
					Laju rata-rata {hasil.pacePerHari} poin/hari.
				</p>
			{/if}
		{/if}
	</section>
{/if}
