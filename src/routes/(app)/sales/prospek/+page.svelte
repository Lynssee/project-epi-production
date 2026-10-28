<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getMyProspectsWithFollowUps,
		updateProspectStage,
		createFollowUp,
		getUpcomingFollowUps,
		getSalesVisitKpis,
		getFieldSalesOptions,
		getPipelineBadges,
		resolveSalesDisplayName,
		PROSPECT_STAGES,
		type ProspectRow,
		type ProspectStage,
		type FollowUpType,
		type UpcomingFollowUp,
		type SalesOption
	} from '$lib/services/sales';
	import {
		getOmniInboundLeads,
		convertOmniContactToLead,
		getProspectOmniChat,
		type OmnichannelContact,
		type OmnichannelMessage
	} from '$lib/services/omnichannel';
	import { getMyPoStatusSummary } from '$lib/services/salesPo';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import FieldExportButton from '$lib/components/sales/FieldExportButton.svelte';
	import {
		IconArrowLeft,
		IconPlus,
		IconLoader2,
		IconUserSearch,
		IconSearch,
		IconUser,
		IconPhone,
		IconMail,
		IconX,
		IconBrandWhatsapp,
		IconArrowRight,
		IconFlame,
		IconBuildingStore,
		IconTrendingUp,
		IconCalendar,
		IconLayoutKanban,
		IconList,
		IconFilter,
		IconClock,
		IconAlertTriangle,
		IconCheck,
		IconRefresh,
		IconChevronRight,
		IconMessageDots,
		IconMessageCircle,
		IconInbox,
		IconSparkles,
		IconBrandInstagram,
		IconWorld,
		IconBrandMessenger,
		IconExternalLink,
		IconSend
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let prospects = $state<ProspectRow[]>([]);
	let pipelineBadges = $state<Map<number, import('$lib/services/sales').PipelineBadge>>(new Map());
	let salesRepOptions = $state<SalesOption[]>([]);
	let activeStage = $state<ProspectStage | 'all'>('all');
	let searchQuery = $state('');
	let selectedSalesRep = $state<string>('all');
	let selectedPriority = $state<string>('all');
	let selectedSource = $state<string>('all');
	let sortBy = $state<'newest' | 'quoted_desc' | 'followup' | 'priority' | 'name_asc'>('newest');
	let viewMode = $state<'list' | 'kanban'>('list');

	// KPI counts
	let reminders = $state<UpcomingFollowUp[]>([]);
	let poNeedsAttention = $state(0);
	let pendingVisits = $state(0);

	// Quick Follow-up Modal state
	let showFollowUpModal = $state(false);
	let modalProspect = $state<ProspectRow | null>(null);
	let fuType = $state<FollowUpType>('whatsapp');
	let fuNotes = $state('');
	let fuResult = $state('');
	let fuNextDate = $state('');
	let fuSaving = $state(false);
	let fuError = $state('');

	// Quick Stage Change State
	let updatingStageId = $state<number | null>(null);

	// ── OMNICHANNEL MODAL & STATE ──
	let showOmniModal = $state(false);
	let omniLoading = $state(false);
	let omniContacts = $state<OmnichannelContact[]>([]);
	let omniSearch = $state('');
	let omniChannelFilter = $state<'all' | 'WhatsApp' | 'Instagram' | 'Messenger' | 'Webchat'>('all');
	let omniUnlinkedOnly = $state(true);

	// Omnichannel Quick Convert Dialog State
	let showConvertDialog = $state(false);
	let selectedOmni = $state<OmnichannelContact | null>(null);
	let convertCompanyName = $state('');
	let convertPriority = $state<'low' | 'medium' | 'high'>('medium');
	let convertQuotedAmount = $state<number | null>(null);
	let convertNotes = $state('');
	let convertAssignee = $state('');
	let convertSaving = $state(false);
	let convertError = $state('');

	// Omnichannel Chat History Viewer State
	let showChatViewer = $state(false);
	let chatViewerLoading = $state(false);
	let chatViewerProspect = $state<ProspectRow | null>(null);
	let chatViewerContact = $state<OmnichannelContact | null>(null);
	let chatViewerMessages = $state<OmnichannelMessage[]>([]);

	const ACTIVITY_TYPES: { value: FollowUpType; label: string; icon: string }[] = [
		{ value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
		{ value: 'call', label: 'Telepon', icon: '📞' },
		{ value: 'meeting', label: 'Meeting', icon: '🤝' },
		{ value: 'visit', label: 'Kunjungan', icon: '🚗' },
		{ value: 'email', label: 'Email', icon: '✉️' },
		{ value: 'other', label: 'Lainnya', icon: '📝' }
	];

	const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

	let isSuperAdmin = $derived(
		$authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')
	);

	// Daftar sales untuk filter: hanya sales lapangan aktif (divisi MARKETING & SALES + whitelist),
	// bukan turunan assigned_name mentah dari prospects. Count dihitung dari prospects.
	let salesReps = $derived.by(() => {
		const countMap = new Map<string, number>();
		prospects.forEach((p) => {
			const name = p.display_assigned_name || resolveSalesDisplayName(p.assigned_name);
			if (name && name !== 'Sales Rep') {
				countMap.set(name, (countMap.get(name) || 0) + 1);
			}
		});
		return salesRepOptions
			.map((opt) => ({ name: opt.name, count: countMap.get(opt.name) || 0 }))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	async function loadData() {
		loading = true;
		errorMsg = '';
		try {
			const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
			const salesName = isSuper ? null : $authStore.karyawanName;
			const salesId = isSuper ? null : $authStore.karyawanId;

			const [prospectList, reminderList, kpiData, salesList] = await Promise.all([
				getMyProspectsWithFollowUps(salesName),
				getUpcomingFollowUps(salesName),
				getSalesVisitKpis(salesId),
				getFieldSalesOptions()
			]);

			prospects = prospectList;
			getPipelineBadges(prospectList.map((p) => p.id))
				.then((m) => { pipelineBadges = m; })
				.catch(() => {});
			reminders = reminderList;
			pendingVisits = kpiData.menungguVerifikasi;
			salesRepOptions = salesList;

			if ($authStore.karyawanId) {
				try {
					const poSummary = await getMyPoStatusSummary($authStore.karyawanId);
					poNeedsAttention = (poSummary.belum_ada || 0) + (poSummary.revisi || 0);
				} catch {}
			}
		} catch (err: any) {
			console.error('[sales/prospek] Error loading prospects:', err);
			errorMsg = err?.message || 'Gagal memuat data prospek.';
		} finally {
			loading = false;
		}
	}

	onMount(loadData);

	// Load Inbound Omnichannel Contacts for Modal
	async function loadOmniContacts() {
		omniLoading = true;
		try {
			omniContacts = await getOmniInboundLeads({
				search: omniSearch,
				unlinkedOnly: omniUnlinkedOnly,
				limit: 60
			});
		} catch (e) {
			console.warn('Error loading omni leads:', e);
		} finally {
			omniLoading = false;
		}
	}

	function openOmniPullModal() {
		showOmniModal = true;
		loadOmniContacts();
	}

	function openConvertDialog(contact: OmnichannelContact) {
		selectedOmni = contact;
		convertCompanyName = contact.name || '';
		convertPriority = 'medium';
		convertQuotedAmount = null;
		convertNotes = contact.last_message_preview || contact.notes || '';
		convertAssignee = $authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email) || 'Adit';
		convertError = '';
		showConvertDialog = true;
	}

	async function handleExecuteConvert() {
		if (!selectedOmni || convertSaving) return;
		convertSaving = true;
		convertError = '';
		try {
			const prospect = await convertOmniContactToLead(selectedOmni.id, {
				name: selectedOmni.name || selectedOmni.phone,
				company: convertCompanyName.trim() || selectedOmni.name || selectedOmni.phone,
				phone: selectedOmni.phone,
				email: selectedOmni.email || '',
				notes: convertNotes.trim(),
				assignedName: convertAssignee.trim() || $authStore.karyawanName || 'Sales Rep',
				priority: convertPriority,
				quotedAmount: convertQuotedAmount ? Number(convertQuotedAmount) : null,
				channelType: selectedOmni.channel
			});

			showConvertDialog = false;
			showOmniModal = false;
			await loadData();
			goto(`/sales/prospek/${prospect.id}`);
		} catch (err: any) {
			convertError = err?.message || 'Gagal mengonversi kontak omnichannel menjadi lead.';
		} finally {
			convertSaving = false;
		}
	}

	async function openChatHistory(prospect: ProspectRow, e?: Event) {
		if (e) e.stopPropagation();
		chatViewerProspect = prospect;
		chatViewerLoading = true;
		showChatViewer = true;
		chatViewerContact = null;
		chatViewerMessages = [];
		try {
			const res = await getProspectOmniChat({
				prospectId: prospect.id,
				phone: prospect.phone,
				contactId: prospect.omni_contact_id
			});
			chatViewerContact = res.contact;
			chatViewerMessages = res.messages;
		} catch (err) {
			console.warn('Gagal memuat chat omnichannel:', err);
		} finally {
			chatViewerLoading = false;
		}
	}

	// Filtered & Sorted prospects
	let filtered = $derived.by(() => {
		let list = [...prospects];

		// Stage filter
		if (activeStage !== 'all') {
			list = list.filter((p) => p.stage === activeStage);
		}

		// Source filter
		if (selectedSource !== 'all') {
			if (selectedSource === 'omnichannel') {
				list = list.filter(
					(p) =>
						p.omni_contact_id ||
						p.omni_channel ||
						p.source_channel === 'WhatsApp' ||
						p.source_channel === 'Instagram' ||
						p.source_channel === 'Messenger' ||
						p.source_channel === 'Webchat' ||
						p.tags?.includes('whatsapp') ||
						p.notes?.includes('[Inbound')
				);
			} else if (selectedSource === 'customer') {
				list = list.filter((p) => p.customer_id != null);
			} else if (selectedSource === 'manual') {
				list = list.filter((p) => !p.omni_contact_id && !p.customer_id && !p.notes?.includes('[Inbound'));
			}
		}

		// Sales Rep filter (for super admins / view all)
		if (selectedSalesRep !== 'all') {
			const sel = selectedSalesRep.toLowerCase();
			list = list.filter((p) => {
				const disp = (p.display_assigned_name || resolveSalesDisplayName(p.assigned_name)).toLowerCase();
				const raw = (p.assigned_name || '').toLowerCase();
				return disp === sel || raw === sel || raw.includes(sel) || disp.includes(sel);
			});
		}

		// Priority filter
		if (selectedPriority !== 'all') {
			list = list.filter((p) => p.priority === selectedPriority);
		}

		// Search query
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(p) =>
					(p.name && p.name.toLowerCase().includes(q)) ||
					(p.company && p.company.toLowerCase().includes(q)) ||
					(p.phone && p.phone.toLowerCase().includes(q)) ||
					(p.email && p.email.toLowerCase().includes(q)) ||
					(p.notes && p.notes.toLowerCase().includes(q)) ||
					(p.source_channel && p.source_channel.toLowerCase().includes(q)) ||
					(p.display_assigned_name && p.display_assigned_name.toLowerCase().includes(q)) ||
					(p.assigned_name && p.assigned_name.toLowerCase().includes(q))
			);
		}

		// Sorting
		list.sort((a, b) => {
			if (sortBy === 'quoted_desc') {
				return (Number(b.quoted_amount) || 0) - (Number(a.quoted_amount) || 0);
			}
			if (sortBy === 'followup') {
				if (!a.next_follow_up) return 1;
				if (!b.next_follow_up) return -1;
				return a.next_follow_up.localeCompare(b.next_follow_up);
			}
			if (sortBy === 'priority') {
				const prioWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };
				return (prioWeight[b.priority || 'medium'] || 0) - (prioWeight[a.priority || 'medium'] || 0);
			}
			if (sortBy === 'name_asc') {
				const nameA = a.name || a.company || '';
				const nameB = b.name || b.company || '';
				return nameA.localeCompare(nameB);
			}
			// Default 'newest' by id or date_created
			return b.id - a.id;
		});

		return list;
	});

	// Fase 6 §9.2 — export lapangan TANPA nilai (quoted_amount/po_amount dibuang).
	let exportRows = $derived(
		filtered.map((p) => ({
			nama: p.name ?? '',
			perusahaan: p.company ?? '',
			telepon: p.phone ?? '',
			email: p.email ?? '',
			tahap: p.stage ?? '',
			prioritas: p.priority ?? '',
			target_closing: (p.expected_close ?? '').slice(0, 10),
			ditugaskan: p.display_assigned_name || p.assigned_name || ''
		}))
	);

	// Pipeline Summary Metrics
	let openProspects = $derived(prospects.filter((p) => p.stage !== 'won' && p.stage !== 'lost'));
	let totalActivePipeline = $derived(
		openProspects.reduce((sum, p) => sum + (Number(p.quoted_amount) || 0), 0)
	);
	let wonProspects = $derived(prospects.filter((p) => p.stage === 'won'));
	let wonTotalAmount = $derived(
		wonProspects.reduce((sum, p) => sum + (Number(p.po_amount) || Number(p.quoted_amount) || 0), 0)
	);
	let overdueOrTodayCount = $derived(
		prospects.filter((p) => p.next_follow_up && p.next_follow_up <= todayStr && p.stage !== 'won' && p.stage !== 'lost').length
	);
	let omniLeadsCount = $derived(
		prospects.filter((p) => p.omni_contact_id || p.omni_channel || p.notes?.includes('[Inbound')).length
	);

	function stageLabel(stage: string) {
		return PROSPECT_STAGES.find((s) => s.value === stage)?.label || stage;
	}

	function stageStyle(stage: string) {
		if (stage === 'won') return 'background:var(--gg); color:var(--ggd)';
		if (stage === 'lost') return 'background:var(--rel); color:var(--red)';
		if (stage === 'negotiation') return 'background:var(--aml); color:var(--amd)';
		if (stage === 'proposal') return 'background:#EDE9FE; color:#6D28D9';
		if (stage === 'qualified') return 'background:#DBEAFE; color:#1D4ED8';
		return 'background:var(--sys-fill); color:var(--sys-label3)';
	}

	function priorityBadge(priority: string) {
		if (priority === 'high') {
			return {
				label: 'Tinggi',
				bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40',
				dot: 'bg-rose-500'
			};
		}
		if (priority === 'medium') {
			return {
				label: 'Sedang',
				bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40',
				dot: 'bg-amber-500'
			};
		}
		return {
			label: 'Rendah',
			bg: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
			dot: 'bg-slate-400'
		};
	}

	function channelBadge(channel: string | null | undefined) {
		const ch = (channel || '').toLowerCase();
		if (ch.includes('wa') || ch.includes('whatsapp')) {
			return {
				label: 'WhatsApp',
				icon: IconBrandWhatsapp,
				bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40',
				dot: 'bg-emerald-500'
			};
		}
		if (ch.includes('ig') || ch.includes('instagram')) {
			return {
				label: 'Instagram',
				icon: IconBrandInstagram,
				bg: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-800/40',
				dot: 'bg-pink-500'
			};
		}
		if (ch.includes('mess') || ch.includes('messenger')) {
			return {
				label: 'Messenger',
				icon: IconBrandMessenger,
				bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40',
				dot: 'bg-blue-500'
			};
		}
		if (ch.includes('web') || ch.includes('webchat')) {
			return {
				label: 'Webchat',
				icon: IconWorld,
				bg: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40',
				dot: 'bg-sky-500'
			};
		}
		return null;
	}

	function formatRupiah(n: number) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function formatShortRupiah(n: number) {
		if (!n || n === 0) return 'Rp 0';
		if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)} M`;
		if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)} Jt`;
		if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)} Rb`;
		return `Rp ${n}`;
	}

	function cleanWaPhone(phone: string): string {
		let p = (phone || '').replace(/[^0-9]/g, '');
		if (p.startsWith('0')) p = '62' + p.slice(1);
		return p;
	}

	function getInitials(name: string): string {
		if (!name) return 'L';
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) {
			return (parts[0][0] + parts[1][0]).toUpperCase();
		}
		return name.slice(0, 2).toUpperCase();
	}

	function getAvatarColor(name: string): string {
		const colors = [
			'bg-blue-500 text-white',
			'bg-emerald-500 text-white',
			'bg-amber-500 text-white',
			'bg-purple-500 text-white',
			'bg-indigo-500 text-white',
			'bg-teal-500 text-white',
			'bg-sky-500 text-white'
		];
		let hash = 0;
		for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
		return colors[Math.abs(hash) % colors.length];
	}

	function getFollowUpStatus(nextDate: string | null | undefined) {
		if (!nextDate) return { text: 'Belum ada jadwal', color: 'text-zinc-400 dark:text-zinc-500', isOverdue: false, isToday: false };
		const dateOnly = nextDate.split('T')[0];
		if (dateOnly < todayStr) {
			return { text: `Overdue (${dateOnly})`, color: 'text-rose-600 font-bold dark:text-rose-400', isOverdue: true, isToday: false };
		}
		if (dateOnly === todayStr) {
			return { text: 'Hari ini!', color: 'text-amber-600 font-bold dark:text-amber-400', isOverdue: false, isToday: true };
		}
		return { text: `Follow-up: ${dateOnly}`, color: 'text-emerald-600 font-medium dark:text-emerald-400', isOverdue: false, isToday: false };
	}

	async function handleQuickStageChange(prospect: ProspectRow, nextStage: ProspectStage, e?: Event) {
		if (e) e.stopPropagation();
		if (updatingStageId === prospect.id || prospect.stage === nextStage) return;
		updatingStageId = prospect.id;
		try {
			const oldStage = prospect.stage;
			const salesName = prospect.assigned_name || $authStore.karyawanName || 'Sales';
			await updateProspectStage(prospect.id, nextStage, {
				oldStage,
				displayName: prospect.name || prospect.company,
				assignedName: salesName
			});
			// Update locally
			prospects = prospects.map((p) => (p.id === prospect.id ? { ...p, stage: nextStage } : p));
		} catch (err: any) {
			alert(err?.message || 'Gagal mengubah stage.');
		} finally {
			updatingStageId = null;
		}
	}

	function openFollowUpModal(p: ProspectRow, e?: Event) {
		if (e) e.stopPropagation();
		modalProspect = p;
		fuType = 'whatsapp';
		fuNotes = '';
		fuResult = '';
		fuNextDate = '';
		fuError = '';
		showFollowUpModal = true;
	}

	async function handleSaveQuickFollowUp() {
		if (!modalProspect || fuSaving) return;
		if (!fuNotes.trim()) {
			fuError = 'Catatan aktivitas wajib diisi.';
			return;
		}
		fuSaving = true;
		fuError = '';
		try {
			await createFollowUp({
				prospectId: modalProspect.id,
				type: fuType,
				notes: fuNotes.trim(),
				result: fuResult.trim(),
				nextFollowUp: fuNextDate || null
			});
			showFollowUpModal = false;
			await loadData();
		} catch (err: any) {
			fuError = err?.message || 'Gagal menyimpan follow-up.';
		} finally {
			fuSaving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-5xl mx-auto p-4 pb-24">
		<!-- Header & Action Bar -->
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
			<div>
				<div class="flex items-center gap-2 flex-wrap">
					<h1 class="text-[19px] font-extrabold tracking-tight" style="color: var(--sys-label)">
						Pipeline Prospek
					</h1>
					<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[var(--p,var(--g))]/10 text-[var(--p,var(--g))]">
						{openProspects.length} Aktif
					</span>
					{#if omniLeadsCount > 0}
						<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
							<IconBrandWhatsapp size={12} />
							{omniLeadsCount} dari Omnichannel
						</span>
					{/if}
				</div>
				<p class="text-[11px] font-medium mt-0.5" style="color: var(--sys-label3)">
					{isSuperAdmin ? 'Semua Lead, Chat Omnichannel, & Tahapan Closing Tim Sales' : 'Kelola lead, chat masuk WhatsApp/Omnichannel, & follow-up closing'}
				</p>
			</div>

			<div class="flex items-center gap-2 flex-wrap">
				<!-- Tarik dari Omnichannel Button -->
				<button
					type="button"
					class="h-9 px-3 rounded-xl border text-[12px] font-bold flex items-center gap-1.5 transition-all shadow-xs hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 active:scale-95"
					style="border-color: rgba(16, 185, 129, 0.4); background: var(--sys-bg)"
					onclick={openOmniPullModal}
					title="Tarik Lead dari Chat WhatsApp / Omnichannel"
				>
					<IconBrandWhatsapp size={16} class="text-emerald-600 dark:text-emerald-400" />
					<span>Tarik dari Omnichannel</span>
				</button>

				<button
					type="button"
					class="h-9 px-2.5 rounded-xl border text-[12px] font-semibold flex items-center gap-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
					style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
					onclick={loadData}
					title="Muat Ulang Data"
				>
					<IconRefresh size={14} class={loading ? 'animate-spin' : ''} />
					<span class="hidden sm:inline">Refresh</span>
				</button>

				<!-- View Mode Toggle -->
				<div class="flex items-center rounded-xl p-0.5 border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
					<button
						type="button"
						class="h-8 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all {viewMode === 'list'
							? 'bg-[var(--sys-bg)] shadow-xs text-[var(--sys-label)]'
							: 'text-[var(--sys-label3)] hover:text-[var(--sys-label)]'}"
						onclick={() => (viewMode = 'list')}
					>
						<IconList size={14} />
						<span class="hidden sm:inline">List</span>
					</button>
					<button
						type="button"
						class="h-8 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all {viewMode === 'kanban'
							? 'bg-[var(--sys-bg)] shadow-xs text-[var(--sys-label)]'
							: 'text-[var(--sys-label3)] hover:text-[var(--sys-label)]'}"
						onclick={() => (viewMode = 'kanban')}
					>
						<IconLayoutKanban size={14} />
						<span class="hidden sm:inline">Kanban</span>
					</button>
				</div>

				<button
					type="button"
					class="h-9 px-3.5 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5 shrink-0 shadow-sm shadow-[var(--p,var(--g))]/30 active:scale-95 transition-transform"
					style="background: var(--p, var(--g))"
					onclick={() => goto('/sales/prospek/baru')}
				>
					<IconPlus size={16} stroke={2.5} />
					<span>Lead Baru</span>
				</button>
			</div>
		</div>

		<!-- Nav Tabs Modul Sales -->
		<SalesNavTabs
			active="prospek"
			remindersCount={reminders.length}
			poCount={poNeedsAttention}
			pendingCount={pendingVisits}
		/>

		<div class="flex justify-end mb-3">
			<FieldExportButton
				rows={exportRows}
				filename="prospek-saya"
				title="Prospek Saya"
				label="Export CSV"
				offlineNote="Tanpa nilai penawaran. Dari daftar terfilter yang tampil."
			/>
		</div>

		<!-- Pipeline Executive KPI Cards -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
			<!-- KPI 1: Lead Aktif -->
			<div class="rounded-2xl border p-3 flex flex-col justify-between shadow-xs" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Lead Aktif</span>
					<span class="p-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
						<IconUserSearch size={14} />
					</span>
				</div>
				<div class="mt-2">
					<p class="text-[20px] font-black leading-none" style="color: var(--sys-label)">{openProspects.length}</p>
					<p class="text-[10px] font-medium mt-1 truncate" style="color: var(--sys-label3)">
						Dari total {prospects.length} prospek
					</p>
				</div>
			</div>

			<!-- KPI 2: Nilai Pipeline -->
			<div class="rounded-2xl border p-3 flex flex-col justify-between shadow-xs" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Nilai Pipeline</span>
					<span class="p-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
						<IconTrendingUp size={14} />
					</span>
				</div>
				<div class="mt-2">
					<p class="text-[17px] font-black leading-none truncate" style="color: var(--p, var(--g))">
						{formatShortRupiah(totalActivePipeline)}
					</p>
					<p class="text-[10px] font-medium mt-1 truncate" style="color: var(--sys-label3)" title={formatRupiah(totalActivePipeline)}>
						{openProspects.length > 0 ? `${openProspects.length} penawaran terbuka` : 'Belum ada nilai'}
					</p>
				</div>
			</div>

			<!-- KPI 3: Closing (Won) -->
			<div class="rounded-2xl border p-3 flex flex-col justify-between shadow-xs" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Closing (Won)</span>
					<span class="p-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
						<IconCheck size={14} />
					</span>
				</div>
				<div class="mt-2">
					<div class="flex items-baseline gap-1.5">
						<p class="text-[20px] font-black leading-none text-emerald-600 dark:text-emerald-400">{wonProspects.length}</p>
						{#if wonTotalAmount > 0}
							<span class="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
								({formatShortRupiah(wonTotalAmount)})
							</span>
						{/if}
					</div>
					<p class="text-[10px] font-medium mt-1 truncate text-emerald-600/80 dark:text-emerald-400/80">
						{prospects.length > 0 ? `${Math.round((wonProspects.length / prospects.length) * 100)}% Win Rate` : '0%'}
					</p>
				</div>
			</div>

			<!-- KPI 4: Perlu Follow-up -->
			<div class="rounded-2xl border p-3 flex flex-col justify-between shadow-xs" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Follow-up Segera</span>
					<span class="p-1 rounded-lg {overdueOrTodayCount > 0 ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 animate-pulse' : 'bg-zinc-500/10 text-zinc-500'}">
						<IconAlertTriangle size={14} />
					</span>
				</div>
				<div class="mt-2">
					<p class="text-[20px] font-black leading-none {overdueOrTodayCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--sys-label)]'}">
						{overdueOrTodayCount}
					</p>
					<p class="text-[10px] font-medium mt-1 truncate {overdueOrTodayCount > 0 ? 'text-rose-600 font-semibold' : 'text-[var(--sys-label3)]'}">
						{overdueOrTodayCount > 0 ? 'Jatuh tempo / Overdue' : 'Semua follow-up aman'}
					</p>
				</div>
			</div>
		</div>

		<!-- Search & Filter Controls -->
		<div class="rounded-2xl border p-3 mb-4 shadow-xs" style="border-color: var(--sys-sep); background: var(--sys-bg)">
			<div class="flex flex-col sm:flex-row gap-2.5">
				<!-- Search Bar -->
				<div class="relative flex-1">
					<span class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)">
						<IconSearch size={15} />
					</span>
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari nama lead, perusahaan, no. HP, email, channel chat..."
						class="w-full h-10 pl-9 pr-8 rounded-xl border text-[12px] font-medium outline-hidden transition-all focus:border-[var(--p,var(--g))]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1"
							style="color: var(--sys-label4)"
							aria-label="Bersihkan pencarian"
						>
							<IconX size={13} />
						</button>
					{/if}
				</div>

				<!-- Sorting selector -->
				<div class="flex items-center gap-2 shrink-0">
					<select
						class="h-10 px-3 rounded-xl border text-[12px] font-medium outline-hidden"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={sortBy}
					>
						<option value="newest">🕒 Terbaru Ditambahkan</option>
						<option value="followup">⏰ Follow-up Terdekat</option>
						<option value="quoted_desc">💰 Nilai Terbesar</option>
						<option value="priority">🔥 Prioritas Tertinggi</option>
						<option value="name_asc">🔤 Nama (A - Z)</option>
					</select>
				</div>
			</div>

			<!-- Secondary Filters: Source, Sales Rep & Priority -->
			<div class="flex flex-wrap items-center gap-2 mt-2.5 pt-2.5 border-t" style="border-color: var(--sys-sep)">
				<!-- Source Filter -->
				<div class="flex items-center gap-1.5">
					<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">Sumber:</span>
					<select
						class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={selectedSource}
					>
						<option value="all">Semua Sumber</option>
						<option value="omnichannel">💬 Omnichannel (WhatsApp / IG)</option>
						<option value="customer">🏢 Customer Terdaftar</option>
						<option value="manual">📝 Input Manual</option>
					</select>
				</div>

				{#if isSuperAdmin && salesReps.length > 0}
					<div class="flex items-center gap-1.5">
						<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">Sales:</span>
						<select
							class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							bind:value={selectedSalesRep}
						>
							<option value="all">Semua Sales ({prospects.length})</option>
							{#each salesReps as rep}
								<option value={rep.name}>{rep.name} ({rep.count})</option>
							{/each}
						</select>
					</div>
				{/if}

				<div class="flex items-center gap-1.5">
					<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">Prioritas:</span>
					<select
						class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={selectedPriority}
					>
						<option value="all">Semua Prioritas</option>
						<option value="high">🔴 Tinggi (High)</option>
						<option value="medium">🟡 Sedang (Medium)</option>
						<option value="low">⚪ Rendah (Low)</option>
					</select>
				</div>

				{#if searchQuery || selectedSalesRep !== 'all' || selectedPriority !== 'all' || activeStage !== 'all' || selectedSource !== 'all'}
					<button
						type="button"
						class="ml-auto text-[11px] font-bold px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
						onclick={() => {
							searchQuery = '';
							selectedSalesRep = 'all';
							selectedPriority = 'all';
							selectedSource = 'all';
							activeStage = 'all';
						}}
					>
						Reset Filter
					</button>
				{/if}
			</div>
		</div>

		<!-- Stage Filter Tabs (Horizontal Pills) -->
		<div class="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 no-scrollbar">
			<button
				type="button"
				class="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all {activeStage === 'all'
					? 'bg-[var(--p,var(--g))] text-white shadow-xs shadow-[var(--p,var(--g))]/30'
					: 'border hover:bg-black/5 dark:hover:bg-white/5'}"
				style={activeStage !== 'all' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)' : ''}
				onclick={() => (activeStage = 'all')}
			>
				Semua ({prospects.length})
			</button>
			{#each PROSPECT_STAGES as s (s.value)}
				{@const count = prospects.filter((p) => p.stage === s.value).length}
				<button
					type="button"
					class="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all {activeStage === s.value
						? 'bg-[var(--p,var(--g))] text-white shadow-xs shadow-[var(--p,var(--g))]/30'
						: 'border hover:bg-black/5 dark:hover:bg-white/5'}"
					style={activeStage !== s.value ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)' : ''}
					onclick={() => (activeStage = s.value)}
				>
					<span>{s.label}</span>
					{#if count > 0}
						<span class="ml-1 px-1.5 py-0.2 rounded-md text-[9px] font-extrabold {activeStage === s.value ? 'bg-white/20 text-white' : 'bg-black/10 dark:bg-white/10'}">
							{count}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Content: Loading, Error, Empty, List View, or Kanban View -->
		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pipeline prospek sales..." />
		</div>
		{:else if errorMsg}
			<div class="rounded-2xl border p-5 text-center my-6" style="background: var(--rel); border-color: var(--re); color: var(--red)">
				<p class="text-[13px] font-bold mb-2">{errorMsg}</p>
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-[12px] font-bold text-white shadow-sm"
					style="background: var(--re)"
					onclick={loadData}
				>
					Coba Lagi
				</button>
			</div>
		{:else if filtered.length === 0}
			<div class="text-center py-16 px-4 rounded-2xl border border-dashed my-2" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="w-14 h-14 rounded-2xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center mx-auto mb-3 shadow-xs">
					<IconUserSearch size={30} />
				</div>
				<p class="text-[15px] font-black" style="color: var(--sys-label)">
					{searchQuery ? 'Tidak ada lead yang cocok dengan pencarian.' : 'Belum ada lead di tahap ini.'}
				</p>
				<p class="text-[12px] mt-1 mb-5 max-w-md mx-auto" style="color: var(--sys-label3)">
					Mulai dengan menambah calon pelanggan baru, atau tarik langsung pesan masuk dari WhatsApp &amp; Omnichannel.
				</p>
				<div class="flex items-center justify-center gap-2.5 flex-wrap">
					<button
						type="button"
						class="px-4 py-2.5 rounded-xl text-[12px] font-bold text-white inline-flex items-center gap-1.5 shadow-sm shadow-[var(--p,var(--g))]/30 active:scale-95 transition-transform"
						style="background: var(--p, var(--g))"
						onclick={() => goto('/sales/prospek/baru')}
					>
						<IconPlus size={15} stroke={2.5} /> Lead Baru Manual
					</button>
					<button
						type="button"
						class="px-4 py-2.5 rounded-xl text-[12px] font-bold border inline-flex items-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 active:scale-95 transition-all"
						style="border-color: rgba(16, 185, 129, 0.4); background: var(--sys-bg)"
						onclick={openOmniPullModal}
					>
						<IconBrandWhatsapp size={16} class="text-emerald-600 dark:text-emerald-400" />
						<span>Tarik Chat Omnichannel</span>
					</button>
				</div>
			</div>
		{:else if viewMode === 'list'}
			<!-- ================= LIST VIEW ================= -->
			<div class="flex flex-col gap-3">
				{#each filtered as p (p.id)}
					{@const priority = priorityBadge(p.priority || 'medium')}
					{@const fuStatus = getFollowUpStatus(p.next_follow_up)}
					{@const avatarColor = getAvatarColor(p.company || p.name || 'Lead')}
					{@const initials = getInitials(p.name || p.company || 'LD')}
					{@const chBadge = channelBadge(p.omni_channel || p.source_channel)}
					{@const picName = p.display_assigned_name || resolveSalesDisplayName(p.assigned_name)}
					{@const bdg = pipelineBadges.get(p.id)}

					<div
						role="button"
						tabindex="0"
						class="text-left rounded-2xl border p-4 w-full shadow-xs transition-all hover:shadow-md hover:border-[var(--p,var(--g))] active:scale-[0.99] cursor-pointer"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
						onclick={() => goto(`/sales/prospek/${p.id}`)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								goto(`/sales/prospek/${p.id}`);
							}
						}}
					>
						<!-- Top Row: Avatar, Name/Company, Channel Badge, Stage & Priority -->
						<div class="flex items-start gap-3">
							<div class="w-11 h-11 rounded-xl {avatarColor} flex items-center justify-center font-extrabold text-[14px] shrink-0 shadow-xs">
								{initials}
							</div>

							<div class="min-w-0 flex-1">
								<div class="flex items-start justify-between gap-2 flex-wrap">
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2 flex-wrap">
											<p class="text-[14px] font-black truncate leading-tight" style="color: var(--sys-label)">
												{p.name || p.company || 'Lead Tanpa Nama'}
											</p>

											{#if chBadge}
												{@const ChIcon = chBadge.icon}
												<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border {chBadge.bg}">
													<ChIcon size={11} />
													<span>{chBadge.label}</span>
												</span>
											{/if}
										</div>

										{#if p.company && p.name}
											<p class="text-[12px] font-semibold truncate flex items-center gap-1 mt-0.5" style="color: var(--sys-label2)">
												<IconBuildingStore size={13} class="shrink-0 opacity-70" />
												<span class="truncate">{p.company}</span>
											</p>
										{/if}
									</div>

									<div class="flex items-center gap-1.5 shrink-0">
										<!-- Priority Badge -->
										<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border {priority.bg}">
											<span class="w-1.5 h-1.5 rounded-full {priority.dot}"></span>
											{priority.label}
										</span>
										<!-- Stage Badge -->
										<span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full" style={stageStyle(p.stage)}>
											{stageLabel(p.stage)}
										</span>
									</div>
								</div>

								<!-- Middle Meta: Quoted Amount, Sales Rep, Next Follow-up -->
								<div class="flex items-center flex-wrap gap-x-3 gap-y-1.5 mt-2 text-[11px]" style="color: var(--sys-label3)">
									{#if p.quoted_amount}
										<span class="font-extrabold text-[13px] text-emerald-600 dark:text-emerald-400">
											{formatRupiah(p.quoted_amount)}
										</span>
									{/if}

									{#if picName}
										<span class="flex items-center gap-1 font-semibold px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5" style="color: var(--sys-label2)">
											<IconUser size={12} class="text-[var(--p,var(--g))]" /> {picName}
										</span>
									{/if}

									<!-- Next Follow-up alert badge -->
									<span class="flex items-center gap-1 {fuStatus.color}">
										<IconClock size={12} />
										<span>{fuStatus.text}</span>
									</span>

									{#if p.follow_up_count && p.follow_up_count > 0}
										<span class="text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold">
											{p.follow_up_count} follow-up
										</span>
									{/if}
								</div>

								<!-- Lifecycle Quotation → SO (CRM Sharpening Fase 4, read-only) -->
								{#if bdg && (bdg.qCount > 0 || bdg.soId)}
									<div class="flex items-center flex-wrap gap-1.5 mt-1.5">
										{#if bdg.qCount > 0}
											<span class="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20">
												📄 {bdg.qCount} penawaran{bdg.qAccepted > 0 ? ` · ${bdg.qAccepted} diterima` : ''}
											</span>
										{/if}
										{#if bdg.soId}
											<a
												href={`/sales/po/${bdg.soId}`}
												onclick={(e) => e.stopPropagation()}
												class="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20 hover:underline"
											>
												📦 SO {bdg.soNomor || `#${bdg.soId}`}{bdg.soStatus ? ` · ${bdg.soStatus}` : ''} ↗
											</a>
										{:else if bdg.qAccepted > 0}
											<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-300">
												Penawaran diterima — menunggu SO
											</span>
										{/if}
									</div>
								{/if}

								<!-- Latest Follow-up note or Inbound chat note snippet -->
								{#if p.latest_follow_up?.notes}
									<div class="mt-2 text-[11px] p-2 rounded-lg border bg-black/[0.02] dark:bg-white/[0.02] italic truncate" style="border-color: var(--sys-sep); color: var(--sys-label2)">
										<span class="font-bold not-italic" style="color: var(--sys-label)">Follow-up:</span> "{p.latest_follow_up.notes}"
									</div>
								{:else if p.notes}
									<div class="mt-2 text-[11px] p-2 rounded-lg border bg-black/[0.02] dark:bg-white/[0.02] italic truncate" style="border-color: var(--sys-sep); color: var(--sys-label2)">
										<span class="font-bold not-italic" style="color: var(--sys-label)">Catatan:</span> "{p.notes}"
									</div>
								{/if}
							</div>
						</div>

						<!-- Bottom Action Bar: WhatsApp, Telepon, Chat Omnichannel, Follow-up, Stage Selector -->
						<div class="flex flex-wrap items-center justify-between gap-2 mt-3 pt-2.5 border-t" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-1.5 flex-wrap">
								{#if p.phone}
									{@const waNumber = cleanWaPhone(p.phone)}
									<a
										href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo ${p.name || p.company || ''}, perkenalkan saya ${$authStore.karyawanName || 'Sales Rep'} dari PT Eltama Prima Indo. Ingin follow-up terkait kebutuhan coating & perlindungan korosi Anda.`)}`}
										target="_blank"
										rel="noopener noreferrer"
										class="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 flex items-center gap-1 transition-colors"
										onclick={(e) => e.stopPropagation()}
									>
										<IconBrandWhatsapp size={14} /> WA Chat
									</a>
									<a
										href={`tel:${p.phone}`}
										class="h-8 px-2.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
										style="border-color: var(--sys-sep); color: var(--sys-label)"
										onclick={(e) => e.stopPropagation()}
									>
										<IconPhone size={13} /> Telp
									</a>
								{/if}

								<!-- View Chat History Trigger -->
								<button
									type="button"
									class="h-8 px-2.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1 hover:bg-teal-500/10 text-teal-700 dark:text-teal-300 transition-colors"
									style="border-color: rgba(20, 184, 166, 0.4)"
									onclick={(e) => openChatHistory(p, e)}
									title="Lihat Riwayat Chat Omnichannel"
								>
									<IconMessageCircle size={13} /> Chat Log
								</button>

								<button
									type="button"
									class="h-8 px-2.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									onclick={(e) => openFollowUpModal(p, e)}
								>
									<IconMessageDots size={13} /> + Follow-up
								</button>
							</div>

							<div class="flex items-center gap-2 ml-auto">
								<!-- Quick Stage Switcher -->
								<select
									class="h-8 px-2 rounded-lg border text-[10px] font-bold outline-hidden transition-colors"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									value={p.stage}
									disabled={updatingStageId === p.id}
									onclick={(e) => e.stopPropagation()}
									onchange={(e) => handleQuickStageChange(p, e.currentTarget.value as ProspectStage, e)}
								>
									{#each PROSPECT_STAGES as s}
										<option value={s.value}>Pindah: {s.label}</option>
									{/each}
								</select>

								<button
									type="button"
									class="h-8 px-2.5 rounded-xl text-[11px] font-bold text-white flex items-center gap-1 shadow-xs transition-transform active:scale-95"
									style="background: var(--p, var(--g))"
									onclick={(e) => {
										e.stopPropagation();
										goto(`/sales/prospek/${p.id}`);
									}}
								>
									<span>Detail</span>
									<IconChevronRight size={12} stroke={2.5} />
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<!-- ================= KANBAN BOARD VIEW ================= -->
			<div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-start overflow-x-auto pb-4">
				{#each PROSPECT_STAGES as stage (stage.value)}
					{@const stageList = filtered.filter((p) => p.stage === stage.value)}
					{@const stageTotalRp = stageList.reduce((sum, p) => sum + (Number(p.quoted_amount) || 0), 0)}

					<div class="rounded-2xl border p-2.5 flex flex-col gap-2 min-w-[230px]" style="border-color: var(--sys-sep); background: var(--sys-fill)">
						<!-- Column Header -->
						<div class="flex items-center justify-between pb-2 border-b" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-1.5">
								<span class="text-[12px] font-extrabold" style="color: var(--sys-label)">{stage.label}</span>
								<span class="text-[10px] font-black px-1.5 py-0.2 rounded-full" style={stageStyle(stage.value)}>
									{stageList.length}
								</span>
							</div>
							{#if stageTotalRp > 0}
								<span class="text-[10px] font-bold truncate text-emerald-600 dark:text-emerald-400" title={formatRupiah(stageTotalRp)}>
									{formatShortRupiah(stageTotalRp)}
								</span>
							{/if}
						</div>

						<!-- Kanban Cards -->
						{#if stageList.length === 0}
							<div class="py-6 text-center text-[11px] italic" style="color: var(--sys-label4)">
								Kosong
							</div>
						{:else}
							<div class="flex flex-col gap-2">
								{#each stageList as p (p.id)}
									{@const priority = priorityBadge(p.priority || 'medium')}
									{@const fuStatus = getFollowUpStatus(p.next_follow_up)}
									{@const chBadge = channelBadge(p.omni_channel || p.source_channel)}
									{@const picName = p.display_assigned_name || resolveSalesDisplayName(p.assigned_name)}

									<div
										role="button"
										tabindex="0"
										class="rounded-xl border p-2.5 text-left shadow-xs transition-all hover:border-[var(--p,var(--g))] hover:shadow-sm cursor-pointer"
										style="border-color: var(--sys-sep); background: var(--sys-bg)"
										onclick={() => goto(`/sales/prospek/${p.id}`)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												goto(`/sales/prospek/${p.id}`);
											}
										}}
									>
										<!-- Priority, Channel & Deal Value -->
										<div class="flex items-center justify-between gap-1 mb-1.5">
											<div class="flex items-center gap-1">
												<span class="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.2 rounded {priority.bg}">
													<span class="w-1.5 h-1.5 rounded-full {priority.dot}"></span>
													{priority.label}
												</span>
												{#if chBadge}
													{@const ChIcon = chBadge.icon}
													<span class="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded-full {chBadge.bg}">
														<ChIcon size={10} />
													</span>
												{/if}
											</div>

											{#if p.quoted_amount}
												<span class="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
													{formatShortRupiah(p.quoted_amount)}
												</span>
											{/if}
										</div>

										<!-- Title -->
										<p class="text-[12px] font-bold truncate leading-tight" style="color: var(--sys-label)">
											{p.name || p.company || 'Lead'}
										</p>
										{#if p.company && p.name}
											<p class="text-[10px] font-medium truncate mt-0.5" style="color: var(--sys-label3)">
												{p.company}
											</p>
										{/if}

										<!-- Sales PIC badge -->
										<div class="flex items-center gap-1 text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 w-fit max-w-full" style="color: var(--sys-label2)">
											<IconUser size={11} class="text-[var(--p,var(--g))] shrink-0" />
											<span class="truncate">{picName}</span>
										</div>

										<!-- Follow-up tag -->
										<div class="mt-1.5 text-[10px] flex items-center gap-1 {fuStatus.color}">
											<IconClock size={11} />
											<span class="truncate">{fuStatus.text}</span>
										</div>

										<!-- Quick Actions -->
										<div class="flex items-center justify-between gap-1 mt-2.5 pt-2 border-t" style="border-color: var(--sys-sep)">
											<div class="flex items-center gap-1">
												{#if p.phone}
													{@const waNumber = cleanWaPhone(p.phone)}
													<a
														href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo ${p.name || ''}, saya ${$authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email) || 'Sales Rep'} dari PT Eltama Prima Indo...`)}`}
														target="_blank"
														rel="noopener noreferrer"
														class="p-1 rounded-md text-emerald-600 hover:bg-emerald-500/10"
														onclick={(e) => e.stopPropagation()}
														title="Kirim WhatsApp"
													>
														<IconBrandWhatsapp size={14} />
													</a>
												{/if}

												<button
													type="button"
													class="p-1 rounded-md text-teal-600 hover:bg-teal-500/10"
													onclick={(e) => openChatHistory(p, e)}
													title="Riwayat Chat"
												>
													<IconMessageCircle size={14} />
												</button>

												<button
													type="button"
													class="p-1 rounded-md text-blue-600 hover:bg-blue-500/10"
													onclick={(e) => openFollowUpModal(p, e)}
													title="Catat Follow-up"
												>
													<IconMessageDots size={14} />
												</button>
											</div>

											<!-- Advance stage dropdown -->
											<select
												class="h-6 px-1 rounded text-[9px] font-bold border ml-auto"
												style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
												value={p.stage}
												onclick={(e) => e.stopPropagation()}
												onchange={(e) => handleQuickStageChange(p, e.currentTarget.value as ProspectStage, e)}
											>
												{#each PROSPECT_STAGES as s}
													<option value={s.value}>→ {s.label}</option>
												{/each}
											</select>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- ================= MODAL TARIK DARI OMNICHANNEL ================= -->
{#if showOmniModal}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
		<div
			class="w-full max-w-2xl max-h-[90vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
			style="border-color: var(--sys-sep); background: var(--sys-bg)"
		>
			<!-- Modal Header -->
			<div class="p-4 border-b flex items-center justify-between" style="border-color: var(--sys-sep); background: linear-gradient(135deg, #0f766e 0%, #134e4a 100%);">
				<div class="flex items-center gap-2.5">
					<div class="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-teal-200">
						<IconBrandWhatsapp size={20} />
					</div>
					<div>
						<h2 class="text-[15px] font-black text-white leading-tight">Tarik Lead dari Omnichannel</h2>
						<p class="text-[11px] text-teal-200">Impor kontak percakapan masuk dari WhatsApp, IG, Webchat ke CRM Pipeline</p>
					</div>
				</div>
				<button
					type="button"
					class="p-1.5 rounded-lg text-teal-200 hover:text-white hover:bg-white/10 transition-colors"
					onclick={() => (showOmniModal = false)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Search & Channel Filter -->
			<div class="p-3 border-b flex flex-col gap-2.5 shrink-0" style="border-color: var(--sys-sep); background: var(--sys-fill)">
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
						<input
							type="text"
							placeholder="Cari nama, nomor HP, atau isi chat..."
							class="w-full h-9 pl-9 pr-3 rounded-xl border text-[12px] font-medium outline-hidden"
							style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
							bind:value={omniSearch}
							oninput={loadOmniContacts}
						/>
					</div>
					<button
						type="button"
						class="h-9 px-3 rounded-xl border text-[11px] font-bold flex items-center gap-1 transition-colors hover:bg-black/5"
						style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
						onclick={loadOmniContacts}
					>
						<IconRefresh size={13} class={omniLoading ? 'animate-spin' : ''} />
						<span>Cari</span>
					</button>
				</div>

				<div class="flex items-center justify-between flex-wrap gap-2">
					<!-- Channel Pills -->
					<div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
						{#each [
							{ id: 'all', label: 'Semua Channel' },
							{ id: 'WhatsApp', label: 'WhatsApp' },
							{ id: 'Instagram', label: 'Instagram' },
							{ id: 'Webchat', label: 'Webchat' }
						] as ch}
							<button
								type="button"
								class="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors {omniChannelFilter === ch.id
									? 'bg-teal-600 text-white'
									: 'border hover:bg-black/5 dark:hover:bg-white/5'}"
								style={omniChannelFilter !== ch.id ? 'border-color: var(--sys-sep); color: var(--sys-label2)' : ''}
								onclick={() => {
									omniChannelFilter = ch.id as any;
									loadOmniContacts();
								}}
							>
								{ch.label}
							</button>
						{/each}
					</div>

					<label class="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer select-none" style="color: var(--sys-label2)">
						<input
							type="checkbox"
							class="rounded text-teal-600"
							bind:checked={omniUnlinkedOnly}
							onchange={loadOmniContacts}
						/>
						<span>Hanya yang belum jadi Lead</span>
					</label>
				</div>
			</div>

			<!-- Contact List -->
			<div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-[260px]">
				{#if omniLoading}
					<div class="flex flex-col items-center justify-center py-16 gap-2">
						<IconLoader2 size={24} class="animate-spin text-teal-600" />
						<p class="text-[12px] font-medium" style="color: var(--sys-label3)">Mengambil percakapan masuk dari Omnichannel...</p>
					</div>
				{:else if omniContacts.length === 0}
					<div class="text-center py-14 px-4 rounded-xl border border-dashed my-auto" style="border-color: var(--sys-sep)">
						<IconInbox size={32} class="mx-auto mb-2 text-zinc-400" />
						<p class="text-[13px] font-bold" style="color: var(--sys-label)">Tidak ada kontak omnichannel ditemukan.</p>
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
							{omniUnlinkedOnly ? 'Semua kontak omnichannel saat ini sudah terhubung ke Pipeline CRM.' : 'Belum ada pesan masuk di kanal yang dipilih.'}
						</p>
					</div>
				{:else}
					{#each omniContacts as contact (contact.id)}
						{@const ch = channelBadge(contact.channel)}
						{@const isLinked = contact.prospect_id != null}

						<div class="rounded-xl border p-3 flex items-center justify-between gap-3 hover:border-teal-500/50 transition-all" style="border-color: var(--sys-sep); background: var(--sys-bg)">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="text-[13px] font-black truncate" style="color: var(--sys-label)">
										{contact.name || contact.phone || `Kontak #${contact.id}`}
									</p>

									{#if ch}
										{@const ChIcon = ch.icon}
										<span class="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.2 rounded border {ch.bg}">
											<ChIcon size={10} />
											<span>{ch.label}</span>
										</span>
									{/if}

									{#if isLinked}
										<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
											✓ Sudah di CRM
										</span>
									{/if}
								</div>

								<div class="flex items-center gap-3 text-[11px] mt-1 font-mono" style="color: var(--sys-label3)">
									{#if contact.phone}
										<span>📱 {contact.phone}</span>
									{/if}
									{#if contact.last_seen}
										<span class="font-sans text-[10px]">🕒 {contact.last_seen.split('T')[0]}</span>
									{/if}
								</div>

								{#if contact.last_message_preview}
									<p class="text-[11px] mt-1.5 text-zinc-600 dark:text-zinc-300 italic truncate line-clamp-1 bg-black/[0.02] dark:bg-white/[0.02] p-1.5 rounded-lg border" style="border-color: var(--sys-sep)">
										💬 "{contact.last_message_preview}"
									</p>
								{/if}
							</div>

							<div class="shrink-0 flex items-center gap-1.5">
								{#if isLinked}
									<button
										type="button"
										class="h-8 px-3 rounded-lg text-[11px] font-bold border hover:bg-black/5"
										style="border-color: var(--sys-sep); color: var(--sys-label)"
										onclick={() => {
											showOmniModal = false;
											goto(`/sales/prospek/${contact.prospect_id}`);
										}}
									>
										Lihat Lead
									</button>
								{:else}
									<button
										type="button"
										class="h-8 px-3 rounded-lg text-[11px] font-bold text-white bg-teal-600 hover:bg-teal-700 flex items-center gap-1 shadow-xs active:scale-95 transition-all"
										onclick={() => openConvertDialog(contact)}
									>
										<IconPlus size={13} stroke={2.5} />
										<span>Jadikan Lead</span>
									</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="p-3 border-t flex items-center justify-between text-[11px] shrink-0" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<span style="color: var(--sys-label3)">Ditemukan {omniContacts.length} kontak</span>
				<button
					type="button"
					class="px-4 py-1.5 rounded-xl border font-bold hover:bg-black/5"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (showOmniModal = false)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ================= MODAL QUICK CONVERT TO LEAD ================= -->
{#if showConvertDialog && selectedOmni}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
		<div
			class="w-full max-w-md rounded-2xl border p-5 shadow-2xl flex flex-col gap-3"
			style="border-color: var(--sys-sep); background: var(--sys-bg)"
		>
			<div class="flex items-center justify-between pb-2 border-b" style="border-color: var(--sys-sep)">
				<div>
					<h2 class="text-[15px] font-black" style="color: var(--sys-label)">Konversi ke Lead Pipeline</h2>
					<p class="text-[11px] text-teal-600 dark:text-teal-400 font-semibold">
						Channel: {selectedOmni.channel} • {selectedOmni.phone || selectedOmni.name}
					</p>
				</div>
				<button
					type="button"
					class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600"
					onclick={() => (showConvertDialog = false)}
				>
					<IconX size={16} />
				</button>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Nama Kontak / PIC *</label>
				<input
					class="w-full h-10 px-3 rounded-xl border text-[12px] font-semibold"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={selectedOmni.name}
				/>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Nama Perusahaan / Instansi</label>
				<input
					class="w-full h-10 px-3 rounded-xl border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					placeholder="cth. PT. Surya Mandiri"
					bind:value={convertCompanyName}
				/>
			</div>

			<div class="grid grid-cols-2 gap-2.5">
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Prioritas</label>
					<select
						class="w-full h-10 px-2 rounded-xl border text-[11px] font-semibold"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={convertPriority}
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
						placeholder="cth. 25000000"
						bind:value={convertQuotedAmount}
					/>
				</div>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Salesman (PIC Lead)</label>
				<div class="relative">
					<input
						list="convert-sales-options"
						class="w-full h-10 px-3 rounded-xl border text-[12px] font-semibold outline-hidden focus:border-teal-600"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="Pilih nama sales PIC..."
						bind:value={convertAssignee}
					/>
					<datalist id="convert-sales-options">
						{#each salesRepOptions as opt}
							<option value={opt.name}>{opt.name}</option>
						{/each}
					</datalist>
				</div>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Catatan Awal Lead</label>
				<textarea
					rows="2"
					class="w-full p-2 rounded-xl border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					placeholder="Ringkasan kebutuhan dari chat..."
					bind:value={convertNotes}
				></textarea>
			</div>

			{#if convertError}
				<p class="text-[11px] font-bold text-rose-600">{convertError}</p>
			{/if}

			<div class="flex items-center justify-end gap-2 pt-2 border-t" style="border-color: var(--sys-sep)">
				<button
					type="button"
					class="h-10 px-4 rounded-xl border text-[12px] font-bold hover:bg-black/5"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (showConvertDialog = false)}
				>
					Batal
				</button>
				<button
					type="button"
					class="h-10 px-5 rounded-xl text-[12px] font-bold text-white bg-teal-600 hover:bg-teal-700 flex items-center gap-2 shadow-sm disabled:opacity-50"
					disabled={convertSaving}
					onclick={handleExecuteConvert}
				>
					{#if convertSaving}
						<IconLoader2 size={15} class="animate-spin" />
					{/if}
					<span>Buat Lead di Pipeline</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ================= MODAL CHAT HISTORY VIEWER ================= -->
{#if showChatViewer && chatViewerProspect}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
		<div
			class="w-full max-w-lg max-h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
			style="border-color: var(--sys-sep); background: var(--sys-bg)"
		>
			<!-- Chat Header -->
			<div class="p-3.5 border-b flex items-center justify-between shrink-0" style="border-color: var(--sys-sep); background: #075E54;">
				<div class="flex items-center gap-2.5 text-white">
					<div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-[13px]">
						<IconBrandWhatsapp size={18} />
					</div>
					<div>
						<p class="text-[13px] font-black leading-tight">{chatViewerProspect.name || chatViewerProspect.company}</p>
						<p class="text-[10px] opacity-80 font-mono">{chatViewerProspect.phone || 'Riwayat Percakapan'}</p>
					</div>
				</div>
				<button
					type="button"
					class="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10"
					onclick={() => (showChatViewer = false)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Messages Stream -->
			<div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 min-h-[300px]" style="background: var(--sys-fill)">
				{#if chatViewerLoading}
					<div class="flex flex-col items-center justify-center py-20 gap-2">
						<IconLoader2 size={24} class="animate-spin text-teal-600" />
						<p class="text-[12px] font-medium" style="color: var(--sys-label3)">Mengambil riwayat percakapan...</p>
					</div>
				{:else if chatViewerMessages.length === 0}
					<div class="text-center py-16 px-4 rounded-xl border border-dashed my-auto" style="border-color: var(--sys-sep)">
						<IconMessageCircle size={32} class="mx-auto mb-2 text-zinc-400" />
						<p class="text-[13px] font-bold" style="color: var(--sys-label)">Belum ada log pesan tersimpan.</p>
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
							Anda dapat langsung memulai percakapan via WhatsApp menggunakan tombol di bawah.
						</p>
					</div>
				{:else}
					{#each chatViewerMessages as msg (msg.id)}
						{@const isOut = msg.direction === 'out'}
						<div class="flex flex-col {isOut ? 'items-end' : 'items-start'}">
							<div class="max-w-[82%] rounded-2xl p-3 shadow-xs text-[12px] leading-relaxed {isOut
								? 'bg-emerald-600 text-white rounded-tr-xs'
								: 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-tl-xs border border-zinc-200 dark:border-zinc-700'}">
								<div class="flex items-center justify-between gap-3 text-[9px] opacity-75 font-semibold mb-0.5">
									<span>{isOut ? (msg.sender_name || 'Sales') : (chatViewerProspect.name || 'Pelanggan')}</span>
									<span>{msg.timestamp ? msg.timestamp.split('T')[1]?.slice(0, 5) : ''}</span>
								</div>
								<p class="whitespace-pre-wrap">{msg.text}</p>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Chat Action Footer -->
			<div class="p-3 border-t flex items-center justify-between gap-2 shrink-0" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				{#if chatViewerProspect.phone}
					{@const waNumber = cleanWaPhone(chatViewerProspect.phone)}
					<a
						href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo ${chatViewerProspect.name || ''}, saya ${$authStore.karyawanName || 'Sales Rep'} dari PT Eltama Prima Indo. Melanjutkan percakapan kita...`)}`}
						target="_blank"
						rel="noopener noreferrer"
						class="h-9 px-4 rounded-xl text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5 shadow-xs"
					>
						<IconBrandWhatsapp size={16} />
						<span>Buka WhatsApp Web / App</span>
					</a>
				{/if}

				<button
					type="button"
					class="h-9 px-4 rounded-xl border text-[11px] font-bold hover:bg-black/5 ml-auto"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (showChatViewer = false)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ================= MODAL QUICK FOLLOW-UP ================= -->
{#if showFollowUpModal && modalProspect}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
		<div
			class="w-full max-w-md rounded-2xl border p-5 shadow-2xl flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150"
			style="border-color: var(--sys-sep); background: var(--sys-bg)"
		>
			<div class="flex items-center justify-between pb-2 border-b" style="border-color: var(--sys-sep)">
				<div>
					<h2 class="text-[15px] font-extrabold" style="color: var(--sys-label)">Catat Aktivitas Follow-up</h2>
					<p class="text-[11px] font-medium" style="color: var(--sys-label3)">
						{modalProspect.name || modalProspect.company}
					</p>
				</div>
				<button
					type="button"
					class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
					onclick={() => (showFollowUpModal = false)}
				>
					<IconX size={16} />
				</button>
			</div>

			<!-- Form Fields -->
			<div>
				<span class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Tipe Aktivitas</span>
				<div class="grid grid-cols-3 gap-1.5">
					{#each ACTIVITY_TYPES as act}
						<button
							type="button"
							class="h-9 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1 transition-all {fuType === act.value
								? 'bg-[var(--p,var(--g))] text-white border-[var(--p,var(--g))] shadow-xs'
								: 'hover:bg-black/5 dark:hover:bg-white/5'}"
							style={fuType !== act.value ? 'border-color: var(--sys-sep); color: var(--sys-label2)' : ''}
							onclick={() => (fuType = act.value)}
						>
							<span>{act.icon}</span>
							<span>{act.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label for="modal-fu-notes" class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Catatan Aktivitas *</label>
				<textarea
					id="modal-fu-notes"
					rows="3"
					placeholder="Tuliskan ringkasan pembicaraan / poin diskusi..."
					class="w-full p-2.5 rounded-xl border text-[12px] font-medium outline-hidden focus:border-[var(--p,var(--g))]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={fuNotes}
				></textarea>
			</div>

			<div>
				<label for="modal-fu-result" class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Hasil / Respon Prospek (Opsional)</label>
				<input
					id="modal-fu-result"
					type="text"
					placeholder="cth. Meminta dikirimkan penawaran harga coating"
					class="w-full h-10 px-3 rounded-xl border text-[12px] font-medium outline-hidden focus:border-[var(--p,var(--g))]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={fuResult}
				/>
			</div>

			<div>
				<label for="modal-fu-date" class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label)">Rencana Follow-up Berikutnya (Opsional)</label>
				<input
					id="modal-fu-date"
					type="date"
					class="w-full h-10 px-3 rounded-xl border text-[12px] font-medium outline-hidden focus:border-[var(--p,var(--g))]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={fuNextDate}
				/>
			</div>

			{#if fuError}
				<p class="text-[11px] font-bold text-rose-600">{fuError}</p>
			{/if}

			<!-- Modal Action Buttons -->
			<div class="flex items-center justify-end gap-2 pt-2 border-t" style="border-color: var(--sys-sep)">
				<button
					type="button"
					class="h-10 px-4 rounded-xl border text-[12px] font-bold hover:bg-black/5 dark:hover:bg-white/5"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (showFollowUpModal = false)}
				>
					Batal
				</button>
				<button
					type="button"
					class="h-10 px-5 rounded-xl text-[12px] font-bold text-white flex items-center gap-2 shadow-sm disabled:opacity-50"
					style="background: var(--p, var(--g))"
					disabled={fuSaving}
					onclick={handleSaveQuickFollowUp}
				>
					{#if fuSaving}
						<IconLoader2 size={15} class="animate-spin" />
					{/if}
					<span>Simpan Follow-up</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>

