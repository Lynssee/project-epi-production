<!-- src/lib/components/kiosk/KioskNumberField.svelte -->
<!-- File 11 §5 — pengganti drop-in untuk <input type="number"> di halaman kiosk. `readonly` +
  `onclick` membuka KioskNumpad supaya keyboard OS tablet tidak ikut muncul (bisa beda-beda
  tombolnya per merek, dan tidak semua funya tombol koma). -->
<script lang="ts">
	import { openKioskNumpad } from './kioskNumpad';

	interface Props {
		value: string;
		judul: string;
		satuan?: string;
		desimal?: boolean;
		placeholder?: string;
		id?: string;
		disabled?: boolean;
	}

	let { value = $bindable(), judul, satuan = '', desimal = false, placeholder = '0', id, disabled = false }: Props = $props();

	async function buka() {
		if (disabled) return;
		const hasil = await openKioskNumpad({ judul, nilaiAwal: value, desimal, satuan });
		if (hasil !== null) value = hasil;
	}

	// Nilai disimpan dengan titik (kompatibel Number()/parseFloat di seluruh halaman), tampilan
	// ke operator pakai koma (konvensi Indonesia) -- lihat catatan sama di KioskNumpad.svelte.
	const tampilan = $derived(value ? value.replace('.', ',') : '');
</script>

<button type="button" {id} class="kiosk-number-field" class:empty={!value} {disabled} onclick={buka}>
	<span class="kiosk-number-field__value">{tampilan || placeholder}</span>
	{#if satuan}<span class="kiosk-number-field__unit">{satuan}</span>{/if}
</button>

<style>
	.kiosk-number-field {
		width: 100%;
		min-height: 64px;
		font-size: 1.5rem;
		font-weight: 700;
		text-align: left;
		padding: 0.5rem 1rem;
		border: 2px solid #cbd5e1;
		border-radius: 0.75rem;
		background: white;
		color: #0f172a;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		cursor: pointer;
	}
	.kiosk-number-field.empty { color: #94a3b8; }
	.kiosk-number-field:disabled { opacity: 0.6; cursor: not-allowed; }
	.kiosk-number-field__unit { font-size: 1rem; font-weight: 600; color: #64748b; }
</style>
