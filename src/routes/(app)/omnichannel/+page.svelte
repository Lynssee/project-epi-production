<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		IconInbox, IconUsers, IconBrandWhatsapp, IconRobot,
		IconSearch, IconLoader2, IconPhoneCall, IconHash,
		IconChevronRight, IconWifi
	} from '@tabler/icons-svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import { fetchContacts, type OmnichannelContact } from '$lib/services/omnichannel';

	type Tab = 'inbox' | 'kontak' | 'channel' | 'ai_agent';

	let activeTab = $state<Tab>('kontak');
	let contacts = $state<OmnichannelContact[]>([]);
	let page = $state(1);
	let hasMore = $state(true);
	let loadingMore = $state(false);
	let initialLoading = $state(true);
	let total = $state(0);
	let search = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;

	const tabs: { id: Tab; label: string; icon: any }[] = [
		{ id: 'inbox',    label: 'Inbox',    icon: IconInbox },
		{ id: 'kontak',   label: 'Kontak',   icon: IconUsers },
		{ id: 'channel',  label: 'Channel',  icon: IconWifi },
		{ id: 'ai_agent', label: 'AI Agent', icon: IconRobot },
	];

	async function loadContacts(reset = false) {
		if (reset) {
			contacts = [];
			page = 1;
			hasMore = true;
			initialLoading = true;
		}
		if (loadingMore || (!hasMore && !reset)) return;

		loadingMore = true;
		try {
			const result = await fetchContacts(page, search);
			contacts = reset ? result.contacts : [...contacts, ...result.contacts];
			hasMore = result.hasMore;
			total = result.total;
			page += 1;
		} catch (e) {
			console.error('Gagal memuat kontak:', e);
		} finally {
			loadingMore = false;
			initialLoading = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => loadContacts(true), 350);
	}

	function getChannelColor(channel: string) {
		switch (channel) {
			case 'WhatsApp':  return 'text-emerald-600 bg-emerald-50';
			case 'Instagram': return 'text-pink-600 bg-pink-50';
			case 'Messenger': return 'text-blue-600 bg-blue-50';
			case 'Webchat':   return 'text-sky-600 bg-sky-50';
			default:          return 'text-gray-500 bg-gray-100';
		}
	}

	function getChannelDot(channel: string) {
		switch (channel) {
			case 'WhatsApp':  return 'bg-emerald-500';
			case 'Instagram': return 'bg-pink-500';
			case 'Messenger': return 'bg-blue-500';
			case 'Webchat':   return 'bg-sky-500';
			default:          return 'bg-gray-400';
		}
	}

	onMount(() => loadContacts(true));
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden">
	<!-- Header -->
	<div class="px-5 py-4 shrink-0" style="background: linear-gradient(135deg, #0f766e 0%, #134e4a 100%);">
		<p class="text-[10px] font-semibold tracking-widest uppercase text-teal-300 mb-0.5">OMNICHANNEL CUSTOMER ENGAGEMENT</p>
		<h1 class="text-[18px] font-bold text-white leading-tight">Omnichannel — PT. Eltama Prima Indo</h1>
		<p class="text-[12px] text-teal-200 mt-1 leading-relaxed">
			Satu inbox untuk WhatsApp, Instagram, Messenger &amp; Webchat. Balas pelanggan, kelola channel, dan atur AI auto-reply.
		</p>
	</div>

	<!-- Tabs -->
	<div class="flex border-b bg-white shrink-0" style="border-color: var(--sys-sep)">
		{#each tabs as tab}
			<button
				class="flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium transition-colors border-b-2 {activeTab === tab.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-400 hover:text-gray-600'}"
				onclick={() => activeTab = tab.id}
			>
				<tab.icon size={15} />
				<span class="hidden sm:inline">{tab.label}</span>
			</button>
		{/each}
	</div>

	<!-- Tab Content -->
	{#if activeTab === 'kontak'}
		<div class="flex-1 flex flex-col overflow-hidden">
			<!-- Search + count -->
			<div class="px-4 py-3 bg-white border-b shrink-0" style="border-color: var(--sys-sep)">
				<div class="relative">
					<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
					<input
						type="text"
						bind:value={search}
						oninput={onSearchInput}
						placeholder="Cari nama atau nomor..."
						class="f-input !pl-9 !py-2 !text-[13px] !bg-gray-50 w-full"
					/>
				</div>
				{#if !initialLoading}
					<p class="text-[11px] text-gray-400 mt-1.5">{total} kontak ditemukan</p>
				{/if}
			</div>

			<!-- Table header -->
			<div class="grid grid-cols-[1fr_110px_130px_130px_110px] gap-2 px-4 py-2 bg-gray-50 border-b shrink-0 text-[10px] font-semibold text-gray-400 uppercase tracking-widest" style="border-color: var(--sys-sep)">
				<span>Nama</span>
				<span>Channel</span>
				<span>Nomor</span>
				<span>Aksi CRM</span>
				<span>Identifier</span>
			</div>

			<!-- Contact list with infinite scroll -->
			<div class="flex-1 overflow-y-auto">
				{#if initialLoading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat kontak omnichannel..." />
		</div>
				{:else if contacts.length === 0}
					<div class="py-16 text-center text-gray-400 text-[13px]">
						<IconUsers size={36} class="mx-auto mb-2 text-gray-200" />
						Tidak ada kontak ditemukan.
					</div>
				{:else}
					{#each contacts as contact (contact.id)}
						<div class="grid grid-cols-[1fr_110px_130px_130px_110px] gap-2 px-4 py-2.5 border-b hover:bg-gray-50 transition-colors items-center" style="border-color: var(--sys-sep)">
							<!-- Name -->
							<div class="min-w-0">
								<span class="text-[13px] text-gray-800 font-medium truncate block">{contact.name}</span>
								{#if contact.last_message_preview}
									<span class="text-[11px] text-gray-400 truncate block italic">"{contact.last_message_preview}"</span>
								{/if}
							</div>

							<!-- Channel badge -->
							<div class="flex items-center gap-1.5">
								<span class="w-2 h-2 rounded-full shrink-0 {getChannelDot(contact.channel)}"></span>
								<span class="text-[12px] font-medium {getChannelColor(contact.channel)} px-2 py-0.5 rounded-full truncate">{contact.channel}</span>
							</div>

							<!-- Phone -->
							<span class="text-[12px] text-gray-500 font-mono truncate">{contact.phone || '—'}</span>

							<!-- CRM Pipeline Action -->
							<div>
								{#if contact.prospect_id}
									<a
										href={`/sales/prospek/${contact.prospect_id}`}
										class="inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-lg border border-teal-200 transition-colors"
									>
										<span>Lihat Lead</span>
										<IconChevronRight size={12} />
									</a>
								{:else}
									<a
										href={`/sales/prospek/baru?omni_contact_id=${contact.id}&name=${encodeURIComponent(contact.name)}&phone=${encodeURIComponent(contact.phone)}&channel=${encodeURIComponent(contact.channel)}`}
										class="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-teal-600 hover:bg-teal-700 px-2.5 py-1 rounded-lg shadow-xs transition-transform active:scale-95"
									>
										<span>+ Lead CRM</span>
									</a>
								{/if}
							</div>

							<!-- Identifier -->
							<span class="text-[11px] text-gray-400 font-mono truncate">{contact.identifier}</span>
						</div>
					{/each}

					<!-- Infinite scroll trigger -->
					<InfiniteScroll
						{hasMore}
						loading={loadingMore}
						rootMargin="300px"
						onloadmore={() => loadContacts()}
					/>

					{#if !hasMore && contacts.length > 0}
						<p class="text-center text-[11px] text-gray-300 py-4">Semua {total} kontak sudah dimuat.</p>
					{/if}
				{/if}
			</div>
		</div>

	{:else if activeTab === 'inbox'}
		<div class="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 py-16">
			<IconInbox size={40} class="text-gray-200" />
			<p class="text-[14px] font-medium text-gray-500">Inbox</p>
			<p class="text-[12px]">Semua percakapan masuk dari berbagai channel.</p>
		</div>

	{:else if activeTab === 'channel'}
		<div class="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 py-16">
			<IconWifi size={40} class="text-gray-200" />
			<p class="text-[14px] font-medium text-gray-500">Channel</p>
			<p class="text-[12px]">Kelola koneksi WhatsApp, Instagram, Messenger & Webchat.</p>
		</div>

	{:else if activeTab === 'ai_agent'}
		<div class="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 py-16">
			<IconRobot size={40} class="text-gray-200" />
			<p class="text-[14px] font-medium text-gray-500">AI Agent</p>
			<p class="text-[12px]">Atur auto-reply cerdas dengan AI.</p>
		</div>
	{/if}
</div>
