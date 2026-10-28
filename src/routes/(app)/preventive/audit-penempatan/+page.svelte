<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getOperatorEquipment, COMPRESSOR_CATEGORY_IDS } from '$lib/services/preventive';
	import { fetchActiveLoanMapForEquipment, registerCompressorPlacement, type LoanRow } from '$lib/services/loanChecklist';
	import { getAllKaryawan, type Karyawan } from '$lib/services/karyawan';
	import { getProjects } from '$lib/services/projects';
	import IconArrowLeft from '@tabler/icons-svelte/icons/arrow-left';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconMapPin from '@tabler/icons-svelte/icons/map-pin';
	import IconCircleCheck from '@tabler/icons-svelte/icons/circle-check';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconSearch from '@tabler/icons-svelte/icons/search';

	// Fase 0 (audit fisik) — daftar cepat "compressor X ada di proyek Y, PIC Z" saat
	// GA/maintenance jalan ke lapangan tempel QR. Lihat "Rencana Implementasi - PM
	// Compressor & Sanksi Berjenjang.pdf" Fase 0. Menulis ke internal_loan_log, yang
	// jadi sumber generator kepatuhan Fase 2 (/api/automation/compressor-compliance).

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_preventive', roles)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let equipmentList = $state<any[]>([]);
	let loanMap = $state<Record<string, LoanRow>>({});
	let karyawanList = $state<Karyawan[]>([]);
	let projectList = $state<any[]>([]);
	let searchQuery = $state('');

	let registeringId = $state<string | null>(null);
	let saving = $state(false);
	let formProjectId = $state<number | ''>('');
	let karyawanSearch = $state('');
	let formPicId = $state<number | ''>('');
	let errorMsg = $state('');

	async function loadAll() {
		loading = true;
		const [equipment, karyawan, projects] = await Promise.all([
			getOperatorEquipment({ categoryIds: COMPRESSOR_CATEGORY_IDS }),
			getAllKaryawan(),
			getProjects(null, true, null, { sort: 'name', limit: 500 })
		]);
		equipmentList = equipment;
		karyawanList = karyawan;
		projectList = Array.isArray(projects) ? projects : (projects as any)?.data || [];
		loanMap = await fetchActiveLoanMapForEquipment(equipment.map((e: any) => e.id));
		loading = false;
	}

	onMount(loadAll);

	let filteredEquipment = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return equipmentList;
		return equipmentList.filter(
			(e) => e.name?.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q)
		);
	});

	let terdaftar = $derived(filteredEquipment.filter((e) => loanMap[e.id]));
	let belumTerdaftar = $derived(filteredEquipment.filter((e) => !loanMap[e.id]));

	let filteredKaryawan = $derived.by(() => {
		const q = karyawanSearch.toLowerCase().trim();
		if (!q) return karyawanList.slice(0, 20);
		return karyawanList.filter((k) => k.nama_karyawan?.toLowerCase().includes(q)).slice(0, 20);
	});

	function openRegister(equipmentId: string) {
		registeringId = equipmentId;
		formProjectId = '';
		formPicId = '';
		karyawanSearch = '';
		errorMsg = '';
	}

	function closeRegister() {
		registeringId = null;
	}

	async function handleRegister() {
		if (!registeringId || !formProjectId || !formPicId) {
			errorMsg = 'Pilih proyek dan PIC dulu.';
			return;
		}
		saving = true;
		errorMsg = '';
		try {
			const loan = await registerCompressorPlacement({
				equipmentId: registeringId,
				projectId: Number(formProjectId),
				picId: Number(formPicId)
			});
			loanMap = { ...loanMap, [registeringId]: loan };
			registeringId = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan registrasi.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/preventive')}>
			<IconArrowLeft size={15} /> Kembali
		</button>

		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Audit Penempatan Compressor</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
			Fase 0 — catat compressor mana sedang di proyek mana &amp; siapa PIC-nya sambil jalan tempel QR di lapangan.
		</p>

		<div class="relative mb-4">
			<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
			<input
				type="text"
				placeholder="Cari nama atau kode unit..."
				bind:value={searchQuery}
				class="w-full pl-9 pr-3 py-2.5 rounded-lg border text-[13px] outline-none"
				style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff); color: var(--sys-label)"
			/>
		</div>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat audit penempatan unit..." />
		</div>
		{:else}
			<p class="text-[11px] font-semibold mb-2" style="color: var(--sys-label3)">
				Belum terdaftar ({belumTerdaftar.length})
			</p>
			<div class="flex flex-col gap-2 mb-6">
				{#each belumTerdaftar as eq (eq.id)}
					<div class="rounded-xl border p-3 flex items-center justify-between gap-2" style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)">
						<div class="min-w-0 space-y-0.5">
							<div class="flex items-center gap-1.5 flex-wrap">
								<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{eq.name}</p>
								{#if eq.ownership_type === 'subcon'}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
										👷 Subcon: {eq.owner_name || 'Subcon'}
									</span>
								{:else if eq.ownership_type === 'customer'}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
										🤝 Customer: {eq.owner_name || 'Customer'}
									</span>
								{:else if eq.ownership_type === 'sewa_vendor'}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
										🔶 Sewa Vendor
									</span>
								{:else}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
										🏢 Eltama
									</span>
								{/if}
							</div>
							<p class="text-[11px]" style="color: var(--sys-label3)">{eq.code || '-'}</p>
						</div>
						<button
							class="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
							style="background: var(--g)"
							onclick={() => openRegister(eq.id)}
						>
							Daftarkan
						</button>
					</div>
				{:else}
					<p class="text-[12px] py-4 text-center" style="color: var(--sys-label4)">Semua unit sudah terdaftar 🎉</p>
				{/each}
			</div>

			<p class="text-[11px] font-semibold mb-2" style="color: var(--sys-label3)">
				Sudah terdaftar ({terdaftar.length})
			</p>
			<div class="flex flex-col gap-2">
				{#each terdaftar as eq (eq.id)}
					{@const loan = loanMap[eq.id]}
					<div class="rounded-xl border p-3 space-y-1" style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2 min-w-0 flex-wrap">
								<IconCircleCheck size={14} style="color: #16A34A" />
								<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{eq.name}</p>
								{#if eq.ownership_type === 'subcon'}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
										👷 Subcon: {eq.owner_name || 'Subcon'}
									</span>
								{:else if eq.ownership_type === 'customer'}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
										🤝 Customer: {eq.owner_name || 'Customer'}
									</span>
								{:else if eq.ownership_type === 'sewa_vendor'}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
										🔶 Sewa Vendor
									</span>
								{:else}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
										🏢 Eltama
									</span>
								{/if}
							</div>
							{#if eq.code}
								<span class="text-[10px] text-gray-400 font-mono">{eq.code}</span>
							{/if}
						</div>
						<p class="text-[11px] flex items-center gap-1" style="color: var(--sys-label3)">
							<IconMapPin size={12} />
							{(loan.equipment as any)?.name ? '' : ''}{(loan as any).project_id?.name || 'Proyek #' + loan.project_id} · PIC {(loan as any).pic_id?.nama_karyawan || '#' + loan.pic_id}
						</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if registeringId}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50">
		<div class="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto" style="background: var(--sys-bg-secondary, #fff)">
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Daftarkan Penempatan</h3>
				<button onclick={closeRegister} style="color: var(--sys-label3)"><IconX size={18} /></button>
			</div>

			<label class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)" for="proj">Proyek</label>
			<select
				id="proj"
				bind:value={formProjectId}
				class="w-full mb-3 px-3 py-2.5 rounded-lg border text-[13px]"
				style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
			>
				<option value="">Pilih proyek...</option>
				{#each projectList as p}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>

			<label class="block text-[11px] font-semibold mb-1.5" style="color: var(--sys-label2)" for="pic">PIC (Operator Penanggung Jawab)</label>
			<input
				id="pic"
				type="text"
				placeholder="Cari nama karyawan..."
				bind:value={karyawanSearch}
				class="w-full mb-2 px-3 py-2.5 rounded-lg border text-[13px]"
				style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
			/>
			<div class="max-h-40 overflow-y-auto rounded-lg border mb-3" style="border-color: var(--sys-sep)">
				{#each filteredKaryawan as k (k.id)}
					<button
						type="button"
						class="w-full text-left px-3 py-2 text-[12px] border-b last:border-0"
						style="border-color: var(--sys-sep); background: {formPicId === k.id ? 'var(--gl)' : 'transparent'}; color: var(--sys-label)"
						onclick={() => (formPicId = k.id)}
					>
						{k.nama_karyawan} {formPicId === k.id ? '✓' : ''}
					</button>
				{:else}
					<p class="text-[11px] p-2" style="color: var(--sys-label4)">Tidak ketemu.</p>
				{/each}
			</div>

			{#if errorMsg}
				<p class="text-[12px] mb-2" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--g)"
				disabled={saving || !formProjectId || !formPicId}
				onclick={handleRegister}
			>
				{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
				Simpan Registrasi
			</button>
		</div>
	</div>
{/if}
