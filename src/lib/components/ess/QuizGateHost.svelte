<script lang="ts">
	// App-Blocking Gate kuis periodik (G_TRN_QUIZ_PERIODIC_WAJIB). Membungkus slot halaman utama:
	//  - mode warn / tunda aktif  → banner pengingat di atas halaman;
	//  - mode soft / hard         → halaman kerja diganti kartu "Kuis Wajib", KECUALI path escape (absen, izin/sakit,
	//                               check-in site, Pelatihan — daftar dari pengaturan, bukan hardcode);
	//  - banner H-N sebelum kuis dibuka (persiapan belajar).
	// Fail-open: bila status gagal dimuat, TIDAK ada yang terkunci. Status dimuat sekali per sesi + saat event refresh.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import {
		getQuizGateStatus,
		snoozeQuizGate,
		QUIZ_GATE_REFRESH_EVENT,
		type QuizGateClientStatus
	} from '$lib/services/ess/quizGate';
	import { isEscapePath } from '$lib/utils/quizPeriodic';
	import { isAttendancePriorityPending, waitForAttendancePriority } from '$lib/utils/essPriority';
	import { IconLock, IconClipboardCheck, IconCalendarEvent } from '@tabler/icons-svelte';

	let { children } = $props();

	let status = $state<QuizGateClientStatus | null>(null);
	let loadedFor = '';
	let snoozeOpen = $state(false);
	let alasan = $state('');
	let snoozing = $state(false);
	let snoozeError = $state('');
	// Flashcard 1 menit di layar kunci: kuis yang kartunya sedang dibuka + indeks kartu.
	let kartuKuis = $state<number | null>(null);
	let kartuIdx = $state(0);
	function bukaKartu(id: number) {
		kartuKuis = kartuKuis === id ? null : id;
		kartuIdx = 0;
	}

	async function load() {
		try {
			status = await getQuizGateStatus();
		} catch {
			// Fail-open (Aturan #3): gagal memuat → gate dianggap tidak berlaku.
			status = null;
		}
	}

	onMount(() => {
		let alive = true;
		const unsub = authStore.subscribe((a) => {
			if (!a.checked || !a.karyawanId) return;
			const key = String(a.karyawanId);
			if (loadedFor === key) return;
			loadedFor = key;
			if (isAttendancePriorityPending()) {
				void waitForAttendancePriority(3000).then(() => {
					if (alive) void load();
				});
			} else {
				void load();
			}
		});
		const onRefresh = () => void load();
		window.addEventListener(QUIZ_GATE_REFRESH_EVENT, onRefresh);
		return () => {
			alive = false;
			unsub();
			window.removeEventListener(QUIZ_GATE_REFRESH_EVENT, onRefresh);
		};
	});

	let pathname = $derived(page.url.pathname);
	let escape = $derived(status ? isEscapePath(pathname, status.escapePaths) : false);
	let locked = $derived(!!status?.blocking && !escape);
	let pending = $derived((status?.items ?? []).filter((i) => i.state === 'pending'));
	let upcoming = $derived(status?.upcoming ?? []);

	function fmtTanggal(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
	}

	async function doSnooze() {
		snoozeError = '';
		if (alasan.trim().length < 10) {
			snoozeError = 'Tulis alasan darurat minimal 10 karakter.';
			return;
		}
		snoozing = true;
		try {
			await snoozeQuizGate(alasan.trim());
			snoozeOpen = false;
			alasan = '';
			await load();
		} catch (e: any) {
			snoozeError = e?.message || 'Gagal menunda.';
		} finally {
			snoozing = false;
		}
	}
</script>

