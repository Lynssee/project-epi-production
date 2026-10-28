<!-- RSM-13 — Mutasi Barang (e-SJ Mutasi) untuk leader lapangan.
     Satu dokumen menggantikan "Pindah Proyek" langsung: proyek tujuan menyetujui → barang dikirim (foto) → leader tujuan
     menghitung & menerima (foto). Semua aturan diputuskan mesin di server admin; layar ini hanya mengisi & menampilkan. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { IconArrowsExchange, IconCamera, IconLoader2, IconInfoCircle, IconCheck, IconX, IconTruckDelivery } from '@tabler/icons-svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getProjects } from '$lib/services/projects';
	import { getAllStockBalancesForProjects, type LowStockBalanceRow } from '$lib/services/projectStockBalanceApi';
	import {
		getMutasiStatus, listMutasi, ajukanMutasi, aksiMutasi, getQtyTerkunci, aksiUntukSaya, perluTindakanSaya, qtyBolehDimutasi,
		validasiFormAjukan, LABEL_STATUS, type Mutasi, type AksiMutasi
	} from '$lib/services/mutasiApi';

	let loading = $state(true);
	let tersedia = $state(true);
	let alasanTidakTersedia = $state<string | null>(null);
	let error = $state('');
	let pesan = $state('');
	let me = $state<{ karyawanId: number; projectIds: number[] }>({ karyawanId: 0, projectIds: [] });
	let daftar = $state<Mutasi[]>([]);
	let tab = $state<'tindakan' | 'semua' | 'ajukan'>('tindakan');

	// ── Ajukan ────────────────────────────────────────────────────────────────
	let myProjects = $state<any[]>([]);
	let allProjects = $state<any[]>([]);
	let asal = $state<number | ''>('');
	let tujuan = $state<number | ''>('');
	let rute = $state<'langsung_site' | 'via_gudang'>('langsung_site');
	let alasan = $state('');
	let saldoRows = $state<LowStockBalanceRow[]>([]);
	let terkunci = $state<Record<number, number>>({});
	let pilih = $state<Record<number, number>>({}); // item_id → qty (ada = dipilih)
	let alasanGate = $state('');
	let submitting = $state(false);
	let clientTxnId = $state(crypto.randomUUID());

	// ── Dialog aksi ───────────────────────────────────────────────────────────
	let dialog = $state<{ m: Mutasi; aksi: AksiMutasi } | null>(null);
	let catatan = $state('');
	let sopir = $state('');
	let hp = $state('');
	let plat = $state('');
	let terimaQty = $state<Record<number, number>>({});
	let terimaAlasan = $state<Record<number, string>>({});
	let fotos = $state<File[]>([]);
	let showCamera = $state(false);
	let busyAksi = $state(false);

	const perluTindakan = $derived(daftar.filter((m) => perluTindakanSaya(m, me)));
	const tampil = $derived(tab === 'tindakan' ? perluTindakan : daftar);

	onMount(async () => {
		try {
			const st = await getMutasiStatus();
			tersedia = st.tersedia;
			alasanTidakTersedia = st.alasan;
			if (!tersedia) return;
			await Promise.all([muat(), muatProyek()]);
			const q = page.url.searchParams;
			if (q.get('asal')) {
				tab = 'ajukan';
				asal = Number(q.get('asal')) || '';
				await gantiAsal();
				const item = Number(q.get('item'));
				if (item && saldoRows.some((r) => r.item_id === item)) pilih = { [item]: qtyBolehDimutasi(saldoRows.find((r) => r.item_id === item)!.qty_on_hand, terkunci[item] || 0) };
			}
		} catch (e: any) {
			error = e?.message || 'Gagal memuat Mutasi Barang.';
		} finally {
			loading = false;
		}
	});

	async function muat() {
		const r = await listMutasi({});
		daftar = r.data || [];
		me = r.aktor;
		if (!perluTindakan.length && tab === 'tindakan') tab = daftar.length ? 'semua' : 'tindakan';
	}
	async function muatProyek() {
		myProjects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
		allProjects = (await getProjects(null, true, null, { limit: 500, sort: 'name' })) || [];
	}
	const namaProyek = (p: any) => p?.nama_project || p?.name || `Proyek #${p?.id}`;

	async function gantiAsal() {
		pilih = {};
		saldoRows = [];
		terkunci = {};
		if (!asal) return;
		const [rows, lock] = await Promise.all([getAllStockBalancesForProjects([Number(asal)]), getQtyTerkunci(Number(asal))]);
		saldoRows = rows.filter((r) => r.qty_on_hand > 0);
		terkunci = lock;
	}
	function togglePilih(r: LowStockBalanceRow) {
		const maks = qtyBolehDimutasi(r.qty_on_hand, terkunci[r.item_id] || 0);
		if (pilih[r.item_id] != null) {
			const { [r.item_id]: _, ...sisa } = pilih;
			pilih = sisa;
		} else if (maks > 0) pilih = { ...pilih, [r.item_id]: maks };
	}

	async function kirimPengajuan() {
		error = ''; pesan = '';
		const items = Object.entries(pilih).map(([id, qty]) => ({ item_id: Number(id), qty: Number(qty), maks: qtyBolehDimutasi(saldoRows.find((r) => r.item_id === Number(id))?.qty_on_hand || 0, terkunci[Number(id)] || 0) }));
		const bad = validasiFormAjukan({ asal, tujuan, alasan, items });
		if (bad) { error = bad; return; }
		submitting = true;
		try {
			const r = await ajukanMutasi({
				jenis: 'proyek_ke_proyek', asal_id: Number(asal), tujuan_id: Number(tujuan), rute, alasan: alasan.trim(),
				items: items.map((i) => ({ item_id: i.item_id, qty: i.qty })), client_txn_id: clientTxnId, ...(alasanGate.trim() ? { alasan_gate: alasanGate.trim() } : {})
			});
			pesan = `Mutasi ${r.data.nomor_mutasi} diajukan. Menunggu persetujuan proyek tujuan — saldo Anda belum berubah.${r.peringatan?.length ? ' Perhatian: ' + r.peringatan.join(' ') : ''}`;
			asal = ''; tujuan = ''; alasan = ''; alasanGate = ''; pilih = {}; saldoRows = []; clientTxnId = crypto.randomUUID();
			await muat();
			tab = 'semua';
		} catch (e: any) {
			error = e?.message || 'Gagal mengajukan mutasi.';
		} finally {
			submitting = false;
		}
	}

	function bukaDialog(m: Mutasi, aksi: AksiMutasi) {
		dialog = { m, aksi };
		catatan = ''; sopir = ''; hp = ''; plat = ''; fotos = []; error = '';
		terimaQty = Object.fromEntries(m.items.map((i) => [i.id, i.qty]));
		terimaAlasan = {};
	}
	async function ambilFoto(file: File) {
		showCamera = false;
		try {
			fotos = [...fotos, await compressPhoto(file)];
		} catch {
			error = 'Gagal memproses foto. Coba lagi.';
		}
	}
	async function unggahFoto(ctx: string): Promise<string[]> {
		const ids: string[] = [];
		for (const f of fotos) {
			const id = await uploadEvidencePhoto(f, ctx);
			if (!id) throw new Error('Gagal mengunggah foto. Periksa sinyal lalu coba lagi.');
			ids.push(id);
		}
		return ids;
	}
	async function jalankanAksi() {
		if (!dialog || busyAksi) return;
		const { m, aksi } = dialog;
		error = '';
		busyAksi = true;
		try {
			const body: Record<string, unknown> = { catatan: catatan.trim() };
			if (aksi === 'kirim') {
				body.driver_name = sopir.trim() || null; body.driver_phone = hp.trim() || null; body.vehicle_plate = plat.trim() || null;
				body.foto_kirim = await unggahFoto(`mutasi_kirim:${m.id}`);
			}
			if (aksi === 'terima') {
				body.items = m.items.map((i) => ({ item_row_id: i.id, qty_diterima: Number(terimaQty[i.id] ?? 0), alasan_selisih: terimaAlasan[i.id] || undefined }));
				body.foto_terima = await unggahFoto(`mutasi_terima:${m.id}`);
			}
			await aksiMutasi(m.id, aksi, body);
			pesan = { setujui: 'Mutasi disetujui.', tolak: 'Mutasi ditolak.', kirim: 'Barang diberangkatkan. Saldo proyek asal sudah berkurang.', terima: 'Penerimaan tercatat. Saldo proyek Anda bertambah sebesar jumlah yang tiba.', batal: 'Mutasi dibatalkan.' }[aksi];
			dialog = null;
			await muat();
		} catch (e: any) {
			error = e?.message || 'Aksi gagal.';
		} finally {
			busyAksi = false;
		}
	}

	const LABEL_AKSI: Record<AksiMutasi, string> = { setujui: 'Setujui', tolak: 'Tolak', kirim: 'Berangkatkan', terima: 'Terima barang', batal: 'Batalkan' };
	const WARNA: Record<string, string> = { diajukan: 'bg-amber-100 text-amber-800', disetujui_tujuan: 'bg-sky-100 text-sky-800', dikirim: 'bg-indigo-100 text-indigo-800', lolos_gerbang: 'bg-indigo-100 text-indigo-800', diterima: 'bg-emerald-100 text-emerald-800', diterima_sebagian: 'bg-orange-100 text-orange-800', ditolak: 'bg-red-100 text-red-800', batal: 'bg-slate-100 text-slate-600' };
	const perluAlasanAksi = (a: AksiMutasi) => a === 'tolak' || a === 'batal';
