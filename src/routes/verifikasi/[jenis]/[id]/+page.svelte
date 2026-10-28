<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Verifikasi keaslian dokumen lewat QR — halaman PUBLIK (tanpa login). Hanya menampilkan data minimal:
	// nomor, jenis, status, tanggal, nominal. Tanda tangan HMAC ada di URL (?s=) dan dicek server.
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { IconLoader2, IconShieldCheck, IconShieldX, IconAlertTriangle } from '@tabler/icons-svelte';

	const jenis = $page.params.jenis;
	const id = $page.params.id;
	const sig = $page.url.searchParams.get('s') || '';

	type View = { jenis_label: string; nomor: string; status: string; tanggal: string | null; nominal: number; nominal_label: string };
	let state = $state<'loading' | 'ok' | 'invalid' | 'limited' | 'off' | 'error'>('loading');
	let view = $state<View | null>(null);
	let diperiksa = $state('');

	const rp = (n: number) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
	const tgl = (iso: string | null) => {
		const t = iso ? Date.parse(iso) : NaN;
		return Number.isNaN(t) ? '-' : new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
	};

	onMount(async () => {
		try {
			const res = await fetch(`/api/verifikasi/${encodeURIComponent(jenis)}/${encodeURIComponent(id)}?s=${encodeURIComponent(sig)}`);
			const j = await res.json().catch(() => ({}));
			if (res.ok) {
				view = j.data;
				diperiksa = j.diperiksa_pada || '';
				state = 'ok';
			} else if (res.status === 404) state = 'invalid';
			else if (res.status === 429) state = 'limited';
			else if (res.status === 503) state = 'off';
			else state = 'error';
		} catch {
			state = 'error';
		}
	});
</script>

<svelte:head>
	<title>Verifikasi Dokumen</title>
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="min-h-screen flex items-start justify-center p-4 pt-10 bg-slate-50">
	<div class="w-full max-w-md">
		<p class="text-center text-xs font-semibold tracking-wider text-slate-500 mb-3">PT. ELTAMA PRIMA INDO · VERIFIKASI DOKUMEN</p>

		{#if state === 'loading'}
			<div class="py-16 flex justify-center">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memeriksa Keaslian Dokumen..." sublabel="Validasi tanda tangan & nomor surat Directus" />
			</div>
		{:else if state === 'ok' && view}
			<div class="rounded-2xl border-2 border-emerald-300 bg-white p-5 shadow-sm">
				<div class="flex items-center gap-2 text-emerald-700 mb-3">
					<IconShieldCheck size={28} />
					<p class="text-base font-extrabold">Dokumen tercatat di sistem</p>
				</div>
				<dl class="space-y-2 text-sm">
					<div class="flex justify-between gap-3"><dt class="text-slate-500">Jenis</dt><dd class="font-semibold text-right">{view.jenis_label}</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-slate-500">Nomor</dt><dd class="font-bold font-mono text-right">{view.nomor}</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-slate-500">Status saat ini</dt><dd class="font-semibold text-right">{view.status}</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-slate-500">Tanggal</dt><dd class="text-right">{tgl(view.tanggal)}</dd></div>
					<div class="flex justify-between gap-3 pt-2 border-t border-slate-100"><dt class="text-slate-500">{view.nominal_label}</dt><dd class="text-lg font-extrabold tabular-nums text-right">{rp(view.nominal)}</dd></div>
				</dl>
				<div class="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
					<strong>Cocokkan dengan kertas di tangan Anda:</strong> nomor dan <strong>nominal</strong> harus sama persis. Bila berbeda, dokumen kemungkinan diubah — jangan diproses dan laporkan ke Finance.
				</div>
				{#if diperiksa}<p class="mt-3 text-[11px] text-slate-400 text-center">Diperiksa {new Date(diperiksa).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</p>{/if}
			</div>
		{:else if state === 'invalid'}
			<div class="rounded-2xl border-2 border-rose-300 bg-white p-5 shadow-sm text-center">
				<IconShieldX size={36} class="mx-auto text-rose-600 mb-2" />
				<p class="text-base font-extrabold text-rose-700">Dokumen tidak dapat diverifikasi</p>
				<p class="text-sm text-slate-600 mt-2">QR tidak valid, tidak lengkap, atau dokumennya tidak ada. Jangan percaya dokumen ini sebelum dikonfirmasi ke Finance.</p>
			</div>
		{:else if state === 'limited'}
			<div class="rounded-2xl border border-amber-300 bg-white p-5 text-center">
				<IconAlertTriangle size={32} class="mx-auto text-amber-600 mb-2" />
				<p class="text-sm font-semibold">Terlalu banyak percobaan. Coba lagi beberapa menit lagi.</p>
			</div>
		{:else if state === 'off'}
			<div class="rounded-2xl border border-slate-300 bg-white p-5 text-center">
				<p class="text-sm font-semibold">Verifikasi dokumen belum diaktifkan. Hubungi admin.</p>
			</div>
		{:else}
			<div class="rounded-2xl border border-slate-300 bg-white p-5 text-center">
				<p class="text-sm font-semibold">Gagal memeriksa dokumen. Periksa koneksi lalu muat ulang halaman ini.</p>
			</div>
		{/if}
	</div>
</div>
