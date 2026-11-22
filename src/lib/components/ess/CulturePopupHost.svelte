<script lang="ts">
	// Penayang popup motivasi/tips/Reminder SOP (+ microquiz) di aplikasi lapangan. Tak terlihat bila tidak ada konten.
	// Hemat resource & aman offline: 1 GET per hari (payload di localStorage → tetap jalan tanpa sinyal), pemilihan momen & jam
	// terjadwal dihitung LOKAL, 1 request hanya saat menekan "Paham" / menjawab. Gagal = diam (dilog) — TIDAK PERNAH menghalangi absen.
	import { onMount, onDestroy } from 'svelte';
	import { auth } from '$lib/firebase';
	import { getBudayaPopup, ackBudayaPopup, jawabMicroquiz, type BudayaPopupPayload, type MicroquizHasil } from '$lib/services/ess/budaya';
	import {
		CULTURE_MOMENT_EVENT, decidePopup, loadDayState, saveDayState, loadCachedPayload, saveCachedPayload, recordShown, recordAnswered,
		type Momen, type PopupDecision
	} from '$lib/utils/culturePopupClient';

	const TONES: Record<string, string> = {
		indigo: 'linear-gradient(90deg,#4f46e5,#6366f1)', emerald: 'linear-gradient(90deg,#059669,#10b981)', amber: 'linear-gradient(90deg,#d97706,#f59e0b)',
		rose: 'linear-gradient(90deg,#e11d48,#f43f5e)', sky: 'linear-gradient(90deg,#0284c7,#0ea5e9)'
	};
	const MOMEN_LABEL: Record<string, string> = {
		clock_in: 'Absen Masuk', break_out: 'Mulai Istirahat', break_in: 'Kembali Istirahat', clock_out: 'Absen Pulang', app_open: 'Pesan Hari Ini', scheduled_time: 'Pengingat'
	};
	const wibNow = () => {
		const d = new Date();
		return {
			ymd: d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }),
			hhmm: d.toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
		};
	};
	const store = () => (typeof window !== 'undefined' ? window.localStorage : null);
	const session = () => (typeof window !== 'undefined' ? window.sessionStorage : null);

	let payload: BudayaPopupPayload | null = null;
	let userKey = 'anon';
	let disabled = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let ticker: ReturnType<typeof setInterval> | null = null;

	let current = $state<(PopupDecision & { momen: Momen }) | null>(null);
	let busy = $state(false);
	let hasil = $state<MicroquizHasil | null>(null);
	let dipilih = $state<number | null>(null);
	let gagalNilai = $state(false);

	const b = $derived((current?.item?.popup_behavior ?? {}) as Record<string, any>);
	const mq = $derived(current?.microquiz ?? null);
	const final = $derived(!!hasil && !hasil.boleh_ulang);

	async function muatPayload(): Promise<BudayaPopupPayload | null> {
		const { ymd } = wibNow();
		const cached = loadCachedPayload(store(), userKey, ymd);
		if (cached) return cached;
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
		try {
			const p = await getBudayaPopup();
			saveCachedPayload(store(), userKey, ymd, p);
			return p;
		} catch (e) {
			// Belum tertaut ke karyawan / sesi habis / server sibuk: matikan sampai muat ulang (tidak mengulang request).
			console.warn('[CulturePopupHost] payload popup tidak dimuat:', (e as Error)?.message);
			disabled = true;
			return null;
		}
	}

	async function tampilkan(momen: Momen, timing: 'before' | 'after' = 'after') {
		if (disabled || current) return;
		if (!payload) payload = await muatPayload();
		if (!payload) return;
		const { ymd, hhmm } = wibNow();
		const state = loadDayState(store(), userKey, ymd);
		const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
		const d = decidePopup(payload, state, { momen, timing, hhmm, nowMs: Date.now(), ymd, online });
		if (!d) return;
		saveDayState(store(), userKey, ymd, recordShown(state, d.item.id, Date.now(), d.slot));
		hasil = null;
		dipilih = null;
		gagalNilai = false;
		current = { ...d, momen };
		const sec = Number(d.item.popup_behavior?.auto_close_sec) || 0;
		// Tutup otomatis hanya bila TIDAK ada microquiz (jangan memutus karyawan yang sedang menjawab).
		if (sec > 0 && !d.microquiz) timer = setTimeout(() => tutup(false), sec * 1000);
	}

	function tutup(kirimAck: boolean) {
		if (timer) clearTimeout(timer);
		const c = current;
		current = null;
		if (kirimAck && c && !c.microquiz && typeof navigator !== 'undefined' && navigator.onLine !== false) {
			ackBudayaPopup(c.item.id, c.momen).catch((e) => console.warn('[CulturePopupHost] ack popup gagal (dilewati):', e?.message));
		}
	}

	async function pilih(idx: number) {
		if (busy || !current?.microquiz || final) return;
		dipilih = idx;
		busy = true;
		try {
			if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
			const r = await jawabMicroquiz(current.item.id, idx, current.momen, hasil?.token ?? tokenCoba);
			hasil = r;
			if (r.status_aksi || r.sudah_dijawab) {
				const { ymd } = wibNow();
				saveDayState(store(), userKey, ymd, recordAnswered(loadDayState(store(), userKey, ymd), current.item.id));
			}
		} catch (e) {
			console.warn('[CulturePopupHost] microquiz tidak dinilai (dilewati):', (e as Error)?.message);
			gagalNilai = true; // tidak memblokir: karyawan tetap bisa menutup popup
		} finally {
			busy = false;
		}
	}
	let tokenCoba: string | null = null; // token percobaan dari jawaban salah sebelumnya (hitungan konsisten lintas instance)
	function cobaLagi() {
		tokenCoba = hasil?.token ?? null;
		hasil = null;
		dipilih = null;
	}

	function onMomen(e: Event) {
		const { momen, timing } = ((e as CustomEvent).detail || {}) as { momen?: Momen; timing?: 'before' | 'after' };
		if (momen) void tampilkan(momen, timing || 'after');
	}
	function onKey(e: KeyboardEvent) {
		if (current && e.key === 'Escape' && b.dismissible !== false && !b.require_ack) tutup(false);
	}
	function cekJam() {
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
		void tampilkan('scheduled_time');
	}

	onMount(() => {
		userKey = auth.currentUser?.uid || 'anon';
		window.addEventListener(CULTURE_MOMENT_EVENT, onMomen);
		window.addEventListener('keydown', onKey);
		(async () => {
			payload = await muatPayload();
			if (!payload?.enabled) return; // tidak aktif / skema belum ada → tanpa timer
			const { ymd } = wibNow();
			const flag = `culturePopup:open:${userKey}:${ymd}`;
			let sudahBuka = false;
			try {
				sudahBuka = !!session()?.getItem(flag);
				session()?.setItem(flag, '1');
			} catch {
				/* storage diblokir → anggap belum */
			}
			if (!sudahBuka) await tampilkan('app_open');
			cekJam();
			ticker = setInterval(cekJam, 60_000);
		})();
	});
	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener(CULTURE_MOMENT_EVENT, onMomen);
			window.removeEventListener('keydown', onKey);
		}
		if (timer) clearTimeout(timer);
		if (ticker) clearInterval(ticker);
	});
