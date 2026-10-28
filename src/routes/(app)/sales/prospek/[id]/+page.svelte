<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getProspectById,
		updateProspectStage,
		updateProspect,
		getFollowUpsForProspect,
		createFollowUp,
		getFieldSalesOptions,
		resolveSalesDisplayName,
		PROSPECT_STAGES,
		type ProspectRow,
		type ProspectStage,
		type FollowUpRow,
		type FollowUpType,
		type SalesOption
	} from '$lib/services/sales';
	import {
		getProspectOmniChat,
		type OmnichannelContact,
		type OmnichannelMessage
	} from '$lib/services/omnichannel';
	import {
		IconArrowLeft,
		IconLoader2,
		IconPhone,
		IconMail,
		IconPlus,
		IconBrandWhatsapp,
		IconBuildingStore,
		IconClipboardCheck,
		IconFileDollar,
		IconCheck,
		IconCalendar,
		IconUser,
		IconMessageDots,
		IconUsers,
		IconMapPin,
		IconSparkles,
		IconMessageCircle,
		IconBrandInstagram,
		IconWorld,
		IconBrandMessenger,
		IconEdit,
		IconFlask,
		IconX
	} from '@tabler/icons-svelte';

	let prospectId = $derived(Number($page.params.id));

	let loading = $state(true);
	let prospect = $state<ProspectRow | null>(null);
	let followUps = $state<FollowUpRow[]>([]);
	let updatingStage = $state(false);
	let salesRepOptions = $state<SalesOption[]>([]);

	// Omnichannel chat state
	let omniContact = $state<OmnichannelContact | null>(null);
	let omniMessages = $state<OmnichannelMessage[]>([]);
	let loadingOmni = $state(false);

	let showForm = $state(false);
	let fuType = $state<FollowUpType>('call');
	let fuNotes = $state('');
	let fuResult = $state('');
	let fuNextDate = $state('');
	let saving = $state(false);
	let errorMsg = $state('');

	// Edit Lead Modal state
	let showEditModal = $state(false);
	let editName = $state('');
	let editCompany = $state('');
	let editPhone = $state('');
	let editEmail = $state('');
	let editAssignedName = $state('');
	let editPriority = $state<'low' | 'medium' | 'high'>('medium');
	let editQuotedAmount = $state<number | null>(null);
	let editExpectedClose = $state('');
	let editNotes = $state('');
	let editSaving = $state(false);
	let editError = $state('');

	const ACTIVITY_TYPES: { value: FollowUpType; label: string; icon: any; color: string }[] = [
		{ value: 'call', label: 'Telepon', icon: IconPhone, color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
		{ value: 'whatsapp', label: 'WhatsApp', icon: IconBrandWhatsapp, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
		{ value: 'meeting', label: 'Meeting', icon: IconUsers, color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
		{ value: 'visit', label: 'Kunjungan', icon: IconMapPin, color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
		{ value: 'email', label: 'Email', icon: IconMail, color: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
		{ value: 'other', label: 'Lainnya', icon: IconMessageDots, color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' }
	];

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	async function loadAll() {
		try {
			const [pData, fList, salesList] = await Promise.all([
				getProspectById(prospectId),
				getFollowUpsForProspect(prospectId),
				getFieldSalesOptions()
			]);
			prospect = pData;
			followUps = fList;
			salesRepOptions = salesList;
			if (prospect) {
				loadOmniContext(prospect);
			}
		} catch (e) {
			console.error('[sales/prospek/[id]] Gagal memuat data:', e);
		} finally {
			loading = false;
		}
	}

	async function loadOmniContext(p: ProspectRow) {
		loadingOmni = true;
		try {
			const res = await getProspectOmniChat({
				prospectId: p.id,
				phone: p.phone,
				contactId: p.omni_contact_id
			});
			omniContact = res.contact;
			omniMessages = res.messages;
		} catch (e) {
			console.warn('Gagal memuat konteks omnichannel:', e);
		} finally {
			loadingOmni = false;
		}
	}

	onMount(loadAll);

	function openEditModal() {
		if (!prospect) return;
		editName = prospect.name || '';
		editCompany = prospect.company || '';
		editPhone = prospect.phone || '';
		editEmail = prospect.email || '';
		editAssignedName = prospect.display_assigned_name || resolveSalesDisplayName(prospect.assigned_name);
		editPriority = prospect.priority || 'medium';
		editQuotedAmount = prospect.quoted_amount;
		editExpectedClose = prospect.expected_close ? prospect.expected_close.split('T')[0] : '';
		editNotes = prospect.notes || '';
		editError = '';
		showEditModal = true;
	}

	async function handleSaveEdit() {
		if (!prospect || editSaving) return;
		if (!editName.trim() && !editCompany.trim()) {
			editError = 'Isi minimal Nama kontak atau Perusahaan.';
			return;
		}
		editSaving = true;
		editError = '';
		try {
			const cleanPic = resolveSalesDisplayName(editAssignedName.trim());
			await updateProspect(prospect.id, {
				name: editName.trim(),
				company: editCompany.trim() || editName.trim(),
				phone: editPhone.trim(),
				email: editEmail.trim(),
				assigned_name: cleanPic,
				priority: editPriority,
				quoted_amount: editQuotedAmount ? Number(editQuotedAmount) : null,
				expected_close: editExpectedClose || null,
				notes: editNotes.trim() || null
			});
			showEditModal = false;
			await loadAll();
		} catch (err: any) {
			editError = err?.message || 'Gagal memperbarui lead.';
		} finally {
			editSaving = false;
		}
	}

	async function handleStageChange(stage: ProspectStage) {
		if (!prospect || updatingStage || prospect.stage === stage) return;
		updatingStage = true;
		try {
			const oldStage = prospect.stage;
			const salesName = prospect.display_assigned_name || resolveSalesDisplayName(prospect.assigned_name) || 'Sales';
			await updateProspectStage(prospect.id, stage, {
				oldStage,
				displayName: prospect.name || prospect.company,
				assignedName: salesName
			});
			prospect = { ...prospect, stage };
		} finally {
			updatingStage = false;
		}
	}

	async function handleAddFollowUp() {
		if (!prospect || saving) return;
		if (!fuNotes.trim()) {
			errorMsg = 'Isi catatan aktivitas.';
			return;
		}
		saving = true;
		errorMsg = '';
		try {
			await createFollowUp({
				prospectId: prospect.id,
				type: fuType,
				notes: fuNotes.trim(),
				result: fuResult.trim(),
				nextFollowUp: fuNextDate || null
			});
			fuNotes = '';
			fuResult = '';
			fuNextDate = '';
			fuType = 'call';
			showForm = false;
			followUps = await getFollowUpsForProspect(prospect.id);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan aktivitas.';
		} finally {
			saving = false;
		}
	}

	function cleanWaPhone(phone: string): string {
		let p = (phone || '').replace(/[^0-9]/g, '');
		if (p.startsWith('0')) p = '62' + p.slice(1);
		return p;
	}

	function getActivityMeta(type: string) {
		return ACTIVITY_TYPES.find((a) => a.value === type) || ACTIVITY_TYPES[0];
	}

	function formatRupiah(n: number) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function channelBadge(channel: string | null | undefined) {
		const ch = (channel || '').toLowerCase();
		if (ch.includes('wa') || ch.includes('whatsapp')) {
			return { label: 'WhatsApp', icon: IconBrandWhatsapp, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40' };
		}
		if (ch.includes('ig') || ch.includes('instagram')) {
			return { label: 'Instagram', icon: IconBrandInstagram, color: 'text-pink-600 bg-pink-50 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-800/40' };
		}
		if (ch.includes('mess') || ch.includes('messenger')) {
			return { label: 'Messenger', icon: IconBrandMessenger, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40' };
		}
		return { label: 'Webchat', icon: IconWorld, color: 'text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40' };
	}
</script>

<div class="scroll-body">
	<div class="max-w-3xl mx-auto p-4 pb-24">
		<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sales/prospek')}>
			<IconArrowLeft size={15} /> Kembali ke Pipeline
		</button>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian prospek..." />
		</div>
		{:else if !prospect}
			<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Lead tidak ditemukan.</div>
		{:else}
			{@const ch = channelBadge(omniContact?.channel || (prospect.notes?.includes('[Inbound') ? 'WhatsApp' : null))}
			{@const ChIcon = ch.icon}

			<!-- Prospect Header Card -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-start justify-between gap-2 mb-2 flex-wrap">
					<div>
						<div class="flex items-center gap-2 flex-wrap">
							<h1 class="text-[19px] font-black" style="color: var(--sys-label)">{prospect.name || prospect.company}</h1>
							<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border {ch.color}">
								<ChIcon size={11} />
								<span>{ch.label}</span>
							</span>
						</div>
						{#if prospect.company && prospect.name}
							<p class="text-[13px] font-semibold flex items-center gap-1 mt-0.5" style="color: var(--sys-label2)">
								<IconBuildingStore size={14} class="opacity-70" />
								<span>{prospect.company}</span>
							</p>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						{#if prospect.quoted_amount}
							<div class="text-right mr-1">
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Nilai Deal:</span>
								<span class="text-[16px] font-black text-emerald-600 dark:text-emerald-400">{formatRupiah(prospect.quoted_amount)}</span>
							</div>
						{/if}
						<button
							type="button"
							class="h-8 px-3 rounded-xl border text-[11px] font-bold flex items-center gap-1 hover:bg-black/5 transition-colors"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
							onclick={openEditModal}
						>
							<IconEdit size={13} /> Edit Lead
						</button>
					</div>
				</div>

				<!-- Contact action buttons -->
				<div class="flex items-center flex-wrap gap-2 pt-2.5 border-t" style="border-color: var(--sys-sep)">
					{#if prospect.phone}
						{@const waNumber = cleanWaPhone(prospect.phone)}
						{@const mySenderName = $authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email) || 'Sales Rep'}
						<a
							href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo ${prospect.name || ''}, saya ${mySenderName} dari PT Eltama Prima Indo. Ingin follow up terkait kebutuhan coating & perlindungan korosi Anda.`)}`}
							target="_blank"
							rel="noopener noreferrer"
							class="h-8 px-3 rounded-xl text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 flex items-center gap-1.5 transition-colors"
						>
							<IconBrandWhatsapp size={15} /> Chat WhatsApp
						</a>
						<a
							href={`tel:${prospect.phone}`}
							class="h-8 px-3 rounded-xl text-[11px] font-semibold border flex items-center gap-1.5 hover:bg-black/5 transition-colors"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
						>
							<IconPhone size={14} /> Telepon ({prospect.phone})
						</a>
					{/if}
					{#if prospect.email}
						<a
							href={`mailto:${prospect.email}`}
							class="h-8 px-3 rounded-xl text-[11px] font-semibold border flex items-center gap-1.5 hover:bg-black/5 transition-colors"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
						>
							<IconMail size={14} /> Email
						</a>
					{/if}

					{#if prospect.display_assigned_name || prospect.assigned_name}
						{@const repDisplayName = prospect.display_assigned_name || resolveSalesDisplayName(prospect.assigned_name)}
						{#if repDisplayName}
							<span class="ml-auto text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5" style="color: var(--sys-label2)">
								<IconUser size={13} class="text-[var(--p,var(--g))]" /> PIC: {repDisplayName}
							</span>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Pipeline Stage Stepper -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-2.5">
					<p class="text-[12px] font-bold" style="color: var(--sys-label)">Tahap Pipeline</p>
					{#if updatingStage}
						<span class="text-[10px] font-semibold flex items-center gap-1 text-teal-600">
							<IconLoader2 size={12} class="animate-spin" /> Menyimpan...
						</span>
					{/if}
				</div>

				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
					{#each PROSPECT_STAGES as s (s.value)}
						{@const isCurrent = prospect.stage === s.value}
						<button
							type="button"
							class="shrink-0 h-8 px-3 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95 {isCurrent
								? s.value === 'won'
									? 'bg-emerald-600 text-white shadow-sm'
									: s.value === 'lost'
										? 'bg-rose-600 text-white shadow-sm'
										: 'bg-[var(--p,var(--g))] text-white shadow-sm'
								: 'border hover:bg-black/5 dark:hover:bg-white/5'}"
							style={!isCurrent ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)' : ''}
							disabled={updatingStage}
							onclick={() => handleStageChange(s.value)}
						>
							{#if isCurrent}
								<IconCheck size={12} stroke={3} />
							{/if}
							<span>{s.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- 1-Tap Next Actions (Estafet Lapangan Auto-Prefill) -->
			<div class="mb-4">
				<div class="flex items-center justify-between mb-2">
					<p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">⚡ 1-Tap Estafet Lapangan (Auto-Prefill)</p>
					<span class="text-[10px] text-gray-400">Data klien otomatis terisi</span>
				</div>
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
					<!-- 1. Check-in Visit GPS -->
					<button
						type="button"
						class="p-2.5 rounded-2xl border flex flex-col justify-between text-left transition-all hover:border-emerald-500 active:scale-[0.98]"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
						onclick={() => {
							if (!prospect) return;
							const q = new URLSearchParams({ prospect_id: String(prospect.id) });
							if (prospect.company || prospect.name) q.set('customer_name', prospect.company || prospect.name);
							if (prospect.customer_id) q.set('customer_id', String(prospect.customer_id));
							q.set('tujuan', `Visit prospek: ${prospect.company || prospect.name}`);
							goto(`/sales/baru?${q.toString()}`);
						}}
					>
						<div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mb-2">
							<IconMapPin size={17} />
						</div>
						<div>
							<p class="text-[12px] font-bold" style="color: var(--sys-label)">Visit GPS</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">Check-in &amp; diskusi</p>
						</div>
					</button>

					<!-- 2. Survey Lapangan -->
					<button
						type="button"
						class="p-2.5 rounded-2xl border flex flex-col justify-between text-left transition-all hover:border-blue-500 active:scale-[0.98]"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
						onclick={() => {
							if (!prospect) return;
							const q = new URLSearchParams({ prospect_id: String(prospect.id) });
							if (prospect.company || prospect.name) q.set('customer_name', prospect.company || prospect.name);
							if (prospect.customer_id) q.set('customer_id', String(prospect.customer_id));
							if (prospect.name) q.set('pic', prospect.name);
							if (prospect.phone) q.set('telp', prospect.phone);
							goto(`/sales/survey/baru?${q.toString()}`);
						}}
					>
						<div class="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mb-2">
							<IconClipboardCheck size={17} />
						</div>
						<div>
							<p class="text-[12px] font-bold" style="color: var(--sys-label)">Survey Lokasi</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">Spek teknis &amp; foto</p>
						</div>
					</button>

					<!-- 3. Request Sample Cat -->
					<button
						type="button"
						class="p-2.5 rounded-2xl border flex flex-col justify-between text-left transition-all hover:border-purple-500 active:scale-[0.98]"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
						onclick={() => {
							if (!prospect) return;
							const q = new URLSearchParams({ prospect_id: String(prospect.id) });
							if (prospect.company || prospect.name) q.set('customer_name', prospect.company || prospect.name);
							goto(`/sales/sample-request?${q.toString()}`);
						}}
					>
						<div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 mb-2">
							<IconFlask size={17} />
						</div>
						<div>
							<p class="text-[12px] font-bold" style="color: var(--sys-label)">Sample Cat</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">Pengajuan trial</p>
						</div>
					</button>

					<!-- 4. Buat Penawaran / SPH -->
					<button
						type="button"
						class="p-2.5 rounded-2xl border flex flex-col justify-between text-left transition-all hover:border-amber-500 active:scale-[0.98]"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
						onclick={() => {
							if (!prospect) return;
							const q = new URLSearchParams({ prospect_id: String(prospect.id) });
							if (prospect.company || prospect.name) q.set('customer_name', prospect.company || prospect.name);
							if (prospect.customer_id) q.set('customer_id', String(prospect.customer_id));
							goto(`/sales/penawaran/baru?${q.toString()}`);
						}}
					>
						<div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mb-2">
							<IconFileDollar size={17} />
						</div>
						<div>
							<p class="text-[12px] font-bold" style="color: var(--sys-label)">Kalkulator SPH</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">Hitung margin &amp; RAB</p>
						</div>
					</button>
				</div>
			</div>

			<!-- Omnichannel & Riwayat Chat Widget -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between gap-2 mb-3 pb-2 border-b" style="border-color: var(--sys-sep)">
					<div class="flex items-center gap-2">
						<span class="p-1 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
							<IconMessageCircle size={16} />
						</span>
						<p class="text-[13px] font-bold" style="color: var(--sys-label)">Konteks Chat Omnichannel</p>
					</div>
					{#if prospect.phone}
						{@const waNumber = cleanWaPhone(prospect.phone)}
						<a
							href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo ${prospect.name || ''}, saya ${$authStore.karyawanName || 'Sales Rep'} dari PT Eltama Prima Indo...`)}`}
							target="_blank"
							rel="noopener noreferrer"
							class="text-[11px] font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
						>
							<IconBrandWhatsapp size={13} />
							<span>Buka WhatsApp</span>
						</a>
					{/if}
				</div>

				{#if loadingOmni}
					<div class="py-6 flex items-center justify-center gap-2 text-[12px] text-zinc-400">
						<IconLoader2 size={16} class="animate-spin text-teal-600" />
						<span>Memeriksa pesan percakapan...</span>
					</div>
				{:else if omniMessages.length === 0}
					<div class="text-center py-5 px-3 rounded-xl border border-dashed text-[12px]" style="border-color: var(--sys-sep)">
						<p class="font-medium text-zinc-500 dark:text-zinc-400">
							Kontak ini terhubung ke kanal <strong>{ch.label}</strong> ({prospect.phone || 'tanpa nomor'}).
						</p>
						<p class="text-[11px] mt-1 text-zinc-400">
							Gunakan tombol Chat WhatsApp di atas untuk berkomunikasi langsung dengan pelanggan.
						</p>
					</div>
				{:else}
					<div class="max-h-60 overflow-y-auto flex flex-col gap-2 p-2 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
						{#each omniMessages as msg (msg.id)}
							{@const isOut = msg.direction === 'out'}
							<div class="flex flex-col {isOut ? 'items-end' : 'items-start'}">
								<div class="max-w-[85%] rounded-xl p-2.5 text-[11px] leading-relaxed {isOut
									? 'bg-emerald-600 text-white rounded-tr-xs'
									: 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-tl-xs border border-zinc-200 dark:border-zinc-700 shadow-xs'}">
									<div class="flex items-center justify-between gap-3 text-[9px] opacity-75 font-semibold mb-0.5">
										<span>{isOut ? (msg.sender_name || 'Sales Rep') : (prospect.name || 'Pelanggan')}</span>
										<span>{msg.timestamp ? msg.timestamp.split('T')[1]?.slice(0, 5) : ''}</span>
									</div>
									<p class="whitespace-pre-wrap">{msg.text}</p>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Notes & Details -->
			{#if prospect.notes}
				<div class="rounded-2xl border p-3.5 mb-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<p class="text-[11px] font-bold mb-1" style="color: var(--sys-label3)">Catatan &amp; Riwayat Awal Lead</p>
					<p class="text-[12px] leading-relaxed" style="color: var(--sys-label)">{prospect.notes}</p>
				</div>
			{/if}

			<!-- Riwayat Follow-up & Aktivitas Section -->
			<div class="flex items-center justify-between mb-3">
				<p class="text-[13px] font-bold" style="color: var(--sys-label)">
					Riwayat Follow-up &amp; Interaksi ({followUps.length})
				</p>
				<button
					type="button"
					class="px-3 py-1.5 rounded-xl text-[11px] font-bold text-white flex items-center gap-1 shadow-sm active:scale-95 transition-transform"
					style="background: var(--p, var(--g))"
					onclick={() => (showForm = !showForm)}
				>
					<IconPlus size={13} stroke={2.5} /> Catat Follow-up
				</button>
			</div>

			<!-- Add Follow-up Form -->
			{#if showForm}
				<div class="rounded-2xl border p-4 mb-4 flex flex-col gap-3 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<p class="text-[12px] font-bold" style="color: var(--sys-label)">Form Follow-up Baru</p>

					<!-- Activity Type Selector -->
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Jenis Interaksi</label>
						<div class="grid grid-cols-3 gap-1.5">
							{#each ACTIVITY_TYPES as a (a.value)}
								{@const isSelected = fuType === a.value}
								{@const Icon = a.icon}
								<button
									type="button"
									class="h-9 px-2 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 border transition-all {isSelected
										? 'bg-[var(--p,var(--g))] text-white border-[var(--p,var(--g))]'
										: 'hover:bg-black/5'}"
									style={!isSelected ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)' : ''}
									onclick={() => (fuType = a.value)}
								>
									<Icon size={13} />
									<span>{a.label}</span>
								</button>
							{/each}
						</div>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Catatan Aktivitas</label>
						<textarea
							class="w-full rounded-xl border text-[12px] p-2.5"
							style="border-color: var(--sys-sep); background: var(--sys-fill)"
							rows="3"
							placeholder="Poin-poin pembicaraan, kebutuhan customer, dsb..."
							bind:value={fuNotes}
						></textarea>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Hasil / Tindak Lanjut (opsional)</label>
						<input
							class="w-full h-10 px-3 rounded-xl border text-[12px]"
							style="border-color: var(--sys-sep); background: var(--sys-fill)"
							placeholder="cth. Minta revisi spek, menunggu jadwal survey..."
							bind:value={fuResult}
						/>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Jadwal Follow-up Berikutnya (opsional)</label>
						<input
							type="date"
							class="w-full h-10 px-3 rounded-xl border text-[12px]"
							style="border-color: var(--sys-sep); background: var(--sys-fill)"
							bind:value={fuNextDate}
						/>
					</div>

					{#if errorMsg}
						<p class="text-[11px]" style="color: #DC2626">{errorMsg}</p>
					{/if}

					<div class="flex items-center justify-end gap-2 pt-1">
						<button
							type="button"
							class="px-3 py-2 rounded-xl text-[12px] font-semibold border"
							style="border-color: var(--sys-sep); color: var(--sys-label3)"
							onclick={() => (showForm = false)}
						>
							Batal
						</button>
						<button
							type="button"
							class="px-4 py-2 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50"
							style="background: var(--p, var(--g))"
							disabled={saving}
							onclick={handleAddFollowUp}
						>
							{#if saving}<IconLoader2 size={14} class="animate-spin" />{/if}
							Simpan Aktivitas
						</button>
					</div>
				</div>
			{/if}

			<!-- Timeline of Follow-ups -->
			{#if followUps.length === 0}
				<div class="text-center py-10 px-4 rounded-2xl border border-dashed" style="border-color: var(--sys-sep)">
					<p class="text-[12px] font-medium" style="color: var(--sys-label3)">Belum ada aktivitas follow-up tercatat.</p>
					<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Klik "Catat Follow-up" untuk merekam interaksi pertama.</p>
				</div>
			{:else}
				<div class="flex flex-col gap-2.5">
					{#each followUps as f (f.id)}
						{@const meta = getActivityMeta(f.type)}
						{@const Icon = meta.icon}
						<div
							class="rounded-2xl border p-3.5 shadow-sm"
							style="border-color: var(--sys-sep); background: var(--sys-bg)"
						>
							<div class="flex items-center justify-between mb-1.5">
								<div class="flex items-center gap-1.5">
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 {meta.color}">
										<Icon size={12} /> {meta.label}
									</span>
								</div>
								<span class="text-[10px]" style="color: var(--sys-label3)">
									{new Date(f.date_created).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
								</span>
							</div>

							<p class="text-[12px] leading-relaxed" style="color: var(--sys-label)">{f.notes}</p>

							{#if f.result}
								<div class="mt-2 text-[11px] p-2 rounded-xl" style="background: var(--sys-fill)">
									<span class="font-semibold" style="color: var(--sys-label2)">Hasil:</span>
									<span style="color: var(--sys-label)"> {f.result}</span>
								</div>
							{/if}

							{#if f.next_follow_up}
								<p class="text-[11px] mt-2 flex items-center gap-1 font-semibold" style="color: var(--amd)">
									<IconCalendar size={13} /> Follow-up berikutnya: {new Date(f.next_follow_up).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- ================= MODAL EDIT LEAD ================= -->
{#if showEditModal}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
		<div
			class="w-full max-w-lg rounded-2xl border p-5 shadow-2xl flex flex-col gap-3.5 max-h-[90vh] overflow-y-auto"
			style="border-color: var(--sys-sep); background: var(--sys-bg)"
		>
			<div class="flex items-center justify-between pb-2 border-b" style="border-color: var(--sys-sep)">
				<div>
					<h2 class="text-[16px] font-black" style="color: var(--sys-label)">Edit Data Lead</h2>
					<p class="text-[11px]" style="color: var(--sys-label3)">Perbarui PIC sales, kontak, estimasi deal, dan prioritas</p>
				</div>
				<button
					type="button"
					class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
					onclick={() => (showEditModal = false)}
				>
					<IconX size={16} />
				</button>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Nama Kontak PIC *</label>
					<input
						class="w-full h-10 px-3 rounded-xl border text-[12px] font-semibold"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editName}
					/>
				</div>
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Nama Perusahaan</label>
					<input
						class="w-full h-10 px-3 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editCompany}
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">No. Telepon / WhatsApp</label>
					<input
						class="w-full h-10 px-3 rounded-xl border text-[12px] font-mono"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editPhone}
					/>
				</div>
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Email</label>
					<input
						type="email"
						class="w-full h-10 px-3 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editEmail}
					/>
				</div>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Salesman (PIC Lead)</label>
				<div class="relative">
					<input
						list="edit-sales-reps-list"
						class="w-full h-10 px-3 rounded-xl border text-[12px] font-semibold outline-hidden focus:border-[var(--p,var(--g))]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="Pilih nama sales..."
						bind:value={editAssignedName}
					/>
					<datalist id="edit-sales-reps-list">
						{#each salesRepOptions as opt}
							<option value={opt.name}>{opt.name}</option>
						{/each}
					</datalist>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Prioritas</label>
					<select
						class="w-full h-10 px-2 rounded-xl border text-[11px] font-semibold"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editPriority}
					>
						<option value="high">🔴 Tinggi</option>
						<option value="medium">🟡 Sedang</option>
						<option value="low">⚪ Rendah</option>
					</select>
				</div>
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Estimasi Deal (Rp)</label>
					<input
						type="number"
						class="w-full h-10 px-3 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editQuotedAmount}
					/>
				</div>
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Target Closing</label>
					<input
						type="date"
						class="w-full h-10 px-2.5 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={editExpectedClose}
					/>
				</div>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Catatan &amp; Riwayat</label>
				<textarea
					rows="3"
					class="w-full p-2.5 rounded-xl border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={editNotes}
				></textarea>
			</div>

			{#if editError}
				<p class="text-[11px] font-bold text-rose-600">{editError}</p>
			{/if}

			<div class="flex items-center justify-end gap-2 pt-2 border-t" style="border-color: var(--sys-sep)">
				<button
					type="button"
					class="h-10 px-4 rounded-xl border text-[12px] font-bold hover:bg-black/5"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (showEditModal = false)}
				>
					Batal
				</button>
				<button
					type="button"
					class="h-10 px-5 rounded-xl text-[12px] font-bold text-white flex items-center gap-2 shadow-sm disabled:opacity-50"
					style="background: var(--p, var(--g))"
					disabled={editSaving}
					onclick={handleSaveEdit}
				>
					{#if editSaving}
						<IconLoader2 size={15} class="animate-spin" />
					{/if}
					<span>Simpan Perubahan</span>
				</button>
			</div>
		</div>
	</div>
{/if}

