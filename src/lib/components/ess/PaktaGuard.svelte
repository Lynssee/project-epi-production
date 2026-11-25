<script lang="ts">
	// Pakta Pra-Kegiatan (rencana_sistem_pakta_sop_gate, Fase 2). Membungkus slot halaman utama — pola sama dengan QuizGateHost.
	//  • Kunci KONTEKSTUAL: hanya halaman kegiatan yang punya aturan (mis. Stock Opname). Halaman darurat/baca tak pernah dikunci
	//    (diputuskan server dari setelan project.pakta.*), jadi Absen / Insiden K3 / Panduan selalu terbuka.
	//  • Mode gate (diatur Super Admin di /settings/gates): warn = banner, soft = kartu boleh dilewati, hard = kartu menahan halaman.
	//  • Tiap SOP/Alur: ringkasan + "Baca lengkap" + kotak centang (aktif setelah waktu baca) → "Saya Paham & Setuju" = tanda tangan otomatis.
	//  • "Ada Kendala" (bukan sekadar "tidak setuju"): wajib kategori + alasan → tercatat, atasan menindaklanjuti.
	// Fail-open: bila status gagal dimuat, TIDAK ada yang terkunci. Status per halaman di-cache klien (lihat services/ess/pakta.ts).
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import {
		getPaktaStatus,
		setujuiPakta,
		ajukanKendalaPakta,
		PAKTA_REFRESH_EVENT,
		requestPaktaRefresh,
		type PaktaStatus,
		type PaktaItem,
		type PaktaStamp
	} from '$lib/services/ess/pakta';
	import { PAKTA_KATEGORI_KENDALA, bolehCentang, alasanBelumBolehCentang } from '$lib/utils/paktaPolicy';
	import { isAttendancePriorityPending, waitForAttendancePriority } from '$lib/utils/essPriority';
	import { IconShieldCheck, IconLock, IconExternalLink, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';

	let { children } = $props();

	let status = $state<PaktaStatus | null>(null);
	let karyawanId = $state<number | null>(null);
	let karyawanName = $state<string>('');
	let loadedKey = '';
	let reviewOpen = $state(false); // banner (warn): buka kartu secara sukarela
	let dilewati = $state<string[]>([]); // soft: "Lanjut dulu" selama sesi halaman ini

	// Per kartu
	let dicentang = $state<Record<string, boolean>>({});
	let menyimpan = $state<string | null>(null);
	let galat = $state('');
	let stempel = $state<Record<string, PaktaStamp>>({});
	let kendalaFor = $state<string | null>(null);
	let kategori = $state('');
	let alasan = $state('');
	let kendalaTerkirim = $state<Record<string, string>>({});

	// Waktu baca minimum & scroll
	let elapsedSec = $state(0);
	let scrolledToEnd = $state(false);
	let timer: ReturnType<typeof setInterval> | null = null;

	const keyOf = (i: PaktaItem) => (i.type === 'gate' ? `gate:${i.gate_key}` : i.type === 'flow' ? `flow:${i.flow_key}` : `sop:${i.sop_id}`);

	async function load(path: string, force = false) {
		try {
			const s = await getPaktaStatus(path, { force });
			status = s;
			elapsedSec = 0;
			scrolledToEnd = false;
		} catch {
			status = null; // fail-open (Aturan #3)
		}
	}

	onMount(() => {
		const unsub = authStore.subscribe((a) => {
			karyawanName = a.karyawanName ?? '';
			karyawanId = a.checked ? a.karyawanId : null;
		});
		const onRefresh = () => void load(page.url.pathname, true);
		// Kembali dari tab "Baca lengkap" (mis. sudah menyetujui di halaman SOP) → muat ulang status bila kartu sedang tampil.
		const onVisible = () => {
			if (document.visibilityState === 'visible' && status?.decision.show) void load(page.url.pathname, true);
		};
		window.addEventListener(PAKTA_REFRESH_EVENT, onRefresh);
		document.addEventListener('visibilitychange', onVisible);
		timer = setInterval(() => (elapsedSec += 1), 1000);
		return () => {
			unsub();
			window.removeEventListener(PAKTA_REFRESH_EVENT, onRefresh);
			document.removeEventListener('visibilitychange', onVisible);
			if (timer) clearInterval(timer);
		};
	});

	let pathname = $derived(page.url.pathname);
	$effect(() => {
		const k = `${karyawanId ?? ''}|${pathname}`;
		if (!karyawanId || loadedKey === k) return;
		loadedKey = k;
		reviewOpen = false;
		// /ess/absen adalah escape path pakta — tidak perlu memanggil API saat karyawan hendak absen.
		if (pathname === '/ess/absen' || pathname.startsWith('/ess/absen/')) return;
		if (isAttendancePriorityPending()) {
			const targetPath = pathname;
			let cancelled = false;
			void waitForAttendancePriority(3000).then(() => {
				if (!cancelled && page.url.pathname === targetPath) void load(targetPath);
			});
			return () => {
				cancelled = true;
			};
		}
		void load(pathname);
	});

	let d = $derived(status?.decision);
	let items = $derived(status?.items ?? []);
	let semuaKey = $derived(items.map(keyOf).join(','));
	let sudahDilewati = $derived(dilewati.includes(`${pathname}|${semuaKey}`));
	let tampilKartu = $derived(!!d?.show && items.length > 0 && (d.presentation === 'modal' ? !sudahDilewati : reviewOpen));
	let tampilBanner = $derived(!!d?.show && d.presentation === 'banner' && !reviewOpen && items.length > 0);
	let terkunci = $derived(tampilKartu && !!d?.blocked);
	let cfg = $derived(status?.settings ?? { min_read_seconds: 5, require_scroll: false });
	let boleh = $derived(bolehCentang({ elapsedSec, minSec: cfg.min_read_seconds, scrolledToEnd, requireScroll: cfg.require_scroll }));
	let bantu = $derived(alasanBelumBolehCentang({ elapsedSec, minSec: cfg.min_read_seconds, scrolledToEnd, requireScroll: cfg.require_scroll }));

	function onScroll(e: Event) {
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) scrolledToEnd = true;
	}
	function fmtTanggal(iso: string | null | undefined): string {
		if (!iso) return '';
		return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
	}

	async function setuju(item: PaktaItem) {
		const k = keyOf(item);
		galat = '';
		menyimpan = k;
		try {
			stempel[k] = await setujuiPakta(item, pathname);
			// Tampilkan stempel sebentar, lalu muat ulang status (halaman terbuka bila semua sudah disetujui).
			setTimeout(() => requestPaktaRefresh(), 1800);
		} catch (e: any) {
			galat = e?.message || 'Gagal menyimpan persetujuan. Coba lagi.';
		} finally {
			menyimpan = null;
		}
	}

	async function kirimKendala(item: PaktaItem) {
		galat = '';
		if (!kategori) {
			galat = 'Pilih jenis kendalanya dulu.';
			return;
		}
		if (alasan.trim().length < 15) {
			galat = 'Jelaskan kendala minimal 15 karakter agar atasan bisa membantu.';
			return;
		}
		menyimpan = keyOf(item);
		try {
			const r = await ajukanKendalaPakta(item, { kategori, alasan: alasan.trim(), route: pathname });
			kendalaTerkirim[keyOf(item)] = r.message;
			kendalaFor = null;
			kategori = '';
			alasan = '';
			if (d?.canProceedWithNote) dilewati = [...dilewati, `${pathname}|${semuaKey}`]; // soft: lanjut dengan catatan
		} catch (e: any) {
			galat = e?.message || 'Gagal mengirim kendala.';
		} finally {
			menyimpan = null;
		}
	}
