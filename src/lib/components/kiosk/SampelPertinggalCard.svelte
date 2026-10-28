<!-- src/lib/components/kiosk/SampelPertinggalCard.svelte -->
<!-- Fase 6C — "Sampel Pertinggal" (retained sample). QC mencatat nomor botol + rak arsip untuk batch ini.
  Dibutuhkan investigasi bila ada komplain pelanggan. Tidak mengubah stok/status SPK. -->
<script lang="ts">
	import { IconFlask, IconLoader2, IconCheck } from '@tabler/icons-svelte';

	interface Props {
		spkId: number | null;
	}
	let { spkId }: Props = $props();

	let open = $state(false);
	let botolNo = $state('');
	let rakNo = $state('');
	let saving = $state(false);
	let error = $state('');
	let saved = $state<{ id: number; botol_no: string; rak_no: string }[]>([]);
	let txnId = $state(crypto.randomUUID());

	async function load() {
		if (!spkId) {
			saved = [];
			return;
		}
		try {
			const res = await fetch(`/api/kiosk/qc/sampel-pertinggal?spkId=${spkId}`);
			if (res.ok) saved = (await res.json()).data || [];
		} catch {
			/* daftar opsional — gagal muat tidak mengganggu input QC */
		}
	}

	$effect(() => {
		spkId; // muat ulang saat SPK berganti
		open = false;
		botolNo = '';
		rakNo = '';
		error = '';
		txnId = crypto.randomUUID();
		load();
	});

	async function simpan() {
		if (!spkId || saving) return;
		if (!botolNo.trim() || !rakNo.trim()) {
			error = 'Isi nomor botol dan nomor rak dulu.';
			return;
		}
		saving = true;
		error = '';
		try {
			const res = await fetch('/api/kiosk/qc/sampel-pertinggal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ spkId, botolNo, rakNo, clientTxnId: txnId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
			botolNo = '';
			rakNo = '';
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
	<div class="sp-card">
		<button type="button" class="sp-toggle" onclick={() => (open = !open)} aria-expanded={open}>
			<IconFlask size={22} />
			<span>Sampel Pertinggal</span>
			{#if saved.length}<span class="sp-badge">{saved.length} tercatat</span>{/if}
		</button>
		<p class="sp-hint">Ambil satu botol sampel dari batch ini, simpan di rak arsip QC, lalu catat nomor botol dan rak-nya. Dipakai bila ada komplain pelanggan.</p>

		{#if saved.length}
			<ul class="sp-list">
				{#each saved as s (s.id)}
					<li><IconCheck size={16} /> Botol {s.botol_no} · Rak {s.rak_no}</li>
				{/each}
			</ul>
		{/if}

		{#if open}
			<div class="sp-form">
				<input class="sp-input" type="text" maxlength="60" placeholder="Nomor / label botol" bind:value={botolNo} />
				<input class="sp-input" type="text" maxlength="60" placeholder="Nomor rak arsip QC" bind:value={rakNo} />
				{#if error}<p class="sp-error">{error}</p>{/if}
				<button type="button" class="sp-save" disabled={saving} onclick={simpan}>
					{#if saving}<IconLoader2 size={20} /> Menyimpan...{:else}Simpan Sampel Pertinggal{/if}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.sp-card {
		border: 2px dashed #94a3b8;
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		background: #f8fafc;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.sp-toggle {
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
	.sp-badge {
		margin-left: auto;
		font-size: 0.8rem;
		background: #dcfce7;
		color: #166534;
		border-radius: 999px;
		padding: 0.125rem 0.625rem;
	}
	.sp-hint {
		font-size: 0.85rem;
		color: #475569;
		margin: 0;
	}
	.sp-list {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.95rem;
		color: #166534;
	}
	.sp-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sp-input {
		min-height: 56px;
		font-size: 1.125rem;
		padding: 0.5rem 1rem;
		border: 2px solid #cbd5e1;
		border-radius: 0.75rem;
	}
	.sp-save {
		min-height: 60px;
		font-size: 1.125rem;
		font-weight: 700;
		color: white;
		background: #0369a1;
		border: 0;
		border-radius: 0.75rem;
	}
	.sp-save:disabled {
		opacity: 0.6;
	}
	.sp-error {
		color: #b91c1c;
		margin: 0;
		font-size: 0.9rem;
	}
</style>