</script>

<svelte:head><title>Mutasi Barang</title></svelte:head>

<div class="max-w-2xl mx-auto p-3 space-y-3">
	<div>
		<h1 class="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><IconArrowsExchange size={18} /> Mutasi Barang</h1>
		<p class="text-[11px] text-slate-500 flex gap-1"><IconInfoCircle size={13} class="shrink-0 mt-0.5" />
			Pindahkan barang sisa ke proyek lain tanpa lewat gudang. Proyek tujuan harus menyetujui, lalu leader tujuan memindai QR saat barang tiba. Biaya barang ikut pindah ke proyek tujuan.</p>
	</div>

	{#if pesan}<div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-2.5">{pesan}</div>{/if}
	{#if error}<div class="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs p-2.5">{error}</div>{/if}

	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={4} label="Memuat…" />
	{:else if !tersedia}
		<div class="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 space-y-1.5">
			<p class="font-semibold">Fitur Mutasi Barang belum aktif di sistem.</p>
			<p>{alasanTidakTersedia || ''}</p>
			<p>Sementara itu, kabari Admin Inventory &amp; PM lewat WA (barang, jumlah, proyek tujuan, foto), atau gunakan tombol <strong>Pindah</strong> di Saldo Barang Saya.</p>
			<a href="/packing-list" class="inline-block mt-1 underline font-semibold">Ke Saldo Barang Saya</a>
		</div>
	{:else}
		<div class="flex gap-1 border-b border-slate-200 dark:border-slate-700 text-xs">
			{#each [['tindakan', `Perlu tindakan (${perluTindakan.length})`], ['semua', `Semua aktif (${daftar.length})`], ['ajukan', 'Ajukan mutasi']] as [k, label]}
				<button type="button" class="px-3 py-2 -mb-px border-b-2 font-semibold {tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}" onclick={() => (tab = k as typeof tab)}>{label}</button>
			{/each}
		</div>

		{#if tab !== 'ajukan'}
			{#if tab === 'tindakan'}
				<p class="text-[11px] text-slate-500">Setujui hanya bila barang memang dibutuhkan proyek Anda — nilainya akan masuk realisasi proyek Anda.</p>
			{/if}
			{#each tampil as m (m.id)}
				{@const aksi = aksiUntukSaya(m, me)}
				<div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs space-y-1.5">
					<div class="flex items-start justify-between gap-2">
						<p class="font-bold text-slate-800 dark:text-slate-100 break-all">{m.nomor_mutasi}</p>
						<span class="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full {WARNA[m.status] || 'bg-slate-100 text-slate-600'}">{LABEL_STATUS[m.status] || m.status}</span>
					</div>
					<p class="text-slate-600">{m.asal_nama} → {m.tujuan_nama}{m.rute === 'via_gudang' ? ' · via gerbang' : ''}</p>
					<ul class="list-disc pl-4 text-slate-700">
						{#each m.items as it (it.id)}<li>{it.nama} — {it.qty} {it.unit || ''}{it.qty_diterima != null ? ` (diterima ${it.qty_diterima})` : ''}</li>{/each}
					</ul>
					<p class="text-slate-500">Alasan: {m.alasan}</p>
					{#if m.langkah && m.status === 'diajukan'}<p class="text-[11px] text-amber-700">Menunggu: langkah {m.langkah.urut}/{m.langkah.total} — {m.langkah.label || m.langkah.role}</p>{/if}
					{#if m.rute === 'via_gudang' && m.status === 'dikirim'}<p class="text-[11px] text-indigo-700">Menunggu lolos gerbang sebelum bisa diterima.</p>{/if}
					{#if aksi.length}
						<div class="flex flex-wrap gap-1.5 pt-1">
							{#each aksi as a}
								<button type="button" class="px-3 py-1.5 rounded-lg font-semibold text-[11px] {a === 'tolak' || a === 'batal' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-indigo-600 text-white'}" onclick={() => bukaDialog(m, a)}>{LABEL_AKSI[a]}</button>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-xs text-slate-400 italic text-center py-8">{tab === 'tindakan' ? 'Tidak ada mutasi yang menunggu tindakan Anda.' : 'Belum ada mutasi aktif.'}</p>
			{/each}
		{:else}
			<div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2.5 text-xs">
				<label class="block"><span class="text-[10px] font-semibold text-slate-500">Dari proyek (yang Anda pimpin)</span>
					<select class="w-full border rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800" bind:value={asal} onchange={gantiAsal}>
						<option value="">— pilih —</option>
						{#each myProjects as p (p.id)}<option value={p.id}>{namaProyek(p)}</option>{/each}
					</select></label>
				<label class="block"><span class="text-[10px] font-semibold text-slate-500">Ke proyek</span>
					<select class="w-full border rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800" bind:value={tujuan}>
						<option value="">— pilih —</option>
						{#each allProjects.filter((p) => p.id !== asal) as p (p.id)}<option value={p.id}>{namaProyek(p)}</option>{/each}
					</select></label>
				<div>
					<span class="text-[10px] font-semibold text-slate-500">Rute</span>
					<label class="flex items-center gap-2"><input type="radio" bind:group={rute} value="langsung_site" /> Langsung site → site (default)</label>
					<label class="flex items-center gap-2"><input type="radio" bind:group={rute} value="via_gudang" /> Lewat gerbang gudang/workshop (satpam memeriksa)</label>
				</div>
				<div>
					<span class="text-[10px] font-semibold text-slate-500">Barang yang dipindah</span>
					{#if !asal}<p class="text-slate-400 italic">Pilih proyek asal dulu.</p>
					{:else if !saldoRows.length}<p class="text-slate-400 italic">Tidak ada saldo barang di proyek ini.</p>{/if}
					{#each saldoRows as r (r.item_id)}
						{@const maks = qtyBolehDimutasi(r.qty_on_hand, terkunci[r.item_id] || 0)}
						<div class="flex items-center gap-2 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
							<input type="checkbox" checked={pilih[r.item_id] != null} disabled={maks <= 0 && pilih[r.item_id] == null} onchange={() => togglePilih(r)} />
							<div class="flex-1 min-w-0">
								<p class="truncate">{r.item_name}</p>
								<p class="text-[10px] text-slate-500">saldo {r.qty_on_hand} {r.item_satuan}{(terkunci[r.item_id] || 0) > 0 ? ` · ${terkunci[r.item_id]} terkunci pengajuan lain` : ''}</p>
							</div>
							{#if pilih[r.item_id] != null}
								<input type="number" min="0" max={maks} step="any" class="w-20 border rounded px-1.5 py-1 text-right bg-white dark:bg-slate-800" bind:value={pilih[r.item_id]} />
							{/if}
						</div>
					{/each}
				</div>
				<label class="block"><span class="text-[10px] font-semibold text-slate-500">Alasan (min. 20 karakter)</span>
					<textarea rows="2" class="w-full border rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800" placeholder="Mis. sisa scaffolding proyek A dibutuhkan proyek B minggu ini" bind:value={alasan}></textarea></label>
				<label class="block"><span class="text-[10px] font-semibold text-slate-500">Alasan pengecualian (hanya bila diminta sistem karena melebihi saldo)</span>
					<input class="w-full border rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800" bind:value={alasanGate} /></label>
				<button type="button" class="w-full py-2 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-1.5" disabled={submitting} onclick={kirimPengajuan}>
					{#if submitting}<IconLoader2 size={14} class="animate-spin" />{/if} Ajukan Mutasi
				</button>
				<p class="text-[10px] text-slate-500">Saldo Anda belum berubah saat diajukan. Barang yang diajukan dikunci (tidak bisa diretur/dipindah lagi) sampai mutasi berangkat atau dibatalkan.</p>
			</div>
		{/if}
	{/if}
</div>

{#if dialog}
	<div class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
		<div class="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-4 space-y-2.5 text-xs">
			<h3 class="text-sm font-bold">{LABEL_AKSI[dialog.aksi]} — {dialog.m.nomor_mutasi}</h3>
			{#if dialog.aksi === 'kirim'}
				<p class="text-slate-500">Foto barang di kendaraan wajib. Saat diberangkatkan, saldo proyek asal berkurang.</p>
				<input class="w-full border rounded-lg px-2.5 py-1.5" placeholder="Nama sopir" bind:value={sopir} />
				<input class="w-full border rounded-lg px-2.5 py-1.5" placeholder="No. HP sopir" bind:value={hp} />
				<input class="w-full border rounded-lg px-2.5 py-1.5" placeholder="Plat kendaraan" bind:value={plat} />
			{/if}
			{#if dialog.aksi === 'terima'}
				<p class="text-slate-500">Hitung barang yang benar-benar tiba. Selisih akan dicatat sebagai barang bermasalah.</p>
				{#each dialog.m.items as it (it.id)}
					<div class="border rounded-lg p-2 space-y-1">
						<p>{it.nama} — dikirim {it.qty} {it.unit || ''}</p>
						<input type="number" min="0" max={it.qty} step="any" class="w-full border rounded px-2 py-1" bind:value={terimaQty[it.id]} />
						{#if Number(terimaQty[it.id]) < it.qty}
							<input class="w-full border rounded px-2 py-1" placeholder="Alasan selisih (wajib)" bind:value={terimaAlasan[it.id]} />
						{/if}
					</div>
				{/each}
			{/if}
			{#if dialog.aksi === 'kirim' || dialog.aksi === 'terima'}
				<div>
					<div class="flex flex-wrap gap-1.5 mb-1.5">
						{#each fotos as f}<span class="text-[10px] px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-1"><IconCheck size={11} /> {Math.round(f.size / 1024)} KB</span>{/each}
					</div>
					<button type="button" class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-slate-300 text-slate-600 font-semibold" onclick={() => (showCamera = true)}><IconCamera size={15} /> {fotos.length ? 'Tambah foto' : 'Ambil foto (disarankan)'}</button>
				</div>
			{/if}
			<textarea rows="2" class="w-full border rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800" placeholder={perluAlasanAksi(dialog.aksi) ? 'Alasan (min. 10 karakter, wajib)' : 'Catatan (opsional)'} bind:value={catatan}></textarea>
			{#if error}<p class="text-red-600">{error}</p>{/if}
			<div class="flex gap-2 pt-1">
				<button type="button" class="flex-1 py-2 rounded-lg border font-semibold" disabled={busyAksi} onclick={() => (dialog = null)}><IconX size={13} class="inline" /> Tutup</button>
				<button type="button" class="flex-1 py-2 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-1.5" disabled={busyAksi} onclick={jalankanAksi}>
					{#if busyAksi}<IconLoader2 size={14} class="animate-spin" />{:else}<IconTruckDelivery size={14} />{/if} {LABEL_AKSI[dialog.aksi]}
				</button>
			</div>
		</div>
	</div>
{/if}
{#if showCamera}
	<CameraCaptureModal onCapture={ambilFoto} onClose={() => (showCamera = false)} />
{/if}
