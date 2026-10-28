<!-- src/lib/components/kiosk/SisaBatchCard.svelte -->
<!-- Fase 4 rencana lifecycle produksi — "Catat Sisa Batch". Operator memasukkan berat cat yang masih
  tersisa di tangki/drum + lokasi simpan; masuk ke radar admin sebagai kandidat pakai ulang (rework/blending).
  Tidak mengubah stok. Dipasang di Input Produksi setelah SPK dipilih. -->
<script lang="ts">
	import KioskNumberField from './KioskNumberField.svelte';
	import { IconPackage, IconLoader2, IconCheck } from '@tabler/icons-svelte';

	interface Props {
		spkId: number | null;
	}
	let { spkId }: Props = $props();

	let open = $state(false);
	let kg = $state('');
	let location = $state('');
	let saving = $state(false);
	let error = $state('');
	let saved = $state<{ id: number; remainder_kg: number; location: string | null }[]>([]);
	let txnId = $state(crypto.randomUUID());

	async function load() {
		if (!spkId) {
			saved = [];
			return;
		}
		try {
			const res = await fetch(`/api/kiosk/sisa-batch?spkId=${spkId}`);
			if (res.ok) saved = (await res.json()).data || [];
		} catch {
			/* daftar opsional — gagal muat tidak mengganggu input produksi */
		}
	}

	$effect(() => {
		spkId; // muat ulang saat SPK berganti
		open = false;
		kg = '';
		location = '';
		error = '';
		txnId = crypto.randomUUID();
		load();
	});

	async function simpan() {
		if (!spkId || saving) return;
		const n = Number(kg);
		if (!(n > 0)) {
			error = 'Isi berat sisa dulu (lebih dari 0 kg).';
			return;
		}
		saving = true;
		error = '';
		try {
			const res = await fetch('/api/kiosk/sisa-batch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ spkId, remainderKg: n, location, clientTxnId: txnId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
			kg = '';
			location = '';
			open = false;
			txnId = crypto.randomUUID();
			await load();
		} catch (e: any) {
			error = e?.message || 'Gagal menyimpan. Coba lagi.';
		} finally {
			saving = false;
		}
	}
</script>

{#if spkId}
	<div class="sisa-card">
		<button type="button" class="sisa-toggle" onclick={() => (open = !open)} aria-expanded={open}>
			<IconPackage size={22} />
			<span>Catat Sisa Batch</span>
			{#if saved.length}<span class="sisa-badge">{saved.length} tercatat</span>{/if}
		</button>
		<p class="sisa-hint">Masih ada cat tersisa di tangki/drum? Catat beratnya agar bisa dipakai ulang di produksi berikutnya. Tidak mengubah stok.</p>

		{#if saved.length}
			<ul class="sisa-list">
				{#each saved as s (s.id)}
					<li><IconCheck size={16} /> {s.remainder_kg} kg{s.location ? ` · ${s.location}` : ''}</li>
				{/each}
			</ul>
		{/if}

		{#if open}
			<div class="sisa-form">
				<KioskNumberField id="input-sisa-batch" bind:value={kg} judul="Berat sisa batch" satuan="kg" desimal={true} />
				<input class="sisa-input" type="text" maxlength="100" placeholder="Lokasi simpan (mis. Drum A2 / Rak 3)" bind:value={location} />
				{#if error}<p class="sisa-error">{error}</p>{/if}
				<button type="button" class="sisa-save" disabled={saving} onclick={simpan}>
					{#if saving}<IconLoader2 size={20} class="spin" /> Menyimpan...{:else}Simpan Sisa Batch{/if}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.sisa-card {
		border: 2px dashed #94a3b8;
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		background: #f8fafc;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sisa-toggle {
		min-height: 56px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.125rem;
		font-weight: 700;
		color: #0f172a;
		background: transparent;
		border: 0;
		text-align: left;
	}
	.sisa-badge {
		margin-left: auto;
		font-size: 0.8rem;
		background: #dcfce7;
		color: #166534;
		border-radius: 999px;
		padding: 0.125rem 0.625rem;
	}
	.sisa-hint {
		font-size: 0.85rem;
		color: #475569;
		margin: 0;
	}
	.sisa-list {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.95rem;
		color: #166534;
	}
	.sisa-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sisa-input {
		min-height: 56px;
		font-size: 1.125rem;
		padding: 0.5rem 1rem;
		border: 2px solid #cbd5e1;
		border-radius: 0.75rem;
	}
	.sisa-save {
		min-height: 60px;
		font-size: 1.125rem;
		font-weight: 700;
		color: white;
		background: #0369a1;
		border: 0;
		border-radius: 0.75rem;
	}
	.sisa-save:disabled {
		opacity: 0.6;
	}
	.sisa-error {
		color: #b91c1c;
		margin: 0;
		font-size: 0.9rem;
	}
</style>
