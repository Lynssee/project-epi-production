<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getNotes, createNote, updateNote, deleteNote, togglePin, type PersonalNote } from '$lib/services/ess/notes';
	import {
		IconLoader2,
		IconPlus,
		IconAlertTriangle,
		IconPinned,
		IconPin,
		IconArchive,
		IconTrash,
		IconMicrophone,
		IconMicrophoneOff,
		IconNotes,
		IconBolt,
		IconBellRinging
	} from '@tabler/icons-svelte';

	type NoteType = 'note' | 'quick_log' | 'reminder';

	let loading = $state(true);
	let errorMsg = $state('');
	let notes = $state<PersonalNote[]>([]);
	let filterType = $state<NoteType | 'all'>('all');

	// Quick add form
	let quickContent = $state('');
	let quickTitle = $state('');
	let quickType = $state<NoteType>('quick_log');
	let quickReminderDate = $state('');
	let submitting = $state(false);
	let formError = $state('');

	// Voice-to-text (Web Speech API — id-ID, hanya isi kotak ketik, sembunyikan tombol kalau API tidak ada)
	let voiceSupported = $state(false);
	let listening = $state(false);
	let voiceError = $state('');
	let recognition: any = null;

	function initVoice() {
		if (typeof window === 'undefined') return;
		const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognitionCtor) return;
		voiceSupported = true;
		recognition = new SpeechRecognitionCtor();
		recognition.lang = 'id-ID';
		recognition.interimResults = false;
		recognition.maxAlternatives = 1;
		recognition.onresult = (e: any) => {
			const transcript = e.results?.[0]?.[0]?.transcript || '';
			if (transcript) quickContent = quickContent ? `${quickContent} ${transcript}` : transcript;
		};
		recognition.onerror = (e: any) => {
			listening = false;
			voiceError = e?.error === 'not-allowed' ? 'Izin mikrofon ditolak.' : 'Gagal mengenali suara — coba lagi.';
		};
		recognition.onend = () => {
			listening = false;
		};
	}

	function toggleVoice() {
		if (!recognition) return;
		voiceError = '';
		if (listening) {
			recognition.stop();
			listening = false;
			return;
		}
		try {
			recognition.start();
			listening = true;
		} catch {
			// start() melempar kalau dipanggil dua kali beruntun — abaikan.
		}
	}

	let filteredNotes = $derived(filterType === 'all' ? notes : notes.filter((n) => n.type === filterType));

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			notes = await getNotes({ status: 'active' });
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat catatan.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		initVoice();
		load();
	});

	async function submitQuick() {
		formError = '';
		const content = quickContent.trim();
		if (!content) {
			formError = 'Isi catatan wajib diisi.';
			return;
		}
		if (quickType === 'reminder' && !quickReminderDate) {
			formError = 'Tanggal pengingat wajib diisi untuk Reminder.';
			return;
		}
		submitting = true;
		try {
			const note = await createNote({
				title: quickTitle.trim() || null,
				content,
				type: quickType,
				reminder_date: quickType === 'reminder' ? new Date(quickReminderDate).toISOString() : null
			});
			notes = [note, ...notes];
			quickContent = '';
			quickTitle = '';
			quickReminderDate = '';
		} catch (err: any) {
			formError = err?.message || 'Gagal menyimpan catatan.';
		} finally {
			submitting = false;
		}
	}

	async function handleTogglePin(note: PersonalNote) {
		try {
			const updated = await togglePin(note);
			notes = notes.map((n) => (n.id === updated.id ? updated : n)).sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengubah pin.';
		}
	}

	async function handleArchive(note: PersonalNote) {
		try {
			await updateNote(note.id, { status: 'archived' });
			notes = notes.filter((n) => n.id !== note.id);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengarsip catatan.';
		}
	}

	async function handleDelete(note: PersonalNote) {
		if (!confirm('Hapus catatan ini? Tindakan tidak bisa dibatalkan.')) return;
		try {
			await deleteNote(note.id);
			notes = notes.filter((n) => n.id !== note.id);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menghapus catatan.';
		}
	}

	function formatDateTime(dateStr: string) {
		if (!dateStr) return '-';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return dateStr;
		return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function typeLabel(type: NoteType) {
		if (type === 'quick_log') return 'Quick Log';
		if (type === 'reminder') return 'Pengingat';
		return 'Catatan';
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Catatan Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Catatan pribadi, quick log, & pengingat — hanya bisa dilihat Anda</p>
	</div>

	<!-- Quick add -->
	<div class="glass-panel rounded-2xl p-4 md:p-5 mb-6">
		<div class="flex items-center gap-2 mb-3">
			<div class="flex rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
				<button
					class="px-3 py-1.5 text-xs font-bold transition-colors"
					style={quickType === 'quick_log' ? 'background: var(--p, var(--g)); color: white' : 'color: var(--sys-label3)'}
					onclick={() => (quickType = 'quick_log')}
				>
					<span class="inline-flex items-center gap-1"><IconBolt size={14} />Quick Log</span>
				</button>
				<button
					class="px-3 py-1.5 text-xs font-bold transition-colors"
					style={quickType === 'note' ? 'background: var(--p, var(--g)); color: white' : 'color: var(--sys-label3)'}
					onclick={() => (quickType = 'note')}
				>
					<span class="inline-flex items-center gap-1"><IconNotes size={14} />Catatan</span>
				</button>
				<button
					class="px-3 py-1.5 text-xs font-bold transition-colors"
					style={quickType === 'reminder' ? 'background: var(--p, var(--g)); color: white' : 'color: var(--sys-label3)'}
					onclick={() => (quickType = 'reminder')}
				>
					<span class="inline-flex items-center gap-1"><IconBellRinging size={14} />Pengingat</span>
				</button>
			</div>
		</div>

		{#if quickType !== 'quick_log'}
			<input
				type="text"
				placeholder="Judul (opsional)"
				bind:value={quickTitle}
				class="w-full rounded-lg border text-[13px] p-3 mb-2"
				style="border-color: var(--sys-sep)"
			/>
		{/if}

		{#if quickType === 'reminder'}
			<input
				type="datetime-local"
				bind:value={quickReminderDate}
				class="w-full rounded-lg border text-[13px] p-3 mb-2"
				style="border-color: var(--sys-sep)"
			/>
		{/if}

		<div class="relative">
			<textarea
				placeholder={quickType === 'quick_log' ? 'Tulis atau ucapkan catatan cepat...' : 'Isi catatan...'}
				bind:value={quickContent}
				rows="3"
				class="w-full rounded-lg border text-[13px] p-3 pr-12"
				style="border-color: var(--sys-sep)"
			></textarea>
			{#if voiceSupported}
				<button
					type="button"
					class="absolute right-2 top-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
					style={listening ? 'background: #DC2626; color: white' : 'background: var(--sys-fill4); color: var(--sys-label3)'}
					onclick={toggleVoice}
					aria-label="Dikte suara"
				>
					{#if listening}
						<IconMicrophoneOff size={16} />
					{:else}
						<IconMicrophone size={16} />
					{/if}
				</button>
			{/if}
		</div>
		{#if voiceError}
			<p class="text-xs text-red-500 mt-1">{voiceError}</p>
		{/if}
		{#if formError}
			<p class="text-xs text-red-500 mt-2">{formError}</p>
		{/if}

		<button
			class="w-full h-11 mt-3 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 gradient-bg"
			disabled={submitting}
			onclick={submitQuick}
		>
			{#if submitting}
				<IconLoader2 size={18} class="animate-spin" />
			{:else}
				<IconPlus size={18} />
			{/if}
			Simpan
		</button>
	</div>

	<!-- Filter -->
	<div class="flex gap-2 mb-4 overflow-x-auto">
		{#each [['all', 'Semua'], ['quick_log', 'Quick Log'], ['note', 'Catatan'], ['reminder', 'Pengingat']] as [value, label]}
			<button
				class="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors"
				style={filterType === value
					? 'background: var(--p, var(--g)); color: white; border-color: var(--p, var(--g))'
					: 'color: var(--sys-label3); border-color: var(--sys-sep)'}
				onclick={() => (filterType = value as NoteType | 'all')}
			>
				{label}
			</button>
		{/each}
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat catatan..." />
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if filteredNotes.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada catatan.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#each filteredNotes as note (note.id)}
				<div class="hover-lift glass-panel rounded-2xl p-4 relative overflow-hidden flex flex-col">
					<div class="flex items-start justify-between mb-2 relative z-10 gap-2">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-[11px] font-bold px-2 py-0.5 rounded-full border" style="background: var(--sys-fill4); color: var(--sys-label3); border-color: var(--sys-sep)">
								{typeLabel(note.type)}
							</span>
							{#if note.type === 'reminder' && note.reminder_date}
								<span class="text-[11px] font-medium" style="color: var(--sys-label3)">{formatDateTime(note.reminder_date)}</span>
							{/if}
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button aria-label="Pin" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5" onclick={() => handleTogglePin(note)}>
								{#if note.is_pinned}
									<IconPinned size={16} style="color: var(--p, var(--g))" />
								{:else}
									<IconPin size={16} style="color: var(--sys-label4)" />
								{/if}
							</button>
							<button aria-label="Arsip" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5" onclick={() => handleArchive(note)}>
								<IconArchive size={16} style="color: var(--sys-label4)" />
							</button>
							<button aria-label="Hapus" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5" onclick={() => handleDelete(note)}>
								<IconTrash size={16} style="color: #DC2626" />
							</button>
						</div>
					</div>
					{#if note.title}
						<h3 class="text-sm font-bold mb-1 relative z-10" style="color: var(--sys-label)">{note.title}</h3>
					{/if}
					<p class="text-sm whitespace-pre-wrap relative z-10" style="color: var(--sys-label)">{note.content}</p>
					<p class="text-[11px] mt-3 relative z-10" style="color: var(--sys-label4)">{formatDateTime(note.date_created)}</p>
				</div>
			{/each}
		</div>
	{/if}
</div>
