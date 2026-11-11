<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconQrcode, IconKey, IconAlertTriangle, IconSearch, IconX } from '@tabler/icons-svelte';
	import QrCameraScanner from '$lib/components/ui/QrCameraScanner.svelte';
	import { searchKaryawan } from '$lib/services/security';
	import {
		fetchKunci,
		pinjamKunci,
		kembalikanKunci,
		cariKunciLokal,
		fetchAtasanPeminjam,
		KunciError,
		type AtasanPeminjam,
		type KunciItem,
		type KunciRingkasan
	} from '$lib/services/kunci';

	type Filter = 'semua' | 'keluar' | 'tersedia';

	let loading = $state(true);
	let errorMsg = $state('');
	let successMsg = $state('');
	let items = $state<KunciItem[]>([]);
	let ringkasan = $state<KunciRingkasan | null>(null);
	let filter = $state<Filter>('semua');
	let q = $state('');
	let scanning = $state(false);

	// Kunci yang sedang diproses (bottom sheet)
	let aktif = $state<KunciItem | null>(null);
	let saving = $state(false);
	let sheetError = $state('');

	// Form pinjam
	let peminjamQuery = $state('');
	let peminjamResults = $state<{ id: number; label: string }[]>([]);
	let peminjam = $state<{ id: number; label: string } | null>(null);
	let rencanaKembali = $state(''); // datetime-local, kosong = batas default dari setelan
	let catatan = $state('');
	let perluAlasan = $state(false); // gate G_SEC8 mode soft meminta alasan
	let alasan = $state('');
	let darurat = $state(false);
	let atasanOpts = $state<AtasanPeminjam[]>([]);
	let izinAtasanId = $state<number | null>(null);

	// Form kembali
	let kondisi = $state<'lengkap_baik' | 'rusak' | 'hilang'>('lengkap_baik');

	async function muat() {
		try {
			const res = await fetchKunci();
			items = res.items || [];
			ringkasan = res.ringkasan || null;
			errorMsg = '';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat daftar kunci.';
		}
		loading = false;
	}
	onMount(muat);

	const tampil = $derived(
		(items || []).filter((k) => {
			if (filter === 'keluar' && k.status !== 'dipinjam' && k.status !== 'overnight_ijin') return false;
			if (filter === 'tersedia' && k.status !== 'tersedia') return false;
			const s = q.trim().toLowerCase();
			if (!s) return true;
			return [k.kode_kunci, k.nama_kunci, k.lokasi_kotak, k.nomor_hook, k.pemegang_nama].some((v) => (v ?? '').toLowerCase().includes(s));
		})
	);

	const fmtJam = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

	const statusLabel: Record<string, { teks: string; bg: string; fg: string }> = {
		tersedia: { teks: 'Di slot', bg: '#DCFCE7', fg: '#166534' },
		dipinjam: { teks: 'Dipinjam', bg: '#FEE2E2', fg: '#991B1B' },
		overnight_ijin: { teks: 'Izin bawa pulang', bg: '#E0E7FF', fg: '#3730A3' },
		hilang: { teks: 'Hilang', bg: '#F3F4F6', fg: '#374151' },
		rusak: { teks: 'Rusak', bg: '#F3F4F6', fg: '#374151' },
		disimpan_khusus: { teks: 'Brankas GA', bg: '#F3F4F6', fg: '#374151' }
	};

	function buka(k: KunciItem) {
		aktif = k;
		sheetError = '';
		peminjam = null;
		peminjamQuery = '';
		peminjamResults = [];
		rencanaKembali = '';
		catatan = '';
		perluAlasan = false;
		alasan = '';
		darurat = false;
		atasanOpts = [];
		izinAtasanId = null;
		kondisi = 'lengkap_baik';
	}
	function tutup() {
		aktif = null;
	}

	function onScan(value: string) {
		scanning = false;
		const k = cariKunciLokal(items, value);
		if (!k) {
			errorMsg = 'QR tidak dikenali sebagai kunci terdaftar. Coba cari manual, atau minta GA mendaftarkannya.';
			return;
		}
		errorMsg = '';
		buka(k);
	}

	let timer: ReturnType<typeof setTimeout>;
	function onPeminjamInput() {
		peminjam = null;
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (!peminjamQuery.trim()) {
				peminjamResults = [];
				return;
			}
			try {
				const rs = await searchKaryawan(peminjamQuery);
				peminjamResults = rs.map((r) => ({ id: r.id, label: r.nama_karyawan }));
			} catch {
				peminjamResults = [];
			}
		}, 300);
	}
	async function pilihPeminjam(p: { id: number; label: string }) {
		peminjam = p;
		peminjamQuery = p.label;
		peminjamResults = [];
		izinAtasanId = null;
		atasanOpts = [];
		try {
			// Pilihan izin atasan hanya informasi tambahan; gagal memuat tidak menghalangi peminjaman.
			const res = await fetchAtasanPeminjam(p.id);
			if (peminjam?.id === p.id) atasanOpts = res.atasan || [];
		} catch (err) {
			console.warn('[kunci] atasan peminjam tidak dapat dimuat:', err);
		}
	}

	async function submitPinjam() {
		if (!aktif) return;
		sheetError = '';
		if (!peminjam) {
			sheetError = 'Pilih peminjam dari hasil pencarian.';
			return;
		}
		saving = true;
		try {
			const res = await pinjamKunci({
				key_id: aktif.id,
				peminjam_id: peminjam.id,
				rencana_kembali: rencanaKembali ? new Date(rencanaKembali).toISOString() : undefined,
				catatan: catatan.trim() || undefined,
				gate_sec8_reason: alasan.trim() || undefined,
				izin_atasan_id: izinAtasanId ?? undefined,
				darurat: darurat || undefined
			});
			successMsg = `${aktif.kode_kunci} dipinjamkan ke ${peminjam.label}. Batas kembali ${fmtJam(res.rencana_kembali)}.${res.gate ? ' Tercatat sebagai pengecualian.' : ''}`;
			tutup();
			await muat();
		} catch (err) {
			// 422 = gate soft meminta alasan/izin; 400 yang menyebut "darurat" = gate hard (hanya izin atasan/akses darurat).
			if (err instanceof KunciError && (err.status === 422 || (err.status === 400 && /darurat/i.test(err.message)))) perluAlasan = true;
			sheetError = err instanceof Error ? err.message : 'Gagal meminjamkan kunci.';
			if (err instanceof KunciError && err.status === 409) await muat();
		}
		saving = false;
	}

	async function submitKembali() {
		if (!aktif) return;
		sheetError = '';
		saving = true;
		try {
			await kembalikanKunci({ key_id: aktif.id, kondisi_fisik: kondisi, catatan: catatan.trim() || undefined });
			successMsg = `${aktif.kode_kunci} kembali ke slot${kondisi !== 'lengkap_baik' ? ` (ditandai ${kondisi}, GA akan menindaklanjuti)` : ''}.`;
			tutup();
			await muat();
		} catch (err) {
			sheetError = err instanceof Error ? err.message : 'Gagal menerima pengembalian kunci.';
			if (err instanceof KunciError && err.status === 409) await muat();
		}
		saving = false;
	}

	const keluar = (k: KunciItem) => k.status === 'dipinjam' || k.status === 'overnight_ijin';
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-3">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')} aria-label="Kembali">
				<IconArrowLeft size={16} />
			</button>
			<div class="flex-1">
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Kotak Kunci</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Scan QR di gantungan untuk meminjamkan atau menerima kunci</p>
			</div>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		{#if ringkasan}
			<div class="grid grid-cols-4 gap-2 mb-3 text-center">
				<div class="rounded-lg p-2" style="background: var(--sys-fill)"><p class="text-[16px] font-bold">{ringkasan.tersedia}</p><p class="text-[10px]" style="color: var(--sys-label3)">Di slot</p></div>
				<div class="rounded-lg p-2" style="background: var(--sys-fill)"><p class="text-[16px] font-bold">{ringkasan.dipinjam}</p><p class="text-[10px]" style="color: var(--sys-label3)">Dipinjam</p></div>
				<div class="rounded-lg p-2" style="background: var(--sys-fill)"><p class="text-[16px] font-bold" style="color: {ringkasan.terlambat > 0 ? '#B45309' : 'inherit'}">{ringkasan.terlambat}</p><p class="text-[10px]" style="color: var(--sys-label3)">Terlambat</p></div>
				<div class="rounded-lg p-2" style="background: var(--sys-fill)"><p class="text-[16px] font-bold">{ringkasan.izin_bawa_pulang}</p><p class="text-[10px]" style="color: var(--sys-label3)">Bawa pulang</p></div>
			</div>
		{/if}

		<button class="w-full rounded-xl py-3 mb-3 text-[14px] font-semibold text-white flex items-center justify-center gap-2" style="background: var(--g)" onclick={() => (scanning = true)}>
			<IconQrcode size={20} /> Scan QR Kunci
		</button>

		<div class="relative mb-2">
			<IconSearch size={14} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
			<input class="w-full rounded-lg pl-8 pr-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Cari kode, nama kunci, slot, atau pemegang…" bind:value={q} />
		</div>
		<div class="flex gap-2 mb-3">
			{#each [['semua', 'Semua'], ['keluar', 'Di luar kotak'], ['tersedia', 'Di slot']] as [val, label]}
				<button class="px-3 py-1 rounded-full text-[12px] font-medium" style="background: {filter === val ? 'var(--g)' : 'var(--sys-fill)'}; color: {filter === val ? 'white' : 'var(--sys-label)'}" onclick={() => (filter = val as Filter)}>{label}</button>
			{/each}
		</div>

		{#if loading}
			<div class="flex justify-center py-8"><IconLoader2 size={24} class="animate-spin" /></div>
		{:else if tampil.length === 0}
			<div class="rounded-xl p-6 text-center text-[12px]" style="background: var(--sys-fill); color: var(--sys-label3)">
				{items.length === 0 ? 'Belum ada kunci terdaftar. Minta GA mendaftarkan kunci di Dashboard Admin → GA → Manajemen Kunci.' : 'Tidak ada kunci yang cocok dengan filter.'}
			</div>
		{:else}
			<div class="space-y-2">
				{#each tampil as k (k.id)}
					{@const st = statusLabel[k.status] ?? { teks: k.status, bg: '#F3F4F6', fg: '#374151' }}
					<button class="w-full text-left rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid {k.terlambat ? '#F59E0B' : 'var(--sys-sep)'}" onclick={() => buka(k)} disabled={k.status === 'hilang' || k.status === 'disimpan_khusus' || k.status === 'rusak'}>
						<div class="flex items-start gap-2">
							<IconKey size={18} style="color: var(--sys-label3)" />
							<div class="flex-1 min-w-0">
								<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{k.kode_kunci} · {k.nama_kunci}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{k.lokasi_kotak || 'Kotak -'}{k.nomor_hook ? ` · Slot ${k.nomor_hook}` : ''}{k.is_restricted ? ' · Terbatas' : ''}</p>
								{#if keluar(k)}
									<p class="text-[11px] mt-1" style="color: var(--sys-label)">Dibawa <b>{k.pemegang_nama ?? '-'}</b> sejak {fmtJam(k.waktu_pinjam)} · kembali {fmtJam(k.rencana_kembali)}</p>
								{/if}
							</div>
							<div class="flex flex-col items-end gap-1">
								<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: {st.bg}; color: {st.fg}">{st.teks}</span>
								{#if k.terlambat}<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1" style="background: #FEF3C7; color: #92400E"><IconAlertTriangle size={10} /> Terlambat</span>{/if}
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if scanning}
	<QrCameraScanner onDetect={onScan} onClose={() => (scanning = false)} />
{/if}

{#if aktif}
	<div class="fixed inset-0 z-40 flex items-end justify-center" style="background: rgba(0,0,0,0.5)">
		<div class="w-full max-w-lg rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto" style="background: white">
			<div class="flex items-start justify-between mb-2">
				<div>
					<p class="text-[14px] font-bold">{aktif.kode_kunci} · {aktif.nama_kunci}</p>
					<p class="text-[11px]" style="color: var(--sys-label3)">{aktif.lokasi_kotak || 'Kotak -'}{aktif.nomor_hook ? ` · Slot ${aktif.nomor_hook}` : ''}</p>
				</div>
				<button onclick={tutup} aria-label="Tutup"><IconX size={18} /></button>
			</div>

			{#if sheetError}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{sheetError}</div>{/if}

			{#if aktif.status === 'tersedia'}
				{#if aktif.is_restricted}
					<p class="text-[11px] mb-2 rounded-lg p-2" style="background: #FEF3C7; color: #92400E">Kunci terbatas: di luar jam kerja atau dibawa pulang butuh alasan.</p>
				{/if}
				<label class="text-[11px] font-semibold mb-1 block" for="peminjam">Peminjam</label>
				<input id="peminjam" class="w-full rounded-lg px-3 py-2 text-[13px] mb-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Cari nama karyawan…" bind:value={peminjamQuery} oninput={onPeminjamInput} />
				{#if peminjamResults.length > 0}
					<div class="rounded-lg mb-2 overflow-hidden" style="border: 1px solid var(--sys-sep)">
						{#each peminjamResults as r}
							<button class="w-full text-left px-3 py-2 text-[12px]" style="background: white" onclick={() => pilihPeminjam(r)}>{r.label}</button>
						{/each}
					</div>
				{/if}

				<label class="text-[11px] font-semibold mb-1 mt-2 block" for="rencana">Batas kembali (opsional)</label>
				<input id="rencana" type="datetime-local" class="w-full rounded-lg px-3 py-2 text-[13px] mb-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={rencanaKembali} />
				<p class="text-[11px] mb-2" style="color: var(--sys-label3)">Kosongkan untuk memakai batas default (akhir hari kerja). Isi hari berikutnya bila kunci dibawa pulang — alasan wajib.</p>

				<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Keperluan / catatan (mis. tujuan, plat mobil)" bind:value={catatan}></textarea>

				{#if atasanOpts.length > 0 && (aktif.is_restricted || rencanaKembali || perluAlasan)}
					<div class="rounded-lg p-2 mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<p class="text-[11px] font-semibold mb-1">Izin atasan peminjam (opsional)</p>
						<p class="text-[11px] mb-1" style="color: var(--sys-label3)">Pilih bila atasan sudah mengizinkan (langsung/chat). Izin ini setara alasan, dan atasan diberi tahu lewat WhatsApp agar bisa menyanggah.</p>
						<label class="flex items-center gap-2 text-[12px]"><input type="radio" name="izin-atasan" checked={izinAtasanId === null} onchange={() => (izinAtasanId = null)} /> Tidak ada izin atasan</label>
						{#each atasanOpts as a (a.id)}
							<label class="flex items-center gap-2 text-[12px]"><input type="radio" name="izin-atasan" checked={izinAtasanId === a.id} onchange={() => (izinAtasanId = a.id)} /> {a.nama} <span style="color: var(--sys-label3)">({a.jenis})</span></label>
						{/each}
					</div>
				{/if}

				{#if perluAlasan}
					<label class="text-[11px] font-semibold mb-1 block" for="alasan">Alasan pengecualian</label>
					<textarea id="alasan" rows="2" class="w-full rounded-lg px-3 py-2 text-[13px] mb-1" style="background: var(--sys-fill); border: 1px solid #F59E0B" placeholder="Jelaskan kenapa kunci tetap dipinjamkan" bind:value={alasan}></textarea>
					<label class="flex items-center gap-2 text-[12px] mb-2"><input type="checkbox" bind:checked={darurat} /> Akses darurat (tetap tercatat dan dilaporkan ke GA)</label>
				{/if}

				<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitPinjam}>
					{#if saving}<IconLoader2 size={16} class="animate-spin inline mr-1" />{/if}{saving ? 'Memproses…' : 'Pinjamkan Kunci'}
				</button>
			{:else if keluar(aktif)}
				<p class="text-[12px] mb-2">Dibawa <b>{aktif.pemegang_nama ?? '-'}</b> sejak {fmtJam(aktif.waktu_pinjam)}; batas kembali {fmtJam(aktif.rencana_kembali)}.</p>
				<label class="text-[11px] font-semibold mb-1 block" for="kondisi">Kondisi kunci saat kembali</label>
				<select id="kondisi" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={kondisi}>
					<option value="lengkap_baik">Lengkap & baik</option>
					<option value="rusak">Rusak</option>
					<option value="hilang">Hilang (tidak dikembalikan)</option>
				</select>
				{#if kondisi !== 'lengkap_baik'}
					<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid #F59E0B" placeholder="Wajib: jelaskan kerusakan / kronologi (min. 10 karakter)" bind:value={catatan}></textarea>
				{/if}
				<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitKembali}>
					{#if saving}<IconLoader2 size={16} class="animate-spin inline mr-1" />{/if}{saving ? 'Memproses…' : 'Terima Kunci Kembali'}
				</button>
				<p class="text-[11px] mt-2" style="color: var(--sys-label3)">Gantungkan kunci di slot yang tertera, lalu tekan tombol di atas.</p>
			{/if}
		</div>
	</div>
{/if}