</script>

{#if tampilBanner && status}
	<div class="mx-4 mt-3 rounded-xl px-3 py-2.5 flex items-center gap-2 border" style="background: var(--sys-fill2); border-color: var(--sys-sep)">
		<IconShieldCheck size={20} class="shrink-0" style="color: var(--sys-tint)" />
		<p class="flex-1 text-[12px] leading-snug" style="color: var(--sys-label)">
			Ada {items.length} aturan/SOP baru untuk {status.label ?? 'kegiatan ini'} yang perlu Anda setujui.
		</p>
		<button class="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white" style="background: var(--sys-tint)" onclick={() => (reviewOpen = true)}>Tinjau</button>
	</div>
{/if}

{#if tampilKartu && status}
	<div class="p-4" data-testid="pakta-kartu">
		<div class="rounded-xl p-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
			<div class="text-center">
				{#if terkunci}
					<IconLock size={30} class="mx-auto mb-2 text-amber-500" />
				{:else}
					<IconShieldCheck size={30} class="mx-auto mb-2" style="color: var(--sys-tint)" />
				{/if}
				<p class="text-[15px] font-bold mb-1" style="color: var(--sys-label)">
					Sebelum mulai {status.label ?? 'kegiatan ini'}: setujui aturan kerja berikut
				</p>
				<p class="text-[12px] leading-relaxed" style="color: var(--sys-label-2)">
					{status.gate_hint ?? 'Baca ringkasannya, lalu centang persetujuan. Persetujuan Anda tercatat dengan tanda tangan otomatis.'}
				</p>
			</div>

			<div class="mt-3 space-y-3">
				{#each items as item (keyOf(item))}
					{@const k = keyOf(item)}
					<div class="rounded-xl border p-3" style="background: var(--sys-fill); border-color: var(--sys-sep)">
						<div class="flex items-start gap-2">
							<div class="flex-1 min-w-0">
								<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{item.title ?? 'Tanpa judul'}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">
									{#if item.type === 'gate'}Perubahan aturan sistem{item.sosialisasi_end_date ? ` · berlaku sejak ${item.sosialisasi_end_date}` : ''}{:else}{item.sop_code ?? (item.type === 'flow' ? 'Alur kerja' : 'SOP')} · versi {item.version}{item.sosialisasi_end_date ? ` · batas sosialisasi ${fmtTanggal(item.sosialisasi_end_date)}` : ''}{/if}
								</p>
							</div>
							{#if item.baca_url}<a href={item.baca_url} target="_blank" rel="noopener" class="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border" style="border-color: var(--sys-sep); color: var(--sys-tint)">
								Baca lengkap <IconExternalLink size={12} />
							</a>{/if}
						</div>

						{#if stempel[k]}
							<div class="mt-2 rounded-lg p-2.5 flex items-start gap-2" style="background: var(--sys-fill2)">
								<IconCircleCheck size={18} class="shrink-0 text-emerald-500" />
								<div class="text-[12px]" style="color: var(--sys-label)">
									<p class="font-semibold">Disetujui — tanda tangan otomatis tercatat</p>
									<p style="color: var(--sys-label-2)">{karyawanName || 'Anda'} · {fmtTanggal(stempel[k].confirmed_at)}{stempel[k].signature ? ` · Kode: ${stempel[k].signature}` : ''}</p>
								</div>
							</div>
						{:else if kendalaTerkirim[k]}
							<div class="mt-2 rounded-lg p-2.5 text-[12px]" style="background: var(--sys-fill2); color: var(--sys-label)">
								<IconAlertTriangle size={16} class="inline text-amber-500" /> {kendalaTerkirim[k]}
								{#if d?.blocked}<span style="color: var(--sys-label-2)"> Kegiatan tetap terkunci sampai atasan memberi dispensasi.</span>{/if}
							</div>
						{:else}
							<!-- 📌 Apa yang berubah -->
							<div class="mt-2 max-h-40 overflow-y-auto rounded-lg p-2.5 text-[12px] leading-relaxed" style="background: var(--sys-fill2); color: var(--sys-label)" onscroll={onScroll}>
								<p class="font-bold mb-1" style="color: var(--sys-label3)">📌 Inti aturan</p>
								<p>{item.ringkasan ?? (item.type === 'gate' ? 'Aturan sistem ini berubah.' : 'Ringkasan belum tersedia. Tekan "Baca lengkap" untuk membaca dokumen sebelum menyetujui.')}</p>
								{#if status.gate_nama}
									<p class="font-bold mt-2 mb-1" style="color: var(--sys-label3)">🛡️ Yang akan diperiksa sistem</p>
									<p>{status.gate_nama}</p>
								{/if}
							</div>

							<label class="mt-2 flex items-start gap-2 text-[12px] leading-snug {boleh ? '' : 'opacity-60'}" style="color: var(--sys-label)">
								<input type="checkbox" class="mt-0.5" disabled={!boleh} bind:checked={dicentang[k]} />
								<span>Saya telah membaca, memahami, dan menyetujui untuk menjalankan prosedur ini.</span>
							</label>
							{#if bantu}<p class="mt-1 text-[11px]" style="color: var(--sys-label3)">{bantu}</p>{/if}

							{#if kendalaFor === k}
								<div class="mt-2 rounded-lg p-2.5 space-y-2" style="background: var(--sys-fill2)">
									<p class="text-[12px] font-bold" style="color: var(--sys-label)">Ada kendala di lapangan?</p>
									<select class="w-full rounded-lg border px-2 py-2 text-[12px]" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)" bind:value={kategori}>
										<option value="">Pilih jenis kendala…</option>
										{#each PAKTA_KATEGORI_KENDALA as kk (kk.value)}<option value={kk.value}>{kk.label}</option>{/each}
									</select>
									<textarea rows="3" class="w-full rounded-lg border px-2 py-2 text-[12px]" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)" placeholder="Jelaskan singkat (min. 15 karakter), mis. alat hitung belum ada di site" bind:value={alasan}></textarea>
									<p class="text-[11px]" style="color: var(--sys-label3)">
										{d?.blocked ? 'Kegiatan tetap terkunci sampai atasan memberi dispensasi.' : 'Anda bisa lanjut bekerja; kendala ini tercatat dan diteruskan ke atasan.'}
									</p>
									<div class="flex gap-2">
										<button class="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white disabled:opacity-50" style="background: var(--sys-tint)" disabled={menyimpan === k} onclick={() => kirimKendala(item)}>Kirim kendala</button>
										<button class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label)" onclick={() => (kendalaFor = null)}>Batal</button>
									</div>
								</div>
							{:else}
								<div class="mt-2 flex flex-wrap gap-2">
									<button class="px-4 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-40" style="background: var(--sys-tint)" disabled={!boleh || !dicentang[k] || menyimpan === k} onclick={() => setuju(item)}>
										{menyimpan === k ? 'Menyimpan…' : 'Saya Paham & Setuju'}
									</button>
									<button class="px-4 py-2 rounded-xl text-[12px] font-bold border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)" onclick={() => { kendalaFor = k; galat = ''; }}>Ada Kendala</button>
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>

			{#if galat}<p class="mt-2 text-[12px] text-rose-500" role="alert">{galat}</p>{/if}

			<div class="mt-3 flex flex-wrap items-center justify-center gap-2">
				{#if terkunci}
					<a href="/ess/absen" class="px-4 py-2 rounded-xl text-[12px] font-bold border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)">Absen Masuk / Pulang</a>
					<a href="/hse" class="px-4 py-2 rounded-xl text-[12px] font-bold border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)">Lapor Insiden K3</a>
				{:else if d?.canProceedWithNote}
					<button class="px-4 py-2 rounded-xl text-[12px] font-semibold underline" style="color: var(--sys-label-2)" onclick={() => (dilewati = [...dilewati, `${pathname}|${semuaKey}`])}>Lanjut dulu, saya baca nanti</button>
				{:else}
					<button class="px-4 py-2 rounded-xl text-[12px] font-semibold underline" style="color: var(--sys-label-2)" onclick={() => (reviewOpen = false)}>Tutup</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if !terkunci}
	{@render children()}
{/if}
