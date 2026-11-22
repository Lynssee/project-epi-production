<!-- src/lib/components/ess/TimPembinaanAlertCard.svelte
     Peringatan dini untuk atasan/mentor di "Kinerja Saya": ada bawahan yang gagal/terlambat training wajib dan berdampak ke skor pembinaan tim Anda.
     Tampil HANYA bila fitur aktif (mode bukan off), pengguna punya bawahan, dan ada yang perlu dibina — selain itu tidak merender apa pun
     (tanpa spinner/galat di beranda). 1 request ringan; gagal = diam (fail-soft). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getTimKesehatan, type TeamTrainingHealth } from '$lib/services/ess/silabus';
	import { IconUsersGroup, IconArrowRight } from '@tabler/icons-svelte';

	let data = $state<TeamTrainingHealth | null>(null);

	onMount(async () => {
		try {
			data = await getTimKesehatan();
		} catch (e: any) {
			console.warn('[TimPembinaanAlertCard] kesehatan tim gagal dimuat (disembunyikan):', e?.message || e);
		}
	});

	const tampil = $derived(!!data && data.aktif && data.jumlahAnggota > 0 && data.perluDibina > 0);
	const nama = $derived((data?.anggota ?? []).filter((a) => a.status === 'perlu_dibina').slice(0, 3).map((a) => a.nama.split(' ')[0]).join(', '));
</script>

{#if tampil && data}
	<button
		type="button"
		class="hover-lift glass-panel rounded-2xl p-4 mb-4 w-full text-left flex items-center gap-3"
		data-testid="tim-pembinaan-alert"
		onclick={() => goto('/ess/pelatihan/tim')}
		title="Buka Pantauan Tim untuk membina bawahan"
	>
		<IconUsersGroup size={22} class="shrink-0" style="color: #D97706" />
		<div class="min-w-0 flex-1">
			<p class="text-sm font-bold" style="color: var(--sys-label)">
				{data.perluDibina} bawahan perlu dibina
				{#if data.mode === 'shadow'}<span class="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">simulasi</span>{/if}
			</p>
			<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
				{nama} gagal atau terlambat training wajib. Skor pembinaan tim Anda: {data.estimasiKpi ?? '—'}%.
			</p>
			<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Langkah: buka Pantauan Tim → pilih bawahan → "Catat Pembinaan" sebelum cutoff KPI (tanggal 25).</p>
		</div>
		<IconArrowRight size={16} class="shrink-0" style="color: var(--sys-label4)" />
	</button>
{/if}
