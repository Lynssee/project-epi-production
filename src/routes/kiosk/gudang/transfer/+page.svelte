<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/transfer/+page.svelte
	// Transfer barang ANTAR GUDANG dari terminal kiosk: Ajukan → (PIC gudang asal) Setujui → (PIC tujuan) Terima.
	// F4-C, Briefing Gate Dua Tingkat & Eliminasi Skema Manual, Bab VI §6.3-B (21 Sep 2026).
	// Stok BARU berkurang saat disetujui dan BARU bertambah saat diterima — semua ditulis oleh ERP.
	// Pindah rak dalam SATU gudang bukan transfer: pakai Cek Stok Rak → Pindah Rak (tanpa persetujuan).
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconSearch, IconInfoCircle, IconTrash } from '@tabler/icons-svelte';
	import type { KioskTransferRow } from '$lib/kiosk/transferTypes';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { kioskConfirm } from '$lib/components/kiosk/kioskConfirm';

	type Tab = 'tindakan' | 'baru' | 'riwayat';
	interface RakOpt { id: number; nama: string; kode: string | null; qr: string | null; jenis: string | null }
	interface Hit {
		identitas_barang_id: number; nama_barang: string; satuan: string | null;
		gudang_id: number; rak_nama: string; rak_kode: string | null; ledger_qty: number | null;
	}
	interface CartLine { item_id: number; nama: string; satuan: string | null; from_rak_id: number; rak_nama: string; max: number | null; quantity: number }

	let tab = $state<Tab>('tindakan');
	let rows = $state<KioskTransferRow[]>([]);
	let loading = $state(true);
	let busyId = $state<number | null>(null);
	let error = $state('');
	let notice = $state('');
	let showHelp = $state(false);

	const perluTindakan = $derived(rows.filter((r) => r.bisa_setujui || r.bisa_terima));
	const menunggu = $derived(rows.filter((r) => (r.status === 'draft' || r.status === 'in_transit') && !(r.bisa_setujui || r.bisa_terima)));
	const riwayat = $derived(rows.filter((r) => !['draft', 'in_transit'].includes(r.status)));

	const STATUS_LABEL: Record<string, string> = {
		draft: 'Menunggu Persetujuan', in_transit: 'Dalam Perjalanan', completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan'
	};

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/kiosk/gudang/transfer');
			if (res.status === 401) return goto('/kiosk');
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Gagal memuat transfer');
			rows = (await res.json()).rows || [];
		} catch (e: any) {
			error = e.message || 'Gagal memuat transfer';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function post(url: string, body: unknown = {}) {
		const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.message || data.alasan || 'Gagal memproses');
		return data.data;
	}

	function gateCatatan(data: any): string {
		const bad = (data?.gates?.gates || []).filter((g: any) => g.status === 'failed');
		return bad.length ? ` Catatan: ${bad.map((g: any) => g.label).join(', ')} (belum memblokir).` : '';
	}

	async function aksi(r: KioskTransferRow, act: 'approve' | 'cancel', konfirmasi: string, sukses: string) {
		if (!(await kioskConfirm({ judul: act === 'approve' ? 'Setujui transfer?' : 'Batalkan transfer?', isi: konfirmasi, ya: act === 'approve' ? 'Ya, setujui' : 'Ya, batalkan', warna: act === 'approve' ? 'hijau' : 'oranye' }))) return;
		busyId = r.id; error = ''; notice = '';
		try {
			const data = await post(`/api/kiosk/gudang/transfer/${r.id}/${act}`);
			notice = sukses + gateCatatan(data);
			await load();
		} catch (e: any) {
			error = e.message;
		} finally {
			busyId = null;
		}
	}
	const setujui = (r: KioskTransferRow) =>
		aksi(r, 'approve', `Setujui ${r.transfer_no}? Stok akan DIKURANGI dari ${r.from_nama} sekarang.`, `${r.transfer_no} disetujui — barang dalam perjalanan.`);
	const batalkan = (r: KioskTransferRow) =>
		aksi(r, 'cancel', r.status === 'in_transit' ? `Batalkan ${r.transfer_no}? Barang sudah berangkat — stok dikembalikan ke ${r.from_nama}.` : `Batalkan ${r.transfer_no}?`, `${r.transfer_no} dibatalkan.`);

	// ── Tolak ──
	let rejectRow = $state<KioskTransferRow | null>(null);
	let rejectReason = $state('');
	async function submitReject() {
		if (!rejectRow) return;
		busyId = rejectRow.id; error = ''; notice = '';
		try {
			await post(`/api/kiosk/gudang/transfer/${rejectRow.id}/reject`, { reason: rejectReason });
			notice = `${rejectRow.transfer_no} ditolak.`;
			rejectRow = null;
			await load();
		} catch (e: any) {
			error = e.message;
		} finally {
			busyId = null;
		}
	}

	// ── Terima ──
	interface RecvLine { id: number; nama: string; satuan: string | null; quantity: number; received: number; rakId: number | null; alasan: string }
	let recvRow = $state<KioskTransferRow | null>(null);
	let recvLines = $state<RecvLine[]>([]);
	let rakOpts = $state<RakOpt[]>([]);
	let scanText = $state<Record<number, string>>({});
	let activeRecvLineId = $state<number | null>(null); // diisi onfocus input scan tiap baris

	async function bukaTerima(r: KioskTransferRow) {
		error = ''; notice = '';
		recvRow = r;
		recvLines = r.items.map((i) => ({ id: i.id, nama: i.nama, satuan: i.satuan, quantity: i.quantity, received: i.quantity, rakId: null, alasan: '' }));
		scanText = {};
		rakOpts = [];
		activeRecvLineId = null;
		try {
			const res = await fetch(`/api/kiosk/gudang/transfer?rak_di=${r.to_id}`);
			if (res.ok) rakOpts = (await res.json()).rak || [];
		} catch { /* dropdown kosong — server tetap menolak/menandai bila rak tak ada */ }
	}

	/** Input dari scanner (keyboard wedge) atau ketik manual: cocokkan QR / kode / nama rak persis. */
	function cocokkanRak(line: RecvLine, text: string) {
		scanText[line.id] = text;
		const t = text.trim().toLowerCase();
		if (!t) return;
		const p = parseEpiQr(text);
		const hit = p?.type === 'LOC'
			? rakOpts.find((o) => o.id === Number(p.id))
			: rakOpts.find((o) => (o.qr || '').toLowerCase() === t || (o.kode || '').toLowerCase() === t || o.nama.toLowerCase() === t);
		if (hit) line.rakId = hit.id;
	}

	/** Scanner fisik (event global dari +layout.svelte) mengisi rak baris yang sedang aktif. */
	function onHardwareScan(ev: Event) {
		if (!recvRow) return;
		const { parsed } = (ev as CustomEvent).detail || {};
		if (parsed?.type !== 'LOC') return; // bukan QR rak → biarkan layout memberi toast
		ev.preventDefault();
		const rak = rakOpts.find((o) => o.id === Number(parsed.id));
		const line = recvLines.find((l) => l.id === activeRecvLineId) ?? recvLines.find((l) => !l.rakId);
		if (!rak) { error = `Rak #${parsed.id} bukan bagian dari gudang ${recvRow.to_nama}.`; return; }
		if (line) { line.rakId = rak.id; scanText[line.id] = rak.nama; }
	}
	onMount(() => {
		window.addEventListener('kiosk-hardware-scan', onHardwareScan);
		return () => window.removeEventListener('kiosk-hardware-scan', onHardwareScan);
	});

	async function submitTerima() {
		if (!recvRow) return;
		const tanpaAlasan = recvLines.find((l) => l.received !== l.quantity && !l.alasan.trim());
		if (
			tanpaAlasan &&
			!(await kioskConfirm({
				judul: 'Lanjut tanpa alasan?',
				isi: `"${tanpaAlasan.nama}" jumlahnya berbeda dari yang dikirim tapi belum ada alasan. Lanjut tanpa alasan?`,
				ya: 'Ya, lanjut',
				warna: 'oranye'
			}))
		)
			return;
		const tanpaRak = recvLines.find((l) => !l.rakId);
		if (
			tanpaRak &&
			!(await kioskConfirm({
				judul: 'Lanjut tanpa rak?',
				isi: `"${tanpaRak.nama}" belum dipilih rak tujuannya. Lanjut tanpa rak?`,
				ya: 'Ya, lanjut',
				warna: 'oranye'
			}))
		)
			return;
		busyId = recvRow.id; error = ''; notice = '';
		try {
			const data = await post(`/api/kiosk/gudang/transfer/${recvRow.id}/receive`, {
				lines: recvLines.map((l) => ({ id: l.id, received_quantity: l.received, to_rak_id: l.rakId, selisih_alasan: l.alasan || null }))
			});
			notice = `${recvRow.transfer_no} diterima — stok masuk ke ${recvRow.to_nama}.` + gateCatatan(data);
			recvRow = null;
			await load();
		} catch (e: any) {
			error = e.message;
		} finally {
			busyId = null;
		}
	}

	// ── Ajukan baru ──
	let gudangOpts = $state<Array<{ id: number; nama: string }>>([]);
	let toGudangId = $state<number | null>(null);
	let q = $state('');
	let hits = $state<Hit[]>([]);
	let searching = $state(false);
	let cart = $state<CartLine[]>([]);
	let catatan = $state('');
	let submitting = $state(false);
	let searchTimer: ReturnType<typeof setTimeout>;

	async function bukaBaru() {
		tab = 'baru';
		if (gudangOpts.length === 0) {
			try {
				const res = await fetch('/api/kiosk/gudang/transfer?gudang=1');
				if (res.ok) gudangOpts = (await res.json()).gudang || [];
			} catch { /* biarkan kosong */ }
		}
	}

	function onSearch() {
		clearTimeout(searchTimer);
		if (q.trim().length < 2) { hits = []; return; }
		searchTimer = setTimeout(async () => {
			searching = true;
			try {
				const res = await fetch(`/api/kiosk/stok/cari?q=${encodeURIComponent(q.trim())}`);
				hits = res.ok ? (await res.json()).hits || [] : [];
			} finally {
				searching = false;
			}
		}, 350);
	}

	function tambah(h: Hit) {
		if (cart.some((c) => c.item_id === h.identitas_barang_id)) { error = 'Barang ini sudah ada di daftar.'; return; }
		error = '';
		cart = [...cart, { item_id: h.identitas_barang_id, nama: h.nama_barang, satuan: h.satuan, from_rak_id: h.gudang_id, rak_nama: h.rak_nama, max: h.ledger_qty, quantity: 1 }];
		q = ''; hits = [];
	}

	async function ajukan() {
		error = ''; notice = '';
		if (!toGudangId) { error = 'Pilih gudang tujuan dulu.'; return; }
		if (cart.length === 0) { error = 'Tambahkan minimal satu barang.'; return; }
		const lebih = cart.find((c) => c.max != null && c.quantity > c.max);
		if (
			lebih &&
			!(await kioskConfirm({
				judul: 'Jumlah melebihi catatan?',
				isi: `"${lebih.nama}": jumlah ${lebih.quantity} melebihi catatan rak (${lebih.max}). Tetap ajukan?`,
				ya: 'Ya, tetap ajukan',
				warna: 'oranye'
			}))
		)
			return;
		submitting = true;
		try {
			const data = await post('/api/kiosk/gudang/transfer', {
				toGudangId, notes: catatan, items: cart.map((c) => ({ item_id: c.item_id, quantity: c.quantity, from_rak_id: c.from_rak_id }))
			});
			notice = `Transfer ${data?.transfer?.transfer_no || ''} diajukan. Menunggu persetujuan PIC gudang asal — stok belum berubah.`;
			cart = []; catatan = ''; toGudangId = null;
			tab = 'tindakan';
			await load();
		} catch (e: any) {
			error = e.message;
		} finally {
			submitting = false;
		}
	}