{#if locked && status}
	<div class="p-4">
		<div class="rounded-xl p-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
			<div class="text-center">
				<IconLock size={30} class="mx-auto mb-2 text-rose-500" />
				<p class="text-[15px] font-bold mb-1" style="color: var(--sys-label)">Kuis wajib periode ini belum dikerjakan</p>
				<p class="text-[12px] leading-relaxed" style="color: var(--sys-label-2)">
					Selesaikan kuis di bawah untuk membuka kembali menu kerja. Absen Masuk/Pulang dan Izin/Sakit tetap bisa dipakai.
				</p>
			</div>

			<div class="mt-3 space-y-2">
				{#each pending as q (q.quizId)}
					<a
						href={`/ess/pelatihan/${q.programId}`}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 border"
						style="background: var(--sys-fill); border-color: var(--sys-sep)"
					>
						<IconClipboardCheck size={22} class="shrink-0" style="color: var(--sys-tint)" />
						<span class="flex-1 min-w-0">
							<span class="block text-[13px] font-semibold truncate" style="color: var(--sys-label)">{q.judul}</span>
							<span class="block text-[11px]" style="color: var(--sys-label3)">
								Percobaan {q.attemptsUsed}/{q.maxAttempts}{q.tanggalSelesai ? ` · batas ${fmtTanggal(q.tanggalSelesai)}` : ''}{q.durasiMenit ? ` · ${q.durasiMenit} menit` : ''}
							</span>
						</span>
						<span class="text-[12px] font-bold px-3 py-1.5 rounded-lg text-white" style="background: var(--sys-tint)">Kerjakan</span>
					</a>
					{#if q.ringkasanPoin?.length}
						<button class="w-full text-left text-[12px] font-semibold px-3 py-1.5 rounded-lg border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)" onclick={() => bukaKartu(q.quizId)}>
							📇 Ringkasan 1 menit — baca dulu ({q.ringkasanPoin.length} poin) {kartuKuis === q.quizId ? '▴' : '▾'}
						</button>
						{#if kartuKuis === q.quizId}
							<div class="rounded-xl p-3 border" style="background: var(--sys-fill2); border-color: var(--sys-sep)">
								<p class="text-[11px] font-bold mb-1" style="color: var(--sys-label3)">Poin {kartuIdx + 1}/{q.ringkasanPoin.length}</p>
								<p class="text-[14px] font-semibold leading-relaxed min-h-[56px]" style="color: var(--sys-label)">{q.ringkasanPoin[kartuIdx]}</p>
								<div class="mt-2 flex gap-2">
									{#if kartuIdx < q.ringkasanPoin.length - 1}
										<button class="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white" style="background: var(--sys-tint)" onclick={() => (kartuIdx += 1)}>Berikutnya →</button>
									{:else}
										<a href={`/ess/pelatihan/${q.programId}`} class="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white" style="background: var(--sys-tint)">Mulai Kuis</a>
									{/if}
								</div>
							</div>
						{/if}
					{/if}
				{/each}
			</div>

			<div class="mt-3 flex flex-wrap items-center justify-center gap-2">
				<a href="/ess/absen" class="px-4 py-2 rounded-xl text-[12px] font-bold border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)">Absen Masuk / Pulang</a>
				<a href="/ess/izin-sakit" class="px-4 py-2 rounded-xl text-[12px] font-bold border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)">Izin / Sakit</a>
			</div>

			{#if status.canSnooze}
				<div class="mt-3 pt-3 border-t" style="border-color: var(--sys-sep)">
					{#if !snoozeOpen}
						<button class="w-full text-[12px] font-semibold underline" style="color: var(--sys-label-2)" onclick={() => (snoozeOpen = true)}>
							Sedang darurat di lapangan? Tunda {status.snoozeMinutes} menit (1× per periode)
						</button>
					{:else}
						<p class="text-[11px] mb-1.5" style="color: var(--sys-label-2)">Alasan darurat (tercatat & dilihat HRD):</p>
						<textarea
							bind:value={alasan}
							rows="2"
							class="w-full rounded-lg px-3 py-2 text-[13px] border"
							style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
							placeholder="Contoh: sedang menangani kebocoran di site, sinyal lemah"
						></textarea>
						{#if snoozeError}<p class="text-[11px] text-rose-500 mt-1">{snoozeError}</p>{/if}
						<div class="mt-2 flex gap-2">
							<button class="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white disabled:opacity-60" style="background: var(--sys-tint)" disabled={snoozing} onclick={doSnooze}>
								{snoozing ? 'Menyimpan…' : `Tunda ${status.snoozeMinutes} menit`}
							</button>
							<button class="px-3 py-1.5 rounded-lg text-[12px] font-semibold" style="color: var(--sys-label-2)" onclick={() => (snoozeOpen = false)}>Batal</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{:else}
	{#if status && status.mode !== 'shadow'}
		{#if status.showBanner || (status.blocking && escape)}
			<div class="px-4 pt-3">
				<a
					href={pending[0] ? `/ess/pelatihan/${pending[0].programId}` : '/ess/pelatihan'}
					class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 border"
					style="background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.45)"
				>
					<IconClipboardCheck size={20} class="shrink-0 text-amber-500" />
					<span class="flex-1 text-[12px] leading-snug" style="color: var(--sys-label)">
						<b>Kuis wajib periode ini belum dikerjakan{pending[0] ? `: ${pending[0].judul}` : ''}.</b>
						{#if status.snoozedUntil}Ditunda sampai {fmtTanggal(status.snoozedUntil)}.{:else}Kerjakan sekarang agar menu kerja tidak terkunci.{/if}
					</span>
					<span class="text-[11px] font-bold" style="color: var(--sys-tint)">Buka →</span>
				</a>
			</div>
		{/if}
		{#if upcoming.length > 0 && pending.length === 0}
			<div class="px-4 pt-3">
				{#each upcoming.slice(0, 2) as u (u.quizId)}
					<a
						href={`/ess/pelatihan/${u.programId}`}
						class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 border mb-1.5"
						style="background: var(--sys-fill2); border-color: var(--sys-sep)"
					>
						<IconCalendarEvent size={20} class="shrink-0" style="color: var(--sys-tint)" />
						<span class="flex-1 text-[12px] leading-snug" style="color: var(--sys-label)">
							<b>Persiapan kuis wajib:</b> {u.judul} dibuka {fmtTanggal(u.tanggalMulai)} ({u.hariLagi} hari lagi). Pelajari materinya sekarang.
						</span>
						<span class="text-[11px] font-bold" style="color: var(--sys-tint)">Pelajari →</span>
					</a>
				{/each}
			</div>
		{/if}
	{/if}
	{@render children?.()}
{/if}
