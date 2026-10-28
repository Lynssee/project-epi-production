<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Fitur Personal Karyawan v2, Fase 4 — Widget personal di home lapangan.
	// Komponen berdiri sendiri dengan onMount sendiri (bukan menumpang onMount besar
	// di (app)/+page.svelte yang sudah berat) — supaya widget ini TIDAK pernah menambah
	// waktu render jalur utama, sesuai instruksi "jangan tambah await blocking di jalur utama".
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getNotes, createNote, type PersonalNote } from '$lib/services/ess/notes';
	import { getCalendarEvents, type CalendarEvent } from '$lib/services/ess/calendar';
	import { getCutiStatus } from '$lib/services/ess/cuti';
	import { getLemburStatus } from '$lib/services/ess/lembur';
	import { getOnboardingStatus } from '$lib/services/ess/training';
	import { IconPin, IconCalendarEvent, IconLoader2, IconSend, IconNotes } from '@tabler/icons-svelte';

	let loading = $state(true);
	let pinnedNotes = $state<PersonalNote[]>([]);
	let upcoming = $state<CalendarEvent[]>([]);
	let sisaCuti = $state<number | null>(null);
	let lemburBulanIniJam = $state<number | null>(null);
	let trainingPending = $state<number | null>(null);

	let quickLogText = $state('');
	let quickLogSubmitting = $state(false);

	function pad(n: number) {
		return String(n).padStart(2, '0');
	}
	function toISODate(d: Date) {
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	async function load() {
		loading = true;
		try {
			const today = new Date();
			const in7 = new Date();
			in7.setDate(in7.getDate() + 7);
			const monthStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;

			const [notes, events, cutiStatus, lemburStatus, onboarding] = await Promise.all([
				getNotes({ status: 'active' }).catch(() => []),
				getCalendarEvents(toISODate(today), toISODate(in7)).catch(() => []),
				getCutiStatus().catch(() => null),
				getLemburStatus().catch(() => null),
				getOnboardingStatus().catch(() => null)
			]);

			pinnedNotes = notes.filter((n) => n.is_pinned).slice(0, 3);
			upcoming = events.slice(0, 5);
			sisaCuti = cutiStatus?.sisaCuti?.sisa ?? null;
			trainingPending = onboarding ? Math.max(0, onboarding.totalProgram - onboarding.totalSelesai) : null;

			if (lemburStatus) {
				lemburBulanIniJam = lemburStatus.riwayat
					.filter((r) => r.status === 'Disetujui' && r.tanggal >= monthStart)
					.reduce((sum, r) => sum + (r.durasi_jam || 0), 0);
			}
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function submitQuickLog() {
		const content = quickLogText.trim();
		if (!content) return;
		quickLogSubmitting = true;
		try {
			await createNote({ content, type: 'quick_log' });
			quickLogText = '';
		} catch {
			// gagal senyap di widget kecil ini — user tetap bisa pakai halaman Catatan penuh
		} finally {
			quickLogSubmitting = false;
		}
	}

	function formatShortDate(iso: string) {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
	}
</script>

{#if !loading && pinnedNotes.length === 0 && upcoming.length === 0 && sisaCuti == null}
	<!-- Belum ada data personal apapun — sembunyikan widget, jangan tampilkan kotak kosong -->
{:else}
	<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
		<div class="flex items-center justify-between mb-2">
			<p class="text-[12px] font-semibold" style="color: var(--sys-label)">📌 Ringkasan Saya</p>
			<div class="flex items-center gap-2">
				<button class="text-[10px] font-bold hover:underline" style="color: var(--sys-label3)" onclick={() => goto('/ess/notes')}>Catatan</button>
				<span class="text-[10px]" style="color: var(--sys-sep)">•</span>
				<button class="text-[10px] font-bold hover:underline" style="color: var(--p, var(--g))" onclick={() => goto('/ess')}>Portal Karyawan →</button>
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={42} strokeWidth={3} label="Memuat data pribadi..." />
		{:else}
			{#if sisaCuti != null || lemburBulanIniJam != null || trainingPending != null}
				<div class="grid grid-cols-3 gap-2 text-center mb-3">
					<div>
						<p class="text-[15px] font-bold" style="color: var(--sys-label)">{sisaCuti ?? '-'}</p>
						<p class="text-[10px]" style="color: var(--sys-label-2)">Sisa Cuti</p>
					</div>
					<div>
						<p class="text-[15px] font-bold" style="color: var(--sys-label)">{lemburBulanIniJam != null ? lemburBulanIniJam.toFixed(1) : '-'}</p>
						<p class="text-[10px]" style="color: var(--sys-label-2)">Jam Lembur/Bln</p>
					</div>
					<div>
						<p class="text-[15px] font-bold" style="color: var(--sys-label)">{trainingPending ?? '-'}</p>
						<p class="text-[10px]" style="color: var(--sys-label-2)">Training Pending</p>
					</div>
				</div>
			{/if}

			{#if pinnedNotes.length > 0}
				<div class="mb-3">
					{#each pinnedNotes as note (note.id)}
						<button class="w-full text-left flex items-start gap-1.5 py-1" onclick={() => goto('/ess/notes')}>
							<IconPin size={12} class="mt-0.5 shrink-0" style="color: var(--p, var(--g))" />
							<span class="text-[11px] truncate" style="color: var(--sys-label-2)">{note.title || note.content}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if upcoming.length > 0}
				<div class="mb-3">
					<p class="text-[10px] font-bold mb-1" style="color: var(--sys-label4)">7 HARI KE DEPAN</p>
					{#each upcoming as ev (ev.id)}
						<button class="w-full text-left flex items-center gap-1.5 py-1" onclick={() => goto('/ess/kalender')}>
							<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background: {ev.color}"></span>
							<span class="text-[11px] truncate flex-1" style="color: var(--sys-label-2)">{ev.title}</span>
							<span class="text-[10px] shrink-0" style="color: var(--sys-label4)">{formatShortDate(ev.start)}</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Quick Log inline (Fase 1) -->
			<div class="flex items-center gap-1.5">
				<IconNotes size={14} class="shrink-0" style="color: var(--sys-label4)" />
				<input
					type="text"
					placeholder="Tulis catatan cepat..."
					bind:value={quickLogText}
					onkeydown={(e) => e.key === 'Enter' && submitQuickLog()}
					class="flex-1 rounded-lg border text-[11px] px-2 py-1.5"
					style="border-color: var(--sys-sep)"
				/>
				<button
					class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40"
					style="background: var(--p, var(--g)); color: white"
					disabled={quickLogSubmitting || !quickLogText.trim()}
					onclick={submitQuickLog}
					aria-label="Kirim"
				>
					{#if quickLogSubmitting}
						<IconLoader2 size={12} class="animate-spin" />
					{:else}
						<IconSend size={12} />
					{/if}
				</button>
			</div>
		{/if}
	</div>
{/if}