</script>

<div class="wrap">
	<div class="header-nav">
		<button class="back-btn" onclick={() => goto('/kiosk/gudang')} aria-label="Kembali">
			<IconArrowLeft size={20} /><span>Kembali</span>
		</button>
		<button class="help-btn" onclick={() => (showHelp = !showHelp)}><IconInfoCircle size={18} /> Cara pakai</button>
	</div>

	<h1>Transfer Antar Gudang</h1>

	{#if showHelp}
		<div class="help">
			<p><b>1. Ajukan</b> — pilih barang dari rak asal + gudang tujuan. Stok belum berubah.</p>
			<p><b>2. Setujui</b> — PIC gudang asal menyetujui: stok keluar dari asal, barang berstatus <i>Dalam Perjalanan</i>.</p>
			<p><b>3. Terima</b> — PIC gudang tujuan hitung fisik, scan/pilih rak tujuan, lalu konfirmasi: stok masuk ke rak.</p>
			<p>Pindah rak di <u>dalam satu gudang</u> tidak perlu transfer — pakai <b>Cek Stok Rak → Pindah Rak</b>.</p>
		</div>
	{/if}

	{#if error}<div class="msg err">{error}</div>{/if}
	{#if notice}<div class="msg ok">{notice}</div>{/if}

	<div class="tabs">
		<button class:active={tab === 'tindakan'} onclick={() => (tab = 'tindakan')}>Perlu Tindakan{perluTindakan.length ? ` (${perluTindakan.length})` : ''}</button>
		<button class:active={tab === 'baru'} onclick={bukaBaru}>+ Ajukan Baru</button>
		<button class:active={tab === 'riwayat'} onclick={() => (tab = 'riwayat')}>Riwayat</button>
	</div>

	{#if loading}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Transfer Barang..." sublabel="Mengambil data mutasi antar rak" />
		</div>
	{:else if tab === 'tindakan'}
		{#if perluTindakan.length === 0 && menunggu.length === 0}
			<p class="empty">Tidak ada transfer yang menunggu Anda. Ajukan transfer baru lewat tab “+ Ajukan Baru”.</p>
		{/if}
		{#each perluTindakan as r (r.id)}
			{@render kartu(r)}
		{/each}
		{#if menunggu.length}
			<h2>Menunggu pihak lain</h2>
			{#each menunggu as r (r.id)}
				{@render kartu(r)}
			{/each}
		{/if}
	{:else if tab === 'riwayat'}
		{#if riwayat.length === 0}<p class="empty">Belum ada riwayat 7 hari terakhir.</p>{/if}
		{#each riwayat as r (r.id)}
			{@render kartu(r)}
		{/each}
	{:else}
		<div class="panel">
			<label for="tujuan">1. Gudang tujuan</label>
			<select id="tujuan" bind:value={toGudangId}>
				<option value={null}>— pilih gudang tujuan —</option>
				{#each gudangOpts as g (g.id)}<option value={g.id}>{g.nama}</option>{/each}
			</select>

			<label for="cari">2. Cari barang di rak asal</label>
			<div class="search">
				<IconSearch size={18} />
				<input id="cari" bind:value={q} oninput={onSearch} placeholder="Ketik nama/kode barang (min. 2 huruf)…" autocomplete="off" />
				{#if searching}<IconLoader2 size={18} class="spin" />{/if}
			</div>
			{#if hits.length}
				<div class="hits">
					{#each hits as h (h.identitas_barang_id + ':' + h.gudang_id)}
						<button class="hit" onclick={() => tambah(h)}>
							<b>{h.nama_barang}</b>
							<span>{h.rak_nama}{h.rak_kode ? ` (${h.rak_kode})` : ''} · stok rak {h.ledger_qty ?? '?'} {h.satuan || ''}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if cart.length}
				<label>3. Jumlah yang dikirim</label>
				{#each cart as c, i (c.item_id)}
					<div class="line">
						<div class="grow"><b>{c.nama}</b><small>dari {c.rak_nama}{c.max != null ? ` · tersedia ${c.max}` : ''}</small></div>
						<input type="number" min="0.01" step="0.01" bind:value={c.quantity} aria-label="Jumlah {c.nama}" />
						<span>{c.satuan || ''}</span>
						<button class="ico" onclick={() => (cart = cart.filter((_, k) => k !== i))} aria-label="Hapus"><IconTrash size={18} /></button>
					</div>
				{/each}
			{/if}

			<label for="cat">Catatan (opsional)</label>
			<input id="cat" bind:value={catatan} placeholder="Mis. untuk kebutuhan SPK minggu depan" />

			<button class="primary" disabled={submitting || !toGudangId || cart.length === 0} onclick={ajukan}>
				{submitting ? 'Mengirim…' : 'Ajukan Transfer'}
			</button>
			<p class="hint">Tombol tetap aktif selama data lengkap — yang menunggu hanya perpindahan stoknya, sampai PIC gudang asal menyetujui.</p>
		</div>
	{/if}
</div>

{#snippet kartu(r: KioskTransferRow)}
	<div class="card">
		<div class="card-head">
			<b>{r.transfer_no}</b>
			<span class="st st-{r.status}">{STATUS_LABEL[r.status] || r.status}</span>
		</div>
		<div class="route">{r.from_nama} → {r.to_nama}</div>
		<ul>
			{#each r.items as i (i.id)}
				<li>{i.nama} — {i.quantity} {i.satuan || ''}{i.received_quantity != null && r.status === 'completed' ? ` (diterima ${i.received_quantity})` : ''}{i.from_rak_nama ? ` · dari ${i.from_rak_nama}` : ''}</li>
			{/each}
		</ul>
		{#if r.notes}<small>Catatan: {r.notes}</small>{/if}
		{#if r.rejected_reason}<small class="red">{r.rejected_reason}</small>{/if}
		{#if r.status === 'draft' && !r.bisa_setujui}<small>Menunggu persetujuan PIC gudang asal ({r.from_nama}).</small>{/if}
		{#if r.status === 'in_transit' && !r.bisa_terima}<small>Menunggu diterima PIC gudang tujuan ({r.to_nama}).</small>{/if}
		<div class="actions">
			{#if r.bisa_setujui}
				<button class="primary" disabled={busyId === r.id} onclick={() => setujui(r)}>Setujui</button>
				<button class="warn" disabled={busyId === r.id} onclick={() => { rejectRow = r; rejectReason = ''; }}>Tolak</button>
			{/if}
			{#if r.bisa_terima}
				<button class="primary" disabled={busyId === r.id} onclick={() => bukaTerima(r)}>Terima Barang</button>
			{/if}
			{#if r.bisa_batal}
				<button class="ghost" disabled={busyId === r.id} onclick={() => batalkan(r)}>Batalkan</button>
			{/if}
		</div>
	</div>
{/snippet}

{#if rejectRow}
	<div class="overlay" role="dialog" aria-modal="true">
		<div class="modal">
			<h2>Tolak {rejectRow.transfer_no}</h2>
			<label for="alasan-tolak">Alasan penolakan (min. 5 karakter)</label>
			<textarea id="alasan-tolak" bind:value={rejectReason} rows="3" placeholder="Mis. stok dikunci untuk SPK"></textarea>
			<div class="actions">
				<button class="ghost" onclick={() => (rejectRow = null)}>Batal</button>
				<button class="warn" disabled={rejectReason.trim().length < 5 || busyId === rejectRow.id} onclick={submitReject}>Tolak Transfer</button>
			</div>
		</div>
	</div>
{/if}

{#if recvRow}
	<div class="overlay" role="dialog" aria-modal="true">
		<div class="modal wide">
			<h2>Terima {recvRow.transfer_no}</h2>
			<p class="hint">Hitung fisik yang benar-benar tiba — jumlah inilah yang masuk stok {recvRow.to_nama}. Arahkan scanner ke QR yang ditempel di rak — rak otomatis terisi di baris yang sedang dipilih (atau pilih dari daftar).</p>
			{#each recvLines as l (l.id)}
				<div class="recv">
					<div class="line"><div class="grow"><b>{l.nama}</b><small>dikirim {l.quantity} {l.satuan || ''}</small></div></div>
					<div class="grid2">
						<div>
							<label for="q-{l.id}">Qty diterima</label>
							<input id="q-{l.id}" type="number" min="0" step="0.01" bind:value={l.received} />
						</div>
						<div>
							<label for="s-{l.id}">Scan / ketik rak tujuan</label>
							<input
								id="s-{l.id}"
								value={scanText[l.id] || ''}
								oninput={(e) => cocokkanRak(l, e.currentTarget.value)}
								onfocus={() => (activeRecvLineId = l.id)}
								placeholder="Scan QR rak…"
								autocomplete="off"
							/>
						</div>
					</div>
					<select bind:value={l.rakId} aria-label="Rak tujuan {l.nama}">
						<option value={null}>— pilih rak tujuan —</option>
						{#each rakOpts as o (o.id)}<option value={o.id}>{o.nama}{o.kode ? ` (${o.kode})` : ''}</option>{/each}
					</select>
					{#if l.rakId}
						<small class="ok-rak">✓ Rak tujuan: {rakOpts.find((o) => o.id === l.rakId)?.nama || l.rakId}</small>
					{/if}
					{#if l.received !== l.quantity}
						<input class="alasan" bind:value={l.alasan} placeholder="Alasan selisih (mis. rusak di jalan)" />
					{/if}
				</div>
			{/each}
			<div class="actions">
				<button class="ghost" onclick={() => (recvRow = null)}>Batal</button>
				<button class="primary" disabled={busyId === recvRow.id} onclick={submitTerima}>{busyId === recvRow.id ? 'Menyimpan…' : 'Konfirmasi Terima'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.wrap { padding: 1rem 1.25rem 2rem; display: flex; flex-direction: column; gap: 0.9rem; max-width: 900px; margin: 0 auto; box-sizing: border-box; }
	.header-nav { display: flex; justify-content: space-between; align-items: center; }
	.back-btn, .help-btn { display: inline-flex; align-items: center; gap: 0.4rem; background: #fff; border: 1px solid #cbd5e1; color: #334155; font-weight: 700; padding: 0.55rem 1rem; border-radius: 9999px; cursor: pointer; min-height: 44px; touch-action: manipulation; }
	h1 { font-size: 1.5rem; margin: 0; color: #0f172a; }
	h2 { font-size: 1.05rem; margin: 0.5rem 0 0; color: #334155; }
	.help { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; padding: 0.75rem 1rem; border-radius: 0.75rem; font-size: 0.9rem; }
	.help p { margin: 0.2rem 0; }
	.msg { padding: 0.7rem 1rem; border-radius: 0.75rem; font-size: 0.92rem; }
	.msg.err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
	.msg.ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
	.tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.tabs button { flex: 1; min-height: 48px; border: 1px solid #cbd5e1; background: #fff; border-radius: 0.75rem; font-weight: 700; color: #475569; cursor: pointer; }
	.tabs button.active { background: #0f172a; color: #fff; border-color: #0f172a; }
	.center { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 2rem; color: #64748b; }
	.empty { color: #64748b; text-align: center; padding: 1.5rem 0.5rem; }
	.card, .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.card-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.route { color: #334155; font-weight: 600; }
	ul { margin: 0; padding-left: 1.1rem; font-size: 0.92rem; color: #334155; }
	small { color: #64748b; }
	small.red { color: #b91c1c; }
	.st { font-size: 0.78rem; font-weight: 800; padding: 0.2rem 0.6rem; border-radius: 9999px; background: #f1f5f9; color: #475569; }
	.st-draft { background: #fef3c7; color: #92400e; }
	.st-in_transit { background: #dbeafe; color: #1e40af; }
	.st-completed { background: #dcfce7; color: #166534; }
	.st-rejected, .st-cancelled { background: #fee2e2; color: #991b1b; }
	.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.3rem; }
	button.primary, button.warn, button.ghost { min-height: 48px; padding: 0 1.2rem; border-radius: 0.75rem; font-weight: 800; font-size: 1rem; cursor: pointer; border: 1px solid transparent; touch-action: manipulation; }
	button.primary { background: #047857; color: #fff; }
	button.warn { background: #ea580c; color: #fff; }
	button.ghost { background: #fff; color: #475569; border-color: #cbd5e1; }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	label { font-weight: 700; color: #334155; font-size: 0.9rem; margin-top: 0.4rem; }
	input, select, textarea { min-height: 46px; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 0.7rem; font-size: 1rem; background: #fff; box-sizing: border-box; width: 100%; }
	.search { display: flex; align-items: center; gap: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.7rem; padding: 0 0.75rem; background: #fff; }
	.search input { border: none; min-height: 46px; padding: 0; }
	.hits { display: flex; flex-direction: column; gap: 0.35rem; max-height: 260px; overflow-y: auto; }
	.hit { text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.7rem; padding: 0.6rem 0.8rem; display: flex; flex-direction: column; cursor: pointer; min-height: 48px; }
	.hit span { color: #64748b; font-size: 0.85rem; }
	.line { display: flex; align-items: center; gap: 0.6rem; }
	.line input { width: 100px; }
	.grow { flex: 1; display: flex; flex-direction: column; }
	.ico { background: none; border: none; color: #b91c1c; cursor: pointer; min-height: 44px; min-width: 44px; }
	.hint { color: #64748b; font-size: 0.85rem; margin: 0; }
	.overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 50; }
	.modal { background: #fff; border-radius: 1rem; padding: 1.2rem; width: 100%; max-width: 480px; max-height: 92vh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; }
	.modal.wide { max-width: 720px; }
	.recv { border: 1px solid #e2e8f0; border-radius: 0.8rem; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
	.alasan { border-color: #fcd34d; background: #fffbeb; }
	.ok-rak { color: #15803d; font-weight: 700; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
