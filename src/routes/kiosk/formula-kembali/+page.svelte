<script lang="ts">
	// src/routes/kiosk/formula-kembali/+page.svelte
	// FSM-02 Fase 3 — operator menandai formula/lembar kerja fisik SUDAH KEMBALI ke PPIC.
	// Dua jalur: (1) pindai QR SPK di lembar kerja dengan scanner kiosk, (2) pilih dari daftar "menunggu formula".
	// Hanya mencatat — tidak memblokir produksi. Sesi kiosk badge+PIN memastikan pencatat selalu terisi.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconRefresh, IconCheck, IconQrcode } from '@tabler/icons-svelte';

	type Item = { id: number; nomor: string; status: string; product: string; customer: string; days: number | null };
	type Detail = Item & { returned: boolean; returned_at: string | null; returned_by: string | null };

	let items = $state<Item[]>([]);
	let total = $state(0);
	let enabled = $state(true);
	let loading = $state(true);
	let err = $state('');
	let info = $state('');
	let scanText = $state('');
	let detail = $state<Detail | null>(null);
	let busy = $state(false);
	let scanEl: HTMLInputElement | undefined = $state();

	async function api(path: string, init?: RequestInit) {
		const res = await fetch(path, init);
		const d = await res.json().catch(() => null);
		if (!res.ok) throw new Error(d?.message || `Gagal (HTTP ${res.status}).`);
		return d;
	}

	async function load() {
		loading = true;
		try {
			const d = await api('/api/kiosk/formula-kembali');
			items = d.items || [];
			total = Number(d.total) || 0;
			enabled = d.enabled !== false;
			err = '';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal memuat.';
		} finally {
			loading = false;
		}
	}

	async function onScan() {
		const raw = scanText.trim();
		scanText = '';
		if (!raw) return;
		info = '';
		err = '';
		try {
			const d = await api(`/api/kiosk/formula-kembali?spk=${encodeURIComponent(raw)}`);
			detail = d.spk;
		} catch (e) {
			detail = null;
			err = e instanceof Error ? e.message : 'Gagal membaca QR.';
		}
		scanEl?.focus();
	}

	async function mark(spkId: number, via: 'scan' | 'manual') {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const d = await api('/api/kiosk/formula-kembali', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ spkId, via })
			});
			info = d.changed
				? `✓ Formula SPK #${spkId} tercatat kembali.${d.eventLogged === false ? ' (Catatan riwayat gagal tersimpan — beri tahu PPIC.)' : ''}`
				: `Formula SPK #${spkId} sudah tercatat kembali${d.by ? ` oleh ${d.by}` : ''} — tidak ada yang diubah.`;
			detail = null;
			await load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal menyimpan.';
		} finally {
			busy = false;
			scanEl?.focus();
		}
	}

	onMount(() => {
		load();
		scanEl?.focus();
	});
</script>

