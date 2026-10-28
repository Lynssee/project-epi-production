<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/cek-stok/[gudang_id]/+page.svelte
	// Detail satu rak untuk terminal Kiosk Gudang.
	// Fase 1: lihat isi rak (read-only) — qty rencana vs qty sistem (ledger), warna status, PIC (WA).
	// Fase 2: aksi "Pindahkan ke rak lain" per item — eksekusi langsung, atribusi badge, BUKAN
	//   pengeluaran barang (stok global tetap, hanya qty antar rak bergeser).
	// Rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).
	// Kelola Rak: tambah item ke rak, lepas item dari rak, pindah LOKASI penempatan tanpa qty
	//   (untuk item yang stok tercatatnya kosong). Hanya master penempatan, tidak menulis stok.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		IconArrowLeft, IconLoader2, IconPhone, IconRefresh, IconArrowsExchange,
		IconQrcode, IconX, IconCircleCheck, IconClock, IconAlertTriangle, IconSearch, IconExternalLink,
		IconSettings, IconPlus, IconTrash, IconCheck
	} from '@tabler/icons-svelte';

	type Kategori = 'fg' | 'rm' | 'lainnya';
	const KATEGORI_LABEL: Record<Kategori, string> = { fg: 'FG', rm: 'RM', lainnya: '—' };

	interface Placement {
		placement_id: number;
		identitas_barang_id: number;
		nama_barang: string;
		kode_item: string | null;
		satuan: string | null;
		kategori: Kategori;
		expected_qty: number | null;
		min_qty: number | null;
		ledger_qty: number | null;
	}
	interface Pic { id: number; nama_karyawan: string; no_hp: string | null; }
	interface Detail {
		gudang: { id: number; kode_gudang: string | null; nama_gudang: string; parent_gudang_id: number | null };
		parent_nama: string | null;
		placements: Placement[];
		pics: Pic[];
		denah: { nama_denah: string } | null;
	}

	const gudangId = Number(page.params.gudang_id);
	let loading = $state(true);
	let loadError = $state('');
	let detail = $state<Detail | null>(null);
	let searchItem = $state('');

	let filteredPlacements = $derived(
		detail?.placements
			? searchItem.trim()
				? detail.placements.filter(
						(p) =>
							p.nama_barang.toLowerCase().includes(searchItem.trim().toLowerCase()) ||
							(p.kode_item && p.kode_item.toLowerCase().includes(searchItem.trim().toLowerCase()))
					)
				: detail.placements
			: []
	);

	async function load() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/kiosk/stok/rak/${gudangId}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal memuat rak (${res.status}).`);
			detail = data;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat rak.';
		} finally {
			loading = false;
		}
	}

	// Status warna: hijau = sistem == rencana; kuning = selisih <= 10% (atau <=1); merah =
	// kosong / selisih besar / di bawah min. Murni indikator visual, bukan gerbang.
	function tone(p: Placement): 'green' | 'amber' | 'red' | 'neutral' {
		if (p.ledger_qty == null) return 'neutral';
		if (p.ledger_qty <= 0) return 'red';
		if (p.min_qty != null && p.ledger_qty < p.min_qty) return 'red';
		if (p.expected_qty == null) return 'neutral';
		const diff = Math.abs(p.ledger_qty - p.expected_qty);
		if (diff === 0) return 'green';
		const tol = Math.max(1, p.expected_qty * 0.1);
		return diff <= tol ? 'amber' : 'red';
	}
	const TONE: Record<string, string> = { green: '#16a34a', amber: '#d97706', red: '#dc2626', neutral: '#94a3b8' };

	function waPic(pic: Pic) {
		if (!pic.no_hp) return;
		const num = pic.no_hp.replace(/[^0-9]/g, '').replace(/^0/, '62');
		window.open(`https://wa.me/${num}`, '_blank');
	}

	// --- Fase 2: Pindah lokasi rak ---
	let moveFor = $state<Placement | null>(null);
	let destRakId = $state('');
	let moveQty = $state<number | null>(null);
	let moveCatatan = $state('');
	let moving = $state(false);
	let moveError = $state('');
	let moveResult = $state<{
		reference_no: string;
		rak_tujuan_ledger_baru: number;
		rak_asal_sisa_ledger: number;
		flag_selisih: boolean;
		pending_approval?: boolean;
	} | null>(null);
	let moveTxnId = $state('');
	// 'lokasi' = pindah penempatan saja (tanpa qty, tidak menulis stok) — default untuk item yang
	// stok tercatatnya kosong. 'qty' = pindah dengan jumlah (transaksi TRANSFER-RAK).
	let moveMode = $state<'lokasi' | 'qty'>('qty');
	let moveLokasiResult = $state<{ digabung: boolean; rak_tujuan_nama: string } | null>(null);
	const tanpaStok = (p: Placement) => p.ledger_qty == null || p.ledger_qty <= 0;

	let QrScannerModal = $state<any>(null);
	let showDestScanner = $state(false);
	async function loadScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	function onDestScan(raw: string) {
		showDestScanner = false;
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'LOC') {
			moveError = 'Itu bukan QR rak. Arahkan ke label QR di rak tujuan.';
			return;
		}
		destRakId = String(parsed.id);
		moveError = '';
	}

	function openMove(p: Placement) {
		moveFor = p;
		destRakId = '';
		moveQty = null;
		moveCatatan = '';
		moveError = '';
		moveResult = null;
		moveLokasiResult = null;
		moveMode = tanpaStok(p) ? 'lokasi' : 'qty';
		moveTxnId =`pindahrak-${gudangId}-${p.identitas_barang_id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	}
	function closeMove() {
		moveFor = null;
		showDestScanner = false;
	}

	async function submitMove() {
		if (!moveFor) return;
		moveError = '';
		let destRaw = destRakId.trim().replace(/[\r\n\t]+/g, '');
		const parsed = parseEpiQr(destRaw);
		if (parsed?.type === 'LOC') {
			destRaw = String(parsed.id);
		} else {
			const locMatch = destRaw.match(/^LOC:(\d+)$/i);
			if (locMatch) destRaw = locMatch[1];
		}
		const dest = Number(destRaw);
		if (!Number.isFinite(dest) || dest <= 0) { moveError = 'Isi ID rak tujuan (angka) atau scan QR-nya.'; return; }
		if (dest === gudangId) { moveError = 'Rak tujuan sama dengan rak ini.'; return; }
		destRakId = String(dest);

		if (moveMode === 'lokasi') {
			moving = true;
			try {
				const res = await fetch(`/api/kiosk/stok/rak/${gudangId}/placement/${moveFor.placement_id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ rak_tujuan_id: dest })
				});
				const data = await res.json().catch(() => null);
				if (!res.ok) throw new Error(data?.message || `Gagal memindahkan (${res.status}).`);
				moveLokasiResult = { digabung: data.digabung, rak_tujuan_nama: data.rak_tujuan_nama };
				await load();
			} catch (e) {
				moveError = e instanceof Error ? e.message : 'Gagal memindahkan.';
			} finally {
				moving = false;
			}
			return;
		}

		if (!moveQty || moveQty <= 0) { moveError = 'Isi jumlah yang dipindah (lebih dari 0).'; return; }

		moving = true;
		try {
			const res = await fetch('/api/kiosk/stok/pindah-rak', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					item_id: moveFor.identitas_barang_id,
					rak_asal_id: gudangId,
					rak_tujuan_id: dest,
					qty: moveQty,
					client_txn_id: moveTxnId,
					catatan: moveCatatan.trim() || null
				})
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal memindahkan (${res.status}).`);
			moveResult = {
				reference_no: data.reference_no,
				rak_tujuan_ledger_baru: data.rak_tujuan_ledger_baru,
				rak_asal_sisa_ledger: data.rak_asal_sisa_ledger,
				flag_selisih: data.flag_selisih,
				pending_approval: !!data.pending_approval
			};
			await load();
		} catch (e) {
			moveError = e instanceof Error ? e.message : 'Gagal memindahkan.';
		} finally {
			moving = false;
		}
	}

	// --- Kelola Rak ---
	let kelola = $state(false);

	// Lepas item dari rak
	let hapusFor = $state<Placement | null>(null);
	let hapusing = $state(false);
	let hapusError = $state('');
	function openHapus(p: Placement) {
		hapusFor = p;
		hapusError = '';
	}
	async function submitHapus() {
		if (!hapusFor) return;
		hapusing = true;
		hapusError = '';
		try {
			const res = await fetch(`/api/kiosk/stok/rak/${gudangId}/placement/${hapusFor.placement_id}`, { method: 'DELETE' });
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal menghapus (${res.status}).`);
			hapusFor = null;
			await load();
		} catch (e) {
			hapusError = e instanceof Error ? e.message : 'Gagal menghapus.';
		} finally {
			hapusing = false;
		}
	}
	// Setelah "Pindah Semua" lewat qty, tawarkan melepas item dari rak asal (rak jadi rapi).
	function hapusSetelahPindah() {
		if (!moveFor) return;
		const p = detail?.placements.find((x) => x.placement_id === moveFor!.placement_id) ?? moveFor;
		closeMove();
		openHapus(p);
	}

	// Tambah item ke rak
	interface BarangHit {
		identitas_barang_id: number;
		nama_barang: string;
		kode_item: string | null;
		satuan: string | null;
		kategori: Kategori;
		sudah_di_rak: boolean;
		rak_lain: string[];
	}
	let showTambah = $state(false);
	let tambahQ = $state('');
	let tambahHits = $state<BarangHit[]>([]);
	let tambahSearching = $state(false);
	let tambahSearchError = $state('');
	// Pilih banyak: centang dari beberapa pencarian, lalu tinjau (rencana qty per item) & simpan sekali.
	let tambahSel = $state<{ hit: BarangHit; qty: number | null }[]>([]);
	let tambahStep = $state<'cari' | 'tinjau'>('cari');
	let tambahSaving = $state(false);
	let tambahError = $state('');
	let tambahOk = $state('');
	let tambahSkip = $state<{ nama: string; alasan: string }[]>([]);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchSeq = 0;
	const MAX_TAMBAH = 50;
	const isSel = (id: number) => tambahSel.some((s) => s.hit.identitas_barang_id === id);

	function openTambah() {
		showTambah = true;
		tambahQ = '';
		tambahHits = [];
		tambahSearchError = '';
		tambahSel = [];
		tambahStep = 'cari';
		tambahError = '';
		tambahOk = '';
		tambahSkip = [];
	}
	function closeTambah() {
		if (tambahSaving) return;
		showTambah = false;
		clearTimeout(searchTimer);
	}
	function onTambahInput() {
		clearTimeout(searchTimer);
		const q = tambahQ.trim();
		if (q.length < 2) {
			tambahHits = [];
			tambahSearchError = '';
			return;
		}
		searchTimer = setTimeout(() => cariBarang(q), 350);
	}
	async function cariBarang(q: string) {
		const seq = ++searchSeq;
		tambahSearching = true;
		tambahSearchError = '';
		try {
			const res = await fetch(`/api/kiosk/stok/rak/${gudangId}/barang?q=${encodeURIComponent(q)}`);
			const data = await res.json().catch(() => null);
			if (seq !== searchSeq) return;
			if (!res.ok) throw new Error(data?.message || `Gagal mencari (${res.status}).`);
			tambahHits = data.hits || [];
		} catch (e) {
			if (seq === searchSeq) tambahSearchError = e instanceof Error ? e.message : 'Gagal mencari.';
		} finally {
			if (seq === searchSeq) tambahSearching = false;
		}
	}
	function toggleBarang(h: BarangHit) {
		if (h.sudah_di_rak) return;
		tambahError = '';
		if (isSel(h.identitas_barang_id)) {
			tambahSel = tambahSel.filter((s) => s.hit.identitas_barang_id !== h.identitas_barang_id);
		} else if (tambahSel.length >= MAX_TAMBAH) {
			tambahError = `Maksimal ${MAX_TAMBAH} barang sekali tambah. Simpan dulu, lalu lanjut.`;
		} else {
			tambahSel = [...tambahSel, { hit: h, qty: null }];
		}
	}
	function pilihSemuaHasil() {
		const bisa = tambahHits.filter((h) => !h.sudah_di_rak && !isSel(h.identitas_barang_id));
		const ruang = MAX_TAMBAH - tambahSel.length;
		tambahSel = [...tambahSel, ...bisa.slice(0, ruang).map((hit) => ({ hit, qty: null }))];
		if (bisa.length > ruang) tambahError = `Maksimal ${MAX_TAMBAH} barang sekali tambah.`;
	}
	function hapusSel(id: number) {
		tambahSel = tambahSel.filter((s) => s.hit.identitas_barang_id !== id);
		if (!tambahSel.length) tambahStep = 'cari';
	}
	async function submitTambah() {
		if (!tambahSel.length) return;
		if (tambahSel.some((s) => s.qty != null && (!Number.isFinite(s.qty) || s.qty < 0))) {
			tambahError = 'Rencana qty tidak boleh negatif.';
			return;
		}
		tambahSaving = true;
		tambahError = '';
		try {
			const res = await fetch(`/api/kiosk/stok/rak/${gudangId}/placement`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					items: tambahSel.map((s) => ({ item_id: s.hit.identitas_barang_id, expected_qty: s.qty }))
				})
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal menambahkan (${res.status}).`);
			const masuk = new Set<number>((data.ditambahkan || []).map((d: any) => Number(d.item_id)));
			tambahHits = tambahHits.map((h) => (masuk.has(h.identitas_barang_id) ? { ...h, sudah_di_rak: true } : h));
			tambahOk = masuk.size ? `${masuk.size} barang ditambahkan ke rak ini.` : '';
			tambahSkip = (data.dilewati || []).map((d: any) => ({ nama: d.nama, alasan: d.alasan }));
			tambahSel = [];
			tambahStep = 'cari';
			load();
		} catch (e) {
			tambahError = e instanceof Error ? e.message : 'Gagal menambahkan.';
		} finally {
			tambahSaving = false;
		}
	}

	onMount(load);
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/cek-stok')}>
		<IconArrowLeft size={18} /> Kembali
	</button>

	{#if loading}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Stok Gudang..." sublabel="Mengambil inventaris rak & partisi" />
		</div>
	{:else if loadError}
		<div class="err-box">
			<p>{loadError}</p>
			<button class="retry" onclick={load}><IconRefresh size={16} /> Coba lagi</button>
		</div>
	{:else if detail}
		<div class="head">
			<div class="head-text">
				<h1>{detail.gudang.nama_gudang}</h1>
				<p class="sub">
					{detail.parent_nama ? `di dalam ${detail.parent_nama}` : 'Lokasi teratas'}
					{detail.gudang.kode_gudang ? ` · ${detail.gudang.kode_gudang}` : ''}
				</p>
			</div>
			{#if detail.gudang.parent_gudang_id}
				<button class="kelola-toggle" class:on={kelola} onclick={() => (kelola = !kelola)}>
					{#if kelola}<IconCheck size={16} /> Selesai{:else}<IconSettings size={16} /> Kelola Rak{/if}
				</button>
			{/if}
		</div>

		{#if kelola}
			<div class="kelola-bar">
				<p>Mode Kelola Rak: tambah, lepas, atau pindahkan item supaya isi rak sesuai kondisi fisik. Stok tidak berubah.</p>
				<button class="tambah-btn" onclick={openTambah}><IconPlus size={16} /> Tambah Item ke Rak</button>
			</div>
		{/if}

		{#if detail.pics.length}
			<div class="pics">
				{#each detail.pics as pic}
					<button class="pic" onclick={() => waPic(pic)} disabled={!pic.no_hp}>
						<IconPhone size={14} /> {pic.nama_karyawan}
					</button>
				{/each}
			</div>
		{:else}
			<div class="note">Rak ini belum punya PIC.</div>
		{/if}

		<div class="legend">
			<span><i style="background:{TONE.green}"></i> Sesuai</span>
			<span><i style="background:{TONE.amber}"></i> Selisih kecil</span>
			<span><i style="background:{TONE.red}"></i> Kosong / selisih besar</span>
		</div>

		{#if detail.placements.length === 0}
			<div class="empty">
				Belum ada item ditempatkan di rak ini.
				{#if detail.gudang.parent_gudang_id}
					Tekan <strong>Kelola Rak</strong> lalu <strong>Tambah Item ke Rak</strong>.
				{/if}
			</div>
		{:else}
			<div class="list-header">
				<p class="count">{detail.placements.length} item{filteredPlacements.length !== detail.placements.length ? ` (menampilkan ${filteredPlacements.length})` : ''}</p>
				{#if detail.placements.length > 2}
					<div class="rack-filter">
						<IconSearch size={14} class="rack-filter__ic" />
						<input
							type="text"
							placeholder="Cari item di rak ini..."
							bind:value={searchItem}
						/>
						{#if searchItem}
							<button class="rack-filter__clear" onclick={() => (searchItem = '')} aria-label="Reset pencarian">
								<IconX size={14} />
							</button>
						{/if}
					</div>
				{/if}
			</div>

			{#if filteredPlacements.length === 0}
				<div class="empty">Tidak ada item yang cocok dengan pencarian "{searchItem}".</div>
			{:else}
				<div class="list">
					{#each filteredPlacements as p (p.placement_id)}
						{@const t = tone(p)}
						<div class="item" style="border-color:{TONE[t]}55">
							<div class="item-top">
								<span class="item-nama">{p.nama_barang}</span>
								{#if p.kategori !== 'lainnya'}
									<span class="tag">{KATEGORI_LABEL[p.kategori]}</span>
								{/if}
							</div>
							{#if p.kode_item}<span class="kode">{p.kode_item}</span>{/if}
							<div class="qty-row">
								<div class="qty-cell">
									<span class="qty-label">Sistem</span>
									<span class="qty-val" style="color:{TONE[t]}">{p.ledger_qty ?? '–'}</span>
								</div>
								<div class="qty-cell">
									<span class="qty-label">Rencana</span>
									<span class="qty-val muted">{p.expected_qty ?? '–'}</span>
								</div>
								{#if p.min_qty != null}
									<div class="qty-cell">
										<span class="qty-label">Min</span>
										<span class="qty-val muted">{p.min_qty}</span>
									</div>
								{/if}
								{#if p.ledger_qty != null && p.expected_qty != null}
									{@const diff = p.ledger_qty - p.expected_qty}
									<div class="qty-cell">
										<span class="qty-label">Selisih</span>
										<span
											class="qty-diff"
											class:diff-zero={diff === 0}
											class:diff-plus={diff > 0}
											class:diff-minus={diff < 0}
										>
											{diff > 0 ? `+${diff}` : diff}
										</span>
									</div>
								{/if}
								<span class="sat">{p.satuan || ''}</span>
							</div>
							<div class="item-actions">
								<button class="move-btn" onclick={() => openMove(p)}>
									<IconArrowsExchange size={15} /> Pindahkan ke rak lain
								</button>
								{#if kelola}
									<button class="hapus-btn" onclick={() => openHapus(p)}>
										<IconTrash size={15} /> Lepas dari rak
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		<p class="disclaimer">
			Qty "Sistem" dihitung dari catatan transaksi stok. Kalau tidak cocok dengan fisik,
			laporkan lewat Cek Area / Genba di aplikasi lapangan — jangan diubah dari sini.
			"Pindahkan ke rak lain" hanya menggeser lokasi barang (stok total tidak berkurang),
			bukan untuk mengeluarkan barang. "Lepas dari rak" hanya menghapus penempatan, dan
			ditolak bila rak ini masih mencatat stok barang tersebut.
		</p>
	{/if}
</div>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		if (moveFor) closeMove();
		else if (hapusFor && !hapusing) hapusFor = null;
		else if (showTambah) closeTambah();
	}}
/>

{#if moveFor}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={closeMove} role="presentation">
		<div class="sheet" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
			<div class="sheet-head">
				<h2>Pindahkan barang</h2>
				<button class="sheet-x" onclick={closeMove} aria-label="Tutup"><IconX size={20} /></button>
			</div>

			{#if moveLokasiResult}
				<div class="ok">
					<IconCircleCheck size={36} style="color:#16a34a" />
					<p class="ok-title">Lokasi item dipindahkan</p>
					<p class="ok-sub">
						{moveFor.nama_barang} sekarang ada di <strong>{moveLokasiResult.rak_tujuan_nama}</strong>.
						{#if moveLokasiResult.digabung}<br />Rak tujuan sudah punya item ini — data digabung jadi satu.{/if}
					</p>
					<div class="sheet-actions">
						<button class="sheet-btn sheet-btn--secondary" onclick={closeMove}>Tetap di Sini</button>
						<button class="sheet-btn sheet-btn--primary" onclick={() => goto(`/kiosk/cek-stok/${destRakId}`)}>
							<IconExternalLink size={16} /> Buka Rak Tujuan
						</button>
					</div>
				</div>
			{:else if moveResult}
				<div class="ok">
					{#if moveResult.pending_approval}
						<IconClock size={36} style="color:#d97706" />
						<p class="ok-title" style="color:#b45309">Permintaan Pindah Rak Terkirim</p>
						<p class="ok-sub">
							{moveFor.nama_barang} → rak #{destRakId}.<br />
							Ref: <strong>{moveResult.reference_no}</strong><br />
							Permintaan menunggu persetujuan Kepala Gudang di Lifecycle Hub ERP sebelum mutasi penempatan fisik efektif.
						</p>
					{:else}
						<IconCircleCheck size={36} style="color:#16a34a" />
						<p class="ok-title">Barang berhasil dipindahkan</p>
						<p class="ok-sub">
							{moveFor.nama_barang} → rak #{destRakId}.<br />
							Ref: <strong>{moveResult.reference_no}</strong><br />
							Qty di rak tujuan sekarang: <strong>{moveResult.rak_tujuan_ledger_baru} {moveFor.satuan || ''}</strong>.
						</p>
					{/if}
					{#if moveResult.flag_selisih}
						<p class="warn">
							<IconAlertTriangle size={16} /> Jumlah yang dipindah lebih besar dari yang tercatat di rak ini.
							Sudah ditandai untuk dicek opname — tidak menghalangi.
						</p>
					{/if}
					{#if moveResult.rak_asal_sisa_ledger <= 0}
						<button class="hapus-after" onclick={hapusSetelahPindah}>
							<IconTrash size={15} /> Rak ini sudah kosong untuk item ini — lepas dari rak?
						</button>
					{/if}
					<div class="sheet-actions">
						<button class="sheet-btn sheet-btn--secondary" onclick={closeMove}>Tetap di Sini</button>
						<button class="sheet-btn sheet-btn--primary" onclick={() => goto(`/kiosk/cek-stok/${destRakId}`)}>
							<IconExternalLink size={16} /> Buka Rak Tujuan
						</button>
					</div>
				</div>
			{:else}
				<p class="sheet-item">{moveFor.nama_barang}{moveFor.kode_item ? ` · ${moveFor.kode_item}` : ''}</p>
				<p class="sheet-from">Dari: <strong>{detail?.gudang.nama_gudang}</strong> · tercatat {moveFor.ledger_qty ?? '–'} {moveFor.satuan || ''}</p>

				<label class="sheet-label" for="dest">Rak tujuan</label>
				<div class="sheet-row">
					<input
						id="dest"
						type="text"
						inputmode="numeric"
						placeholder="ID rak atau scan QR"
						bind:value={destRakId}
						onkeydown={(e) => { if (e.key === 'Enter') submitMove(); }}
					/>
					<button class="scan-mini" onclick={async () => { await loadScanner(); moveError = ''; showDestScanner = true; }}>
						<IconQrcode size={18} /> Scan
					</button>
				</div>
				<p class="sheet-hint">Rak tujuan harus di gudang/fasilitas yang sama. Pindah antar-fasilitas lewat Surat Jalan.</p>

				{#if tanpaStok(moveFor)}
					<div class="mode-seg" role="tablist">
						<button role="tab" aria-selected={moveMode === 'lokasi'} class:active={moveMode === 'lokasi'} onclick={() => (moveMode = 'lokasi')}>
							Pindah lokasi saja
						</button>
						<button role="tab" aria-selected={moveMode === 'qty'} class:active={moveMode === 'qty'} onclick={() => (moveMode = 'qty')}>
							Pindah dengan jumlah
						</button>
					</div>
					{#if moveMode === 'lokasi'}
						<p class="sheet-hint">
							Stok tercatat item ini di rak ini kosong, jadi cukup pindahkan penempatannya. Tidak ada transaksi stok yang dibuat.
							Pilih "Pindah dengan jumlah" kalau barang fisiknya memang ada.
						</p>
					{/if}
				{/if}

				{#if moveMode === 'qty'}
				<div class="qty-head-row">
					<label class="sheet-label" for="qty">Jumlah dipindah</label>
					{#if moveFor.ledger_qty && moveFor.ledger_qty > 0}
						<button class="fill-all-btn" type="button" onclick={() => (moveQty = moveFor!.ledger_qty)}>
							Pindah Semua ({moveFor.ledger_qty})
						</button>
					{/if}
				</div>
				<div class="stepper-row">
					<button class="step-btn" type="button" onclick={() => (moveQty = Math.max(1, (moveQty || 0) - 1))}>−1</button>
					<input id="qty" type="number" inputmode="decimal" min="0" placeholder="0" bind:value={moveQty} />
					<button class="step-btn" type="button" onclick={() => (moveQty = (moveQty || 0) + 1)}>+1</button>
					<button class="step-btn" type="button" onclick={() => (moveQty = (moveQty || 0) + 5)}>+5</button>
				</div>

				{#if moveQty && moveFor.ledger_qty != null && moveQty > moveFor.ledger_qty}
					<p class="warn">
						<IconAlertTriangle size={14} /> Jumlah yang dipindah ({moveQty}) melebihi stok tercatat di rak ini ({moveFor.ledger_qty}). Selisih akan dicatat untuk audit opname.
					</p>
				{/if}

				<label class="sheet-label" for="cat">Catatan (opsional)</label>
				<input id="cat" type="text" placeholder="mis. konsolidasi rak" bind:value={moveCatatan} />
				{/if}

				{#if moveError}<p class="sheet-err">{moveError}</p>{/if}

				<button class="sheet-submit" disabled={moving} onclick={submitMove}>
					{moving ? 'Memindahkan…' : moveMode === 'lokasi' ? 'Pindahkan lokasi' : 'Pindahkan sekarang'}
				</button>
				<p class="sheet-attrib">Tercatat atas nama Anda (badge yang login di terminal ini).</p>
			{/if}
		</div>
	</div>
{/if}

{#if hapusFor}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={() => { if (!hapusing) hapusFor = null; }} role="presentation">
		<div class="sheet" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
			<div class="sheet-head">
				<h2>Lepas item dari rak?</h2>
				<button class="sheet-x" onclick={() => (hapusFor = null)} disabled={hapusing} aria-label="Tutup"><IconX size={20} /></button>
			</div>
			<p class="sheet-item">{hapusFor.nama_barang}{hapusFor.kode_item ? ` · ${hapusFor.kode_item}` : ''}</p>
			<p class="sheet-from">Dari: <strong>{detail?.gudang.nama_gudang}</strong> · tercatat {hapusFor.ledger_qty ?? '–'} {hapusFor.satuan || ''}</p>

			{#if hapusFor.ledger_qty != null && hapusFor.ledger_qty > 0}
				<p class="warn">
					<IconAlertTriangle size={16} /> Rak ini masih mencatat stok {hapusFor.ledger_qty} {hapusFor.satuan || ''}.
					Pindahkan dulu jumlahnya ke rak lain sebelum dilepas.
				</p>
				<div class="sheet-actions">
					<button class="sheet-btn sheet-btn--secondary" onclick={() => (hapusFor = null)}>Batal</button>
					<button class="sheet-btn sheet-btn--primary" onclick={() => { const p = hapusFor!; hapusFor = null; openMove(p); }}>
						<IconArrowsExchange size={16} /> Pindahkan dulu
					</button>
				</div>
			{:else}
				<p class="sheet-hint">
					Item ini hanya dilepas dari daftar rak ini — data barang dan stok tidak dihapus.
					Bisa ditambahkan lagi kapan saja lewat Kelola Rak.
				</p>
				{#if hapusError}<p class="sheet-err">{hapusError}</p>{/if}
				<div class="sheet-actions">
					<button class="sheet-btn sheet-btn--secondary" onclick={() => (hapusFor = null)} disabled={hapusing}>Batal</button>
					<button class="sheet-btn sheet-btn--danger" onclick={submitHapus} disabled={hapusing}>
						<IconTrash size={16} /> {hapusing ? 'Melepas…' : 'Ya, lepas dari rak'}
					</button>
				</div>
			{/if}
			<p class="sheet-attrib">Tercatat atas nama Anda (badge yang login di terminal ini).</p>
		</div>
	</div>
{/if}

{#if showTambah}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={closeTambah} role="presentation">
		<div class="sheet" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
			<div class="sheet-head">
				<h2>Tambah item ke {detail?.gudang.nama_gudang}</h2>
				<button class="sheet-x" onclick={closeTambah} aria-label="Tutup"><IconX size={20} /></button>
			</div>

			{#if tambahStep === 'tinjau'}
				<p class="sheet-hint">Periksa barang yang akan ditambahkan. Rencana qty boleh dikosongkan.</p>
				<div class="sel-list">
					{#each tambahSel as s (s.hit.identitas_barang_id)}
						<div class="sel-row">
							<div class="sel-info">
								<span class="hit-nama">{s.hit.nama_barang}</span>
								<span class="hit-meta">{s.hit.kode_item || ''}{s.hit.satuan ? ` · ${s.hit.satuan}` : ''}</span>
							</div>
							<input
								class="sel-qty"
								type="number"
								inputmode="decimal"
								min="0"
								placeholder="Rencana"
								aria-label="Rencana qty {s.hit.nama_barang}"
								bind:value={s.qty}
							/>
							<button class="sel-x" onclick={() => hapusSel(s.hit.identitas_barang_id)} disabled={tambahSaving} aria-label="Batal pilih">
								<IconX size={18} />
							</button>
						</div>
					{/each}
				</div>
				{#if tambahError}<p class="sheet-err">{tambahError}</p>{/if}
				<div class="sheet-actions">
					<button class="sheet-btn sheet-btn--secondary" onclick={() => (tambahStep = 'cari')} disabled={tambahSaving}>Kembali pilih</button>
					<button class="sheet-btn sheet-btn--primary" onclick={submitTambah} disabled={tambahSaving}>
						<IconPlus size={16} /> {tambahSaving ? 'Menyimpan…' : `Tambahkan ${tambahSel.length} barang`}
					</button>
				</div>
			{:else}
				{#if tambahOk}<p class="ok-line"><IconCircleCheck size={16} /> {tambahOk}</p>{/if}
				{#if tambahSkip.length}
					<p class="warn">
						<IconAlertTriangle size={14} />
						Dilewati: {tambahSkip.map((s) => `${s.nama} (${s.alasan.toLowerCase()})`).join(', ')}
					</p>
				{/if}
				<div class="tambah-search">
					<IconSearch size={16} />
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						placeholder="Cari nama atau kode barang…"
						bind:value={tambahQ}
						oninput={onTambahInput}
						autofocus
					/>
					{#if tambahSearching}<IconLoader2 size={16} class="spin" />{/if}
				</div>
				{#if tambahSearchError}
					<p class="sheet-err">{tambahSearchError}</p>
				{:else if tambahQ.trim().length >= 2 && !tambahSearching && tambahHits.length === 0}
					<p class="sheet-hint">Tidak ada barang yang cocok dengan "{tambahQ}".</p>
				{:else if tambahQ.trim().length < 2}
					<p class="sheet-hint">Ketik minimal 2 huruf. Ketuk barang untuk mencentang — bisa pilih banyak, juga dari pencarian berbeda.</p>
				{/if}
				{#if tambahHits.some((h) => !h.sudah_di_rak && !isSel(h.identitas_barang_id))}
					<button class="pilih-semua" onclick={pilihSemuaHasil}>Centang semua hasil</button>
				{/if}
				<div class="hit-list">
					{#each tambahHits as h (h.identitas_barang_id)}
						{@const sel = isSel(h.identitas_barang_id)}
						<button class="hit" class:hit--sel={sel} disabled={h.sudah_di_rak} onclick={() => toggleBarang(h)} aria-pressed={sel}>
							<span class="hit-check" class:on={sel || h.sudah_di_rak}>{#if sel || h.sudah_di_rak}<IconCheck size={14} />{/if}</span>
							<span class="hit-body">
								<span class="hit-nama">{h.nama_barang}</span>
								<span class="hit-meta">
									{h.kode_item || ''}{h.satuan ? ` · ${h.satuan}` : ''}
									{#if h.kategori !== 'lainnya'}<span class="tag">{KATEGORI_LABEL[h.kategori]}</span>{/if}
								</span>
								{#if h.sudah_di_rak}
									<span class="hit-badge hit-badge--in">Sudah di rak ini</span>
								{:else if h.rak_lain.length}
									<span class="hit-badge">Juga di: {h.rak_lain.slice(0, 3).join(', ')}{h.rak_lain.length > 3 ? ` +${h.rak_lain.length - 3}` : ''}</span>
								{/if}
							</span>
						</button>
					{/each}
				</div>
				{#if tambahError}<p class="sheet-err">{tambahError}</p>{/if}
				{#if tambahSel.length}
					<div class="sel-footer">
						<span>{tambahSel.length} barang dipilih</span>
						<button class="sheet-btn sheet-btn--primary" onclick={() => { tambahError = ''; tambahStep = 'tinjau'; }}>
							Lanjut tinjau
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

{#if showDestScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:" onDetect={onDestScan} onClose={() => (showDestScanner = false)} />
{/if}

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.back {
		align-self: flex-start; display: flex; align-items: center; gap: 0.4rem;
		background: none; border: none; color: #475569; font-size: 0.95rem; font-weight: 600; cursor: pointer; padding: 0;
	}
	.center { display: flex; justify-content: center; padding: 3rem; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.err-box { text-align: center; color: #dc2626; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; padding: 2rem 1rem; }
	.retry { display: flex; align-items: center; gap: 0.35rem; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 0.6rem; padding: 0.5rem 1rem; font-weight: 700; cursor: pointer; }
	.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
	.head h1 { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
	.kelola-toggle {
		display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;
		background: white; color: #334155; border: 1px solid #cbd5e1; border-radius: 0.6rem;
		padding: 0.5rem 0.9rem; font-size: 0.85rem; font-weight: 700; cursor: pointer;
	}
	.kelola-toggle.on { background: #0f766e; color: white; border-color: #0f766e; }
	.kelola-bar {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
		background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 0.75rem; padding: 0.7rem 0.9rem;
	}
	.kelola-bar p { margin: 0; font-size: 0.8rem; color: #115e59; flex: 1; min-width: 200px; }
	.tambah-btn {
		display: flex; align-items: center; gap: 0.35rem; background: #0f766e; color: white; border: none;
		border-radius: 0.6rem; padding: 0.6rem 1rem; font-size: 0.9rem; font-weight: 800; cursor: pointer;
	}
	.item-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.6rem; }
	.item-actions .move-btn { margin-top: 0; }
	.hapus-btn {
		display: flex; align-items: center; gap: 0.35rem;
		background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 0.5rem;
		padding: 0.45rem 0.8rem; font-size: 0.8rem; font-weight: 700; cursor: pointer;
	}
	.hapus-after {
		display: flex; align-items: center; gap: 0.35rem; margin-top: 0.5rem;
		background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 0.5rem;
		padding: 0.5rem 0.8rem; font-size: 0.8rem; font-weight: 700; cursor: pointer;
	}
	.sheet-btn--danger { background: #dc2626; color: white; }
	.sheet-btn:disabled { opacity: 0.55; }
	.mode-seg { display: flex; gap: 0.25rem; background: #f1f5f9; border-radius: 0.6rem; padding: 0.25rem; margin-top: 0.5rem; }
	.mode-seg button {
		flex: 1; border: none; background: none; border-radius: 0.45rem; padding: 0.55rem;
		font-size: 0.85rem; font-weight: 700; color: #64748b; cursor: pointer;
	}
	.mode-seg button.active { background: white; color: #0f172a; box-shadow: 0 1px 2px rgba(15,23,42,0.12); }
	.tambah-search {
		display: flex; align-items: center; gap: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.6rem;
		padding: 0 0.9rem; color: #64748b; margin-top: 0.25rem;
	}
	.sheet .tambah-search input { border: none; outline: none; padding: 0.75rem 0; font-size: 1rem; flex: 1; min-width: 0; }
	.hit-list { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.4rem; }
	.hit {
		display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; text-align: left;
		background: white; border: 1px solid #e2e8f0; border-radius: 0.6rem; padding: 0.65rem 0.85rem; cursor: pointer;
	}
	.hit:disabled { background: #f8fafc; cursor: default; }
	.hit { flex-direction: row; align-items: flex-start; gap: 0.6rem; }
	.hit--sel { border-color: #0f766e; background: #f0fdfa; }
	.hit-body { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; min-width: 0; }
	.hit-check {
		flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; border: 2px solid #cbd5e1; margin-top: 0.05rem;
		display: flex; align-items: center; justify-content: center; color: white; background: white;
	}
	.hit-check.on { background: #0f766e; border-color: #0f766e; }
	.hit:disabled .hit-check.on { background: #94a3b8; border-color: #94a3b8; }
	.pilih-semua {
		align-self: flex-end; background: none; border: none; color: #0f766e; font-size: 0.8rem; font-weight: 700;
		cursor: pointer; padding: 0.2rem 0;
	}
	.sel-footer {
		position: sticky; bottom: -1.75rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		background: white; border-top: 1px solid #e2e8f0; margin: 0.5rem -1.25rem -1.75rem; padding: 0.75rem 1.25rem 1rem;
	}
	.sel-footer span { font-size: 0.9rem; font-weight: 800; color: #0f172a; }
	.sel-footer .sheet-btn { flex: 0 0 auto; }
	.sel-list { display: flex; flex-direction: column; gap: 0.4rem; }
	.sel-row { display: flex; align-items: center; gap: 0.5rem; border: 1px solid #e2e8f0; border-radius: 0.6rem; padding: 0.5rem 0.6rem 0.5rem 0.85rem; }
	.sel-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.sheet input.sel-qty { width: 96px; border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.55rem 0.6rem; font-size: 0.95rem; text-align: center; }
	.sel-x { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0.25rem; display: flex; }
	.hit-nama { font-size: 0.9rem; font-weight: 700; color: #0f172a; }
	.hit-meta { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: #94a3b8; }
	.hit-badge { font-size: 0.7rem; font-weight: 700; color: #475569; background: #f1f5f9; border-radius: 4px; padding: 0.1rem 0.4rem; }
	.hit-badge--in { color: #047857; background: #dcfce7; }
	.ok-line {
		display: flex; align-items: center; gap: 0.35rem; margin: 0.25rem 0 0;
		background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d;
		border-radius: 0.5rem; padding: 0.5rem 0.7rem; font-size: 0.82rem; font-weight: 700;
	}
	.sub { font-size: 0.85rem; color: #64748b; margin: 0.15rem 0 0; }
	.pics { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.pic {
		display: flex; align-items: center; gap: 0.35rem; background: #ecfdf5; color: #047857;
		border: 1px solid #a7f3d0; border-radius: 999px; padding: 0.4rem 0.9rem; font-size: 0.85rem; font-weight: 700; cursor: pointer;
	}
	.pic:disabled { opacity: 0.5; }
	.note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 0.6rem; padding: 0.6rem 0.9rem; font-size: 0.85rem; }
	.legend { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.75rem; color: #64748b; }
	.legend span { display: flex; align-items: center; gap: 0.3rem; }
	.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
	.empty { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 1.5rem; text-align: center; color: #64748b; font-size: 0.9rem; }
	.list-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
	.count { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0; }
	.rack-filter {
		display: flex; align-items: center; gap: 0.3rem; background: white; border: 1px solid #cbd5e1;
		border-radius: 0.5rem; padding: 0.3rem 0.6rem; flex: 1; max-width: 260px;
	}
	.rack-filter input { border: none; outline: none; font-size: 0.82rem; width: 100%; color: #0f172a; background: transparent; }
	.rack-filter__clear { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; display: flex; }
	.list { display: flex; flex-direction: column; gap: 0.5rem; }
	.item { background: white; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.85rem 1rem; }
	.item-top { display: flex; align-items: center; gap: 0.5rem; }
	.item-nama { flex: 1; font-size: 0.95rem; font-weight: 700; color: #0f172a; }
	.tag { font-size: 0.65rem; font-weight: 800; background: #e2e8f0; color: #475569; border-radius: 4px; padding: 0.1rem 0.35rem; }
	.kode { font-size: 0.75rem; color: #94a3b8; }
	.qty-row { display: flex; align-items: flex-end; gap: 1rem; margin-top: 0.5rem; flex-wrap: wrap; }
	.qty-cell { display: flex; flex-direction: column; line-height: 1.1; }
	.qty-label { font-size: 0.65rem; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
	.qty-val { font-size: 1.2rem; font-weight: 800; }
	.qty-val.muted { color: #64748b; }
	.qty-diff { font-size: 0.85rem; font-weight: 800; border-radius: 4px; padding: 0.1rem 0.35rem; display: inline-block; margin-top: 0.15rem; }
	.diff-zero { background: #dcfce7; color: #15803d; }
	.diff-plus { background: #ecfdf5; color: #047857; }
	.diff-minus { background: #fee2e2; color: #b91c1c; }
	.sat { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; margin-left: auto; align-self: center; }
	.disclaimer { font-size: 0.78rem; color: #94a3b8; line-height: 1.4; margin: 0.5rem 0 0; }

	.move-btn {
		margin-top: 0.6rem; display: flex; align-items: center; gap: 0.35rem;
		background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; border-radius: 0.5rem;
		padding: 0.45rem 0.8rem; font-size: 0.8rem; font-weight: 700; cursor: pointer;
	}

	.sheet-backdrop {
		position: fixed; inset: 0; background: rgba(15,23,42,0.55);
		display: flex; align-items: flex-end; justify-content: center; z-index: 50;
	}
	.sheet {
		background: white; width: 100%; max-width: 640px; border-radius: 1rem 1rem 0 0;
		padding: 1.25rem 1.25rem 1.75rem; display: flex; flex-direction: column; gap: 0.5rem;
		max-height: 90vh; overflow-y: auto;
	}
	.sheet-head { display: flex; align-items: center; justify-content: space-between; }
	.sheet-head h2 { font-size: 1.1rem; font-weight: 800; color: #0f172a; margin: 0; }
	.sheet-x { background: none; border: none; color: #64748b; cursor: pointer; padding: 0.25rem; }
	.sheet-item { font-size: 0.95rem; font-weight: 700; color: #0f172a; margin: 0.25rem 0 0; }
	.sheet-from { font-size: 0.8rem; color: #64748b; margin: 0 0 0.5rem; }
	.sheet-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: #64748b; }
	.sheet-row { display: flex; gap: 0.5rem; }
	.sheet-row input, .sheet input[type="text"] {
		flex: 1; border: 1px solid #cbd5e1; border-radius: 0.6rem; padding: 0.7rem 0.9rem; font-size: 1rem; min-width: 0; width: 100%;
	}
	.scan-mini {
		display: flex; align-items: center; gap: 0.3rem; background: #0f766e; color: white;
		border: none; border-radius: 0.6rem; padding: 0 1rem; font-weight: 700; font-size: 0.85rem; cursor: pointer;
	}
	.sheet-hint { font-size: 0.72rem; color: #94a3b8; margin: 0.2rem 0 0; line-height: 1.35; }
	.qty-head-row { display: flex; align-items: center; justify-content: space-between; margin-top: 0.5rem; }
	.fill-all-btn {
		background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 4px;
		padding: 0.15rem 0.5rem; font-size: 0.72rem; font-weight: 700; cursor: pointer;
	}
	.stepper-row { display: flex; gap: 0.4rem; align-items: center; }
	.step-btn {
		width: 44px; height: 44px; border-radius: 0.5rem; border: 1px solid #cbd5e1;
		background: #f8fafc; font-size: 0.9rem; font-weight: 800; color: #334155; cursor: pointer; flex-shrink: 0;
	}
	.stepper-row input {
		flex: 1; text-align: center; border: 1px solid #cbd5e1; border-radius: 0.6rem;
		height: 44px; font-size: 1.1rem; font-weight: 800; min-width: 0;
	}
	.sheet-err { color: #dc2626; font-size: 0.85rem; margin: 0.4rem 0 0; }
	.sheet-submit {
		margin-top: 0.9rem; width: 100%; background: #ea580c; color: white; border: none;
		border-radius: 0.75rem; padding: 0.85rem; font-size: 1rem; font-weight: 800; cursor: pointer;
	}
	.sheet-submit:disabled { opacity: 0.55; }
	.sheet-attrib { font-size: 0.72rem; color: #94a3b8; text-align: center; margin: 0.5rem 0 0; }
	.ok { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; text-align: center; padding: 0.5rem 0; }
	.ok-title { font-size: 1.05rem; font-weight: 800; color: #0f172a; margin: 0.2rem 0 0; }
	.ok-sub { font-size: 0.82rem; color: #475569; margin: 0; line-height: 1.4; }
	.warn {
		display: flex; align-items: flex-start; gap: 0.35rem; text-align: left;
		background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
		border-radius: 0.5rem; padding: 0.5rem 0.7rem; font-size: 0.78rem; margin: 0.4rem 0 0;
	}
	.sheet-actions { display: flex; gap: 0.5rem; width: 100%; margin-top: 1rem; }
	.sheet-btn {
		flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem;
		border-radius: 0.6rem; padding: 0.75rem 1rem; font-size: 0.9rem; font-weight: 700; cursor: pointer; border: none;
	}
	.sheet-btn--secondary { background: #f1f5f9; color: #475569; }
	.sheet-btn--primary { background: #0f766e; color: white; }
</style>
