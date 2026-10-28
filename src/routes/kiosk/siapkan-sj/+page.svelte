<script lang="ts">
	// src/routes/kiosk/siapkan-sj/+page.svelte
	// SJH-07 §4.3 — Kiosk Gudang: "Siapkan SJ" = TTD #1 "Disiapkan oleh". Cari SJ dengan NOMOR
	// (SJ belum tercetak, QR belum ada), cocokkan barang, lalu tandai sudah disiapkan.
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconCheck, IconLoader2, IconAlertTriangle, IconSearch } from '@tabler/icons-svelte';

	let nomor = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let err = $state('');
	let info = $state('');
	let target = $state<any>(null);
	let catatan = $state('');
	let checked = $state<Record<number, boolean>>({});

	const allChecked = $derived(!!target && target.items.length > 0 && target.items.every((it: any) => checked[it.id]));

	function reset() {
		target = null; nomor = ''; catatan = ''; checked = {};
	}

	async function cari() {
		const q = nomor.trim();
		if (q.length < 3 || loading) return;
		loading = true; err = ''; info = '';
		try {
			const res = await fetch(`/api/kiosk/siapkan-sj?nomor=${encodeURIComponent(q)}`);
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal mencari SJ.');
			target = d; checked = {}; catatan = '';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
			target = null;
		} finally {
			loading = false;
		}
	}

	async function simpan() {
		if (!target || saving || !allChecked) return;
		saving = true; err = '';
		try {
			const res = await fetch('/api/kiosk/siapkan-sj', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sjId: target.sj.id, catatan: catatan.trim() || undefined })
			});
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal menyimpan.');
			info = `${target.sj.nomor_sj} ditandai sudah disiapkan. Admin sekarang bisa memverifikasi dan mencetak.`;
			reset();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/home')}><IconArrowLeft size={18} /> Kembali</button>
	<h1 title="Ini TTD #1 di Surat Jalan: menandai barang sudah lengkap dan siap dimuat.">Siapkan Surat Jalan</h1>
	<p class="hint">Tandai SJ sudah disiapkan <b>setelah semua barang terkumpul di area muat</b>. Ini TTD #1 (&quot;Disiapkan oleh&quot;) di SJ. SJ yang belum tercetak dicari dengan nomornya.</p>

	{#if err}<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>{/if}
	{#if info}<div class="banner ok"><IconCheck size={18} /> {info}</div>{/if}

	{#if !target}
		<div class="manual">
			<input placeholder="Nomor SJ (mis. SJ/261006/001)" bind:value={nomor} onkeydown={(e) => e.key === 'Enter' && cari()} />
			<button onclick={cari} disabled={loading || nomor.trim().length < 3}>
				{#if loading}<IconLoader2 size={18} class="spin" />{:else}<IconSearch size={18} />{/if} Cari
			</button>
		</div>
	{:else}
		<div class="card">
			<div class="sjno">{target.sj.nomor_sj}</div>
			<div class="sub">{target.sj.tujuan || 'Tujuan —'}</div>

			{#if target.state === 'ditolak'}
				<div class="banner err"><IconAlertTriangle size={18} /> {target.alasan}</div>
				<button class="batal" onclick={reset}>Cari SJ lain</button>
			{:else if target.state === 'sudah'}
				<div class="banner ok"><IconCheck size={18} /> Sudah disiapkan oleh <b>{target.existing?.by_name}</b>. Tidak perlu diulang.</div>
				<button class="batal" onclick={reset}>Cari SJ lain</button>
			{:else}
				{#if target.items.length === 0}
					<div class="banner err"><IconAlertTriangle size={18} /> SJ ini belum punya baris barang. Hubungi admin logistik.</div>
				{:else}
					<p class="hint2">Centang tiap barang yang sudah ada di area muat:</p>
					<ul class="items">
						{#each target.items as it (it.id)}
							<li>
								<label>
									<input type="checkbox" bind:checked={checked[it.id]} />
									<span class="nm">{it.nama_barang || 'Barang tanpa nama'}</span>
									<span class="qty">{(Number(it.qty_delivered) > 0 ? it.qty_delivered : (it.qty_required ?? it.qty ?? '—'))} {it.unit || ''}</span>
								</label>
							</li>
						{/each}
					</ul>
					<textarea rows="2" placeholder="Catatan (opsional, mis. jumlah koli)" bind:value={catatan}></textarea>
				{/if}
				<div class="actions">
					<button class="batal" onclick={reset} disabled={saving}>Batal</button>
					<button class="ok" onclick={simpan} disabled={saving || !allChecked}
						title={allChecked ? '' : 'Centang semua barang dulu'}>
						{#if saving}<IconLoader2 size={20} class="spin" />{:else}<IconCheck size={20} />{/if}
						Sudah Disiapkan
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.wrap { max-width: 560px; margin: 0 auto; padding: 1rem; }
	.back { display: inline-flex; align-items: center; gap: 0.35rem; background: none; border: none; color: #475569; font-size: 0.9rem; margin-bottom: 0.5rem; }
	h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
	.hint { font-size: 0.85rem; color: #64748b; margin: 0 0 1rem; }
	.hint2 { font-size: 0.85rem; color: #475569; margin: 0.5rem 0 0.25rem; }
	.banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; font-size: 0.85rem; margin-bottom: 0.6rem; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.banner.ok { background: #f0fdf4; color: #15803d; }
	.manual { display: flex; gap: 0.5rem; }
	.manual input { flex: 1; padding: 0.9rem; border: 1px solid #cbd5e1; border-radius: 0.7rem; font-size: 1rem; }
	.manual button { display: flex; align-items: center; gap: 0.35rem; padding: 0 1.1rem; border: none; border-radius: 0.7rem; background: #2563eb; color: #fff; font-weight: 700; }
	.manual button:disabled { background: #cbd5e1; }
	.card { border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1rem; background: #fff; }
	.sjno { font-size: 1.25rem; font-weight: 700; }
	.sub { font-size: 0.85rem; color: #64748b; margin-bottom: 0.5rem; }
	.items { list-style: none; padding: 0; margin: 0; }
	.items li { border-bottom: 1px solid #f1f5f9; }
	.items label { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem 0.2rem; font-size: 1rem; }
	.items input { width: 1.4rem; height: 1.4rem; }
	.nm { flex: 1; }
	.qty { color: #64748b; font-size: 0.9rem; }
	textarea { width: 100%; margin-top: 0.6rem; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; font-size: 0.9rem; resize: vertical; }
	.actions { display: flex; gap: 0.6rem; margin-top: 0.9rem; }
	.batal, .ok { flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem; padding: 1rem; border: none; border-radius: 0.75rem; font-size: 1rem; font-weight: 700; }
	.batal { background: #f1f5f9; color: #475569; }
	.ok { background: #16a34a; color: #fff; }
	.ok:disabled { background: #cbd5e1; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
