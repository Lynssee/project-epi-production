<script lang="ts">
	// src/routes/(app)/lacak-sj/[id]/verifikasi/+page.svelte
	// SJ-06 / SJH-19 Layar C + D — cek barang fisik per item di gudang SEBELUM SJ dicetak, dari HP.
	// Verifikasi ≠ approval: hanya mencatat hasil cek (surat_jalan.pengaju_verification). Tidak ada "centang semua".
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCheck, IconMinus, IconPlus } from '@tabler/icons-svelte';
	import { SectionGuide } from '$lib/components/hints';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import { MIN_CATATAN, geserQty, ringkasVerifikasi, validasiVerifikasi, type BarisVerif, type ItemSj } from '$lib/utils/verifikasiMuat';

	const id = page.params.id;
	const persist = createFormPersist<{ rows: Record<string, BarisVerif>; overall: string; cid: string }>(`verifikasi_muat_${id}`);

	let loading = $state(true);
	let err = $state('');
	let nomorSj = $state('');
	let tujuan = $state('');
	let driver = $state('');
	let items = $state<ItemSj[]>([]);
	let isDraft = $state(false);
	let bolehUbah = $state(true);
	let alasanTidakBoleh = $state<string | null>(null);
	let sudahAda = $state(false);
	let rows = $state<Record<string, BarisVerif>>({});
	let overall = $state('');
	let cid = $state(`verif-${crypto.randomUUID()}`); // sama selama form terbuka → simpan ganda tidak menulis dua kali
	let draftSavedAt = $state<Date | null>(null);
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);
	let showConfirm = $state(false);
	let saving = $state(false);
	let hasil = $state<{ mode: string; selisih: number; langkah: string } | null>(null);
	let tampilGalat = $state(false); // tampilkan pesan merah per item setelah user mencoba simpan

	const kosong = (): BarisVerif => ({ status: '', qty: '', alasan: '', note: '' });
	const snapshot = () => ({ rows: $state.snapshot(rows), overall, cid });

	onMount(() => {
		const onOn = () => (isOffline = false);
		const onOff = () => (isOffline = true);
		window.addEventListener('online', onOn);
		window.addEventListener('offline', onOff);
		load();
		return () => { window.removeEventListener('online', onOn); window.removeEventListener('offline', onOff); };
	});
	$effect(() => registerFormPersistSaveTriggers(persist, snapshot));

	async function load() {
		loading = true; err = '';
		try {
			const [vr, dr] = await Promise.all([fetch(`/api/lacak-sj/${id}/verifikasi-fisik`), fetch(`/api/lacak-sj/${id}`)]);
			const v = await vr.json().catch(() => null);
			if (!vr.ok) throw new Error(v?.message || 'Gagal memuat item SJ.');
			const d = await dr.json().catch(() => null);
			items = v.items || [];
			nomorSj = v.nomor_sj || d?.sj?.nomor_sj || `#${id}`;
			tujuan = d?.sj?.tujuan || '';
			driver = d?.sj?.driver || '';
			isDraft = !!v.draft;
			bolehUbah = v.boleh_ubah !== false;
			alasanTidakBoleh = v.alasan_tidak_boleh || null;
			sudahAda = !!v.pengaju_verification?.verified_at;
			// isi awal: dari hasil sebelumnya ("Ubah hasil") — barulah dari draf lokal bila ada
			const base: Record<string, BarisVerif> = Object.fromEntries(items.map((it) => [String(it.id), kosong()]));
			for (const pi of v.pengaju_verification?.items || []) {
				const k = String(pi.sj_item_id);
				if (base[k]) base[k] = { status: pi.status, qty: pi.status === 'qty_dikoreksi' ? String(pi.qty_confirmed) : '', alasan: '', note: pi.note || '' };
			}
			const draf = persist.restore();
			if (draf) {
				for (const k of Object.keys(base)) if (draf.rows?.[k]) base[k] = draf.rows[k];
				overall = draf.overall || '';
				cid = draf.cid || cid;
				draftSavedAt = new Date();
			}
			rows = base;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			loading = false;
		}
	}

	const qtySj = (it: ItemSj) => Number(it.qty_delivered) || Number(it.qty_required) || 0;
	const dicek = $derived(items.filter((it) => rows[String(it.id)]?.status).length);
	const galat = $derived(validasiVerifikasi(items, rows));
	const ringkas = $derived(ringkasVerifikasi(items, rows));
	const bisaSimpan = $derived(!galat.length && !isOffline && bolehUbah);

	function pilih(it: ItemSj, status: BarisVerif['status']) {
		const r = rows[String(it.id)];
		r.status = status;
		if (status === 'qty_dikoreksi' && r.qty === '') r.qty = String(geserQty(qtySj(it), qtySj(it), -1));
		if (status === 'sesuai') { r.qty = ''; r.alasan = ''; r.note = ''; }
		draftSavedAt = new Date();
	}
	function ubahQty(it: ItemSj, delta: number) {
		const r = rows[String(it.id)];
		r.qty = String(geserQty(qtySj(it), Number(r.qty), delta));
		draftSavedAt = new Date();
	}
	function pilihAlasan(it: ItemSj, a: string, label: string) {
		const r = rows[String(it.id)];
		r.alasan = a;
		if (!r.note.trim()) r.note = label;
		draftSavedAt = new Date();
	}

	function mintaSimpan() {
		tampilGalat = true;
		if (!bisaSimpan) return;
		showConfirm = true;
	}

	async function simpan() {
		saving = true; err = '';
		try {
			const res = await fetch(`/api/lacak-sj/${id}/verifikasi-fisik`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					client_event_id: cid, overall_note: overall,
					items: items.map((it) => {
						const r = rows[String(it.id)];
						return { sj_item_id: it.id, status: r.status, qty_confirmed: r.status === 'qty_dikoreksi' ? Number(r.qty) : undefined, note: r.note, alasan: r.alasan };
					})
				})
			});
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal menyimpan.');
			persist.clear();
			draftSavedAt = null;
			hasil = { mode: d.mode, selisih: d.selisih ?? 0, langkah: d.langkah_berikut || (d.selisih ? '⚠ Ada barang beda.' : '✓ Semua barang sesuai. Gudang bisa mencetak SJ.') };
			showConfirm = false;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
			showConfirm = false;
		} finally {
			saving = false;
		}
	}
