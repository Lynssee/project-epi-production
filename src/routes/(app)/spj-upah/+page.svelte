<!-- src/routes/(app)/spj-upah/+page.svelte -->
<!-- GPM-C09 — SPJ Upah: koordinator upah (leader) membuktikan upah yang diterimanya sudah dibagikan ke SETIAP pekerja.
     Satu foto per pekerja (pekerja memegang uang / tanda terima bertanda tangan). Finance memverifikasi di ERP.
     Pengajuan upah baru oleh koordinator yang sama ditandai bila bukti pembagian lama belum lengkap melewati batas hari. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconCamera, IconCheck, IconLoader2, IconAlertTriangle, IconTrash } from '@tabler/icons-svelte';
	import { SectionGuide } from '$lib/components/hints';
	import { getDaftarSpj, kirimBukti, batalkanBukti, type DaftarSpj, type PengajuanSpj, type PekerjaSpj, type StatusBukti } from '$lib/services/spjUpah';

	let data = $state<DaftarSpj | null>(null);
	let memuat = $state(true);
	let galat = $state('');
	let terbuka = $state<number | null>(null); // PA yang dibentangkan
	let form = $state<{ paId: number; pekerja: PekerjaSpj } | null>(null);
	let jumlah = $state('');
	let metode = $state<'tunai' | 'transfer'>('tunai');
	let foto = $state<File | null>(null);
	let pratinjau = $state('');
	let mengirim = $state(false);
	let pesanForm = $state('');

	const rp = (n: number) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	const tanggal = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

	const LABEL: Record<StatusBukti, { t: string; c: string }> = {
		belum: { t: 'Belum ada bukti', c: 'bg-red-50 text-red-700 border-red-200' },
		menunggu: { t: 'Menunggu Finance', c: 'bg-amber-50 text-amber-700 border-amber-200' },
		disetujui: { t: 'Disetujui', c: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		ditolak: { t: 'Ditolak — ulangi', c: 'bg-red-50 text-red-700 border-red-200' }
	};

	async function muat() {
		memuat = true; galat = '';
		try {
			data = await getDaftarSpj();
			if (terbuka == null) terbuka = data.pengajuan.find((p) => !p.lengkap)?.id ?? data.pengajuan[0]?.id ?? null;
		} catch (e: any) {
			galat = e?.message || 'Gagal memuat daftar SPJ upah.';
			data = null;
		} finally {
			memuat = false;
		}
	}
	onMount(muat);

	function bukaForm(pa: PengajuanSpj, p: PekerjaSpj) {
		form = { paId: pa.id, pekerja: p };
		// saran jumlah = sisa bagian pekerja (rincian − yang sudah diterima), tidak pernah negatif
		jumlah = String(Math.max(0, Math.round(p.jumlah_rincian - p.jumlah_diterima)) || Math.round(p.jumlah_rincian));
		metode = 'tunai'; foto = null; pratinjau = ''; pesanForm = '';
	}
	function tutupForm() {
		if (pratinjau) URL.revokeObjectURL(pratinjau);
		form = null; foto = null; pratinjau = ''; pesanForm = '';
	}
	function pilihFoto(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0] || null;
		if (pratinjau) URL.revokeObjectURL(pratinjau);
		foto = f; pratinjau = f ? URL.createObjectURL(f) : '';
	}

	/** GPS opsional (bukti tambahan saat bagi tunai di lokasi) — tidak pernah menahan pengiriman. */
	function ambilGps(): Promise<{ lat: number; lng: number } | null> {
		if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
		return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 4000, maximumAge: 60_000 }));
	}

	async function kirim() {
		if (!form || mengirim) return;
		const nominal = Number(jumlah);
		if (!(nominal > 0)) { pesanForm = 'Isi jumlah yang diterima pekerja.'; return; }
		if (!foto) { pesanForm = 'Ambil foto bukti terlebih dulu.'; return; }
		mengirim = true; pesanForm = '';
		try {
			const gps = await ambilGps();
			await kirimBukti({ paId: form.paId, manpowerId: form.pekerja.manpower_id, jumlah: nominal, metode, foto, lat: gps?.lat ?? null, lng: gps?.lng ?? null });
			tutupForm();
			await muat();
		} catch (e: any) {
			pesanForm = e?.message || 'Gagal mengirim bukti.';
		} finally {
			mengirim = false;
		}
	}

	async function batalkan(paId: number, barisId: number) {
		if (!confirm('Batalkan bukti ini? Anda bisa mengambil foto ulang.')) return;
		try {
			await batalkanBukti(paId, barisId);
			await muat();
		} catch (e: any) {
			galat = e?.message || 'Gagal membatalkan bukti.';
		}
	}
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-3 p-3">
	<div class="flex items-center gap-2">
		<button type="button" class="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => goto('/ess')} aria-label="Kembali"><IconArrowLeft size={18} /></button>
		<h1 class="text-base font-bold text-slate-900 dark:text-slate-100">SPJ Upah — Bukti Pembagian</h1>
	</div>

	<SectionGuide
		id="spj-upah.page"
		title="Cara mengisi SPJ Upah"
		steps={[
			'Setelah upah cair ke rekening Anda dan dibagikan, buka PA di bawah dan pilih tiap pekerja.',
			'Foto pekerja memegang uang, atau tanda terima bertanda tangan. Satu foto per pekerja.',
			'Isi jumlah yang benar-benar diterima pekerja, pilih tunai atau transfer, lalu kirim.',
			'Total semua pekerja harus sama dengan jumlah yang dicairkan. Finance akan memeriksa tiap foto.',
			'Bukti yang ditolak perlu diambil ulang. Selesaikan sebelum batas tanggal agar pengajuan upah berikutnya tidak tertahan.'
		]}
	/>

	{#if memuat && !data}
		<p class="flex items-center gap-2 py-6 text-sm text-slate-500"><IconLoader2 size={16} class="animate-spin" /> Memuat…</p>
	{:else if galat}
		<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{galat}
			<button type="button" class="ml-2 font-semibold underline" onclick={muat}>Coba lagi</button>
		</div>
	{:else if data && data.pengajuan.length === 0}
		<p class="rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700">Tidak ada PA upah yang perlu dibuktikan pembagiannya. PA muncul di sini setelah dana cair ke Anda sebagai koordinator upah.</p>
	{:else if data}
		<p class="text-xs text-slate-500">Koordinator: <strong>{data.koordinator.nama}</strong> · batas penyerahan bukti {data.batas_hari} hari sejak dana cair.</p>

		{#each data.pengajuan as pa (pa.id)}
			<section class="rounded-xl border bg-white p-3 dark:bg-slate-900 {pa.terlambat ? 'border-red-300' : pa.lengkap ? 'border-emerald-300' : 'border-slate-200 dark:border-slate-700'}">
				<button type="button" class="flex w-full items-start justify-between gap-2 text-left" onclick={() => (terbuka = terbuka === pa.id ? null : pa.id)}>
					<div class="min-w-0">
						<p class="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{pa.nomor_pengajuan}</p>
						<p class="text-xs text-slate-500">Cair {tanggal(pa.tanggal_dicairkan)} · {rp(pa.total_amount)}</p>
					</div>
					<span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold {pa.lengkap ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : pa.terlambat ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}">
						{pa.lengkap ? 'Lengkap' : pa.terlambat ? `Terlambat (batas ${tanggal(pa.batas_tanggal)})` : `Batas ${tanggal(pa.batas_tanggal)}`}
					</span>
				</button>

				{#if terbuka === pa.id}
					<p class="mt-2 text-xs text-slate-600 dark:text-slate-300">
						Diterima pekerja {rp(pa.total_diterima)} dari {rp(pa.total_amount)}
						{#if Math.abs(pa.selisih) > 0}<span class="font-semibold {pa.selisih < 0 ? 'text-amber-700' : 'text-red-700'}"> · selisih {rp(pa.selisih)}</span>{/if}
						· {pa.pekerja.length - pa.pekerja_belum_bukti} dari {pa.pekerja.length} pekerja berbukti
					</p>
					<ul class="mt-2 flex flex-col gap-2">
						{#each pa.pekerja as p (p.manpower_id)}
							<li class="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
								<div class="flex items-center justify-between gap-2">
									<div class="min-w-0">
										<p class="truncate font-semibold text-slate-900 dark:text-slate-100">{p.nama}</p>
										<p class="text-slate-500">Bagian {rp(p.jumlah_rincian)}{p.jumlah_diterima ? ` · tercatat ${rp(p.jumlah_diterima)}` : ''}</p>
									</div>
									<span class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold {LABEL[p.status].c}">{LABEL[p.status].t}</span>
								</div>
								{#each p.baris as b (b.id)}
									<div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
										<span>{rp(b.jumlah_diterima)} · {b.metode}</span>
										{#if b.bukti_file_id}<a class="text-blue-600 underline" href={`/api/directus/assets/${b.bukti_file_id}`} target="_blank" rel="noopener">foto</a>{/if}
										<span class="rounded border px-1 {b.status_verifikasi === 'ditolak' ? 'border-red-200 text-red-700' : b.status_verifikasi === 'disetujui' ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-700'}">{b.status_verifikasi}</span>
										{#if b.catatan_verifikasi}<span class="text-red-700">“{b.catatan_verifikasi}”</span>{/if}
										{#if b.status_verifikasi !== 'disetujui'}
											<button type="button" class="ml-auto inline-flex items-center gap-0.5 text-slate-400 hover:text-red-600" onclick={() => batalkan(pa.id, b.id)} aria-label="Batalkan bukti"><IconTrash size={13} /></button>
										{/if}
									</div>
								{/each}
								<button type="button" class="mt-2 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700" onclick={() => bukaForm(pa, p)}>
									<IconCamera size={13} /> {p.status === 'belum' || p.status === 'ditolak' ? 'Tambah bukti' : 'Tambah bukti lagi'}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</div>

{#if form}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Bukti pembagian upah">
		<div class="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
			<h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">Bukti untuk {form.pekerja.nama}</h2>
			<p class="mt-0.5 text-[11px] text-slate-500">Foto pekerja memegang uang atau tanda terima bertanda tangan. Satu foto per pekerja.</p>

			<label class="mt-3 block text-xs font-semibold text-slate-700 dark:text-slate-200" for="spj-jumlah">Jumlah diterima (Rp)</label>
			<input id="spj-jumlah" type="number" inputmode="numeric" min="0" class="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800" bind:value={jumlah} />

			<div class="mt-3 flex gap-2 text-xs font-semibold">
				<button type="button" class="flex-1 rounded-lg border py-2 {metode === 'tunai' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}" onclick={() => (metode = 'tunai')}>Tunai</button>
				<button type="button" class="flex-1 rounded-lg border py-2 {metode === 'transfer' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}" onclick={() => (metode = 'transfer')}>Transfer</button>
			</div>

			<label class="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-3 text-xs font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300">
				<IconCamera size={16} /> {foto ? 'Ganti foto' : 'Ambil foto bukti'}
				<input type="file" accept="image/*" capture="environment" class="hidden" onchange={pilihFoto} />
			</label>
			{#if pratinjau}<img src={pratinjau} alt="Pratinjau bukti" class="mt-2 max-h-48 w-full rounded-lg object-contain" />{/if}

			{#if pesanForm}<p class="mt-2 flex items-start gap-1 text-xs text-red-700"><IconAlertTriangle size={14} class="mt-0.5 shrink-0" /> {pesanForm}</p>{/if}

			<div class="mt-4 flex gap-2">
				<button type="button" class="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-600" onclick={tutupForm} disabled={mengirim}>Batal</button>
				<button type="button" class="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-60" onclick={kirim} disabled={mengirim}>
					{#if mengirim}<IconLoader2 size={15} class="animate-spin" /> Mengirim…{:else}<IconCheck size={15} /> Sudah diterima{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
