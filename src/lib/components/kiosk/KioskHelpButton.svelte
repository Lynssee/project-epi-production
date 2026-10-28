<!-- src/lib/components/kiosk/KioskHelpButton.svelte -->
<!-- File 11 §6 (29 Sep 2026) — tombol bulat "?" pojok kanan atas di setiap halaman kiosk
  (Aturan CLAUDE.md: "Cantumkan hint/panduan untuk setiap fitur/langkah baru"). Dipasang SEKALI
  di kiosk/+layout.svelte (bukan per halaman) supaya otomatis ikut semua rute kiosk tanpa perlu
  ditempel manual satu-satu, isinya mengikuti `$page.url.pathname` lewat panduan.ts.
  Tur pertama kali: status "sudah lihat" per PERANGKAT (localStorage), bukan per karyawan --
  kiosk dipakai bergantian banyak operator di satu perangkat yang sama, jadi pelacakan per
  perangkat lebih berguna di sini daripada per karyawan (dan tidak butuh tahu siapa yang login
  di titik pemasangan global ini). -->
<script lang="ts">
	import { page } from '$app/state';
	import { getPanduan } from '$lib/kiosk/panduan';

	// `kiosk-statusbar` (profil/jam/koneksi) juga menempel di kanan-atas saat sesi aktif --
	// tanpa offset ini tombol "?" akan tumpang tindih dengan chip koneksi/jam di sana.
	interface Props {
		adaStatusbar?: boolean;
	}
	let { adaStatusbar = false }: Props = $props();

	let terbuka = $state(false);
	let sudahAutoTampilUntuk = $state<string | null>(null);

	const panduan = $derived(getPanduan(page.url.pathname));
	const localStorageKey = $derived(`kiosk_panduan_seen:${page.url.pathname}`);

	// Tur pertama kali per halaman per perangkat — jalan sekali tiap pathname berubah.
	$effect(() => {
		const key = localStorageKey;
		const path = page.url.pathname;
		if (sudahAutoTampilUntuk === path) return;
		sudahAutoTampilUntuk = path;
		try {
			if (!localStorage.getItem(key)) {
				terbuka = true;
				localStorage.setItem(key, '1');
			}
		} catch {
			// Private mode / storage diblokir -- tidak fatal, cukup tidak ada auto-tampil.
		}
	});
</script>

<button
	type="button"
	class="kiosk-help-btn"
	class:kiosk-help-btn--geser={adaStatusbar}
	onclick={() => (terbuka = true)}
	aria-label="Panduan halaman ini"
>
	?
</button>

{#if terbuka}
	<div class="kiosk-help-overlay" role="dialog" aria-modal="true" aria-label={panduan.judul}>
		<div class="kiosk-help-card">
			<h2>{panduan.judul}</h2>
			<ol class="kiosk-help-list">
				{#each panduan.langkah as l, i (i)}
					<li>
						<span class="kiosk-help-icon">{l.icon}</span>
						<span class="kiosk-help-teks">{l.teks}</span>
					</li>
				{/each}
			</ol>
			<button type="button" class="kiosk-help-tutup" onclick={() => (terbuka = false)}>Mengerti</button>
		</div>
	</div>
{/if}

<style>
	.kiosk-help-btn {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 900;
		width: 44px;
		height: 44px;
		border-radius: 999px;
		border: none;
		background: #0f172a;
		color: white;
		font-size: 1.25rem;
		font-weight: 800;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
	}
	.kiosk-help-btn--geser { top: 4rem; }
	.kiosk-help-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.kiosk-help-card {
		background: white;
		border-radius: 1.25rem;
		padding: 1.5rem;
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
	}
	.kiosk-help-card h2 { margin: 0; font-size: 1.2rem; font-weight: 800; color: #0f172a; }
	.kiosk-help-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.85rem; }
	.kiosk-help-list li { display: flex; align-items: flex-start; gap: 0.75rem; }
	.kiosk-help-icon { font-size: 1.6rem; line-height: 1; flex-shrink: 0; }
	.kiosk-help-teks { font-size: 1rem; color: #334155; line-height: 1.4; }
	.kiosk-help-tutup {
		min-height: 56px;
		border: none;
		border-radius: 0.75rem;
		background: #16a34a;
		color: white;
		font-weight: 700;
		font-size: 1.05rem;
		cursor: pointer;
	}
</style>
