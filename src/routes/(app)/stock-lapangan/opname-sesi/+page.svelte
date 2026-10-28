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
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconClipboardCheck, IconCamera, IconQrcode, IconAlertTriangle, IconRefresh } from '@tabler/icons-svelte';

	// Lifecycle Inventory Tahap 6 — F4 (7 Okt 2026): hitung fisik untuk SESI opname yang dibuat admin.
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

	// draf hitungan lokal (tahan refresh / sinyal putus) — kunci per sesi
	let drafts = $state<Record<number, string>>({});
	let buktiPerlu = $state<Record<number, boolean>>({}); // lineId -> server minta foto/alasan
	let alasanDraft = $state<Record<number, string>>({});
	let fotoDraft = $state<Record<number, File | null>>({});
	let saving = $state(false);
	let saveMsg = $state('');
	let showScanner = $state<'rak' | 'item' | null>(null);

	const draftKey = (id: number) => `opname_sesi_draft_${id}`;
	function loadDraft(id: number) {
		try {
			drafts = JSON.parse(localStorage.getItem(draftKey(id)) || '{}');
		} catch {
			drafts = {};
		}
	}
	function persistDraft() {
		if (!aktif) return;
		try {
			localStorage.setItem(draftKey(aktif.id), JSON.stringify(drafts));
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

	async function simpanSemua() {
		if (!aktif || saving) return;
		const entries = Object.entries(drafts)
			.filter(([, v]) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0)
			.map(([id, v]) => ({ lineId: Number(id), qtyFisik: Number(v) }));
		if (!entries.length) return;
		saving = true;
		saveMsg = '';
		try {
			const res = await simpanHitungan(aktif.id, entries);
			const gagal = res.hasil.filter((h) => !h.ok);
			const next = { ...drafts };
			for (const h of res.hasil) {
				if (!h.ok) continue;
				delete next[h.lineId];
				const idx = lines.findIndex((l) => l.id === h.lineId);
				if (idx >= 0) lines[idx] = { ...lines[idx], qty_fisik: entries.find((e) => e.lineId === h.lineId)!.qtyFisik, status: 'counted' };
				if (h.perlu_bukti) buktiPerlu = { ...buktiPerlu, [h.lineId]: true };
			}
			drafts = next;
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
			await simpanHitungan(aktif.id, [{ lineId: l.id, qtyFisik: l.qty_fisik, alasan: alasan || null, foto: fotoId }]);
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
		<button class="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" onclick={kembali} aria-label="Kembali"><IconArrowLeft size={18} /></button>
		<div class="min-w-0">
			<h1 class="text-lg font-black text-slate-800 truncate">{aktif ? aktif.kode : 'Tugas Opname Saya'}</h1>
			<p class="text-xs text-slate-500 truncate">{aktif ? aktif.gudang_nama || 'Sesi opname' : 'Hitung fisik untuk sesi yang dibuat admin'}</p>
		</div>
		{#if aktif}
			<div class="ml-auto text-right text-xs font-semibold text-slate-600">{aktif.counted_lines}/{aktif.total_lines} item</div>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-4 space-y-3 pb-28">
		{#if errorMsg}
			<div class="p-3 rounded-xl bg-red-50 text-red-700 text-sm flex gap-2"><IconAlertTriangle size={18} />{errorMsg}</div>
		{/if}

		{#if !aktif}
			<div class="p-3 rounded-xl bg-blue-50 text-blue-800 text-xs leading-relaxed">
				💡 <b>Cara pakai:</b> pilih sesi → scan QR rak (opsional) → isi jumlah <b>fisik</b> yang Anda hitung → <b>Simpan</b>. Jumlah di sistem sengaja disembunyikan agar hitungan tidak bias. Hitungan tersimpan di perangkat bila sinyal putus.
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
				<button class="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:scale-[0.99] transition" onclick={() => bukaSesi(s)}>
					<div class="flex items-center gap-2">
						<span class="font-mono text-sm font-bold text-slate-800">{s.kode}</span>
						{#if s.mine}<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Tugas saya</span>{/if}
						{#if s.recount_lines}<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{s.recount_lines} hitung ulang</span>{/if}
					</div>
					<div class="text-xs text-slate-500 mt-0.5">{s.gudang_nama || '—'}{s.jadwal_tanggal ? ` · jadwal ${s.jadwal_tanggal}` : ''}</div>
					<div class="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-emerald-500" style="width:{s.total_lines ? Math.round((s.counted_lines / s.total_lines) * 100) : 0}%"></div></div>
					<div class="text-[11px] text-slate-500 mt-1">{s.counted_lines}/{s.total_lines} item terhitung</div>
				</button>
			{/each}
			<button class="mx-auto flex items-center gap-1 text-xs text-slate-500" onclick={loadList}><IconRefresh size={14} /> Muat ulang</button>
		{:else}
			<!-- toolbar scan + filter -->
			<div class="flex gap-2">
				<button class="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold flex items-center justify-center gap-2" onclick={async () => { await loadQrScannerModal(); showScanner = 'rak'; }}><IconQrcode size={16} /> Scan Rak</button>
				<button class="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-semibold flex items-center justify-center gap-2" onclick={async () => { await loadQrScannerModal(); showScanner = 'item'; }}><IconQrcode size={16} /> Scan Barang</button>
			</div>
			{#if scanInfo}<div class="text-xs text-slate-600 bg-white rounded-lg px-3 py-2 border border-slate-100">{scanInfo}</div>{/if}
			{#if rakFilter || itemFilter}
				<button class="text-xs text-blue-600 underline" onclick={() => { rakFilter = null; itemFilter = null; scanInfo = ''; }}>Hapus filter scan</button>
			{/if}
			{#if raks.length > 1 && !rakFilter}
				<select class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); rakFilter = v || null; }}>
					<option value="">Semua rak ({raks.length})</option>
					{#each raks as [rid, nama]}<option value={rid}>{nama}</option>{/each}
				</select>
			{/if}
			<div class="flex gap-1.5 text-xs font-semibold">
				<button class="px-3 py-1.5 rounded-full {tab === 'belum' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}" onclick={() => (tab = 'belum')}>Belum ({jmlBelum})</button>
				<button class="px-3 py-1.5 rounded-full {tab === 'recount' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}" onclick={() => (tab = 'recount')}>Hitung Ulang ({jmlRecount})</button>
				<button class="px-3 py-1.5 rounded-full {tab === 'semua' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'}" onclick={() => (tab = 'semua')}>Semua ({lines.length})</button>
			</div>
			<input class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Cari nama / kode barang…" bind:value={search} />
			{#if tab === 'recount' && jmlRecount}
				<div class="p-3 rounded-xl bg-amber-50 text-amber-800 text-xs">🔁 Admin meminta item berikut dihitung ulang. Baca catatannya, hitung teliti, lalu simpan lagi.</div>
			{/if}

			{#if loadingDetail}
		<div class="py-10 flex flex-col items-center justify-center">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian sesi opname..." />
		</div>
			{:else if !tampil.length}
				<div class="py-8 text-center text-sm text-slate-500">{tab === 'belum' ? '🎉 Semua item di tampilan ini sudah dihitung.' : 'Tidak ada item.'}</div>
			{/if}

			{#each tampil as l (l.id)}
				{@const draf = drafts[l.id]}
				<div class="bg-white rounded-2xl p-3 shadow-sm border {l.status === 'recount' ? 'border-amber-300' : 'border-slate-100'}">
					<div class="flex items-start gap-2">
						<div class="min-w-0 flex-1">
							<div class="text-sm font-semibold text-slate-800 leading-snug">{l.nama}</div>
							<div class="text-[11px] text-slate-500">{l.kode_item || ''}{l.rak_nama ? ` · 📍 ${l.rak_nama}` : ''}{l.satuan ? ` · ${l.satuan}` : ''}</div>
							{#if l.status === 'recount' && l.catatan}<div class="text-[11px] text-amber-700 mt-1">{l.catatan}</div>{/if}
							{#if l.qty_sistem !== null}<div class="text-[11px] text-slate-400">Sistem: {l.qty_sistem}</div>{/if}
						</div>
						{#if sudahDihitung(l) && draf === undefined}<IconCircleCheck size={20} class="text-emerald-500 shrink-0" />{/if}
					</div>
					<div class="mt-2 flex items-center gap-2">
						<input
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							class="w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-base font-semibold"
							placeholder={l.qty_fisik !== null && l.status !== 'recount' ? String(l.qty_fisik) : 'Fisik'}
							value={draf ?? ''}
							oninput={(e) => setDraft(l, (e.currentTarget as HTMLInputElement).value)}
						/>
						<span class="text-xs text-slate-500">{l.satuan || ''}</span>
					</div>

					{#if buktiPerlu[l.id]}
						<div class="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
							<div class="text-xs text-amber-800 font-semibold">⚠ Hitungan Anda berbeda cukup jauh dari sistem. Cek ulang, lalu tambahkan alasan & foto bukti.</div>
							<select class="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs" bind:value={alasanDraft[l.id]}>
								<option value={undefined}>— pilih alasan —</option>
								{#each ALASAN_SELISIH as a}<option value={a.value}>{a.label}</option>{/each}
							</select>
							<label class="flex items-center gap-2 text-xs text-amber-900">
								<IconCamera size={16} />
								<input type="file" accept="image/*" capture="environment" class="text-xs" onchange={(e) => (fotoDraft[l.id] = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
							</label>
							<button class="w-full py-2 rounded-lg bg-amber-500 text-white text-xs font-bold" disabled={saving} onclick={() => kirimBukti(l)}>Kirim Bukti</button>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	{#if aktif}
		<div class="fixed bottom-0 inset-x-0 z-40 p-3 bg-white/95 backdrop-blur border-t border-slate-200">
			{#if saveMsg}<div class="text-xs text-center text-slate-600 mb-1.5">{saveMsg}</div>{/if}
			<button class="w-full py-3 rounded-2xl bg-emerald-600 disabled:bg-slate-300 text-white font-bold text-sm flex items-center justify-center gap-2" disabled={!jmlDraf || saving} onclick={simpanSemua}>
				{#if saving}<IconLoader2 class="animate-spin" size={18} />{/if}
				Simpan {jmlDraf ? `${jmlDraf} Hitungan` : 'Hitungan'}
			</button>
		</div>
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal onDetect={onScan} onClose={() => (showScanner = null)} expectedPrefix="EPI:" />
{/if}
