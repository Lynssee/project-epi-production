<!-- Lencana BPJSTK Proyek (Jakon) di header detail proyek — Fase 4.
     Hijau: terlindungi + "Lihat Sertifikat" (untuk ditunjukkan ke Safety Officer klien). Kuning/merah: belum
     selesai + "Colek HRD". Abu-abu: tidak diwajibkan. 1x fetch (cache 60 dtk), gagal memuat = disembunyikan. -->
<script lang="ts">
	import { fetchProjectBpjstk, colekHrdBpjstk, bukaSertifikatBpjstk, type ProjectBpjstk } from '$lib/services/projectBpjstk';

	let { projectId }: { projectId: string | number } = $props();

	let data = $state<ProjectBpjstk | null>(null);
	let colekBusy = $state(false);
	let info = $state('');

	$effect(() => {
		const id = projectId;
		data = null;
		info = '';
		if (!id) return;
		fetchProjectBpjstk(id)
			.then((d) => (data = d))
			.catch((e) => console.warn('[ProjectBpjstkBadge] tidak termuat:', e?.message || e));
	});

	let status = $derived(data?.bpjstk_status_efektif ?? 'tidak_wajib');

	async function colek() {
		if (colekBusy) return;
		colekBusy = true;
		const r = await colekHrdBpjstk(projectId);
		info = r.success ? (r.alreadySent ? 'HRD sudah diingatkan hari ini.' : 'HRD sudah diingatkan.') : r.error || 'Gagal mengirim.';
		colekBusy = false;
	}

	function lihat() {
		bukaSertifikatBpjstk(data?.bpjstk_file_sertifikat).catch(() => (info = 'Gagal membuka sertifikat.'));
	}
</script>

{#if data}
	<div class="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
		{#if !data.bpjstk_wajib}
			<span class="px-2 py-0.5 rounded-lg font-semibold" style="background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8)">
				⚪ BPJSTK tidak diwajibkan
			</span>
		{:else if status === 'aktif'}
			<span class="px-2 py-0.5 rounded-lg font-bold" style="background: #dcfce7; color: #166534">
				🟢 BPJSTK Jakon Terlindungi{data.bpjstk_nomor_sertifikat ? ` (No: ${data.bpjstk_nomor_sertifikat})` : ''}
			</span>
			{#if data.bpjstk_file_sertifikat}
				<button type="button" onclick={lihat} class="px-2 py-0.5 rounded-lg font-semibold underline" style="color: white">
					📄 Lihat Sertifikat
				</button>
			{/if}
		{:else}
			<span class="px-2 py-0.5 rounded-lg font-bold" style="background: {status === 'kedaluwarsa' ? '#fee2e2' : '#fef3c7'}; color: {status === 'kedaluwarsa' ? '#991b1b' : '#92400e'}">
				{status === 'kedaluwarsa' ? '🔴 Sertifikat BPJSTK kedaluwarsa' : '🟡 BPJSTK sedang diproses HRD'}
			</span>
			<button type="button" onclick={colek} disabled={colekBusy} class="px-2 py-0.5 rounded-lg font-semibold underline" style="color: white" title="Kirim pengingat ke HRD (maks 1x per hari)">
				{colekBusy ? 'Mengirim…' : '🔔 Colek HRD'}
			</button>
		{/if}
		{#if info}<span style="color: rgba(255,255,255,0.8)">{info}</span>{/if}
	</div>
{/if}
