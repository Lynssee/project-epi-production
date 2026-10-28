<!-- src/lib/components/TunggakanFisikWidget.svelte
     Penajaman Gate SJ Fase 3 — "Tunggakan Fisik Saya": SJ milik Anda yang barangnya sudah diterima tetapi berkas
     fisiknya (foto SJ bertanda tangan / lembar untuk admin) belum kembali. Komponen mandiri & non-blocking
     (pola sama PengecualianProyekWidget): tidak tampil bila tidak ada tunggakan atau gagal muat. Informatif saja,
     tidak mematikan tombol apa pun. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authedJson } from '$lib/services/sjTunggakan';

	/** compact = banner kecil di dalam form; default = kartu beranda. */
	let { compact = false }: { compact?: boolean } = $props();

	interface Row { id: number | string; nomor_sj: string; ageDays: number; reasons: string[] }
	let info = $state<{ enabled: boolean; count: number; quota: number; graceDays: number; over: boolean; rows: Row[] } | null>(null);

	onMount(async () => {
		try {
			info = await authedJson('/api/lacak-sj/tunggakan');
		} catch (e) {
			console.warn('[TunggakanFisikWidget] gagal memuat:', e instanceof Error ? e.message : e);
		}
	});

	const show = $derived(!!info?.enabled && (info?.count ?? 0) > 0);
	const sisa = $derived(info ? Math.max(0, info.quota - info.count) : 0);
</script>

{#if show && info}
	<div class="tf" class:over={info.over} class:compact role="status">
		<p class="tf-title">
			{info.count} Surat Jalan Anda belum diserahkan berkas fisiknya
		</p>
		<p class="tf-sub">
			{#if info.over}
				Melebihi batas {info.quota} SJ — pengajuan/cetak SJ baru bisa tertahan sampai berkas diserahkan.
			{:else}
				Batas {info.quota} SJ, sisa {sisa}. Foto SJ bertanda tangan paling lambat {info.graceDays} hari kerja setelah barang tiba.
			{/if}
		</p>
		{#if !compact}
			<ul class="tf-list">
				{#each info.rows.slice(0, 3) as r (r.id)}
					<li>
						<button class="tf-link" onclick={() => goto(`/lacak-sj/${r.id}`)}>{r.nomor_sj}</button>
						<span class="tf-age">{r.ageDays} hari kerja</span>
					</li>
				{/each}
			</ul>
			<p class="tf-hint">Ketuk nomor SJ → "Foto SJ Fisik" untuk mengunggah bukti.</p>
			<button class="tf-btn" onclick={() => goto('/lacak-sj/serah-berkas')} title="Tunjukkan QR ke admin; admin scan, berkas langsung tercatat diterima">Serahkan Berkas ke Admin (QR)</button>
		{/if}
	</div>
{/if}

<style>
	.tf { border: 1px solid #fde68a; background: #fffbeb; color: #92400e; border-radius: 0.75rem; padding: 0.7rem 0.85rem; margin: 0.5rem 0; }
	.tf.over { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
	.tf.compact { padding: 0.5rem 0.7rem; }
	.tf-title { font-size: 0.85rem; font-weight: 700; margin: 0; }
	.tf-sub { font-size: 0.75rem; margin: 0.15rem 0 0; opacity: 0.85; }
	.tf-list { list-style: none; padding: 0; margin: 0.4rem 0 0; font-size: 0.8rem; }
	.tf-list li { display: flex; justify-content: space-between; padding: 0.15rem 0; }
	.tf-link { background: none; border: none; padding: 0; font-weight: 700; text-decoration: underline; color: inherit; }
	.tf-age { opacity: 0.7; }
	.tf-btn { margin-top: 0.5rem; width: 100%; padding: 0.55rem; border-radius: 0.6rem; border: 1px solid currentColor; background: #fff; font-size: 0.8rem; font-weight: 700; color: inherit; }
	.tf-hint { font-size: 0.7rem; margin: 0.35rem 0 0; opacity: 0.7; }
</style>
