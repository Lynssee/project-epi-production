<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getBookmarks, type PersonalBookmark } from '$lib/services/ess/bookmarks';
	import {
		IconLink,
		IconPlus,
		IconCalendarEvent,
		IconWallet,
		IconReceipt2,
		IconHourglass,
		IconFileText,
		IconTrophy,
		IconSchool,
		IconUserCircle,
		IconNotes,
		IconBookmark
	} from '@tabler/icons-svelte';

	// Bar pintasan kecil (bukan sidebar baru) — reuse nav utama, hanya akses cepat ke halaman yang di-pin.
	const ICON_MAP: Record<string, any> = {
		cuti: IconCalendarEvent,
		wallet: IconWallet,
		receipt: IconReceipt2,
		hourglass: IconHourglass,
		file: IconFileText,
		trophy: IconTrophy,
		school: IconSchool,
		user: IconUserCircle,
		notes: IconNotes
	};

	function iconFor(icon: string | null) {
		if (!icon) return IconLink;
		return ICON_MAP[icon] || IconLink;
	}

	let bookmarks = $state<PersonalBookmark[]>([]);
	let loading = $state(true);

	onMount(load);

	async function load() {
		loading = true;
		try {
			bookmarks = await getBookmarks();
		} catch {
			bookmarks = [];
		} finally {
			loading = false;
		}
	}
</script>

{#if !loading && bookmarks.length === 0}
	<div class="mb-4">
		<a
			href="/ess/bookmarks"
			class="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold w-fit transition-colors hover:border-blue-400 no-underline"
			style="border-color: var(--sys-sep); color: var(--sys-label3)"
		>
			<IconBookmark size={14} />
			Tambah pintasan favorit
		</a>
	</div>
{:else if bookmarks.length > 0}
	<div class="flex items-center gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar">
		{#each bookmarks as b (b.id)}
			{@const Icon = iconFor(b.icon)}
			<a
				href={b.url || '/ess'}
				class="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold whitespace-nowrap hover-lift transition-all no-underline"
				style="background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label)"
			>
				<Icon size={14} />
				{b.label}
			</a>
		{/each}
		<a
			href="/ess/bookmarks"
			class="flex items-center justify-center w-8 h-8 rounded-xl border shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors no-underline"
			style="background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label4)"
			aria-label="Kelola pintasan"
			title="Kelola pintasan"
		>
			<IconPlus size={14} />
		</a>
	</div>
{/if}
