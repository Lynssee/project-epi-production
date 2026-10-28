<script lang="ts">
	// src/routes/kiosk/gerbang-sj/+page.svelte
	// Kiosk Satpam — loloskan / tahan Surat Jalan di gerbang keluar.
	// GSP-08: memakai SATU form bersama (GerbangSjForm) + endpoint satu pintu /api/gerbang-sj/* — sama persis
	// dengan app HP & ERP. Sesi kiosk badge+PIN (cookie ikut otomatis; layout kiosk sudah menjaga).
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { createGerbangApi, type GAntrianRow, type GDetail, type GHasil, type GPenjualanRow } from '$lib/services/gerbangSjApi';
	import { TEKS, menitText } from '$lib/data/gerbangSjTeks';
	import GerbangSjForm from '$lib/components/gerbangSj/GerbangSjForm.svelte';
	import {
		IconArrowLeft, IconQrcode, IconCheck, IconAlertTriangle, IconClockHour4
	} from '@tabler/icons-svelte';

	const api = createGerbangApi(async () => ({}));

	let QrScannerModal = $state<any>(null);
	async function loadScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let showScanner = $state(false);
	let err = $state('');
	let info = $state('');
	let efekGagal = $state(false);

	let manual = $state('');
	let loading = $state(false);
	let target = $state<GDetail | null>(null);

	let antrian = $state<GAntrianRow[]>([]);
	let antrianCount = $state(0);
	let aktor = $state('');

	// SJ-09 opsi C — antrean SJ penjualan (hanya tampil bila setelan gerbang_penjualan_aktif menyala)
	let penjualanAktif = $state(false);
	let penjualan = $state<GPenjualanRow[]>([]);
	let penjualanBuka = $state<GPenjualanRow | null>(null);
	let penjualanBusy = $state(false);
	let penjualanCatatan = $state('');

	async function loadPenjualan() {
		try {
			const d = await api.antrianPenjualan();
			penjualanAktif = !!d.aktif;
			penjualan = d.antrian || [];
		} catch (e) {
			// antrean utama tetap jalan; tampilkan peringatan ringan, jangan menelan diam-diam
			console.error('[kiosk gerbang] antrean penjualan gagal:', e);
			penjualanAktif = false;
		}
	}
	let penjualanAlasan = $state('');
	async function tahanPenjualanAksi() {
		if (!penjualanBuka || penjualanBusy) return;
		if (penjualanAlasan.trim().length < 5) { err = 'Tulis alasan menahan (min. 5 karakter).'; return; }
		penjualanBusy = true; err = ''; info = '';
		try {
			const r = await api.tahanPenjualan(penjualanBuka.id, { client_event_id: crypto.randomUUID(), kategori: 'lainnya', alasan: penjualanAlasan.trim() });
			info = r.pesan;
			efekGagal = (r.effects_gagal?.length ?? 0) > 0;
			penjualanBuka = null; penjualanAlasan = '';
			await loadPenjualan();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal menahan.';
		} finally {
			penjualanBusy = false;
		}
	}
	async function catatLolosPenjualan() {
		if (!penjualanBuka || penjualanBusy) return;
		penjualanBusy = true; err = ''; info = '';
		try {
			const r = await api.loloskanPenjualan(penjualanBuka.id, {
				client_event_id: crypto.randomUUID(), catatan: penjualanCatatan.trim() || null
			});
			info = r.pesan;
			efekGagal = (r.effects_gagal?.length ?? 0) > 0;
			penjualanBuka = null; penjualanCatatan = '';
			await loadPenjualan();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal mencatat.';
		} finally {
			penjualanBusy = false;
		}
	}

	async function loadAntrian() {
		try {
			const d = await api.antrian();
			antrian = d.antrian || [];
			antrianCount = d.count || 0;
			aktor = d.aktor?.nama || '';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal memuat antrian.';
		}
	}

	// Scanner fisik (keyboard-wedge, event global dari +layout.svelte) — selain modal kamera.
	// Satpam sering pakai scanner USB, bukan kamera tablet.
	function onHardwareScan(e: Event) {
		const { code, parsed } = (e as CustomEvent).detail || {};
		if (parsed?.type !== 'SJ' || !code) return; // bukan QR SJ → biarkan layout memberi toast
		e.preventDefault();
		onScanDetect(String(code));
	}

	onMount(() => {
		loadAntrian();
		loadPenjualan();
		window.addEventListener('kiosk-hardware-scan', onHardwareScan);
		return () => window.removeEventListener('kiosk-hardware-scan', onHardwareScan);
	});

	async function buka(loader: () => Promise<GDetail>) {
		err = ''; info = ''; efekGagal = false; loading = true; target = null;
		try {
			target = await loader();
		} catch (e) {
			err = e instanceof Error ? e.message : 'SJ tidak ditemukan.';
		} finally {
			loading = false;
		}
	}

	function onScanDetect(raw: string) {
		showScanner = false;
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'SJ') { err = 'Itu bukan QR Surat Jalan. Kalau QR rusak, ketik nomor SJ.'; return; }
		buka(() => api.cari({ code: raw }));
	}
	function bukaManual() {
		const t = manual.trim();
		if (!t) return;
		buka(() => api.cari({ nomor: t }));
	}

	async function onDone(r: GHasil) {
		target = null;
		err = '';
		info = r.pesan;
		efekGagal = (r.effects_gagal?.length ?? 0) > 0;
		await loadAntrian();
	}

	// SJH-13: beri tahu pihak yang harus bertindak (in-app, anti-spam 15 menit di server).
	let notifying = $state('');
	function whoKey(siapa: string): string {
		if (['Admin Logistik', 'Approver SJ', 'Gudang / QC'].includes(siapa)) return siapa;
		if (siapa.startsWith('Approver')) return 'Approver SJ';
		if (siapa.startsWith('Gudang')) return 'Gudang / QC';
		return 'Admin Logistik';
	}
	async function beritahu(siapa: string) {
		if (!target?.sj?.id) return;
		const who = whoKey(siapa);
		notifying = siapa; err = ''; info = '';
		try {
			const res = await fetch('/api/kiosk/gerbang-sj/beritahu', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sjId: target.sj.id, who })
			});
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal mengirim pemberitahuan.');
			info = d?.already_sent ? `Pemberitahuan ke ${who} sudah dikirim (maks. sekali per 15 menit).` : `Pemberitahuan terkirim ke ${who}.`;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			notifying = '';
		}
	}
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/home')}><IconArrowLeft size={18} /> Kembali</button>
	<h1 title="Kartu merah = SJ belum boleh keluar. Baca siapa yang harus dihubungi, tekan Kirim pemberitahuan, jangan loloskan manual. Tombol Tahan selalu tersedia.">Gerbang — Surat Jalan</h1>
	{#if aktor}<p class="muted sm" style="text-align:left">Masuk sebagai {aktor}</p>{/if}
	<p class="hint">
		Scan QR di pojok kanan atas Surat Jalan. Kalau QR rusak, ketik nomor SJ.
		Cocokkan plat, driver, jumlah koli, dan setiap barang. Loloskan hanya kalau semuanya cocok; kalau ada yang beda, tekan Tahan.
	</p>

	{#if err}<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>{/if}
	{#if info}<div class="banner ok"><IconCheck size={18} /> {info}</div>{/if}
	{#if efekGagal}<p class="muted sm" style="text-align:left">{TEKS.efekGagal}</p>{/if}

	{#if !target}
		<button class="scan-btn" onclick={async () => { await loadScanner(); err = ''; showScanner = true; }}>
			<IconQrcode size={40} /> Scan QR Surat Jalan
		</button>
		<div class="manual">
			<input placeholder="atau ketik nomor SJ (mis. SJ/260909/001)" bind:value={manual}
				onkeydown={(e) => e.key === 'Enter' && bukaManual()} />
			<button onclick={bukaManual} disabled={loading}>{loading ? '…' : 'Cari'}</button>
		</div>

		<section class="antrian">
			<h2><IconClockHour4 size={18} /> {TEKS.judulAntrian} ({antrianCount})</h2>
			{#if antrian.length === 0}
				<p class="muted">Tidak ada SJ yang menunggu.</p>
			{:else}
				<ul>
					{#each antrian as a (a.id)}
						<li class:overdue={a.terlambat}>
							<button class="row" onclick={() => buka(() => api.detail(a.id))}>
								<span class="no">{a.blockers.length ? '🔒 ' : ''}{a.nomor_sj}
									{#if a.ditahan}<b class="tag tahan">DITAHAN</b>{/if}
									{#if a.terlambat}<b class="tag late">TERLAMBAT</b>{/if}
								</span>
								<span class="drv">{a.driver || '—'}{a.plat ? ' · ' + a.plat : ''}{a.koli_acuan != null ? ' · ' + a.koli_acuan + ' koli' : ''}</span>
								<span class="age">{menitText(a.menunggu_menit)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if penjualanAktif}
			<section class="antrian">
				<h2 title={TEKS.hintPenjualan}><IconClockHour4 size={18} /> {TEKS.judulPenjualan} ({penjualan.length})</h2>
				<p class="muted sm" style="text-align:left">{TEKS.hintPenjualan}</p>
				{#if penjualan.length === 0}
					<p class="muted">Tidak ada pengiriman penjualan yang menunggu dicatat.</p>
				{:else}
					<ul>
						{#each penjualan as p (p.id)}
							<li>
								<button class="row" onclick={() => { penjualanBuka = penjualanBuka?.id === p.id ? null : p; penjualanCatatan = ''; penjualanAlasan = ''; }}>
									<span class="no">{p.nomor_sj}{#if p.ditahan}<b class="tag tahan">DITAHAN</b>{/if}</span>
									<span class="drv">{p.customer || '—'} · {p.driver || '—'}{p.plat ? ' · ' + p.plat : ''}</span>
									<span class="age">{menitText(p.menunggu_menit)}</span>
								</button>
								{#if penjualanBuka?.id === p.id}
									<div class="card" style="margin-top:0.4rem">
										<p class="sjsub">Tujuan: {p.tujuan || '—'}</p>
										{#if p.ditahan && p.alasan_tahan}<p class="sjsub" style="color:#c2410c">Ditahan: {p.alasan_tahan}</p>{/if}
										<textarea rows="2" placeholder="Catatan (opsional) — atau alasan bila ditahan" bind:value={penjualanCatatan}></textarea>
										<div class="actions">
											<button class="loloskan" onclick={catatLolosPenjualan} disabled={penjualanBusy}>
												<IconCheck size={18} /> {penjualanBusy ? 'Mencatat…' : 'Catat Lolos'}
											</button>
											<button class="tahan" title="Tahan bila plat/driver/barang tidak cocok dengan SJ. Alasan wajib (min. 5 karakter) diisi di kolom catatan. Logistik otomatis diberi tahu." onclick={() => { penjualanAlasan = penjualanCatatan; tahanPenjualanAksi(); }} disabled={penjualanBusy}>
												Tahan
											</button>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{:else}
		{#key target.sj.id}
			<GerbangSjForm detail={target} {api} mode="kiosk" {onDone} onClose={() => (target = null)} onBeritahu={beritahu} {notifying} />
		{/key}
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:SJ:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}

<style>
	.wrap { max-width: 640px; margin: 0 auto; padding: 1rem; }
	.back { display: inline-flex; align-items: center; gap: 0.35rem; background: none; border: none; color: #475569; font-size: 0.9rem; margin-bottom: 0.5rem; }
	h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
	.hint { font-size: 0.85rem; color: #64748b; margin: 0 0 1rem; }
	.banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; font-size: 0.85rem; margin-bottom: 0.6rem; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.banner.ok { background: #f0fdf4; color: #15803d; }
	.banner.warn { background: #fffbeb; color: #b45309; }
	.scan-btn { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.75rem; border: 2px dashed #94a3b8; border-radius: 1rem; background: #f8fafc; color: #334155; font-size: 1rem; font-weight: 600; }
	.manual { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
	.manual input { flex: 1; padding: 0.7rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; font-size: 0.95rem; }
	.manual button { padding: 0.7rem 1.1rem; border: none; border-radius: 0.6rem; background: #2563eb; color: #fff; font-weight: 600; }
	.antrian { margin-top: 1.5rem; }
	.notify { margin-left: 0.5rem; padding: 0.2rem 0.55rem; border-radius: 0.4rem; border: 1px solid #b45309; background: #fff; color: #b45309; font-size: 0.75rem; font-weight: 700; }
	.notify:disabled { opacity: 0.5; }
	.belum { margin-top: 0.75rem; font-size: 0.85rem; color: #64748b; }
	.belum ul { list-style: none; padding: 0.25rem 0 0 0.5rem; margin: 0; }
	.plat { font-size: 1.15rem; letter-spacing: 0.04em; }
	.items { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 0.5rem 0; }
	.items th, .items td { text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid #e2e8f0; }
	.antrian h2 { display: flex; align-items: center; gap: 0.4rem; font-size: 1rem; margin: 0 0 0.5rem; }
	.antrian ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	.antrian li.overdue .row { border-color: #f87171; background: #fef2f2; }
	.row { width: 100%; display: grid; grid-template-columns: 1fr auto auto; gap: 0.75rem; align-items: center; padding: 0.7rem 0.9rem; border: 1px solid #e2e8f0; border-radius: 0.6rem; background: #fff; text-align: left; }
	.row .no { font-weight: 600; }
	.row .drv { color: #64748b; font-size: 0.85rem; }
	.row .age { color: #475569; font-size: 0.8rem; }
	.muted { color: #94a3b8; font-size: 0.9rem; }
	.muted.sm { font-size: 0.8rem; text-align: center; }
	.card { border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1rem; background: #fff; }
	.sjhead { display: flex; justify-content: space-between; align-items: flex-start; }
	.sjno { font-size: 1.25rem; font-weight: 700; }
	.sjsub { color: #64748b; font-size: 0.85rem; }
	.closex { background: none; border: none; color: #94a3b8; }
	.sjmeta { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.85rem; color: #475569; margin: 0.5rem 0 0.75rem; }
	.checks { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
	.chk { display: flex; align-items: center; gap: 0.6rem; padding: 0.9rem; border: 2px solid #cbd5e1; border-radius: 0.75rem; background: #fff; color: #475569; font-size: 1rem; font-weight: 600; }
	.chk.on { border-color: #16a34a; background: #f0fdf4; color: #15803d; }
	.foto-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.85rem; border: 2px dashed #cbd5e1; border-radius: 0.75rem; font-size: 0.9rem; color: #475569; cursor: pointer; }
	.foto-btn.has { border-color: #16a34a; border-style: solid; color: #16a34a; }
	.foto-prev { width: 100%; max-height: 180px; object-fit: cover; border-radius: 0.5rem; margin-top: 0.5rem; }
	textarea { width: 100%; margin-top: 0.6rem; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; font-size: 0.9rem; resize: vertical; }
	.actions { display: flex; gap: 0.6rem; margin-top: 0.9rem; }
	.tahan, .loloskan { flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem; padding: 1rem; border: none; border-radius: 0.75rem; font-size: 1rem; font-weight: 700; }
	.tahan { background: #fee2e2; color: #b91c1c; }
	.loloskan { background: #16a34a; color: #fff; }
	.loloskan:disabled { background: #cbd5e1; }
	.tag { margin-left: 0.4rem; padding: 0.05rem 0.4rem; border-radius: 0.3rem; font-size: 0.65rem; }
	.tag.tahan { background: #ffedd5; color: #c2410c; }
	.tag.late { background: #fee2e2; color: #b91c1c; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