</script>

{#if current}
	<div class="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-4" style="background: rgba(0,0,0,0.45)" role="dialog" aria-modal="true" aria-label={current.item.judul}>
		<div class="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style="background: var(--sys-bg, #fff)" aria-live="polite">
			<div class="px-4 py-2.5 flex items-center justify-between gap-2 text-white" style="background: {TONES[b.theme_tone] || TONES.indigo}">
				<p class="text-[11px] font-bold uppercase tracking-wider truncate">{MOMEN_LABEL[current.momen] ?? 'Pesan Budaya'}</p>
				{#if b.dismissible !== false && !b.require_ack}
					<button type="button" class="text-xl leading-none px-1" aria-label="Tutup" onclick={() => tutup(false)}>×</button>
				{/if}
			</div>
			<div class="p-4 space-y-3">
				<p class="text-[14px] font-bold" style="color: var(--sys-label)">{current.item.judul}</p>
				<p class="text-[13px] whitespace-pre-line" style="color: var(--sys-label2, var(--sys-label))">{current.item.isi_pesan}</p>

				{#if mq}
					<div class="rounded-xl p-3 space-y-2" style="background: rgba(245,158,11,0.10); border: 1px solid rgba(245,158,11,0.4)">
						<p class="text-[10px] font-bold uppercase tracking-wider" style="color: #b45309">🧠 Microquiz</p>
						<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{mq.pertanyaan}</p>
						<div class="space-y-1.5">
							{#each mq.opsi as o, idx}
								<button
									type="button"
									class="w-full text-left rounded-lg px-3 py-2.5 text-[12px] border disabled:cursor-default"
									style={!hasil
										? 'background:#fff;border-color:#cbd5e1'
										: final && idx === hasil.kunci_idx
											? 'background:#ecfdf5;border-color:#10b981;color:#064e3b'
											: dipilih === idx
												? 'background:#fff1f2;border-color:#fb7185;color:#881337'
												: 'background:#fff;border-color:#e2e8f0;opacity:.6'}
									disabled={busy || final || gagalNilai}
									onclick={() => pilih(idx)}>{o}</button>
							{/each}
						</div>
						{#if gagalNilai}
							<p class="text-[11px]" style="color: var(--sys-label3)">Sinyal lemah — microquiz dilewati. Anda bisa menutup pesan ini.</p>
						{:else if hasil}
							<p class="text-[11px]" style="color: {hasil.benar ? '#047857' : '#be123c'}">
								{hasil.benar ? '✅ Benar!' : hasil.boleh_ulang ? '❌ Belum tepat — coba sekali lagi.' : '❌ Jawaban yang benar ditandai hijau.'}
								{#if hasil.penjelasan}{hasil.penjelasan}{/if}
							</p>
							{#if hasil.boleh_ulang}<button type="button" class="text-[11px] underline" onclick={cobaLagi}>Coba lagi</button>{/if}
						{/if}
					</div>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					{#if current.item.sop_document_id}
						<a class="text-[12px] rounded-lg px-2.5 py-1.5 border" style="border-color:#a5b4fc;color:#4338ca" href={`/ess/pelatihan/sop/${current.item.sop_document_id}`} onclick={() => tutup(false)}>📄 Lihat Poin SOP</a>
					{/if}
					<button type="button" class="ml-auto text-[12px] rounded-lg font-semibold px-4 py-2 text-white disabled:opacity-50" style="background:#059669" disabled={busy} onclick={() => tutup(true)}>
						{b.cta_label || 'Paham'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