</script>

<div class="wrap">
	<button class="back" onclick={() => goto(`/lacak-sj/${id}`)}><IconArrowLeft size={18} /> Kembali ke SJ</button>
	<h1>Cek Barang Sebelum Kirim</h1>

	{#if loading}
		<div class="center"><IconLoader2 size={28} class="spin" /></div>
	{:else if err && !items.length}
		<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>
	{:else if hasil}
		<!-- Layar D — hasil -->
		<div class="banner" class:ok={hasil.selisih === 0} class:warn={hasil.selisih > 0}>
			{#if hasil.selisih === 0}<IconCheck size={18} />{:else}<IconAlertTriangle size={18} />{/if}
			<span>{hasil.langkah}</span>
		</div>
		<button class="btn primary" onclick={() => goto(`/lacak-sj/${id}`)}>Kembali ke SJ</button>
	{:else}
		<p class="sj"><b>{nomorSj}</b>{#if driver} · {driver}{/if}</p>
		{#if tujuan}<p class="muted sm">{tujuan}</p>{/if}

		<SectionGuide id="lacak-sj.verifikasi" title="Cara mengecek barang" defaultOpen={true}
			steps={['① Lihat barang fisik di gudang.', '② Tandai tiap baris: Sesuai / Jumlah Beda / Tidak Ada. Tidak ada tombol "centang semua" — setiap barang harus ditandai sendiri.', '③ Tekan Simpan Hasil Cek. Selisih otomatis diberi tahu ke gudang.']} />

		{#if !bolehUbah}
			<div class="banner warn"><IconAlertTriangle size={18} /> {alasanTidakBoleh || 'SJ ini tidak bisa diverifikasi.'}</div>
		{/if}
		{#if sudahAda && bolehUbah}
			<div class="banner ok"><IconCheck size={18} /> SJ ini sudah pernah dicek. Menyimpan lagi akan mengganti hasil (hasil lama tersimpan di riwayat).</div>
		{/if}
		{#if isOffline}
			<div class="banner warn"><IconAlertTriangle size={18} /> Tidak ada sinyal. Hasil cek tersimpan di HP; tekan Simpan lagi saat sinyal ada.</div>
		{/if}
		{#if err}<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>{/if}

		<div class="progres" aria-live="polite">{dicek} dari {items.length} barang dicek</div>
		<DraftIndicator savedAt={draftSavedAt} {isOffline} />

		{#each items as it (it.id)}
			{@const r = rows[String(it.id)]}
			{@const g = galat.find((x) => x.id === String(it.id))}
			<div class="kartu" class:hijau={r?.status === 'sesuai'} class:merah={tampilGalat && g}>
				<div class="nama">{it.nama_barang || 'Item #' + it.id}</div>
				<div class="muted sm">Di SJ: {qtySj(it)} {it.unit || ''}</div>
				{#if r}
					<div class="tombol">
						<button type="button" class="t sesuai" class:on={r.status === 'sesuai'} onclick={() => pilih(it, 'sesuai')}>✓ Sesuai</button>
						<button type="button" class="t beda" class:on={r.status === 'qty_dikoreksi'} onclick={() => pilih(it, 'qty_dikoreksi')}>± Jumlah Beda</button>
						<button type="button" class="t tidak" class:on={r.status === 'tidak_dimuat'} onclick={() => pilih(it, 'tidak_dimuat')}>✗ Tidak Ada</button>
					</div>
					{#if r.status === 'qty_dikoreksi'}
						<label class="lbl" for={`q${it.id}`}>Jumlah yang benar-benar ada</label>
						<div class="qty">
							<button type="button" class="kecil" onclick={() => ubahQty(it, -1)} aria-label="Kurangi"><IconMinus size={18} /></button>
							<input id={`q${it.id}`} type="number" inputmode="decimal" min="0" max={qtySj(it)} step="any" bind:value={r.qty} />
							<button type="button" class="kecil" onclick={() => ubahQty(it, 1)} aria-label="Tambah"><IconPlus size={18} /></button>
							<span class="muted sm">{it.unit || ''}</span>
						</div>
						<label class="lbl" for={`n${it.id}`}>Kenapa beda?</label>
						<input id={`n${it.id}`} class="teks" type="text" placeholder="Min. {MIN_CATATAN} huruf" bind:value={r.note} />
					{:else if r.status === 'tidak_dimuat'}
						<label class="lbl" for={`n${it.id}`}>Kenapa tidak ada?</label>
						<div class="cepat">
							{#each [['kurang', 'Kurang stok'], ['rusak', 'Rusak'], ['tertinggal', 'Tertinggal'], ['lainnya', 'Lainnya']] as [a, label]}
								<button type="button" class="chip" class:on={r.alasan === a} onclick={() => pilihAlasan(it, a, label)}>{label}</button>
							{/each}
						</div>
						<input id={`n${it.id}`} class="teks" type="text" placeholder="Jelaskan singkat (min. {MIN_CATATAN} huruf)" bind:value={r.note} />
					{/if}
					{#if tampilGalat && g}<p class="galat">{g.pesan}</p>{/if}
				{/if}
			</div>
		{/each}

		<label class="lbl" for="umum">Catatan umum (opsional)</label>
		<input id="umum" class="teks" type="text" bind:value={overall} placeholder="Mis. barang ditumpuk di area B" />

		<button class="btn primary besar" disabled={saving || !bolehUbah} onclick={mintaSimpan}
			title={dicek < items.length ? 'Tandai semua barang dulu' : isOffline ? 'Tidak ada sinyal' : ''}>
			{#if saving}<IconLoader2 size={18} class="spin" />{/if} Simpan Hasil Cek
		</button>
		{#if tampilGalat && galat.length}<p class="galat">Tandai semua barang dulu dan lengkapi alasan yang kurang (kartu bertanda merah).</p>{/if}
	{/if}
</div>

{#if showConfirm}
	<div class="backdrop" role="presentation">
		<div class="dialog" role="dialog" aria-modal="true" aria-label="Konfirmasi hasil cek">
			<p class="judul">Simpan hasil cek?</p>
			<p>{ringkas.teks}</p>
			{#if ringkas.selisih > 0 && !isDraft}<p class="warn-txt">Gudang akan diberi tahu dan SJ tertahan sampai selisih diselesaikan.</p>{/if}
			{#if ringkas.selisih > 0 && isDraft}<p class="warn-txt">Manager Project akan menyetujui dengan jumlah yang Anda catat.</p>{/if}
			<div class="aksi">
				<button class="btn" disabled={saving} onclick={() => (showConfirm = false)}>Periksa Lagi</button>
				<button class="btn primary" disabled={saving} onclick={simpan}>{saving ? 'Menyimpan…' : 'Ya, Simpan'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.wrap { max-width: 640px; margin: 0 auto; padding: 1rem; padding-bottom: 5rem; }
	.back { display: inline-flex; align-items: center; gap: 0.35rem; background: none; border: none; color: #475569; font-size: 0.9rem; margin-bottom: 0.5rem; }
	h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
	.sj { margin: 0.25rem 0 0; }
	.muted { color: #94a3b8; }
	.sm { font-size: 0.8rem; margin: 0.1rem 0 0.4rem; }
	.center { display: flex; justify-content: center; padding: 2rem; }
	.banner { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; font-size: 0.85rem; margin: 0.5rem 0; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.banner.warn { background: #fffbeb; color: #b45309; }
	.banner.ok { background: #f0fdf4; color: #15803d; }
	.progres { position: sticky; top: 0; z-index: 5; background: #1d4ed8; color: #fff; font-weight: 600; font-size: 0.9rem; padding: 0.5rem 0.75rem; border-radius: 0.6rem; margin: 0.5rem 0; text-align: center; }
	.kartu { border: 2px solid #e2e8f0; border-radius: 0.9rem; padding: 0.8rem; margin-bottom: 0.65rem; background: #fff; }
	.kartu.hijau { border-color: #16a34a; background: #f0fdf4; }
	.kartu.merah { border-color: #ef4444; }
	.nama { font-weight: 700; }
	.tombol { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; margin-top: 0.4rem; }
	.t { min-height: 48px; border: 2px solid #cbd5e1; border-radius: 0.7rem; background: #fff; font-size: 0.85rem; font-weight: 700; color: #475569; }
	.t.sesuai.on { background: #16a34a; border-color: #16a34a; color: #fff; }
	.t.beda.on { background: #eab308; border-color: #eab308; color: #1f2937; }
	.t.tidak.on { background: #dc2626; border-color: #dc2626; color: #fff; }
	.lbl { display: block; font-size: 0.8rem; font-weight: 600; color: #475569; margin: 0.6rem 0 0.25rem; }
	.qty { display: flex; align-items: center; gap: 0.4rem; }
	.qty input { width: 6.5rem; text-align: center; font-size: 1.1rem; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; }
	.kecil { min-width: 44px; min-height: 44px; border: 1px solid #cbd5e1; border-radius: 0.6rem; background: #fff; display: flex; align-items: center; justify-content: center; }
	.teks { width: 100%; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; font-size: 0.9rem; }
	.cepat { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.4rem; }
	.chip { padding: 0.4rem 0.75rem; min-height: 40px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font-size: 0.8rem; }
	.chip.on { background: #dc2626; border-color: #dc2626; color: #fff; }
	.galat { color: #b91c1c; font-size: 0.8rem; margin: 0.4rem 0 0; }
	.btn { min-height: 48px; padding: 0 1.1rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #fff; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; }
	.btn.primary { background: #16a34a; border-color: #16a34a; color: #fff; }
	.btn.besar { width: 100%; margin-top: 1rem; }
	.btn:disabled { opacity: 0.5; }
	.backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 50; }
	.dialog { background: #fff; border-radius: 1rem; padding: 1rem; max-width: 420px; width: 100%; }
	.dialog .judul { font-weight: 700; font-size: 1.05rem; margin: 0 0 0.5rem; }
	.warn-txt { color: #b45309; font-size: 0.85rem; }
	.aksi { display: flex; gap: 0.5rem; margin-top: 0.8rem; }
	.aksi .btn { flex: 1; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
