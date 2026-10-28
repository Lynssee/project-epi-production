<!-- src/lib/components/kiosk/KioskConfirm.svelte -->
<!-- File 11 §4 (M17) — pengganti confirm() bawaan browser di kiosk: tombol OK/Cancel
     berbahasa Inggris, dialog kecil, dan kadang diblokir di mode layar penuh. Tombol besar
     (≥56px), berbahasa Indonesia, dan role="dialog" (dipakai file 02 untuk mendeteksi modal
     terbuka supaya scanner tidak membajak halaman saat dialog ini terbuka). -->
<script lang="ts">
	interface Props {
		judul: string;
		isi: string;
		ya?: string;
		tidak?: string;
		warna?: 'hijau' | 'merah' | 'oranye';
		onYa: () => void;
		onTidak: () => void;
	}
	let { judul, isi, ya = 'Ya', tidak = 'Batal', warna = 'hijau', onYa, onTidak }: Props = $props();
</script>

<div class="kc-backdrop" role="dialog" aria-modal="true" onclick={onTidak}>
	<div class="kc-card" onclick={(e) => e.stopPropagation()}>
		<h2>{judul}</h2>
		<p>{isi}</p>
		<div class="kc-actions">
			<button type="button" class="kc-btn kc-btn--tidak" onclick={onTidak}>{tidak}</button>
			<button type="button" class="kc-btn kc-btn--ya kc-btn--{warna}" onclick={onYa}>{ya}</button>
		</div>
	</div>
</div>

<style>
	.kc-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		z-index: 15000;
	}
	.kc-card {
		background: #ffffff;
		color: #0f172a;
		border-radius: 1.1rem;
		padding: 1.75rem 1.5rem;
		max-width: 420px;
		width: 100%;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
	}
	.kc-card h2 { margin: 0 0 0.6rem; font-size: 1.2rem; font-weight: 800; }
	.kc-card p { margin: 0; color: #334155; font-size: 1rem; line-height: 1.5; }
	.kc-actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
	.kc-btn {
		flex: 1;
		min-height: 56px;
		border-radius: 0.75rem;
		font-weight: 800;
		font-size: 1.02rem;
		border: none;
		cursor: pointer;
	}
	.kc-btn--tidak { background: #f1f5f9; color: #334155; border: 1.5px solid #cbd5e1; }
	.kc-btn--ya.kc-btn--hijau { background: #16a34a; color: #fff; }
	.kc-btn--ya.kc-btn--merah { background: #dc2626; color: #fff; }
	.kc-btn--ya.kc-btn--oranye { background: #ea580c; color: #fff; }
</style>
