<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getBookmarks, createBookmark, deleteBookmark, reorderBookmarks, type PersonalBookmark } from '$lib/services/ess/bookmarks';
	import {
		IconLoader2,
		IconPlus,
		IconAlertTriangle,
		IconTrash,
		IconArrowUp,
		IconArrowDown,
		IconLink,
		IconCalendarEvent,
		IconWallet,
		IconReceipt2,
		IconHourglass,
		IconFileText,
		IconTrophy,
		IconSchool,
		IconUserCircle,
		IconNotes
	} from '@tabler/icons-svelte';

	const ICON_OPTIONS: { value: string; label: string; Icon: any }[] = [
		{ value: '', label: 'Default', Icon: IconLink },
		{ value: 'cuti', label: 'Kalender', Icon: IconCalendarEvent },
		{ value: 'wallet', label: 'Dompet', Icon: IconWallet },
		{ value: 'receipt', label: 'Kwitansi', Icon: IconReceipt2 },
		{ value: 'hourglass', label: 'Jam', Icon: IconHourglass },
		{ value: 'file', label: 'Dokumen', Icon: IconFileText },
		{ value: 'trophy', label: 'Trofi', Icon: IconTrophy },
		{ value: 'school', label: 'Sekolah', Icon: IconSchool },
		{ value: 'user', label: 'Profil', Icon: IconUserCircle },
		{ value: 'notes', label: 'Catatan', Icon: IconNotes }
	];

	function iconFor(icon: string | null) {
		return ICON_OPTIONS.find((o) => o.value === icon)?.Icon || IconLink;
	}

	let loading = $state(true);
	let errorMsg = $state('');
	let bookmarks = $state<PersonalBookmark[]>([]);

	let label = $state('');
	let url = $state('');
	let icon = $state('');
	let submitting = $state(false);
	let formError = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			bookmarks = await getBookmarks();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat bookmark.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function submitAdd() {
		formError = '';
		const l = label.trim();
		let u = url.trim();
		if (!l || !u) {
			formError = 'Label dan URL wajib diisi.';
			return;
		}
		if (!u.startsWith('/')) u = `/${u}`;
		submitting = true;
		try {
			const bookmark = await createBookmark({ label: l, url: u, icon: icon || null });
			bookmarks = [...bookmarks, bookmark];
			label = '';
			url = '';
			icon = '';
		} catch (err: any) {
			formError = err?.message || 'Gagal menambah bookmark.';
		} finally {
			submitting = false;
		}
	}

	async function handleDelete(b: PersonalBookmark) {
		if (!confirm(`Hapus pintasan "${b.label}"?`)) return;
		try {
			await deleteBookmark(b.id);
			bookmarks = bookmarks.filter((x) => x.id !== b.id);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menghapus bookmark.';
		}
	}

	async function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= bookmarks.length) return;
		const reordered = [...bookmarks];
		[reordered[index], reordered[target]] = [reordered[target], reordered[index]];
		bookmarks = reordered;
		try {
			await reorderBookmarks(reordered.map((b) => b.id));
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan urutan.';
			load();
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Pintasan Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Kelola halaman favorit untuk akses 1-tap dari home ESS</p>
	</div>

	<div class="glass-panel rounded-2xl p-4 md:p-5 mb-6">
		<div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
			<input type="text" placeholder="Label, mis. Cuti Saya" bind:value={label} class="rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" />
			<input type="text" placeholder="URL, mis. /ess/cuti" bind:value={url} class="rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" />
			<select bind:value={icon} class="rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)">
				{#each ICON_OPTIONS as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
		{#if formError}
			<p class="text-xs text-red-500 mb-2">{formError}</p>
		{/if}
		<button
			class="h-11 px-5 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 gradient-bg"
			disabled={submitting}
			onclick={submitAdd}
		>
			{#if submitting}
				<IconLoader2 size={18} class="animate-spin" />
			{:else}
				<IconPlus size={18} />
			{/if}
			Tambah Pintasan
		</button>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pintasan..." />
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
	{:else if bookmarks.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada pintasan. Tambahkan di atas.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each bookmarks as b, i (b.id)}
				{@const Icon = iconFor(b.icon)}
				<div class="glass-panel rounded-xl p-3 flex items-center gap-3">
					<Icon size={18} style="color: var(--sys-label3)" />
					<button class="flex-1 text-left" onclick={() => goto(b.url)}>
						<div class="text-sm font-bold" style="color: var(--sys-label)">{b.label}</div>
						<div class="text-xs" style="color: var(--sys-label4)">{b.url}</div>
					</button>
					<div class="flex items-center gap-1">
						<button aria-label="Naikkan" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5 disabled:opacity-30" disabled={i === 0} onclick={() => move(i, -1)}>
							<IconArrowUp size={14} />
						</button>
						<button aria-label="Turunkan" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5 disabled:opacity-30" disabled={i === bookmarks.length - 1} onclick={() => move(i, 1)}>
							<IconArrowDown size={14} />
						</button>
						<button aria-label="Hapus" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5" onclick={() => handleDelete(b)}>
							<IconTrash size={14} style="color: #DC2626" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
