<script lang="ts">
	// "Siap Offline": unduh materi teks kursus yang sedang diikuti sekali tekan (saat ada WiFi/sinyal bagus),
	// supaya bisa dibaca di area tanpa sinyal. Progres, kuis, video/PDF tetap butuh sinyal.
	import { onMount } from 'svelte';
	import { getKursusDetail, type KursusListItem } from '$lib/services/ess/training';
	import { listCachedKursus, clearCachedKursus, prefetchKursus, selectPrefetchTargets, MAX_PREFETCH_PER_RUN, type CachedKursusInfo } from '$lib/utils/offlineTrainingCache';
	import { IconCloudDownload, IconLoader2, IconWifiOff, IconTrash } from '@tabler/icons-svelte';

	let { kursus = [], offline = false }: { kursus?: KursusListItem[]; offline?: boolean } = $props();

	let tersimpan = $state<CachedKursusInfo[]>([]);
	let berjalan = $state(false);
	let selesai = $state(0);
	let total = $state(0);
	let pesan = $state('');

	async function muat() {
		tersimpan = await listCachedKursus();
	}
	onMount(muat);

	const freshIds = $derived(new Set(tersimpan.map((t) => t.programId)));
	const targets = $derived(
		selectPrefetchTargets(
			kursus.map((k) => ({ programId: k.program.id, wajib: !!k.program.wajib, terdaftar: k.terdaftar, status: k.enrollment?.status ?? null, progress: k.enrollment?.progress_persen ?? 0 })),
			freshIds
		)
	);
	const terakhir = $derived(tersimpan[0]?.cachedAt ? new Date(tersimpan[0].cachedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

	async function unduh() {
		if (berjalan || targets.length === 0) return;
		berjalan = true;
		pesan = '';
		selesai = 0;
		total = targets.length;
		try {
			const r = await prefetchKursus(targets, (id) => getKursusDetail(id), (s) => (selesai = s));
			pesan = r.tersimpan > 0 ? `${r.tersimpan} kursus tersimpan untuk offline.` : 'Tidak ada materi teks baru yang bisa disimpan.';
			if (r.gagal > 0) pesan += ` ${r.gagal} gagal (sinyal terputus?) — coba lagi.`;
			if (r.dilewati > 0) pesan += ` ${r.dilewati} dilewati (hanya video/PDF).`;
		} finally {
			berjalan = false;
			await muat();
		}
	}

	async function hapus() {
		await clearCachedKursus();
		pesan = 'Salinan offline dihapus.';
		await muat();
	}
</script>

{#if offline || kursus.some((k) => k.terdaftar) || tersimpan.length > 0}
	<div class="card-section mb-4" style="border: 1px solid var(--sys-sep)">
		<div class="flex items-center gap-2">
			{#if offline}<IconWifiOff size={18} style="color: #d97706" />{:else}<IconCloudDownload size={18} style="color: var(--ac, #2563eb)" />{/if}
			<p class="text-[13px] font-bold" style="color: var(--sys-label)">{offline ? 'Mode offline' : 'Siap Offline'}</p>
			<span class="ml-auto text-[11px]" style="color: var(--sys-label3)">
				{tersimpan.length} kursus tersimpan{terakhir ? ` · ${terakhir}` : ''}
			</span>
		</div>

		{#if offline}
			<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Tidak ada sinyal. Hanya kursus yang sudah disimpan yang bisa dibuka; materi teksnya bisa dibaca, progres dan kuis menunggu sinyal.</p>
		{:else}
			<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
				Tekan sebelum berangkat ke lokasi tanpa sinyal. Yang disimpan: materi teks kursus yang sedang Anda ikuti (kursus wajib lebih dulu, maksimal {MAX_PREFETCH_PER_RUN} sekali tekan). Video, PDF, dan kuis tetap butuh sinyal.
			</p>
			<div class="flex items-center gap-2 mt-2">
				<button type="button" onclick={unduh} disabled={berjalan || targets.length === 0} class="flex-1 rounded-lg py-2 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--ac, #2563eb)">
					{#if berjalan}
						<IconLoader2 size={14} class="inline animate-spin" /> Menyimpan {selesai}/{total}…
					{:else if targets.length === 0}
						Semua kursus Anda sudah tersimpan
					{:else}
						Simpan {targets.length} kursus untuk offline
					{/if}
				</button>
				{#if tersimpan.length > 0}
					<button type="button" onclick={hapus} disabled={berjalan} class="rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style="border: 1px solid var(--sys-sep); color: var(--sys-label)" title="Hapus semua salinan offline dari HP ini" aria-label="Hapus salinan offline">
						<IconTrash size={14} />
					</button>
				{/if}
			</div>
		{/if}
		{#if pesan}<p class="text-[11px] mt-1.5" style="color: var(--sys-label)">{pesan}</p>{/if}
	</div>
{/if}