<div class="wrap">
	<header>
		<button class="back" onclick={() => goto('/kiosk/home')}><IconArrowLeft size={18} /> Kembali</button>
		<h1>Formula Kembali</h1>
		<button class="back" onclick={load} disabled={loading} aria-label="Muat ulang"><IconRefresh size={18} /></button>
	</header>

	<section class="how" aria-label="Cara pakai">
		<b>Cara pakai:</b> ① Kembalikan formula fisik ke PPIC → ② Pindai QR di lembar kerja (kotak "Scan di Kiosk Produksi") atau pilih SPK di daftar → ③ Cek nomor SPK, tekan <b>Formula Sudah Kembali</b>.
		Ini hanya pencatatan — produksi tetap bisa dimulai.
	</section>

	{#if !enabled}<div class="warn">Pelacakan formula sedang dinonaktifkan admin. Tidak perlu mencatat.</div>{/if}
	{#if err}<div class="err" role="alert">{err}</div>{/if}
	{#if info}<div class="ok" role="status">{info}</div>{/if}

	<label class="scan">
		<IconQrcode size={22} />
		<input
			bind:this={scanEl}
			bind:value={scanText}
			onkeydown={(e) => e.key === 'Enter' && onScan()}
			placeholder="Arahkan scanner ke QR SPK… (atau ketik nomor lalu Enter)"
			autocomplete="off"
			inputmode="text"
			disabled={!enabled}
		/>
	</label>

	{#if detail}
		<div class="confirm">
			<div class="big">{detail.nomor}</div>
			<div class="meta">{detail.product || '—'} · {detail.customer || '—'}</div>
			{#if detail.returned}
				<div class="note">Sudah tercatat kembali{detail.returned_by ? ` oleh ${detail.returned_by}` : ''}{detail.returned_at ? ` (${new Date(detail.returned_at).toLocaleString('id-ID')})` : ''}.</div>
				<button class="btn ghost" onclick={() => (detail = null)}>Tutup</button>
			{:else if detail.status !== 'worksheet_generated' && detail.status !== 'waiting_for_stock'}
				<div class="note">Status SPK: {detail.status}. Formula hanya dicatat untuk SPK yang belum mulai produksi.</div>
				<button class="btn ghost" onclick={() => (detail = null)}>Tutup</button>
			{:else}
				<div class="meta">Menunggu formula {detail.days ?? '—'} hari</div>
				<button class="btn go" disabled={busy || !enabled} onclick={() => mark(detail.id, 'scan')}><IconCheck size={22} /> {busy ? 'Menyimpan…' : 'Formula Sudah Kembali'}</button>
				<button class="btn ghost" onclick={() => (detail = null)}>Batal</button>
			{/if}
		</div>
	{/if}

	<h2>Menunggu formula ({total})</h2>
	{#if loading && items.length === 0}
		<div class="empty">Memuat…</div>
	{:else if items.length === 0}
		<div class="empty">Tidak ada SPK yang menunggu formula. 🎉</div>
	{:else}
		<ul class="list">
			{#each items as it (it.id)}
				<li class="row">
					<div class="info">
						<div class="no">{it.nomor}</div>
						<div class="meta">{it.product || '—'} · {it.customer || '—'}</div>
					</div>
					<span class="age" class:late={(it.days ?? 0) >= 3}>{it.days ?? '—'} hari</span>
					<button class="btn go sm" disabled={busy || !enabled} onclick={() => mark(it.id, 'manual')}>Tandai Kembali</button>
				</li>
			{/each}
		</ul>
		{#if total > items.length}<div class="empty">Menampilkan {items.length} terlama dari {total}.</div>{/if}
	{/if}
</div>

<style>
	.wrap { min-height: 100vh; background: #0f172a; color: #e2e8f0; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
	header { display: flex; align-items: center; gap: 1rem; }
	header h1 { font-size: 1.5rem; margin: 0; flex: 1; }
	.back { display: inline-flex; align-items: center; gap: 0.3rem; background: none; border: none; color: #94a3b8; font-size: 0.9rem; min-height: 44px; }
	.how { background: #1e293b; border-radius: 0.6rem; padding: 0.6rem 0.8rem; font-size: 0.85rem; color: #cbd5e1; }
	.warn { background: #78350f; color: #fde68a; padding: 0.5rem 0.75rem; border-radius: 0.5rem; }
	.err { background: #7f1d1d; color: #fecaca; padding: 0.5rem 0.75rem; border-radius: 0.5rem; }
	.ok { background: #14532d; color: #bbf7d0; padding: 0.5rem 0.75rem; border-radius: 0.5rem; }
	.scan { display: flex; align-items: center; gap: 0.6rem; background: #1e293b; border: 2px solid #334155; border-radius: 0.7rem; padding: 0.6rem 0.8rem; }
	.scan input { flex: 1; background: transparent; border: none; outline: none; color: #f8fafc; font-size: 1.05rem; }
	.confirm { background: #1e293b; border: 2px solid #22c55e; border-radius: 0.8rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.big { font-size: 1.8rem; font-weight: 800; }
	.meta { color: #94a3b8; font-size: 0.9rem; }
	.note { color: #fde68a; }
	h2 { font-size: 1rem; margin: 0.5rem 0 0; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.03em; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	.row { display: flex; align-items: center; gap: 0.75rem; background: #1e293b; border-radius: 0.6rem; padding: 0.5rem 0.75rem; }
	.info { flex: 1; min-width: 0; }
	.no { font-weight: 700; }
	.age { font-size: 0.85rem; color: #fbbf24; white-space: nowrap; }
	.age.late { color: #f87171; font-weight: 700; }
	.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; border: none; border-radius: 0.6rem; font-weight: 700; min-height: 48px; padding: 0 1rem; }
	.btn.go { background: #16a34a; color: #fff; font-size: 1.1rem; }
	.btn.go.sm { font-size: 0.9rem; min-height: 44px; }
	.btn.ghost { background: #334155; color: #e2e8f0; }
	.btn:disabled { opacity: 0.5; }
	.empty { color: #94a3b8; padding: 0.75rem 0; text-align: center; }
</style>
