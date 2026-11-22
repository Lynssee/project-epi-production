<!-- src/lib/components/ess/SopSayaWidget.svelte -->
<!-- "Tugas Saya di Alur Kerja" versi RINGKAS untuk beranda & dashboard peran lapangan (driver, satpam, HSE, workshop, maintenance).
     Pembungkus tipis: hanya tampil untuk akun yang tertaut ke karyawan (tanpa itu tidak ada jabatan → tak ada panggilan server sama sekali).
     Semua kartu di satu halaman berbagi memo 5 menit di processGuidanceMineApi, jadi menaruhnya di banyak dashboard TIDAK menambah panggilan ke Directus. -->
<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import TugasSayaAlurCard from './TugasSayaAlurCard.svelte';
</script>

{#if $authStore.karyawanId}
	<TugasSayaAlurCard ringkas cacheOwner={$authStore.karyawanId} />
{/if}
