<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getCalendarEvents, createCalendarEvent, deleteCalendarEvent, type CalendarEvent } from '$lib/services/ess/calendar';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconChevronLeft,
		IconChevronRight,
		IconPlus,
		IconTrash,
		IconCalendarEvent
	} from '@tabler/icons-svelte';

	const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
	const MONTH_LABELS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

	function pad(n: number) {
		return String(n).padStart(2, '0');
	}
	function toISODate(d: Date) {
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}
	function todayISO() {
		return toISODate(new Date());
	}

	let now = new Date();
	let viewYear = $state(now.getFullYear());
	let viewMonth = $state(now.getMonth()); // 0-based
	let selectedDate = $state(todayISO());

	let loading = $state(true);
	let errorMsg = $state('');
	let events = $state<CalendarEvent[]>([]);

	// grid: array of { date: Date|null, iso: string|null } — null utk sel kosong sebelum tgl 1
	let grid = $derived.by(() => {
		const first = new Date(viewYear, viewMonth, 1);
		const firstWeekday = (first.getDay() + 6) % 7; // 0=Senin
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const cells: { iso: string | null; day: number | null }[] = [];
		for (let i = 0; i < firstWeekday; i++) cells.push({ iso: null, day: null });
		for (let d = 1; d <= daysInMonth; d++) {
			cells.push({ iso: `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`, day: d });
		}
		while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
		return cells;
	});

	let eventsByDate = $derived.by(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const ev of events) {
			const key = ev.start.slice(0, 10);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(ev);
			if (ev.end) {
				const start = new Date(ev.start.slice(0, 10));
				const end = new Date(ev.end.slice(0, 10));
				for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
					const iso = toISODate(d);
					if (iso === key) continue;
					if (!map.has(iso)) map.set(iso, []);
					map.get(iso)!.push(ev);
				}
			}
		}
		return map;
	});

	let selectedEvents = $derived(eventsByDate.get(selectedDate) || []);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const from = `${viewYear}-${pad(viewMonth + 1)}-01`;
			const to = `${viewYear}-${pad(viewMonth + 1)}-${pad(new Date(viewYear, viewMonth + 1, 0).getDate())}`;
			events = await getCalendarEvents(from, to);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat kalender.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function prevMonth() {
		viewMonth -= 1;
		if (viewMonth < 0) {
			viewMonth = 11;
			viewYear -= 1;
		}
		load();
	}
	function nextMonth() {
		viewMonth += 1;
		if (viewMonth > 11) {
			viewMonth = 0;
			viewYear += 1;
		}
		load();
	}

	// Add custom event
	let showAddForm = $state(false);
	let newTitle = $state('');
	let newDate = $state('');
	let newAllDay = $state(true);
	let newRecurrence = $state<'' | 'daily' | 'weekly' | 'monthly'>('');
	let newRecurrenceUntil = $state('');
	let submitting = $state(false);
	let formError = $state('');

	const RECURRENCE_OPTIONS: Array<{ value: '' | 'daily' | 'weekly' | 'monthly'; label: string }> = [
		{ value: '', label: 'Tidak berulang' },
		{ value: 'daily', label: 'Setiap hari' },
		{ value: 'weekly', label: 'Setiap minggu' },
		{ value: 'monthly', label: 'Setiap bulan' }
	];

	function openAddForm() {
		newTitle = '';
		newDate = selectedDate;
		newAllDay = true;
		newRecurrence = '';
		newRecurrenceUntil = '';
		formError = '';
		showAddForm = true;
	}

	async function submitAdd() {
		formError = '';
		const title = newTitle.trim();
		if (!title || !newDate) {
			formError = 'Judul dan tanggal wajib diisi.';
			return;
		}
		if (newRecurrence && !newRecurrenceUntil) {
			formError = 'Tanggal "Sampai" wajib diisi untuk event berulang.';
			return;
		}
		submitting = true;
		try {
			await createCalendarEvent({
				title,
				start_date: newDate,
				all_day: newAllDay,
				recurrence_rule: newRecurrence || null,
				recurrence_until: newRecurrence ? newRecurrenceUntil : null
			});
			showAddForm = false;
			await load();
		} catch (err: any) {
			formError = err?.message || 'Gagal menambah event.';
		} finally {
			submitting = false;
		}
	}

	async function handleDelete(ev: CalendarEvent) {
		if (ev.source !== 'event' || ev.eventId == null) return;
		const pesan = ev.recurring
			? `Hapus "${ev.title}"? Ini event berulang — SELURUH rangkaiannya akan terhapus, bukan cuma tanggal ini.`
			: `Hapus "${ev.title}"?`;
		if (!confirm(pesan)) return;
		try {
			await deleteCalendarEvent(ev.eventId);
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menghapus event.';
		}
	}

	function sourceLabel(source: CalendarEvent['source']) {
		const map: Record<string, string> = { cuti: 'Cuti', lembur: 'Lembur', shift: 'Shift', training: 'Training', reminder: 'Pengingat', event: 'Event' };
		return map[source] || source;
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Kalender Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Cuti, lembur, shift, tenggat training, pengingat & event pribadi</p>
	</div>

	<div class="glass-panel rounded-2xl p-4 mb-4">
		<div class="flex items-center justify-between mb-3">
			<button class="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5" onclick={prevMonth} aria-label="Bulan sebelumnya">
				<IconChevronLeft size={18} />
			</button>
			<h2 class="text-sm font-bold" style="color: var(--sys-label)">{MONTH_LABELS[viewMonth]} {viewYear}</h2>
			<button class="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5" onclick={nextMonth} aria-label="Bulan berikutnya">
				<IconChevronRight size={18} />
			</button>
		</div>

		{#if loading}
			<CircularProgressGauge size={50} strokeWidth={4} label="Memuat kalender..." />
		{:else if errorMsg}
			<div class="text-center py-6">
				<IconAlertTriangle size={24} style="color: #DC2626" class="mx-auto mb-2" />
				<p class="text-xs text-red-500 mb-3">{errorMsg}</p>
				<button class="px-4 py-1.5 rounded-lg text-xs font-bold text-white gradient-bg" onclick={load}>Coba Lagi</button>
			</div>
		{:else}
			<div class="grid grid-cols-7 gap-1 mb-1">
				{#each DAY_LABELS as label}
					<div class="text-center text-[10px] font-bold py-1" style="color: var(--sys-label4)">{label}</div>
				{/each}
			</div>
			<div class="grid grid-cols-7 gap-1">
				{#each grid as cell}
					{#if cell.iso}
						{@const dayEvents = eventsByDate.get(cell.iso) || []}
						<button
							class="aspect-square rounded-lg flex flex-col items-center justify-center relative text-xs font-bold transition-colors"
							style={cell.iso === selectedDate
								? 'background: var(--p, var(--g)); color: white'
								: cell.iso === todayISO()
									? 'background: var(--sys-fill4); color: var(--sys-label)'
									: 'color: var(--sys-label)'}
							onclick={() => (selectedDate = cell.iso as string)}
						>
							{cell.day}
							{#if dayEvents.length > 0}
								<div class="flex gap-0.5 mt-0.5">
									{#each dayEvents.slice(0, 3) as ev}
										<span class="w-1.5 h-1.5 rounded-full" style="background: {cell.iso === selectedDate ? 'white' : ev.color}"></span>
									{/each}
								</div>
							{/if}
						</button>
					{:else}
						<div></div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>

	<div class="flex items-center justify-between mb-3">
		<h3 class="text-sm font-bold" style="color: var(--sys-label)">
			{new Date(selectedDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
		</h3>
		<button class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white gradient-bg" onclick={openAddForm}>
			<IconPlus size={14} />
			Event
		</button>
	</div>

	{#if showAddForm}
		<div class="glass-panel rounded-2xl p-4 mb-4">
			<input type="text" placeholder="Judul event" bind:value={newTitle} class="w-full rounded-lg border text-[13px] p-3 mb-2" style="border-color: var(--sys-sep)" />
			<input type="date" bind:value={newDate} class="w-full rounded-lg border text-[13px] p-3 mb-2" style="border-color: var(--sys-sep)" />
			<label class="flex items-center gap-2 text-xs font-medium mb-2" style="color: var(--sys-label3)">
				<input type="checkbox" bind:checked={newAllDay} />
				Sepanjang hari
			</label>
			<select bind:value={newRecurrence} class="w-full rounded-lg border text-[13px] p-3 mb-2" style="border-color: var(--sys-sep)">
				{#each RECURRENCE_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
			</select>
			{#if newRecurrence}
				<input type="date" bind:value={newRecurrenceUntil} min={newDate} class="w-full rounded-lg border text-[13px] p-3 mb-2" style="border-color: var(--sys-sep)" />
				<p class="text-[11px] mb-2" style="color: var(--sys-label4)">Hapus event berulang akan menghapus seluruh rangkaiannya, bukan per-tanggal.</p>
			{/if}
			{#if formError}
				<p class="text-xs text-red-500 mb-2">{formError}</p>
			{/if}
			<div class="flex gap-2">
				<button class="flex-1 h-10 rounded-xl text-[13px] font-bold text-white gradient-bg disabled:opacity-40" disabled={submitting} onclick={submitAdd}>
					{submitting ? 'Menyimpan...' : 'Simpan'}
				</button>
				<button class="px-4 h-10 rounded-xl text-[13px] font-bold border" style="border-color: var(--sys-sep); color: var(--sys-label3)" onclick={() => (showAddForm = false)}>
					Batal
				</button>
			</div>
		</div>
	{/if}

	{#if selectedEvents.length === 0}
		<div class="glass-panel rounded-2xl p-8 text-center">
			<IconCalendarEvent size={28} style="color: var(--sys-label4)" class="mx-auto mb-2" />
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Tidak ada jadwal di tanggal ini.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each selectedEvents as ev (ev.id)}
				<div class="glass-panel rounded-xl p-3 flex items-center gap-3">
					<span class="w-2 h-2 rounded-full shrink-0" style="background: {ev.color}"></span>
					<div class="flex-1">
						<div class="text-sm font-bold" style="color: var(--sys-label)">{ev.title}{ev.recurring ? ' 🔁' : ''}</div>
						<div class="text-[11px]" style="color: var(--sys-label4)">{sourceLabel(ev.source)}</div>
					</div>
					{#if ev.source === 'event'}
						<button aria-label="Hapus" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5" onclick={() => handleDelete(ev)}>
							<IconTrash size={14} style="color: #DC2626" />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
