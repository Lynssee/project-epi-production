<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/cek-stok/+page.svelte
	// Hub Cek Stok terminal Kiosk Gudang: scan QR rak / input manual / cari barang lintas rak.
	// Read-only — tidak ada form submit. Fase 1, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		IconArrowLeft, IconQrcode, IconSearch, IconLoader2, IconChevronRight, IconPackageOff, IconX
	} from '@tabler/icons-svelte';

	type Kategori = 'fg' | 'rm' | 'lainnya';
	interface Hit {
		identitas_barang_id: number;
		nama_barang: string;
		kode_item: string | null;
		satuan: string | null;
		kategori: Kategori;
		gudang_id: number;
		rak_nama: string;
		rak_kode: string | null;
		parent_nama: string | null;
		expected_qty: number | null;
		ledger_qty: number | null;
	}

	const KATEGORI_LABEL: Record<Kategori, string> = {
		fg: 'Finished Good',
		rm: 'Raw Material',
		lainnya: 'Lainnya'
	};

	let QrScannerModal = $state<any>(null);
	async function loadScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let showScanner = $state(false);
	let scanError = $state('');

	function onScanDetect(raw: string) {
		showScanner = false;
		scanError = '';
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'LOC') {
			scanError = 'Itu bukan QR rak. Arahkan kamera ke label QR yang menempel di rak.';
			return;
		}
		goto(`/kiosk/cek-stok/${parsed.id}`);
	}

	let manualCode = $state('');
	function bukaManual() {
		let t = manualCode.trim();
		if (!t) return;
		scanError = '';
		t = t.replace(/[\r\n\t]+/g, '').trim();

		if (/^\d+$/.test(t)) {
			goto(`/kiosk/cek-stok/${t}`);
			return;
		}

		const urlMatch = t.match(/\/cek-stok\/(\d+)/i);
		if (urlMatch) {
			goto(`/kiosk/cek-stok/${urlMatch[1]}`);
			return;
		}

		const locMatch = t.match(/^LOC:(\d+)$/i);
		if (locMatch) {
			goto(`/kiosk/cek-stok/${locMatch[1]}`);
			return;
		}

		const parsed = parseEpiQr(t);
		if (parsed?.type === 'LOC') {
			goto(`/kiosk/cek-stok/${parsed.id}`);
		} else {
			scanError = 'Masukkan ID rak (angka) atau kode EPI:LOC:...';
		}
	}

	// --- Cari barang ---
	let q = $state('');
	let searching = $state(false);
	let searchError = $state('');
	let hits = $state<Hit[]>([]);
	let searched = $state(false);
	let filter = $state<'semua' | Kategori>('semua');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	let hasRm = $derived(hits.some((h) => h.kategori === 'rm'));
	let chipOptions: Array<'semua' | Kategori> = $derived(
		hasRm ? ['semua', 'fg', 'rm', 'lainnya'] : ['semua', 'fg', 'lainnya']
	);
	let filteredHits = $derived(
		filter === 'semua' ? hits : hits.filter((h) => h.kategori === filter)
	);

	async function runSearch() {
		const term = q.trim();
		searchError = '';
		if (term.length < 2) {
			hits = [];
			searched = false;
			return;
		}
		searching = true;
		try {
			const res = await fetch(`/api/kiosk/stok/cari?q=${encodeURIComponent(term)}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Pencarian gagal.');
			hits = data.hits || [];
			searched = true;
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Pencarian gagal.';
			hits = [];
		} finally {
			searching = false;
		}
	}

	function onQInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(runSearch, 400);
	}

	onMount(() => {
		const paramQ = page.url.searchParams.get('q');
		if (paramQ && paramQ.trim().length >= 2) {
			q = paramQ.trim();
			runSearch();
		}

		function onHardwareScan(e: Event) {
			const custom = e as CustomEvent<{ code: string }>;
			if (custom.detail?.code) {
				const code = custom.detail.code.trim();
				const parsed = parseEpiQr(code);
				if (parsed?.type === 'LOC') {
					goto(`/kiosk/cek-stok/${parsed.id}`);
					e.preventDefault();
					return;
				}
				q = code;
				runSearch();
				e.preventDefault();
			}
		}
		window.addEventListener('kiosk-hardware-scan', onHardwareScan);

		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			window.removeEventListener('kiosk-hardware-scan', onHardwareScan);
		};
	});
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/home')}>
		<IconArrowLeft size={18} /> Kembali
	</button>

	<h1>Cek Stok Rak</h1>
	<p class="hint">
		Lihat isi rak dan qty barang. Scan QR di rak, atau cari nama/kode barang untuk tahu ada di rak mana.
		Halaman ini hanya untuk melihat — tidak mengubah stok.
	</p>

	<button class="scan-btn" onclick={async () => { await loadScanner(); scanError = ''; showScanner = true; }}>
		<IconQrcode size={40} />
		Scan QR Rak
	</button>
	{#if scanError}
		<p class="err">{scanError}</p>
	{/if}

	<div class="or"><span>atau</span></div>

	<div class="field">
		<label for="manual">Input ID / Kode Rak</label>
		<div class="row">
			<div class="input-wrap">
				<input
					id="manual"
					type="text"
					placeholder="mis. 42 atau EPI:LOC:42"
					bind:value={manualCode}
					onkeydown={(e) => { if (e.key === 'Enter') bukaManual(); }}
				/>
				{#if manualCode}
					<button class="clear-btn" onclick={() => { manualCode = ''; scanError = ''; }} aria-label="Hapus input rak">
						<IconX size={16} />
					</button>
				{/if}
			</div>
			<button class="go" onclick={bukaManual}>Buka</button>
		</div>
	</div>

	<div class="field">
		<label for="cari">Cari Barang</label>
		<div class="row">
			<div class="input-wrap search-wrap">
				<span class="ic"><IconSearch size={18} /></span>
				<input
					id="cari"
					type="text"
					placeholder="Nama atau kode barang"
					bind:value={q}
					oninput={onQInput}
					onkeydown={(e) => { if (e.key === 'Enter') { if (debounceTimer) clearTimeout(debounceTimer); runSearch(); } }}
				/>
				{#if q}
					<button class="clear-btn" onclick={() => { q = ''; hits = []; searched = false; }} aria-label="Hapus pencarian">
						<IconX size={16} />
					</button>
				{/if}
			</div>
		</div>
	</div>

	{#if searched || searching}
		<div class="chips">
			{#each chipOptions as c}
				<button class="chip" class:active={filter === c} onclick={() => (filter = c)}>
					{c === 'semua' ? 'Semua' : KATEGORI_LABEL[c]}
				</button>
			{/each}
		</div>
	{/if}

	{#if searching}
		<div class="center py-6 flex justify-center">
			<CircularProgressGauge size={64} strokeWidth={5} label="Mencari Stok Rak..." sublabel="Mengecek persediaan gudang" />
		</div>
	{:else if searchError}
		<p class="err">{searchError}</p>
	{:else if searched && filteredHits.length === 0}
		<div class="empty">
			<IconPackageOff size={28} />
			<p>Tidak ada rak yang punya barang ini{filter !== 'semua' ? ` di kategori ${KATEGORI_LABEL[filter as Kategori]}` : ''}.</p>
		</div>
	{:else if filteredHits.length > 0}
		<div class="list">
			{#each filteredHits as h (h.gudang_id + '-' + h.identitas_barang_id)}
				<button class="hit" onclick={() => goto(`/kiosk/cek-stok/${h.gudang_id}`)}>
					<div class="hit-main">
						<div class="hit-top">
							<span class="hit-nama">{h.nama_barang}</span>
							{#if h.kategori !== 'lainnya'}
								<span class="cat-pill cat-pill--{h.kategori}">{KATEGORI_LABEL[h.kategori]}</span>
							{/if}
						</div>
						<div class="hit-meta">
							{#if h.kode_item}<span class="hit-kode">{h.kode_item}</span>{/if}
							<span class="hit-loc">
								{h.rak_nama}{h.parent_nama ? ` · ${h.parent_nama}` : ''}
							</span>
						</div>
					</div>
					<div class="hit-qty">
						<span class="qty">{h.ledger_qty ?? '–'}</span>
						<span class="sat">{h.satuan || ''}</span>
						{#if h.expected_qty != null}
							<span class="exp-hint">Rencana: {h.expected_qty}</span>
						{/if}
					</div>
					<IconChevronRight size={18} class="hit-arrow" />
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.back {
		align-self: flex-start; display: flex; align-items: center; gap: 0.4rem;
		background: none; border: none; color: #475569; font-size: 0.95rem; font-weight: 600;
		cursor: pointer; padding: 0;
	}
	h1 { font-size: 1.4rem; font-weight: 800; color: #0f172a; margin: 0; }
	.hint { font-size: 0.9rem; color: #64748b; margin: 0; line-height: 1.4; }
	.scan-btn {
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;
		min-height: 120px; border-radius: 1rem; border: none; cursor: pointer;
		background: #ea580c; color: white; font-size: 1.15rem; font-weight: 800;
		transition: transform 0.1s ease, background-color 0.15s ease;
	}
	.scan-btn:active { transform: scale(0.985); background: #c2410c; }
	.or { display: flex; align-items: center; gap: 0.75rem; color: #94a3b8; }
	.or::before, .or::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }
	.or span { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
	.field { display: flex; flex-direction: column; gap: 0.4rem; }
	.field label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; }
	.row { display: flex; gap: 0.5rem; align-items: center; }
	.input-wrap {
		flex: 1; position: relative; display: flex; align-items: center; min-width: 0;
		background: white; border: 1px solid #cbd5e1; border-radius: 0.6rem;
	}
	.input-wrap:focus-within { border-color: #0f766e; box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15); }
	.input-wrap input {
		flex: 1; border: none; outline: none; padding: 0.75rem 0.9rem;
		font-size: 1rem; min-width: 0; background: transparent; color: #0f172a;
	}
	.search-wrap .ic { display: flex; align-items: center; padding-left: 0.8rem; color: #94a3b8; }
	.search-wrap input { padding-left: 0.5rem; }
	.clear-btn {
		background: none; border: none; color: #94a3b8; padding: 0 0.6rem;
		cursor: pointer; display: flex; align-items: center; justify-content: center; height: 100%;
	}
	.clear-btn:hover { color: #475569; }
	.go {
		border: none; border-radius: 0.6rem; background: #0f766e; color: white;
		font-weight: 700; font-size: 0.95rem; padding: 0.75rem 1.25rem; cursor: pointer;
		white-space: nowrap; transition: background-color 0.15s ease;
	}
	.go:hover { background: #115e59; }
	.chips { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.chip {
		border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 999px;
		padding: 0.4rem 0.9rem; font-size: 0.85rem; font-weight: 700; cursor: pointer;
	}
	.chip.active { background: #0f172a; color: white; border-color: #0f172a; }
	.center { display: flex; justify-content: center; padding: 2rem; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.err { color: #dc2626; font-size: 0.85rem; text-align: center; margin: 0; }
	.empty {
		display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
		padding: 2rem 1rem; color: #94a3b8; text-align: center;
	}
	.empty p { margin: 0; font-size: 0.9rem; }
	.list { display: flex; flex-direction: column; gap: 0.5rem; }
	.hit {
		display: flex; align-items: center; gap: 0.75rem; width: 100%; text-align: left;
		background: white; border: 1px solid #e2e8f0; border-radius: 0.75rem;
		padding: 0.85rem 1rem; cursor: pointer; transition: all 0.15s ease;
	}
	.hit:hover { border-color: #cbd5e1; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
	.hit:active { transform: scale(0.99); }
	.hit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
	.hit-top { display: flex; align-items: center; gap: 0.45rem; }
	.hit-nama { font-size: 0.95rem; font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cat-pill { font-size: 0.65rem; font-weight: 800; padding: 0.1rem 0.4rem; border-radius: 4px; flex-shrink: 0; text-transform: uppercase; }
	.cat-pill--fg { background: #e0e7ff; color: #3730a3; }
	.cat-pill--rm { background: #fef3c7; color: #92400e; }
	.hit-meta { display: flex; align-items: center; gap: 0.5rem; }
	.hit-kode { font-size: 0.72rem; font-family: monospace; background: #f1f5f9; color: #475569; padding: 0.05rem 0.35rem; border-radius: 3px; }
	.hit-loc { font-size: 0.8rem; color: #64748b; }
	.hit-qty { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
	.hit-qty .qty { font-size: 1.15rem; font-weight: 800; color: #0f766e; }
	.hit-qty .sat { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; }
	.exp-hint { font-size: 0.68rem; color: #64748b; margin-top: 0.15rem; }
	:global(.hit-arrow) { color: #cbd5e1; flex-shrink: 0; }
</style>
