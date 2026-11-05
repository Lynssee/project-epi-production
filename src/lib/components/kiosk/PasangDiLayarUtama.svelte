<script lang="ts">
	// Panduan "Tambahkan ke layar utama" untuk Kiosk Proyek (Fase 3). Android Chrome: tombol pasang
	// langsung (beforeinstallprompt). iPhone: langkah manual — dan PENTING: di iPhone ikon punya
	// penyimpanan sendiri (terpisah dari Safari), jadi ikat HP harus dilakukan DARI ikon, bukan sebelumnya.
	import { onMount } from 'svelte';
	import { IconDownload, IconShare2, IconDotsVertical, IconX } from '@tabler/icons-svelte';
	import { deteksiPlatform, sudahTerpasang } from '$lib/utils/kioskProyekPwa';

	let { sebelumIkat = false }: { sebelumIkat?: boolean } = $props();

	let platform = $state<'ios' | 'android' | 'lain'>('lain');
	let terpasang = $state(true); // aman: sembunyi sampai terdeteksi di klien
	let tutup = $state(false);
	let promptEvent = $state<any>(null);

	const KUNCI = 'kiosk_proyek_pwa_tutup';

	onMount(() => {
		platform = deteksiPlatform(navigator.userAgent);
		terpasang = sudahTerpasang();
		try {
			tutup = localStorage.getItem(KUNCI) === '1';
		} catch {
			/* penyimpanan diblokir — tampilkan saja */
		}
		const onPrompt = (e: Event) => {
			e.preventDefault();
			promptEvent = e;
		};
		const onInstalled = () => (terpasang = true);
		window.addEventListener('beforeinstallprompt', onPrompt);
		window.addEventListener('appinstalled', onInstalled);
		return () => {
			window.removeEventListener('beforeinstallprompt', onPrompt);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	async function pasang() {
		if (!promptEvent) return;
		promptEvent.prompt();
		try {
			const r = await promptEvent.userChoice;
			if (r?.outcome === 'accepted') terpasang = true;
		} catch {
			/* abaikan */
		}
		promptEvent = null;
	}

	function sembunyikan() {
		tutup = true;
		try {
			localStorage.setItem(KUNCI, '1');
		} catch {
			/* abaikan */
		}
	}
</script>

{#if !terpasang && !tutup}
	<div class="mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm space-y-2" role="note">
		<div class="flex items-start justify-between gap-2">
			<p class="font-bold text-base">Pasang ikon “Absen EPI” di layar utama</p>
			<button onclick={sembunyikan} class="p-1 rounded-lg hover:bg-emerald-100" aria-label="Sembunyikan panduan" title="Sembunyikan"><IconX size={18} /></button>
		</div>
		<p>Besok-besok cukup buka ikon, tidak perlu cari link lagi.</p>

		{#if platform === 'ios'}
			<ol class="list-decimal pl-5 space-y-1">
				<li>Buka halaman ini di <b>Safari</b>.</li>
				<li>Tekan tombol <b>Bagikan</b> <IconShare2 size={16} class="inline -mt-0.5" /> di bawah layar.</li>
				<li>Pilih <b>Tambah ke Layar Utama</b> → <b>Tambah</b>.</li>
				{#if sebelumIkat}
					<li class="font-semibold text-red-700">Penting di iPhone: pasang ikon DULU, lalu buka dari ikon itu dan baru ikat HP. Kalau mengikat di Safari, ikon tidak mengenali HP Anda.</li>
				{/if}
			</ol>
		{:else if platform === 'android'}
			{#if promptEvent}
				<button onclick={pasang} class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white font-bold text-base"><IconDownload size={20} /> Pasang sekarang</button>
			{:else}
				<ol class="list-decimal pl-5 space-y-1">
					<li>Tekan menu <IconDotsVertical size={16} class="inline -mt-0.5" /> di pojok kanan atas Chrome.</li>
					<li>Pilih <b>Tambahkan ke layar utama</b> (atau <b>Instal aplikasi</b>).</li>
					<li>Tekan <b>Tambahkan</b>.</li>
				</ol>
			{/if}
		{:else}
			<p>Di menu browser, pilih <b>Tambahkan ke layar utama</b> / <b>Instal aplikasi</b>.</p>
		{/if}
	</div>
{/if}
