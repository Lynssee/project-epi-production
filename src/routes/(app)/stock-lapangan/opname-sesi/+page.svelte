<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchSesiAktif, fetchDetailSesi, simpanHitungan, ALASAN_SELISIH, type SesiRingkas, type BarisHitung } from '$lib/services/opnameSesiApi';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { vibrateTap } from '$lib/utils/haptic';
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import {
		IconArrowLeft,
		IconLoader2,
		IconCircleCheck,
		IconClipboardCheck,
		IconCamera,
		IconQrcode,
		IconAlertTriangle,
		IconRefresh,
		IconCalculator,
		IconX,
		IconCheck,
		IconBuilding
	} from '@tabler/icons-svelte';

	// Lifecycle Inventory Tahap 6 — F4 & SOP-PRJ-320 / SOP-LOG-015:
	// Hitung fisik untuk SESI opname site proyek & gudang yang dibuat admin.
	// Blind count ditegakkan di server: layar ini tidak pernah menerima qty sistem saat sesi blind.

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_stock_lapangan', roles)) goto('/');
	});

	let loading = $state(true);
	let errorMsg = $state('');
	let sesiList = $state<SesiRingkas[]>([]);

	let aktif = $state<SesiRingkas | null>(null);
	let lines = $state<BarisHitung[]>([]);
	let loadingDetail = $state(false);
	let tab = $state<'semua' | 'belum' | 'recount'>('belum');
	let search = $state('');
	let rakFilter = $state<number | null>(null);
	let itemFilter = $state<number | null>(null);
	let scanInfo = $state('');

	// Draf hitungan lokal (tahan refresh / sinyal putus) — kunci per sesi
	let drafts = $state<Record<number, string>>({});
	let catatanDraft = $state<Record<number, string>>({});
	let buktiPerlu = $state<Record<number, boolean>>({}); // lineId -> server minta foto/alasan
	let alasanDraft = $state<Record<number, string>>({});
	let fotoDraft = $state<Record<number, File | null>>({});
	let saving = $state(false);
	let saveMsg = $state('');
	let showScanner = $state<'rak' | 'item' | null>(null);
	let showSopGuide = $state(false);

	// Kalkulator Kaleng Cat & Limbah B3 (SOP-LOG-015 & SOP-PRJ-320)
	let kalkulatorLine = $state<BarisHitung | null>(null);
	let kalUtuh = $state<number | ''>('');
	let kalBuka = $state<number | ''>('');
	let kalKosongB3 = $state<number | ''>('');

	const draftKey = (id: number) => `opname_sesi_draft_${id}`;
	const catatanKey = (id: number) => `opname_sesi_catatan_${id}`;

	function loadDraft(id: number) {
		try {
			drafts = JSON.parse(localStorage.getItem(draftKey(id)) || '{}');
			catatanDraft = JSON.parse(localStorage.getItem(catatanKey(id)) || '{}');
		} catch {
			drafts = {};
			catatanDraft = {};
		}
	}
	function persistDraft() {
		if (!aktif) return;
		try {
			localStorage.setItem(draftKey(aktif.id), JSON.stringify(drafts));
			localStorage.setItem(catatanKey(aktif.id), JSON.stringify(catatanDraft));
		} catch {
			/* penyimpanan penuh/diblok — draf tetap hidup di memori */
		}
	}

	async function loadList() {
		loading = true;
		errorMsg = '';
		try {
			sesiList = (await fetchSesiAktif()).sesi;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat sesi opname.';
		} finally {
			loading = false;
		}
	}

	async function bukaSesi(s: SesiRingkas) {
		vibrateTap();
		aktif = s;
		loadingDetail = true;
		errorMsg = '';
		rakFilter = null;
		itemFilter = null;
		scanInfo = '';
		buktiPerlu = {};
		try {
			const d = await fetchDetailSesi(s.id);
			lines = d.lines;
			loadDraft(s.id);
			tab = lines.some((l) => l.status === 'recount') ? 'recount' : 'belum';
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal membuka sesi.';
			aktif = null;
		} finally {
			loadingDetail = false;
		}
	}

	const sudahDihitung = (l: BarisHitung) => l.qty_fisik !== null && l.qty_fisik !== undefined && l.status !== 'recount';
	let tampil = $derived(
		lines.filter((l) => {
			if (rakFilter && l.rak_id !== rakFilter) return false;
			if (itemFilter && l.item_id !== itemFilter) return false;
			if (tab === 'belum' && (sudahDihitung(l) || l.status === 'recount') && drafts[l.id] === undefined) return false;
			if (tab === 'recount' && l.status !== 'recount') return false;
			if (search && !`${l.nama} ${l.kode_item || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
			return true;
		})
	);
	let jmlBelum = $derived(lines.filter((l) => !sudahDihitung(l) && l.status !== 'recount').length);
	let jmlRecount = $derived(lines.filter((l) => l.status === 'recount').length);
	let jmlDraf = $derived(Object.keys(drafts).filter((k) => drafts[Number(k)] !== '').length);
	let raks = $derived([...new Map(lines.filter((l) => l.rak_id).map((l) => [l.rak_id as number, l.rak_nama || `Rak #${l.rak_id}`])).entries()]);

	function setDraft(l: BarisHitung, v: string) {
		drafts = { ...drafts, [l.id]: v };
		if (v === '') {
			const { [l.id]: _drop, ...rest } = drafts;
			drafts = rest;
		}
		persistDraft();
	}

	function bukaKalkulatorKaleng(l: BarisHitung) {
		vibrateTap();
		kalkulatorLine = l;
		kalUtuh = '';
		kalBuka = '';
		kalKosongB3 = '';
		const catatanAda = catatanDraft[l.id] || l.catatan || '';
		const mUtuh = catatanAda.match(/Utuh:\s*([\d.]+)/i);
		const mBuka = catatanAda.match(/Buka:\s*([\d.]+)/i);
		const mB3 = catatanAda.match(/Kaleng Kosong B3:\s*([\d.]+)/i);
		if (mUtuh) kalUtuh = Number(mUtuh[1]);
		if (mBuka) kalBuka = Number(mBuka[1]);
		if (mB3) kalKosongB3 = Number(mB3[1]);
	}

	function terapkanKalkulatorKaleng() {
		if (!kalkulatorLine) return;
		vibrateTap();
		const u = Number(kalUtuh) || 0;
		const b = Number(kalBuka) || 0;
		const b3 = Number(kalKosongB3) || 0;
		const total = Number((u + b).toFixed(3));
		setDraft(kalkulatorLine, String(total));
		catatanDraft = {
			...catatanDraft,
			[kalkulatorLine.id]: `[SOP-LOG-015] Utuh: ${u}, Buka: ${b}, Kaleng Kosong B3: ${b3}`
		};
		persistDraft();
		kalkulatorLine = null;
	}

	async function simpanSemua() {
		if (!aktif || saving) return;
		vibrateTap();
		const entries = Object.entries(drafts)
			.filter(([, v]) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0)
			.map(([id, v]) => ({
				lineId: Number(id),
				qtyFisik: Number(v),
				catatan: catatanDraft[Number(id)] || undefined,
				alasan: alasanDraft[Number(id)] || undefined
			}));
		if (!entries.length) return;
		saving = true;
		saveMsg = '';
		try {
			const res = await simpanHitungan(aktif.id, entries);
			const gagal = res.hasil.filter((h) => !h.ok);
			const next = { ...drafts };
			const nextCatatan = { ...catatanDraft };
			for (const h of res.hasil) {
				if (!h.ok) continue;
				delete next[h.lineId];
				delete nextCatatan[h.lineId];
				const idx = lines.findIndex((l) => l.id === h.lineId);
				if (idx >= 0) {
					lines[idx] = {
						...lines[idx],
						qty_fisik: entries.find((e) => e.lineId === h.lineId)!.qtyFisik,
						catatan: entries.find((e) => e.lineId === h.lineId)?.catatan || lines[idx].catatan,
						status: 'counted'
					};
				}
				if (h.perlu_bukti) buktiPerlu = { ...buktiPerlu, [h.lineId]: true };
			}
			drafts = next;
			catatanDraft = nextCatatan;
			persistDraft();
			aktif = { ...aktif, counted_lines: res.counted_lines };
			saveMsg = gagal.length ? `${entries.length - gagal.length} tersimpan, ${gagal.length} gagal: ${gagal[0].error}` : `${entries.length} hitungan tersimpan ✓`;
		} catch (e: any) {
			// jaringan putus: draf TETAP di perangkat, dicoba lagi saat online
			saveMsg = navigator.onLine ? e?.message || 'Gagal menyimpan.' : 'Tidak ada sinyal — hitungan aman di perangkat, akan dikirim saat online.';
		} finally {
			saving = false;
		}
	}

	async function kirimBukti(l: BarisHitung) {
		if (!aktif) return;
		vibrateTap();
		const file = fotoDraft[l.id];
		const alasan = alasanDraft[l.id];
		if (!file && !alasan) {
			saveMsg = 'Pilih alasan dan/atau ambil foto dulu.';
			return;
		}
		saving = true;
		try {
			let fotoId: string | null = null;
			if (file) fotoId = await uploadEvidencePhoto(await compressPhoto(file), 'opname_sesi:bukti');
			if (file && !fotoId) throw new Error('Foto gagal diunggah. Coba lagi.');
			await simpanHitungan(aktif.id, [{ lineId: l.id, qtyFisik: l.qty_fisik, alasan: alasan || null, foto: fotoId, catatan: catatanDraft[l.id] || undefined }]);
			buktiPerlu = { ...buktiPerlu, [l.id]: false };
			saveMsg = 'Bukti tersimpan ✓';
		} catch (e: any) {
			saveMsg = e?.message || 'Gagal mengirim bukti.';
		} finally {
			saving = false;
		}
	}

	function onScan(value: string) {
		const mode = showScanner;
		showScanner = null;
		const p = parseEpiQr(value);
		if (!p) {
			scanInfo = 'QR tidak dikenali (bukan label EPI).';
			return;
		}
		const id = Number(p.id);
		if (mode === 'rak' && p.type === 'LOC') {
			rakFilter = id;
			tab = 'semua';
			scanInfo = lines.some((l) => l.rak_id === id) ? 'Menampilkan item di rak ini.' : 'Rak ini tidak ada dalam sesi.';
		} else if (mode === 'item' && p.type === 'ITEM') {
			itemFilter = id;
			tab = 'semua';
			scanInfo = lines.some((l) => l.item_id === id) ? 'Menampilkan item hasil scan.' : 'Item ini tidak ada dalam sesi.';
		} else {
			scanInfo = mode === 'rak' ? 'Itu bukan QR lokasi rak.' : 'Itu bukan QR barang.';
		}
	}

	function kembali() {
		vibrateTap();
		if (aktif) {
			aktif = null;
			loadList();
		} else goto('/stock-lapangan');
	}

	onMount(() => {
		loadList();
		const online = () => {
			if (aktif && jmlDraf) simpanSemua();
		};
		window.addEventListener('online', online);
		return () => window.removeEventListener('online', online);
	});
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm px-4 py-3 flex items-center gap-3">
		<button class="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center text-slate-700 active:scale-95 transition" onclick={kembali} aria-label="Kembali">
			<IconArrowLeft size={18} />
		</button>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<h1 class="text-base font-black text-slate-800 truncate">{aktif ? aktif.kode : 'Tugas Opname Saya'}</h1>
				{#if aktif}
					<span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider {aktif.scope_type === 'project' || aktif.project_id ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}">
						{aktif.scope_type === 'project' || aktif.project_id ? '🏗️ Site' : '🏢 Gudang'}
					</span>
				{/if}
			</div>
			<p class="text-xs text-slate-500 truncate">
				{aktif ? (aktif.project_nama || aktif.gudang_nama || 'Sesi opname') : 'Hitung fisik sesi site proyek & gudang dari admin'}
			</p>
		</div>
		{#if aktif}
			<div class="ml-auto text-right text-xs font-bold text-slate-700">
				{aktif.counted_lines}/{aktif.total_lines}
				<span class="text-[10px] text-slate-400 block font-normal">item</span>
			</div>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-4 space-y-3 pb-28">
		{#if errorMsg}
			<div class="p-3 rounded-xl bg-red-50 text-red-700 text-sm flex gap-2"><IconAlertTriangle size={18} />{errorMsg}</div>
		{/if}

		<!-- Panduan Ringkas SOP-PRJ-320 & SOP-LOG-015 (Collapsible) -->
		<div class="rounded-2xl border border-indigo-200 bg-indigo-50/70 text-indigo-950 text-xs overflow-hidden">
			<button
				type="button"
				class="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 font-bold text-left cursor-pointer"
				onclick={() => { vibrateTap(); showSopGuide = !showSopGuide; }}
			>
				<span class="truncate">📋 Panduan SOP-PRJ-320 &amp; SOP-LOG-015 · Audit Lapangan &amp; Kaleng Cat</span>
				<span class="text-[11px] font-semibold text-indigo-700 shrink-0">{showSopGuide ? 'Tutup ▲' : 'Lihat ▼'}</span>
			</button>
			{#if showSopGuide}
				<div class="px-3.5 pb-3.5 pt-1 border-t border-indigo-200/80 space-y-2 text-[11px] leading-relaxed text-slate-700">
					<div class="p-2 rounded-xl bg-white/80 border border-indigo-100 space-y-1">
						<div class="font-bold text-indigo-900 text-xs">⚖️ Batasan Kategori Audit (Dilarang Dicampur):</div>
						<p>• <b>Material Proyek (Cat, Thinner, Pasir, APD):</b> Wajib dihitung di sini via Sesi Opname Proyek.</p>
						<p>• <b>Perabotan Mess/Site:</b> Bukan persediaan! Masuk Aset General Affair di menu <code>/ga?tab=assets</code>.</p>
						<p>• <b>Laptop / Printer IT:</b> Masuk Inventaris IT di menu <code>/it?tab=assets</code>.</p>
						<p>• <b>Komponen Mesin Terpasang:</b> DILARANG membongkar mesin. Cek jam kerja operasional &amp; fisik via P2H di <code>/maintenance</code>.</p>
					</div>
					<p><b>• Blind Count &amp; Stiker:</b> Saldo sistem disembunyikan. Tempel stiker fisik <b>AUDITED-SO</b> pada drum/pail/sak yang telah dihitung.</p>
					<p><b>• Kalkulator Kaleng (SOP-LOG-015):</b> Gunakan tombol <b>Kaleng Cat</b> untuk memisahkan hitungan kaleng utuh, kaleng buka (in-use), dan kaleng kosong di TPS Limbah B3.</p>
					<p><b>• Ambang Toleransi 2%:</b> Varian selisih &gt; 2% memicu investigasi wajib sebelum Berita Acara Stock Opname (BASO) diterbitkan.</p>
					<p><b>• Ketahanan Sinyal:</b> Input otomatis disimpan di HP dan dikirim saat koneksi internet aktif kembali.</p>
				</div>
			{/if}
		</div>

		{#if !aktif}
			<div class="p-3 rounded-2xl bg-blue-50 text-blue-800 text-xs leading-relaxed border border-blue-100">
				💡 <b>Cara pakai:</b> Pilih sesi di bawah → hitung fisik aktual di lapangan → gunakan <b>Kalkulator Kaleng Cat</b> untuk material kimia/cat → <b>Simpan</b>. Jumlah sistem sengaja disembunyikan (<i>Blind Count</i>) agar audit objektif.
			</div>
			{#if loading}
				<div class="py-10 flex flex-col items-center justify-center">
					<CircularProgressGauge size={54} strokeWidth={4} label="Memuat sesi stock opname..." />
				</div>
			{:else if !sesiList.length}
				<div class="py-10 text-center text-slate-500 text-sm">
					<IconClipboardCheck size={40} class="mx-auto mb-2 text-slate-300" />
					Belum ada sesi opname yang sedang menghitung.<br />Admin membuatnya di Inventory → Stok → Opname.
				</div>
			{/if}
			{#each sesiList as s (s.id)}
				<button class="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:scale-[0.99] transition hover:border-blue-200" onclick={() => bukaSesi(s)}>
					<div class="flex items-center gap-2 flex-wrap">
						<span class="font-mono text-sm font-bold text-slate-800">{s.kode}</span>
						{#if s.scope_type === 'project' || s.project_id}
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">🏗️ Site Proyek</span>
						{:else}
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">🏢 Gudang HQ</span>
						{/if}
						{#if s.mine}<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Tugas saya</span>{/if}
						{#if s.recount_lines}<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{s.recount_lines} hitung ulang</span>{/if}
					</div>
					<div class="text-xs font-semibold text-slate-700 mt-1">
						{s.scope_type === 'project' || s.project_id ? (s.project_nama || s.gudang_nama || 'Site Proyek') : (s.gudang_nama || 'Gudang Pusat')}
					</div>
					{#if s.jadwal_tanggal}
						<div class="text-[11px] text-slate-400 mt-0.5">📅 Jadwal Cut-Off: {s.jadwal_tanggal}</div>
					{/if}
					<div class="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
						<div class="h-full bg-emerald-500 transition-all duration-300" style="width:{s.total_lines ? Math.round((s.counted_lines / s.total_lines) * 100) : 0}%"></div>
					</div>
					<div class="flex items-center justify-between text-[11px] text-slate-500 mt-1">
						<span>{s.counted_lines}/{s.total_lines} item terhitung</span>
						<span class="font-bold text-emerald-600">{s.total_lines ? Math.round((s.counted_lines / s.total_lines) * 100) : 0}%</span>
					</div>
				</button>
			{/each}
			<button class="mx-auto flex items-center gap-1 text-xs text-slate-500 font-semibold" onclick={loadList}><IconRefresh size={14} /> Muat ulang sesi</button>
		{:else}
			<!-- Toolbar Scan + Filter -->
			<div class="flex gap-2">
				<button class="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 transition" onclick={async () => { vibrateTap(); await loadQrScannerModal(); showScanner = 'rak'; }}><IconQrcode size={16} /> Scan Lokasi / Rak</button>
				<button class="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 transition" onclick={async () => { vibrateTap(); await loadQrScannerModal(); showScanner = 'item'; }}><IconQrcode size={16} /> Scan SKU Barang</button>
			</div>
			{#if scanInfo}<div class="text-xs text-slate-600 bg-white rounded-lg px-3 py-2 border border-slate-100">{scanInfo}</div>{/if}
			{#if rakFilter || itemFilter}
				<button class="text-xs text-blue-600 underline font-semibold" onclick={() => { rakFilter = null; itemFilter = null; scanInfo = ''; }}>Hapus filter scan</button>
			{/if}
			{#if raks.length > 1 && !rakFilter}
				<select class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium" onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); rakFilter = v || null; }}>
					<option value="">Semua Lokasi / Rak ({raks.length})</option>
					{#each raks as [rid, nama]}<option value={rid}>{nama}</option>{/each}
				</select>
			{/if}
			<div class="flex gap-1.5 text-xs font-semibold">
				<button class="px-3.5 py-1.5 rounded-full {tab === 'belum' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}" onclick={() => { vibrateTap(); tab = 'belum'; }}>Belum ({jmlBelum})</button>
				<button class="px-3.5 py-1.5 rounded-full {tab === 'recount' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}" onclick={() => { vibrateTap(); tab = 'recount'; }}>Hitung Ulang ({jmlRecount})</button>
				<button class="px-3.5 py-1.5 rounded-full {tab === 'semua' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}" onclick={() => { vibrateTap(); tab = 'semua'; }}>Semua ({lines.length})</button>
			</div>
			<input class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Cari nama / kode barang…" bind:value={search} />
			{#if tab === 'recount' && jmlRecount}
				<div class="p-3 rounded-xl bg-amber-50 text-amber-800 text-xs border border-amber-200">🔁 Admin meminta item berikut dihitung ulang. Baca catatannya, hitung teliti, lalu simpan lagi.</div>
			{/if}

			{#if loadingDetail}
				<div class="py-10 flex flex-col items-center justify-center">
					<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian sesi opname..." />
				</div>
			{:else if !tampil.length}
				<div class="py-8 text-center text-sm text-slate-500">{tab === 'belum' ? '🎉 Semua item di tampilan ini sudah dihitung.' : 'Tidak ada item yang cocok.'}</div>
			{/if}

			{#each tampil as l (l.id)}
				{@const draf = drafts[l.id]}
				<div class="bg-white rounded-2xl p-3.5 shadow-sm border {l.status === 'recount' ? 'border-amber-300 ring-1 ring-amber-300' : 'border-slate-100'}">
					<div class="flex items-start gap-2">
						<div class="min-w-0 flex-1">
							<div class="text-sm font-semibold text-slate-800 leading-snug">{l.nama}</div>
							<div class="text-[11px] text-slate-500 mt-0.5">{l.kode_item || ''}{l.rak_nama ? ` · 📍 ${l.rak_nama}` : ''}{l.satuan ? ` · ${l.satuan}` : ''}</div>
							{#if l.status === 'recount' && l.catatan}<div class="text-[11px] text-amber-700 mt-1 font-semibold">{l.catatan}</div>{/if}
							{#if l.qty_sistem !== null}<div class="text-[11px] text-slate-400 mt-0.5">Sistem: {l.qty_sistem} {l.satuan || ''}</div>{/if}
						</div>
						{#if sudahDihitung(l) && draf === undefined}
							<IconCircleCheck size={20} class="text-emerald-500 shrink-0" />
						{/if}
					</div>

					<div class="mt-2.5 flex items-center gap-2">
						<input
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							class="w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-base font-bold text-slate-800"
							placeholder={l.qty_fisik !== null && l.status !== 'recount' ? String(l.qty_fisik) : 'Fisik'}
							value={draf ?? ''}
							oninput={(e) => setDraft(l, (e.currentTarget as HTMLInputElement).value)}
						/>
						<span class="text-xs text-slate-500 font-medium">{l.satuan || ''}</span>

						<button
							type="button"
							class="ml-auto px-2.5 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold flex items-center gap-1 active:bg-indigo-100 transition"
							title="Kalkulator Kaleng Cat & Limbah B3 (SOP-LOG-015)"
							onclick={() => bukaKalkulatorKaleng(l)}
						>
							<IconCalculator size={14} />
							<span>Kaleng Cat</span>
						</button>
					</div>

					{#if catatanDraft[l.id]}
						<div class="mt-2 text-[11px] text-indigo-800 bg-indigo-50/80 px-2.5 py-1.5 rounded-xl border border-indigo-100 flex items-center justify-between">
							<span class="truncate">{catatanDraft[l.id]}</span>
							<button type="button" class="text-indigo-400 hover:text-indigo-600 font-bold ml-1 text-sm" onclick={() => { const { [l.id]: _, ...rest } = catatanDraft; catatanDraft = rest; persistDraft(); }}>&times;</button>
						</div>
					{/if}

					{#if buktiPerlu[l.id]}
						<div class="mt-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
							<div class="text-xs text-amber-800 font-semibold">⚠ Hitungan fisik berbeda jauh dari sistem (&gt; toleransi). Cek ulang, pilih alasan, dan unggah foto bukti:</div>
							<select class="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs font-medium" bind:value={alasanDraft[l.id]}>
								<option value={undefined}>— pilih alasan varian selisih —</option>
								{#each ALASAN_SELISIH as a}<option value={a.value}>{a.label}</option>{/each}
							</select>
							<label class="flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
								<IconCamera size={16} />
								<input type="file" accept="image/*" capture="environment" class="text-xs" onchange={(e) => (fotoDraft[l.id] = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
							</label>
							<button class="w-full py-2 rounded-lg bg-amber-500 text-white text-xs font-bold active:bg-amber-600 transition" disabled={saving} onclick={() => kirimBukti(l)}>Kirim Bukti</button>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	{#if aktif}
		<div class="fixed bottom-0 inset-x-0 z-40 p-3 bg-white/95 backdrop-blur border-t border-slate-200 shadow-lg">
			{#if saveMsg}<div class="text-xs text-center font-medium text-slate-700 mb-1.5">{saveMsg}</div>{/if}
			<button class="w-full py-3 rounded-2xl bg-emerald-600 disabled:bg-slate-300 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition" disabled={!jmlDraf || saving} onclick={simpanSemua}>
				{#if saving}<IconLoader2 class="animate-spin" size={18} />{/if}
				Simpan {jmlDraf ? `${jmlDraf} Hitungan Fisik` : 'Hitungan'}
			</button>
		</div>
	{/if}
</div>

<!-- Modal Popover Kalkulator Kaleng Cat & Limbah B3 (SOP-LOG-015 & SOP-PRJ-320) -->
{#if kalkulatorLine}
	<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
		<div class="w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
			<div class="flex items-start justify-between">
				<div>
					<span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">SOP-LOG-015 &amp; SOP-PRJ-320</span>
					<h3 class="text-base font-black text-slate-800 mt-1">Kalkulator Kaleng &amp; Limbah B3</h3>
					<p class="text-xs text-slate-500 line-clamp-1">{kalkulatorLine.nama}</p>
				</div>
				<button type="button" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 active:scale-95 transition" onclick={() => (kalkulatorLine = null)}>
					<IconX size={16} />
				</button>
			</div>

			<div class="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
				💡 <b>Aturan Audit:</b> Kaleng utuh + kaleng buka dihitung sebagai <b>Qty Fisik Tersedia</b>. Kaleng kosong dihitung di TPS Limbah B3 untuk rekonsiliasi <i>Loss Ratio</i> cat &amp; kepatuhan lingkungan.
			</div>

			<div class="space-y-3">
				<div>
					<label class="block text-xs font-bold text-slate-700 mb-1">1. Kaleng / Pail Utuh (Sealed / Tertutup)</label>
					<div class="flex items-center gap-2">
						<input
							type="number"
							min="0"
							step="1"
							class="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-right"
							placeholder="0"
							bind:value={kalUtuh}
						/>
						<span class="text-xs text-slate-500 w-16 font-medium">Pail/Klg</span>
					</div>
				</div>

				<div>
					<label class="block text-xs font-bold text-slate-700 mb-1">2. Kaleng Buka / Sedang Dipakai (In-Use)</label>
					<div class="flex items-center gap-2">
						<input
							type="number"
							min="0"
							step="any"
							class="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-right"
							placeholder="0.5 atau liter sisa"
							bind:value={kalBuka}
						/>
						<span class="text-xs text-slate-500 w-16 font-medium">{kalkulatorLine.satuan || 'Pail'}</span>
					</div>
					<p class="text-[10px] text-slate-400 mt-0.5">Estimasi porsi isi kaleng yang masih ada cairan cat/thinner.</p>
				</div>

				<div>
					<label class="block text-xs font-bold text-slate-700 mb-1">3. Kaleng Kosong Bekas Pakai (di TPS Limbah B3)</label>
					<div class="flex items-center gap-2">
						<input
							type="number"
							min="0"
							step="1"
							class="flex-1 rounded-xl border border-amber-300 bg-amber-50/50 px-3 py-2 text-sm font-bold text-right text-amber-900"
							placeholder="0"
							bind:value={kalKosongB3}
						/>
						<span class="text-xs text-amber-800 w-16 font-semibold">Kaleng</span>
					</div>
					<p class="text-[10px] text-amber-700 mt-0.5">Wajib dihitung fisik untuk rekonsiliasi pemakaian cat riil vs teoretis.</p>
				</div>

				<div class="p-3 bg-slate-50 rounded-2xl flex items-center justify-between border border-slate-200">
					<div>
						<div class="text-[11px] text-slate-500 font-medium">Total Qty Fisik Masuk Stok:</div>
						<div class="text-xs text-slate-400">(Utuh + Buka)</div>
					</div>
					<div class="text-lg font-black text-emerald-600">
						{Number(((Number(kalUtuh) || 0) + (Number(kalBuka) || 0)).toFixed(3))} {kalkulatorLine.satuan || ''}
					</div>
				</div>
			</div>

			<div class="flex gap-2 pt-1">
				<button type="button" class="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold" onclick={() => (kalkulatorLine = null)}>Batal</button>
				<button type="button" class="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:bg-indigo-700 transition" onclick={terapkanKalkulatorKaleng}>
					<IconCheck size={16} />
					<span>Terapkan Hitungan</span>
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showScanner && QrScannerModal}
	<QrScannerModal onDetect={onScan} onClose={() => (showScanner = null)} expectedPrefix="EPI:" />
{/if}
