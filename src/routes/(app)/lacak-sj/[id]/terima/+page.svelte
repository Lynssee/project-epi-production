<script lang="ts">
	// src/routes/(app)/lacak-sj/[id]/terima/+page.svelte
	// Fase 2 Pengiriman Ekspedisi (15 Okt 2026) — "Terima Barang" terpadu, wizard 3 langkah:
	// ① Foto barang diterima + GPS  ② Cek per item (Sesuai/Kurang/Rusak)  ③ Foto SJ fisik
	// bertanda tangan (opsional). Satu tombol "Serahkan" di akhir memanggil ulang
	// /api/goods-received/confirm (lewat sjTerimaApi.ts) — tidak ada logika jurnal baru.
	// Layar lama /stock-lapangan/masuk TETAP ADA (tidak dihapus) untuk kasus yang wizard
	// ini belum tangani (mis. scan QR, komplain manual, TTD driver).
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCheck, IconCamera, IconArrowRight } from '@tabler/icons-svelte';
	import { SectionGuide } from '$lib/components/hints';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import { GR_CONDITION_OPTIONS, type GRCondition } from '$lib/constants/grCondition';
	import {
		fetchShipmentForSj,
		submitTerimaBarang,
		registerAutoFlushTerima,
		type GRShipment,
		type GRItem,
		type TerimaItemInput
	} from '$lib/services/sjTerimaApi';

	let { data } = $props();
	const wajibScanFisik = data.wajibScanFisik;

	const id = page.params.id;
	const persist = createFormPersist<{ step: number; rows: Record<string, { condition: GRCondition; qty: string }> }>(`terima_barang_${id}`);

	let loading = $state(true);
	let err = $state('');
	let shipment = $state<GRShipment | null>(null);
	let step = $state(1); // 1=foto barang, 2=cek item, 3=foto SJ fisik + serahkan
	let draftSavedAt = $state<Date | null>(null);
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);

	let rows = $state<Record<string, { condition: GRCondition; qty: string }>>({});
	let gps = $state<{ lat: number; lng: number; accuracy: number } | null>(null);
	let fotoTerimaFile = $state<File | null>(null);
	let fotoTerimaPreview = $state<string | null>(null);
	let scanSjFile = $state<File | null>(null);
	let scanSjPreview = $state<string | null>(null);

	let saving = $state(false);
	let hasil = $state<{ queued: boolean; hasVariance?: boolean } | null>(null);

	const snapshot = () => ({ step, rows: $state.snapshot(rows) });

	onMount(() => {
		const onOn = () => (isOffline = false);
		const onOff = () => (isOffline = true);
		window.addEventListener('online', onOn);
		window.addEventListener('offline', onOff);
		const unregisterFlush = registerAutoFlushTerima();
		load();
		return () => {
			window.removeEventListener('online', onOn);
			window.removeEventListener('offline', onOff);
			unregisterFlush();
		};
	});
	$effect(() => registerFormPersistSaveTriggers(persist, snapshot));

	const kosong = (): { condition: GRCondition; qty: string } => ({ condition: 'ok', qty: '' });
	const qtySj = (it: GRItem) => Number(it.qtySent) || 0;

	async function load() {
		loading = true;
		err = '';
		try {
			shipment = await fetchShipmentForSj(id);
			if (!shipment) throw new Error('SJ ini tidak/sudah tidak ada di daftar "Barang Dalam Perjalanan" Anda.');
			const base: Record<string, { condition: GRCondition; qty: string }> = {};
			for (const it of shipment.items) {
				const key = it.itemType === 'rab' ? `exp:${it.projectExpenseId}` : `sji:${it.suratJalanItemId}`;
				base[key] = { ...kosong(), qty: String(qtySj(it)) };
			}
			const draf = persist.restore();
			if (draf) {
				for (const k of Object.keys(base)) if (draf.rows?.[k]) base[k] = draf.rows[k];
				step = draf.step || 1;
				draftSavedAt = new Date();
			}
			rows = base;
			const [fp, sp] = await Promise.all([persist.restorePhoto('foto_terima'), persist.restorePhoto('scan_sj')]);
			if (fp) { fotoTerimaFile = new File([fp], 'foto-terima.jpg', { type: fp.type || 'image/jpeg' }); fotoTerimaPreview = URL.createObjectURL(fp); }
			if (sp) { scanSjFile = new File([sp], 'scan-sj.jpg', { type: sp.type || 'image/jpeg' }); scanSjPreview = URL.createObjectURL(sp); }
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal memuat data.';
		} finally {
			loading = false;
		}
	}

	function getGps(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) return resolve(null);
			navigator.geolocation.getCurrentPosition(
				(p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
				() => resolve(null),
				{ timeout: 4000, maximumAge: 60000 }
			);
		});
	}

	async function onPickFotoTerima(input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file) return;
		fotoTerimaFile = file;
		fotoTerimaPreview = URL.createObjectURL(file);
		gps = await getGps();
		await persist.savePhoto('foto_terima', file);
		draftSavedAt = new Date();
	}

	async function onPickScanSj(input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file) return;
		scanSjFile = file;
		scanSjPreview = URL.createObjectURL(file);
		await persist.savePhoto('scan_sj', file);
		draftSavedAt = new Date();
	}

	function goStep(n: number) {
		if (n === 2 && !fotoTerimaFile) { err = 'Foto barang diterima wajib diisi dulu.'; return; }
		err = '';
		step = n;
		draftSavedAt = new Date();
	}

	const dicek = $derived(Object.keys(rows).length);

	async function serahkan() {
		if (!shipment || !fotoTerimaFile) return;
		if (wajibScanFisik && !scanSjFile) { err = 'Foto SJ fisik bertanda tangan wajib diisi (diaktifkan admin).'; return; }
		saving = true;
		err = '';
		try {
			const items: TerimaItemInput[] = shipment.items.map((it) => {
				const key = it.itemType === 'rab' ? `exp:${it.projectExpenseId}` : `sji:${it.suratJalanItemId}`;
				const r = rows[key] || kosong();
				return {
					itemType: it.itemType,
					projectExpenseId: it.projectExpenseId,
					suratJalanItemId: it.suratJalanItemId,
					materialName: it.materialName,
					identitasBarangId: it.identitasBarangId,
					qtyReceived: r.condition === 'ok' ? qtySj(it) : Number(r.qty) || 0,
					condition: r.condition
				};
			});
			const out = await submitTerimaBarang({
				suratJalanId: shipment.suratJalanId,
				nomorSJ: shipment.nomorSJ,
				items,
				fotoTerimaFile,
				scanSjFisikFile: scanSjFile,
				gps
			});
			hasil = out;
			persist.clear();
			await persist.clearPhotos();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal menyimpan.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="wrap">
	<button class="back" onclick={() => goto(`/lacak-sj/${id}`)}><IconArrowLeft size={18} /> Kembali ke SJ</button>
	<h1>Terima Barang</h1>

	{#if loading}
		<div class="center"><IconLoader2 size={28} class="spin" /></div>
	{:else if err && !shipment}
		<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>
	{:else if hasil}
		<div class="banner" class:ok={!hasil.queued} class:warn={hasil.queued}>
			{#if hasil.queued}
				<IconAlertTriangle size={18} /> <span>Tidak ada sinyal — tersimpan di HP, akan terkirim otomatis begitu sinyal kembali.</span>
			{:else}
				<IconCheck size={18} /> <span>Barang diterima tercatat.{hasil.hasVariance ? ' Ada selisih — klaim otomatis dibuat.' : ' Semua sesuai.'}</span>
			{/if}
		</div>
		<button class="btn primary besar" onclick={() => goto(`/lacak-sj/${id}`)}>Kembali ke SJ</button>
	{:else if shipment}
		<p class="sj"><b>{shipment.nomorSJ}</b>{#if shipment.driver} · {shipment.driver}{/if}</p>
		<p class="muted sm">{shipment.projectName}</p>

		<div class="progres" aria-live="polite">Langkah {step} dari 3</div>
		<DraftIndicator savedAt={draftSavedAt} {isOffline} />
		{#if err}<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>{/if}

		{#if step === 1}
			<SectionGuide id="lacak-sj.terima.foto" title="Langkah 1: Foto barang" defaultOpen={true}
				steps={['① Foto seluruh barang yang diterima dari belakang/samping.', '② Lokasi GPS terekam otomatis saat foto dipilih.']} />
			<label class="foto-box">
				{#if fotoTerimaPreview}
					<img src={fotoTerimaPreview} alt="Foto barang diterima" />
				{:else}
					<IconCamera size={32} /><span>Ambil / pilih foto barang</span>
				{/if}
				<input type="file" accept="image/*" capture="environment" class="hidden-input" onchange={(e) => onPickFotoTerima(e.currentTarget)} />
			</label>
			{#if gps}<p class="muted sm">GPS tercatat ({gps.accuracy.toFixed(0)}m)</p>{/if}
			<button class="btn primary besar" disabled={!fotoTerimaFile} onclick={() => goStep(2)}>
				Lanjut: Cek Barang <IconArrowRight size={18} />
			</button>
		{:else if step === 2}
			<SectionGuide id="lacak-sj.terima.cek" title="Langkah 2: Cek barang" defaultOpen={true}
				steps={['① Cocokkan jumlah fisik dengan SJ.', '② Tandai Sesuai / Kurang / Rusak per barang.', '③ Isi jumlah yang BENAR-BENAR ada bila Kurang/Rusak.']} />
			<div class="progres" aria-live="polite">{dicek} barang di SJ ini</div>
			{#each shipment.items as it (it.itemType === 'rab' ? `exp:${it.projectExpenseId}` : `sji:${it.suratJalanItemId}`)}
				{@const key = it.itemType === 'rab' ? `exp:${it.projectExpenseId}` : `sji:${it.suratJalanItemId}`}
				{@const r = rows[key]}
				<div class="kartu" class:hijau={r?.condition === 'ok'} class:merah={r?.condition && r.condition !== 'ok'}>
					<div class="nama">{it.materialName}</div>{#if it.identitasBarangId}<div class="sm"><KnowledgeCard itemId={it.identitasBarangId} context="receive" label="Cek barang" /></div>{/if}
					<div class="muted sm">Di SJ: {qtySj(it)} {it.unit || ''}</div>
					{#if r}
						<div class="tombol">
							{#each GR_CONDITION_OPTIONS as opt}
								<button type="button" class="t" class:on={r.condition === opt.value}
									onclick={() => { r.condition = opt.value; if (opt.value === 'ok') r.qty = String(qtySj(it)); draftSavedAt = new Date(); }}>
									{opt.label}
								</button>
							{/each}
						</div>
						{#if r.condition !== 'ok'}
							<label class="lbl" for={`q-${key}`}>Jumlah yang benar-benar ada</label>
							<input id={`q-${key}`} type="number" inputmode="decimal" min="0" max={qtySj(it)} step="any"
								bind:value={r.qty} oninput={() => (draftSavedAt = new Date())} class="teks" />
						{/if}
					{/if}
				</div>
			{/each}
			<div class="aksi-baris">
				<button class="btn" onclick={() => goStep(1)}>Kembali</button>
				<button class="btn primary" onclick={() => goStep(3)}>Lanjut: Foto SJ Fisik <IconArrowRight size={18} /></button>
			</div>
		{:else if step === 3}
			<SectionGuide id="lacak-sj.terima.scan" title={`Langkah 3: Foto SJ fisik ${wajibScanFisik ? '(wajib)' : '(opsional)'}`} defaultOpen={true}
				steps={wajibScanFisik
					? ['① Foto lembar SJ fisik yang sudah ditandatangani + stempel.', '② Admin mewajibkan langkah ini — tidak bisa dilewati.']
					: ['① Foto lembar SJ fisik yang sudah ditandatangani + stempel.', '② Boleh dilewati sekarang dan diisi nanti dari halaman SJ.']} />
			<label class="foto-box">
				{#if scanSjPreview}
					<img src={scanSjPreview} alt="Foto SJ fisik bertanda tangan" />
				{:else}
					<IconCamera size={32} /><span>Foto SJ fisik bertanda tangan (opsional)</span>
				{/if}
				<input type="file" accept="image/*" capture="environment" class="hidden-input" onchange={(e) => onPickScanSj(e.currentTarget)} />
			</label>
			<div class="aksi-baris">
				<button class="btn" disabled={saving} onclick={() => goStep(2)}>Kembali</button>
				<button class="btn primary besar" disabled={saving || (wajibScanFisik && !scanSjFile)} onclick={serahkan}
					title={wajibScanFisik && !scanSjFile ? 'Foto SJ fisik wajib diisi (diaktifkan admin)' : ''}>
					{#if saving}<IconLoader2 size={18} class="spin" />{/if} Serahkan
				</button>
			</div>
		{/if}
	{/if}
</div>

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
	.foto-box { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; min-height: 180px; border: 2px dashed #cbd5e1; border-radius: 1rem; color: #64748b; margin: 0.75rem 0; position: relative; overflow: hidden; cursor: pointer; }
	.foto-box img { width: 100%; height: 220px; object-fit: cover; border-radius: 1rem; }
	.hidden-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
	.kartu { border: 2px solid #e2e8f0; border-radius: 0.9rem; padding: 0.8rem; margin-bottom: 0.65rem; background: #fff; }
	.kartu.hijau { border-color: #16a34a; background: #f0fdf4; }
	.kartu.merah { border-color: #ef4444; }
	.nama { font-weight: 700; }
	.tombol { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; margin-top: 0.4rem; }
	.t { min-height: 48px; border: 2px solid #cbd5e1; border-radius: 0.7rem; background: #fff; font-size: 0.85rem; font-weight: 700; color: #475569; }
	.t.on { background: #16a34a; border-color: #16a34a; color: #fff; }
	.lbl { display: block; font-size: 0.8rem; font-weight: 600; color: #475569; margin: 0.6rem 0 0.25rem; }
	.teks { width: 100%; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; font-size: 0.9rem; }
	.btn { min-height: 48px; padding: 0 1.1rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #fff; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; }
	.btn.primary { background: #16a34a; border-color: #16a34a; color: #fff; }
	.btn.besar { width: 100%; margin-top: 1rem; }
	.btn:disabled { opacity: 0.5; }
	.aksi-baris { display: flex; gap: 0.5rem; margin-top: 1rem; }
	.aksi-baris .btn { flex: 1; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
