<!-- src/lib/components/shared/CuacaBadge.svelte
     Pusat Intelijen v2 Fase 4 (§6 L1) — badge peringatan hujan BMKG untuk pekerjaan outdoor.
     Sembunyi diam-diam kalau proyek belum diisi kode wilayah BMKG (bmkg_adm4_code) di admin —
     bukan error, banyak proyek memang belum dikonfigurasi. Sumber SELALU dicantumkan (syarat BMKG). -->
<script>
  import { onMount } from 'svelte';
  import { fetchCuacaLokasi } from '$lib/services/weatherLokasi';

  /** @type {{ projectId: number|string, variant?: 'compact'|'full' }} */
  let { projectId, variant = 'compact' } = $props();

  let cuaca = $state(/** @type {import('$lib/services/weatherLokasi').CuacaLokasi | null} */ (null));
  let loading = $state(true);

  onMount(async () => {
    if (!projectId) {
      loading = false;
      return;
    }
    cuaca = await fetchCuacaLokasi(projectId);
    loading = false;
  });
</script>

{#if !loading && cuaca?.hariIni}
  {#if variant === 'compact'}
    {#if cuaca.hariIni.hujan}
      <span
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
        title="BMKG memprediksi hujan hari ini ({cuaca.lokasiLabel || 'lokasi proyek'}). Ini peringatan, bukan larangan — leader tetap yang memutuskan."
      >
        🌧️ Prediksi Hujan
      </span>
    {:else}
      <span
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
        title="Sumber: BMKG ({cuaca.lokasiLabel || 'lokasi proyek'})"
      >
        ☀️ Cerah/Berawan
      </span>
    {/if}
  {:else}
    <div class="rounded-xl border border-gray-200 p-3 bg-white">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-gray-700">Prakiraan Cuaca — {cuaca.lokasiLabel || 'Lokasi Proyek'}</span>
        <span class="text-[10px] text-gray-400">Sumber: BMKG</span>
      </div>
      <div class="flex gap-2">
        {#each cuaca.forecastHarian.slice(0, 3) as hari (hari.tanggal)}
          <div class="flex-1 text-center rounded-lg p-2 {hari.hujan ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-150'}">
            <p class="text-[10px] text-gray-500">{new Date(hari.tanggal).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            <p class="text-lg">{hari.hujan ? '🌧️' : '☀️'}</p>
            <p class="text-[10px] {hari.hujan ? 'text-amber-700 font-semibold' : 'text-gray-400'}">{hari.ringkasan}</p>
          </div>
        {/each}
      </div>
      <p class="text-[10px] text-gray-400 mt-2">Tanggal kuning = BMKG memprediksi hujan. Ini peringatan, bukan larangan — leader tetap yang memutuskan.</p>
    </div>
  {/if}
{/if}
