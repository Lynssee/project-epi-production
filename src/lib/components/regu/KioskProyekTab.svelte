<script lang="ts">
	// Tab "Kiosk" di /regu — leader mengaktifkan HP/tablet kiosk proyek (Rencana Kiosk Proyek, Fase 1).
	// Alur: Tampilkan QR → HP kiosk scan → perangkat aktif. QR berumur pendek & sekali pakai.
	import { onMount, onDestroy } from 'svelte';
	import QRCode from 'qrcode';
	import { IconLoader2, IconQrcode, IconTrash, IconCopy, IconPrinter, IconAlertTriangle, IconDeviceMobile } from '@tabler/icons-svelte';
	import {
		getKioskInfo,
		getAktivasiToken,
		cabutPerangkat,
		kioskUrl,
		type KioskInfo
	} from '$lib/services/kioskProyekLeader';

	let { projectId, projectName = '' }: { projectId: number; projectName?: string } = $props();

	let info = $state<KioskInfo | null>(null);
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);

	let qrDataUrl = $state('');
	let qrExp = $state(0);
	let sisaDetik = $state(0);
	let posterQr = $state(''); // dimuat di awal agar window.open() tidak menunggu await (Aturan #5)
	let timer: ReturnType<typeof setInterval> | null = null;

	const linkTetap = $derived(info ? kioskUrl(window.location.origin, info.kode) : '');

	async function muat() {
		loading = true;
		error = '';
		try {
			info = await getKioskInfo(projectId);
			posterQr = await QRCode.toDataURL(kioskUrl(window.location.origin, info.kode), { margin: 2, width: 480 });
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function hentikanQr() {
		qrDataUrl = '';
		if (timer) clearInterval(timer);
		timer = null;
	}

	async function tampilkanQr() {
		if (!info || busy) return;
		busy = true;
		error = '';
		try {
			const { kode, token, exp } = await getAktivasiToken(projectId);
			qrDataUrl = await QRCode.toDataURL(kioskUrl(window.location.origin, kode, token), { margin: 2, width: 420, errorCorrectionLevel: 'M' });
			qrExp = exp;
			sisaDetik = Math.max(0, Math.round((exp - Date.now()) / 1000));
			if (timer) clearInterval(timer);
			timer = setInterval(() => {
				sisaDetik = Math.max(0, Math.round((qrExp - Date.now()) / 1000));
				if (sisaDetik <= 0) {
					hentikanQr();
					// QR habis → segarkan daftar: perangkat yang baru scan akan muncul.
					muat();
				}
			}, 1000);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function cabut(id: number, label: string | null) {
		if (!confirm(`Cabut perangkat "${label || '#' + id}"? Perangkat itu tidak bisa absen lagi sampai diaktifkan ulang.`)) return;
		busy = true;
		try {
			await cabutPerangkat(projectId, id);
			await muat();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function salinLink() {
		try {
			await navigator.clipboard.writeText(linkTetap);
		} catch {
			prompt('Salin link ini:', linkTetap);
		}
	}

	// Sinkron (tanpa await sebelum window.open) — kalau tidak, browser memblokir pop-up cetak.
	function cetakPoster() {
		if (!info || !posterQr) return;
		const w = window.open('', '_blank');
		if (!w) {
			error = 'Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.';
			return;
		}
		const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
		w.document.write(
			`<!doctype html><title>Poster Kiosk ${esc(info.kode)}</title><body style="font-family:sans-serif;text-align:center;padding:32px">` +
				`<h1 style="margin:0">Absen Kru Proyek</h1><h2 style="margin:4px 0 16px;font-weight:600">${esc(projectName)}</h2>` +
				`<img src="${posterQr}" style="width:360px;height:360px"><p style="font-size:28px;letter-spacing:6px;margin:8px 0"><b>${esc(info.kode)}</b></p>` +
				`<p style="font-size:14px;color:#555">Link ini hanya membuka halaman kiosk. Untuk mulai absen, HP harus diaktifkan oleh leader (QR khusus di HP leader).</p>` +
				`<script>window.onload=function(){window.print()}<\/script></body>`
		);
		w.document.close();
	}

	const statusWarna: Record<string, string> = {
		aktif: 'bg-emerald-100 text-emerald-700',
		dicabut: 'bg-gray-200 text-gray-600',
		kedaluwarsa: 'bg-amber-100 text-amber-700'
	};
	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

	onMount(muat);
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

{#if loading && !info}
	<div class="flex justify-center py-10 text-gray-400"><IconLoader2 class="animate-spin" size={24} /></div>
{:else}
	{#if error}
		<div class="p-3 mb-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex gap-2">
			<IconAlertTriangle size={16} class="shrink-0 mt-0.5" /> <span>{error}</span>
		</div>
	{/if}

	{#if info && !info.aktif}
		<div class="p-3 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
			<b>Kiosk Proyek belum diaktifkan admin.</b> Hubungi admin untuk menyalakannya di Pengaturan → Kiosk → Kiosk Proyek. Sebelum itu, QR aktivasi tidak bisa dibuat.
		</div>
	{/if}

	<div class="p-3 mb-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-900 space-y-1">
		<p class="font-semibold">Cara mengaktifkan HP kiosk</p>
		<ol class="list-decimal pl-4 space-y-0.5">
			<li>Tekan <b>Tampilkan QR aktivasi</b> di HP Anda.</li>
			<li>Di HP/tablet kiosk, buka kamera lalu scan QR itu (berlaku {info ? Math.round(info.qr_detik / 60 * 10) / 10 : 2} menit, sekali pakai).</li>
			<li>Perangkat muncul di daftar bawah dan siap dipakai kru. Hilang/dicuri? Tekan <b>Cabut</b>.</li>
		</ol>
		<p class="font-semibold pt-1">HP pribadi kru (tanpa QR)</p>
		<p>Kru membuka link kiosk di HP-nya, memasukkan <b>kode harian</b> di bawah, memilih namanya sekali saja. Setelah itu cukup buka ikon, tekan HADIR, selfie.</p>
	</div>

	{#if info}
		<div class="p-4 mb-3 rounded-xl border border-gray-200 bg-white">
			{#if qrDataUrl}
				<div class="flex flex-col items-center gap-2">
					<img src={qrDataUrl} alt="QR aktivasi kiosk" class="w-64 h-64" />
					<p class="text-sm font-semibold {sisaDetik <= 15 ? 'text-red-600' : 'text-gray-700'}">Berlaku {sisaDetik} detik lagi</p>
					<button onclick={hentikanQr} class="text-xs text-gray-500 underline">Sembunyikan QR</button>
				</div>
			{:else}
				<button
					onclick={tampilkanQr}
					disabled={busy || !info.aktif}
					class="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-40"
				>
					{#if busy}<IconLoader2 class="animate-spin" size={18} />{:else}<IconQrcode size={18} />{/if}
					Tampilkan QR aktivasi
				</button>
			{/if}
		</div>

		{#if info.kode_harian}
			<div class="p-3 mb-3 rounded-xl border border-indigo-200 bg-indigo-50 text-center">
				<p class="text-xs text-indigo-900 font-semibold">Kode harian — untuk kru yang mengikat HP pribadi</p>
				<p class="text-4xl font-bold tracking-[0.25em] text-indigo-900 my-1" aria-label="Kode harian {info.kode_harian.split('').join(' ')}">{info.kode_harian}</p>
				<p class="text-[11px] text-indigo-800">Berganti otomatis tiap hari (pukul 00.00 WIB). Sebutkan langsung ke kru di lokasi — jangan dikirim ke grup WA.</p>
			</div>
		{:else if info.kode_harian_mode === 'nonaktif'}
			<p class="p-3 mb-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">Kode harian dimatikan admin: siapa pun yang tahu link kiosk bisa mengikat HP ke nama kru. Nyalakan kembali di Pengaturan → Kiosk → Kiosk Proyek.</p>
		{/if}

		<div class="p-3 mb-3 rounded-xl border border-gray-200 bg-white text-xs space-y-2">
			<div class="flex items-center justify-between gap-2">
				<div>
					<p class="text-gray-500">Kode kiosk proyek</p>
					<p class="text-lg font-bold tracking-widest">{info.kode}</p>
				</div>
				<div class="flex gap-2">
					<button onclick={salinLink} class="px-3 py-2 rounded-lg border border-gray-300 flex items-center gap-1" title="Salin link halaman kiosk"><IconCopy size={14} /> Salin link</button>
					<button onclick={cetakPoster} disabled={!posterQr} class="px-3 py-2 rounded-lg border border-gray-300 flex items-center gap-1 disabled:opacity-40" title="Cetak poster QR link kiosk untuk ditempel di pos jaga"><IconPrinter size={14} /> Poster</button>
				</div>
			</div>
			<p class="text-gray-500">Link/poster hanya membuka halaman kiosk. HP baru tetap harus diaktifkan lewat QR aktivasi di atas, jadi poster yang difoto orang lain tidak bisa dipakai absen dari rumah.</p>
		</div>

		<h3 class="text-sm font-semibold mb-2 flex items-center gap-1"><IconDeviceMobile size={16} /> Perangkat ({info.perangkat.filter((p) => p.status === 'aktif').length} aktif)</h3>
		{#if info.perangkat.length === 0}
			<p class="text-xs text-gray-500 p-3 rounded-lg bg-gray-50">Belum ada perangkat. Tampilkan QR aktivasi lalu scan dari HP kiosk.</p>
		{:else}
			<ul class="space-y-2">
				{#each info.perangkat as p (p.id)}
					<li class="p-3 rounded-lg border border-gray-200 bg-white flex items-center justify-between gap-2 text-xs">
						<div class="min-w-0">
							<p class="font-semibold truncate">{p.jenis === 'pribadi' ? `📱 HP pribadi: ${p.manpower_nama || p.label || '#' + p.id}` : p.label || `Perangkat #${p.id}`}</p>
							<p class="text-gray-500">{p.jenis === 'pribadi' ? 'Diikat' : 'Aktif oleh'} {p.jenis === 'pribadi' ? '' : p.diaktifkan_oleh || '—'} · dipakai {fmt(p.terakhir_dipakai)} · s/d {fmt(p.kedaluwarsa_pada)}</p>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							<span class="px-2 py-0.5 rounded-full font-semibold {statusWarna[p.status]}">{p.status}</span>
							{#if p.status === 'aktif'}
								<button onclick={() => cabut(p.id, p.label)} disabled={busy} class="p-2 rounded-lg border border-red-200 text-red-600 disabled:opacity-40" title="Cabut perangkat ini"><IconTrash size={14} /></button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
{/if}
