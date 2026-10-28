<!-- src/lib/components/kiosk/KioskNumpad.svelte -->
<!-- File 11 §5 (29 Sep 2026) — numpad di layar, dipasang lewat kioskNumpad.ts (pola sama
  kioskConfirm.ts). Alasan: keyboard OS tablet Android berbeda-beda, `inputmode="numeric"`
  tidak punya tombol koma (barang kg/liter tidak bisa diisi desimal), dan di PC layar sentuh
  keyboard kadang tidak muncul sama sekali. Tombol >= 64px sesuai target sentuh awam. -->
<script lang="ts">
	interface Props {
		judul: string;
		nilaiAwal?: string;
		desimal?: boolean;
		satuan?: string;
		masked?: boolean;
		maxLength?: number;
		onSelesai: (nilai: string) => void;
		onBatal: () => void;
	}

	let { judul, nilaiAwal = '', desimal = false, satuan = '', masked = false, maxLength = 12, onSelesai, onBatal }: Props = $props();

	// Disimpan & dikembalikan dengan TITIK desimal (`.`) supaya kompatibel dengan `Number()`/
	// `parseFloat()` yang sudah dipakai di semua halaman kiosk -- tombol dan tampilan tetap
	// pakai KOMA (konvensi Indonesia), hanya representasi layar yang berbeda dari nilai asli.
	let nilai = $state(nilaiAwal);

	function tekan(digit: string) {
		if (digit === '.' && (nilai.includes('.') || !desimal)) return;
		if (nilai.length >= maxLength) return;
		nilai += digit;
	}

	function hapus() {
		nilai = nilai.slice(0, -1);
	}

	function selesai() {
		onSelesai(nilai);
	}

	const tombolAngka = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
	const tampilan = $derived(nilai.replace('.', ','));
</script>

<div class="numpad-overlay" role="dialog" aria-modal="true" aria-label={judul}>
	<div class="numpad-card">
		<h2>{judul}</h2>
		<div class="numpad-display">
			<span class="numpad-value">{masked ? '●'.repeat(nilai.length) || '—' : tampilan || '0'}</span>
			{#if satuan && !masked}<span class="numpad-unit">{satuan}</span>{/if}
		</div>
		<div class="numpad-grid">
			{#each tombolAngka as d (d)}
				<button type="button" class="numpad-btn" onclick={() => tekan(d)}>{d}</button>
			{/each}
			<button type="button" class="numpad-btn" class:numpad-btn--disabled={!desimal} onclick={() => tekan('.')} disabled={!desimal}>,</button>
			<button type="button" class="numpad-btn" onclick={() => tekan('0')}>0</button>
			<button type="button" class="numpad-btn numpad-btn--hapus" onclick={hapus}>⌫ Hapus</button>
		</div>
		<div class="numpad-actions">
			<button type="button" class="numpad-batal" onclick={onBatal}>Batal</button>
			<button type="button" class="numpad-selesai" onclick={selesai}>Selesai</button>
		</div>
	</div>
</div>

<style>
	.numpad-overlay {
		position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); z-index: 1000;
		display: flex; align-items: center; justify-content: center; padding: 1rem;
	}
	.numpad-card {
		background: white; border-radius: 1.25rem; padding: 1.5rem; width: 100%; max-width: 420px;
		display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 20px 50px rgba(0,0,0,0.25);
	}
	h2 { margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a; text-align: center; }
	.numpad-display {
		display: flex; align-items: baseline; justify-content: center; gap: 0.5rem;
		background: #f1f5f9; border-radius: 0.75rem; padding: 1rem; min-height: 64px;
	}
	.numpad-value { font-size: 2.25rem; font-weight: 800; color: #0f172a; letter-spacing: 0.05em; word-break: break-all; }
	.numpad-unit { font-size: 1.1rem; color: #64748b; font-weight: 600; }
	.numpad-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
	.numpad-btn {
		min-height: 64px; font-size: 1.5rem; font-weight: 700; border-radius: 0.75rem;
		border: 2px solid #e2e8f0; background: #f8fafc; color: #0f172a; cursor: pointer;
	}
	.numpad-btn:active { background: #e2e8f0; }
	.numpad-btn--disabled, .numpad-btn:disabled { opacity: 0.35; cursor: not-allowed; }
	.numpad-btn--hapus { font-size: 1.1rem; background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
	.numpad-actions { display: flex; gap: 0.6rem; }
	.numpad-batal, .numpad-selesai {
		flex: 1; min-height: 56px; border-radius: 0.75rem; border: none; font-weight: 700; font-size: 1.05rem; cursor: pointer;
	}
	.numpad-batal { background: #e2e8f0; color: #334155; }
	.numpad-selesai { background: #16a34a; color: white; }
</style>
