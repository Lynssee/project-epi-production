<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { resolveOperatorId } from '$lib/services/preventive';
	import { getMyTickets, type SupportTicketRow } from '$lib/services/support';
	import { IconHeadset, IconPlus, IconChevronRight, IconLoader2, IconClock } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let tickets = $state<SupportTicketRow[]>([]);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_support', roles)) {
			goto('/');
		}
	});

	function verifikasiBadge(v: string) {
		if (v === 'Ditolak') return { bg: 'var(--rel)', color: 'var(--red)', label: 'Ditolak' };
		if (v === 'Terverifikasi') return { bg: 'var(--gg)', color: 'var(--ggd)', label: 'Terverifikasi' };
		return { bg: 'var(--aml)', color: 'var(--amd)', label: 'Menunggu Verifikasi' };
	}

	function statusBadge(status: string) {
		const map: Record<string, { bg: string; color: string }> = {
			'Open': { bg: 'var(--pl)', color: 'var(--pd)' },
			'In Progress': { bg: '#DBEAFE', color: '#1D4ED8' },
			'Resolved': { bg: 'var(--gg)', color: 'var(--ggd)' },
			'Closed': { bg: 'var(--sys-fill)', color: 'var(--sys-label3)' },
			'Cancelled': { bg: 'var(--rel)', color: 'var(--red)' }
		};
		return map[status] || { bg: 'var(--sys-fill)', color: 'var(--sys-label3)' };
	}

	function umurHari(tanggal: string) {
		const diff = Date.now() - new Date(tanggal).getTime();
		return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
	}

	onMount(async () => {
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama pelapor tidak ditemukan di sesi login.');
			const personnelId = await resolveOperatorId(karyawanName);
			tickets = await getMyTickets(personnelId);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat tiket support.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="w-full lg:max-w-none max-w-7xl mx-auto p-4 md:p-6 pb-24">
	<div class="flex items-start justify-between mb-1">
		<div>
			<h1 class="text-[18px] md:text-xl font-bold" style="color: var(--sys-label)">Tiket Saya</h1>
			<p class="text-[12px] md:text-[14px]" style="color: var(--sys-label3)">Komplain, permintaan, atau kendala yang Anda laporkan</p>
		</div>
	</div>

	<button
		class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 mt-4 mb-5"
		style="background: var(--p, #1F6592)"
		onclick={() => goto('/support/baru')}
	>
		<IconPlus size={18} /> Tiket Baru
	</button>

	{#if loading}
		<div class="py-16 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Tiket Kendala..." sublabel="Sinkronisasi tiket support lokasi" />
		</div>
	{:else if errorMsg}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if tickets.length === 0}
		<div class="text-center py-16">
			<IconHeadset size={32} style="color: var(--sys-label4); margin: 0 auto" />
			<p class="text-[13px] mt-3" style="color: var(--sys-label3)">Belum ada tiket yang Anda laporkan.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
			{#each tickets as t (t.id)}
				{@const vBadge = verifikasiBadge(t.verifikasi_status)}
				{@const sBadge = statusBadge(t.status)}
				<div
					class="w-full text-left rounded-xl border p-3.5 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5 active:opacity-70"
					style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)"
					role="button"
					tabindex="0"
					onclick={() => goto(`/support/${t.id}`)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') goto(`/support/${t.id}`); }}
				>
					<div class="flex items-start gap-3">
						<div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--gl)">
							<IconHeadset size={18} style="color: var(--g)" />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-[11px] font-semibold" style="color: var(--sys-label4)">{t.nomor_tiket}</p>
							<p class="text-[13px] font-semibold truncate mt-0.5" style="color: var(--sys-label)">{t.judul}</p>
							<p class="text-[12px] mt-0.5 line-clamp-2" style="color: var(--sys-label3)">{t.deskripsi}</p>
							<div class="flex items-center gap-2 mt-2 flex-wrap">
								<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:{vBadge.bg}; color:{vBadge.color}">{vBadge.label}</span>
								{#if t.verifikasi_status === 'Terverifikasi'}
									<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:{sBadge.bg}; color:{sBadge.color}">{t.status}</span>
								{/if}
								<span class="inline-flex items-center gap-1 text-[10px]" style="color: var(--sys-label4)">
									<IconClock size={11} /> {umurHari(t.tanggal)} hari
								</span>
							</div>
						</div>
						<IconChevronRight size={16} style="color: var(--sys-label4)" />
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
