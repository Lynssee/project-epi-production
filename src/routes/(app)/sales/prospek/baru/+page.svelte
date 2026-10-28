<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		createProspect,
		getCustomerOptions,
		getFieldSalesOptions,
		resolveSalesDisplayName,
		type CustomerOption,
		type SalesOption
	} from '$lib/services/sales';
	import {
		getOmniInboundLeads,
		linkOmniContactToProspect,
		type OmnichannelContact
	} from '$lib/services/omnichannel';
	import {
		IconArrowLeft,
		IconLoader2,
		IconSearch,
		IconX,
		IconBrandWhatsapp,
		IconBrandInstagram,
		IconWorld,
		IconBrandMessenger,
		IconUser,
		IconBuildingStore,
		IconCheck
	} from '@tabler/icons-svelte';

	let sourceMode = $state<'manual' | 'omnichannel'>('manual');
	let omniContactId = $state<number | null>(null);
	let channelType = $state<string>('');

	let name = $state('');
	let company = $state('');
	let phone = $state('');
	let email = $state('');
	let notes = $state('');
	let assignedSalesName = $state('');
	let salesRepOptions = $state<SalesOption[]>([]);
	let priority = $state<'low' | 'medium' | 'high'>('medium');
	let quotedAmount = $state<number | null>(null);
	let expectedClose = $state('');
	let saving = $state(false);
	let errorMsg = $state('');

	// Customer Search (for registered customer)
	let customerSearch = $state('');
	let customerOptions = $state<CustomerOption[]>([]);
	let selectedCustomer = $state<CustomerOption | null>(null);
	let searchTimer: ReturnType<typeof setTimeout>;

	// Omnichannel Contacts Picker
	let omniSearch = $state('');
	let omniList = $state<OmnichannelContact[]>([]);
	let omniLoading = $state(false);
	let selectedOmniContact = $state<OmnichannelContact | null>(null);

	let isSuperAdmin = $derived(
		$authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')
	);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			salesRepOptions = await getFieldSalesOptions();
		} catch (e) {
			console.warn('Gagal memuat list sales:', e);
		}

		if (!assignedSalesName) {
			assignedSalesName = $authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email) || 'Adit';
		}

		// Read URL query params if redirected from omnichannel
		const params = $page.url.searchParams;
		const qOmniId = params.get('omni_contact_id');
		const qName = params.get('name');
		const qPhone = params.get('phone');
		const qEmail = params.get('email');
		const qCompany = params.get('company');
		const qNotes = params.get('notes');
		const qChannel = params.get('channel');

		if (qOmniId) {
			omniContactId = Number(qOmniId);
			sourceMode = 'omnichannel';
		}
		if (qName) name = qName;
		if (qPhone) phone = qPhone;
		if (qEmail) email = qEmail;
		if (qCompany) company = qCompany;
		if (qChannel) channelType = qChannel;
		if (qNotes) {
			notes = qNotes;
		} else if (qChannel) {
			notes = `[Inbound ${qChannel}] Dikonversi dari percakapan ${qChannel}`;
		}
	});

	async function loadOmniList() {
		omniLoading = true;
		try {
			omniList = await getOmniInboundLeads({ search: omniSearch, unlinkedOnly: true, limit: 30 });
		} catch (e) {
			console.warn('Gagal memuat kontak omnichannel:', e);
		} finally {
			omniLoading = false;
		}
	}

	function selectOmniContact(c: OmnichannelContact) {
		selectedOmniContact = c;
		omniContactId = typeof c.id === 'number' ? c.id : parseInt(String(c.id).replace(/\D/g, ''), 10) || null;
		channelType = c.channel;
		if (!name) name = c.name || '';
		if (!phone) phone = c.phone || '';
		if (!company) company = c.name || '';
		if (!email && c.email) email = c.email;
		if (c.last_message_preview) {
			notes = `[Inbound ${c.channel}] "${c.last_message_preview}"`;
		} else {
			notes = `[Inbound ${c.channel}] Kontak chat masuk ${c.channel}`;
		}
	}

	function onCustomerSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (customerSearch.trim()) {
				customerOptions = await getCustomerOptions(customerSearch);
			} else {
				customerOptions = [];
			}
		}, 300);
	}

	function selectCustomer(c: CustomerOption) {
		selectedCustomer = c;
		company = c.customer_name;
		if (!name && (c.contact_person || c.pic_nama)) name = c.contact_person || c.pic_nama || '';
		if (!phone && (c.telp || c.telepon || c.pic_telepon)) phone = c.telp || c.telepon || c.pic_telepon || '';
		customerSearch = c.customer_name;
		customerOptions = [];
	}

	function getChannelBadge(ch: string) {
		const c = (ch || '').toLowerCase();
		if (c.includes('wa')) return { label: 'WhatsApp', icon: IconBrandWhatsapp, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
		if (c.includes('ig')) return { label: 'Instagram', icon: IconBrandInstagram, color: 'text-pink-600 bg-pink-50 border-pink-200' };
		if (c.includes('mess')) return { label: 'Messenger', icon: IconBrandMessenger, color: 'text-blue-600 bg-blue-50 border-blue-200' };
		return { label: 'Webchat', icon: IconWorld, color: 'text-sky-600 bg-sky-50 border-sky-200' };
	}

	async function handleSubmit() {
		if (saving) return;
		if (!name.trim() && !company.trim()) {
			errorMsg = 'Isi minimal Nama kontak atau Nama Perusahaan.';
			return;
		}
		const defaultSalesName = $authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email) || 'Adit';
		const salesName = resolveSalesDisplayName(assignedSalesName.trim() || defaultSalesName);

		saving = true;
		errorMsg = '';
		try {
			const prospect = await createProspect({
				name: name.trim(),
				company: company.trim() || name.trim(),
				phone: phone.trim(),
				email: email.trim(),
				notes: notes.trim(),
				assignedName: salesName,
				priority,
				quotedAmount: quotedAmount ? Number(quotedAmount) : null,
				expectedClose: expectedClose || null,
				customerId: selectedCustomer?.id || null
			});

			// Link omni_contact if specified
			if (omniContactId) {
				try {
					await linkOmniContactToProspect(omniContactId, prospect.id);
				} catch (linkErr) {
					console.warn('Gagal menautkan omni contact:', linkErr);
				}
			}

			goto(`/sales/prospek/${prospect.id}`);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan lead.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sales/prospek')}>
			<IconArrowLeft size={15} /> Kembali ke Pipeline
		</button>

		<h1 class="text-[19px] font-black mb-1" style="color: var(--sys-label)">Lead Baru</h1>
		<p class="text-[11px] mb-4 font-medium" style="color: var(--sys-label3)">
			Catat calon pelanggan baru ke dalam pipeline CRM sales tim PT Eltama Prima Indo.
		</p>

		<!-- Mode Sumber Lead: Manual vs Omnichannel -->
		<div class="grid grid-cols-2 gap-2 p-1 rounded-2xl border mb-4" style="border-color: var(--sys-sep); background: var(--sys-fill)">
			<button
				type="button"
				class="h-10 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all {sourceMode === 'manual'
					? 'bg-[var(--sys-bg)] text-[var(--sys-label)] shadow-xs'
					: 'text-[var(--sys-label3)] hover:text-[var(--sys-label)]'}"
				onclick={() => (sourceMode = 'manual')}
			>
				<IconBuildingStore size={16} />
				<span>Input Manual / Customer</span>
			</button>

			<button
				type="button"
				class="h-10 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all {sourceMode === 'omnichannel'
					? 'bg-teal-600 text-white shadow-xs'
					: 'text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30'}"
				onclick={() => {
					sourceMode = 'omnichannel';
					loadOmniList();
				}}
			>
				<IconBrandWhatsapp size={16} />
				<span>Tarik dari Omnichannel</span>
			</button>
		</div>

		<!-- Omnichannel Inbound Picker Box (if omnichannel mode active) -->
		{#if sourceMode === 'omnichannel'}
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: rgba(20, 184, 166, 0.4); background: var(--sys-bg)">
				<div class="flex items-center justify-between gap-2 mb-2.5">
					<div class="flex items-center gap-2">
						<span class="p-1 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
							<IconBrandWhatsapp size={16} />
						</span>
						<p class="text-[12px] font-bold" style="color: var(--sys-label)">Pilih Kontak Chat Masuk</p>
					</div>
					<button
						type="button"
						class="text-[11px] font-semibold text-teal-600 hover:underline"
						onclick={loadOmniList}
					>
						Muat Ulang
					</button>
				</div>

				<!-- Search omni -->
				<div class="relative mb-2.5">
					<IconSearch size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
					<input
						type="text"
						placeholder="Cari nama atau nomor kontak chat..."
						class="w-full h-9 pl-9 pr-3 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={omniSearch}
						oninput={loadOmniList}
					/>
				</div>

				{#if omniLoading}
					<div class="py-6 flex items-center justify-center gap-2 text-[12px] text-zinc-400">
						<IconLoader2 size={16} class="animate-spin text-teal-600" />
						<span>Memuat kontak omnichannel...</span>
					</div>
				{:else if omniList.length === 0}
					<p class="text-[11px] text-center py-4 italic text-zinc-400">Tidak ada kontak chat baru yang belum ditautkan.</p>
				{:else}
					<div class="max-h-48 overflow-y-auto flex flex-col gap-1.5 pr-1">
						{#each omniList as c (c.id)}
							{@const badge = getChannelBadge(c.channel)}
							{@const isSel = selectedOmniContact?.id === c.id}
							{@const BIcon = badge.icon}

							<button
								type="button"
								class="w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 {isSel
									? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/20 shadow-xs'
									: 'hover:border-zinc-400 dark:hover:border-zinc-600'}"
								style={!isSel ? 'border-color: var(--sys-sep); background: var(--sys-fill)' : ''}
								onclick={() => selectOmniContact(c)}
							>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span class="text-[12px] font-bold truncate" style="color: var(--sys-label)">{c.name || c.phone}</span>
										<span class="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.2 rounded border {badge.color}">
											<BIcon size={10} />
											<span>{badge.label}</span>
										</span>
									</div>
									<p class="text-[10px] font-mono opacity-70 truncate mt-0.5">{c.phone || c.identifier}</p>
									{#if c.last_message_preview}
										<p class="text-[10px] italic opacity-80 truncate mt-0.5">"{c.last_message_preview}"</p>
									{/if}
								</div>

								{#if isSel}
									<span class="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
										<IconCheck size={14} stroke={3} />
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Main Lead Form -->
		<div class="rounded-2xl border p-4 shadow-sm flex flex-col gap-3.5" style="border-color: var(--sys-sep); background: var(--sys-bg)">
			<!-- Customer Autocomplete / Picker -->
			<div class="relative">
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Perusahaan / Instansi Customer *</label>
				<div class="relative">
					<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
					<input
						class="w-full h-11 pl-9 pr-3 rounded-xl border text-[13px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="Pilih customer terdaftar atau ketik nama perusahaan..."
						bind:value={company}
						oninput={() => {
							customerSearch = company;
							onCustomerSearch();
						}}
					/>
				</div>
				{#if customerOptions.length > 0}
					<div class="absolute z-20 w-full mt-1 rounded-xl border bg-white dark:bg-zinc-900 shadow-xl max-h-56 overflow-y-auto" style="border-color: var(--sys-sep)">
						{#each customerOptions as c (c.id)}
							<button
								type="button"
								class="w-full text-left px-3.5 py-2.5 text-[12px] hover:bg-black/5 border-b last:border-b-0 flex items-center justify-between"
								style="border-color: var(--sys-sep)"
								onclick={() => selectCustomer(c)}
							>
								<span class="font-bold" style="color: var(--sys-label)">{c.customer_name}</span>
								<span class="text-[10px] font-mono opacity-70">{c.kode_customer}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Nama Kontak PIC (Person in Charge) *</label>
				<input
					class="w-full h-11 px-3 rounded-xl border text-[13px] font-semibold"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					placeholder="cth. Bpk. Hendra Pratama"
					bind:value={name}
				/>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">No. WhatsApp / HP</label>
					<input
						class="w-full h-11 px-3 rounded-xl border text-[13px] font-mono"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="08xxxxxxxxxx"
						bind:value={phone}
					/>
				</div>
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Email (opsional)</label>
					<input
						type="email"
						class="w-full h-11 px-3 rounded-xl border text-[13px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="email@perusahaan.com"
						bind:value={email}
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Tingkat Prioritas</label>
					<div class="grid grid-cols-3 gap-1.5">
						<button
							type="button"
							class="h-10 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1 transition-all {priority === 'high'
								? 'bg-rose-500 text-white border-rose-500 shadow-xs'
								: 'hover:bg-black/5 dark:hover:bg-white/5'}"
							style={priority !== 'high' ? 'border-color: var(--sys-sep); color: var(--sys-label2)' : ''}
							onclick={() => (priority = 'high')}
						>
							<span>🔴</span> Tinggi
						</button>
						<button
							type="button"
							class="h-10 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1 transition-all {priority === 'medium'
								? 'bg-amber-500 text-white border-amber-500 shadow-xs'
								: 'hover:bg-black/5 dark:hover:bg-white/5'}"
							style={priority !== 'medium' ? 'border-color: var(--sys-sep); color: var(--sys-label2)' : ''}
							onclick={() => (priority = 'medium')}
						>
							<span>🟡</span> Sedang
						</button>
						<button
							type="button"
							class="h-10 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1 transition-all {priority === 'low'
								? 'bg-slate-600 text-white border-slate-600 shadow-xs'
								: 'hover:bg-black/5 dark:hover:bg-white/5'}"
							style={priority !== 'low' ? 'border-color: var(--sys-sep); color: var(--sys-label2)' : ''}
							onclick={() => (priority = 'low')}
						>
							<span>⚪</span> Rendah
						</button>
					</div>
				</div>

				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Estimasi Nilai Deal (Rp, opsional)</label>
					<input
						type="number"
						class="w-full h-10 px-3 rounded-xl border text-[13px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="cth. 50000000"
						bind:value={quotedAmount}
					/>
				</div>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Target Tanggal Closing (opsional)</label>
				<input
					type="date"
					class="w-full h-10 px-3 rounded-xl border text-[13px] font-medium"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={expectedClose}
				/>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Salesman (PIC Lead)</label>
				<div class="relative">
					<input
						list="sales-rep-options-list"
						class="w-full h-11 px-3 rounded-xl border text-[13px] font-semibold outline-hidden focus:border-[var(--p,var(--g))]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						placeholder="Pilih atau ketik nama Sales PIC..."
						bind:value={assignedSalesName}
					/>
					<datalist id="sales-rep-options-list">
						{#each salesRepOptions as opt}
							<option value={opt.name}>{opt.name}</option>
						{/each}
					</datalist>
				</div>
			</div>

			<div>
				<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Catatan &amp; Kebutuhan Awal</label>
				<textarea
					class="w-full rounded-xl border text-[13px] p-2.5"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					rows="3"
					placeholder="Kebutuhan jasa sandblasting / coating epoxy / lantai, volume estimasi, dll."
					bind:value={notes}
				></textarea>
			</div>

			{#if errorMsg}
				<p class="text-[12px] font-semibold" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				type="button"
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 transition-transform active:scale-[0.99] mt-2"
				style="background: var(--p, var(--g))"
				disabled={saving}
				onclick={handleSubmit}
			>
				{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
				Simpan Lead ke Pipeline
			</button>
		</div>
	</div>
</div>

