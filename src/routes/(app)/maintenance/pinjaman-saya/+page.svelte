<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		fetchActiveLoansForKaryawan,
		fetchActivePeminjamanInternalForKaryawan,
		fetchLoansAwaitingSerahTerima,
		hasTodayDailyChecklist,
		type LoanRow
	} from '$lib/services/loanChecklist';
	import { IconArrowLeft, IconLoader2, IconTool, IconClipboardCheck, IconAlertTriangle, IconTruckDelivery } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let loans = $state<(LoanRow & { daily_done_today?: boolean })[]>([]);
	let pendingSerahTerima = $state<LoanRow[]>([]);

	onMount(async () => {
		try {
			const karyawanId = $authStore.karyawanId;
			if (!karyawanId) throw new Error('Akun Anda belum tertaut ke data karyawan.');

			// Fase 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026): dua sumber digabung
			// jadi satu daftar — BR-01 (legacy, punya serah_terima/kembali sendiri) dan
			// peminjaman_internal (jalur aktif, hanya butuh checklist harian di sini karena
			// serah_terima/kembali sudah otomatis di erp-epi-1).
			const [rows, piRows, pending] = await Promise.all([
				fetchActiveLoansForKaryawan(karyawanId),
				fetchActivePeminjamanInternalForKaryawan(),
				fetchLoansAwaitingSerahTerima(karyawanId)
			]);
			pendingSerahTerima = pending;
			loans = await Promise.all(
				[...rows, ...piRows].map(async (loan) => ({
					...loan,
					daily_done_today: loan.checklist_policy ? await hasTodayDailyChecklist(loan.id, loan.source || 'internal_loan_log') : undefined
				}))
			);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat alat pinjaman Anda.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/maintenance')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Alat Pinjaman Saya</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Equipment yang sedang Anda pinjam sebagai PIC — isi checklist harian & kembalikan di sini.</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pinjaman alat saya..." />
		</div>
	{:else if errorMsg}
		<p class="text-[12px] text-center py-8" style="color: #DC2626">{errorMsg}</p>
	{:else}
		{#if pendingSerahTerima.length > 0}
			<div class="mb-4">
				<p class="text-[12px] font-bold mb-2" style="color: #DC2626">Wajib Checklist Serah-Terima ({pendingSerahTerima.length})</p>
				<div class="flex flex-col gap-2">
					{#each pendingSerahTerima as loan (loan.id)}
						<button
							class="w-full glass-panel rounded-xl p-3 text-left flex items-center justify-between gap-2"
							style="border: 1px solid #DC2626"
							onclick={() => goto(`/maintenance/pinjaman-saya/${loan.id}?jenis=serah_terima`)}
						>
							<div>
								<p class="text-[13px] font-bold" style="color: var(--sys-label)">{loan.equipment?.name || 'Unit'}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">
									{loan.equipment?.code || ''} · Proyek: {(loan as any).project_id?.name || '-'}
								</p>
								<p class="text-[10px] mt-1" style="color: #DC2626">Equipment ini baru dikirim — Goods Received proyek terhambat sampai checklist diisi.</p>
							</div>
							<IconTruckDelivery size={20} style="color: #DC2626; flex-shrink: 0" />
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if loans.length === 0 && pendingSerahTerima.length === 0}
			<div class="text-center py-16">
				<IconTool size={32} style="color: var(--sys-label4); margin: 0 auto" />
				<p class="text-[13px] font-semibold mt-3" style="color: var(--sys-label)">Tidak ada alat yang sedang Anda pinjam</p>
			</div>
		{:else if loans.length > 0}
		<div class="flex flex-col gap-3">
			{#each loans as loan (`${loan.source || 'internal_loan_log'}:${loan.id}`)}
				<div class="glass-panel rounded-2xl p-4">
					<div class="flex items-start justify-between mb-2">
						<div>
							<div class="flex items-center gap-2 flex-wrap">
								<p class="text-[14px] font-bold" style="color: var(--sys-label)">{loan.equipment?.name || 'Unit'}</p>
								{#if loan.ownership_type === 'subcon'}
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-100 text-purple-700">👷 Milik Subcon ({loan.owner_name || 'Primantara'})</span>
								{:else if loan.ownership_type === 'customer'}
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-100 text-sky-700">🤝 Milik Customer ({loan.owner_name || 'Klien'})</span>
								{:else if loan.ownership_type === 'sewa_vendor'}
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">🔶 Sewa Vendor</span>
								{/if}
							</div>
							<p class="text-[11px]" style="color: var(--sys-label3)">{loan.equipment?.code || ''}</p>
						</div>
						{#if loan.checklist_policy && loan.daily_done_today === false}
							<span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background: var(--aml); color: var(--amd)">P2H Belum</span>
						{:else if loan.checklist_policy && loan.daily_done_today}
							<span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background: var(--gl); color: var(--g)">P2H OK Hari Ini</span>
						{/if}
					</div>

					<p class="text-[11px] mb-3" style="color: var(--sys-label3)">Mulai: {loan.start_date} · Rencana kembali: {loan.end_date_planned || '-'}</p>

					<div class="grid {loan.source === 'peminjaman_internal' ? 'grid-cols-1' : 'grid-cols-2'} gap-2">
						{#if loan.checklist_policy}
							<button
								class="h-10 rounded-lg text-[12px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
								style="background: var(--g); color: white"
								disabled={loan.daily_done_today === true}
								onclick={() => goto(`/maintenance/pinjaman-saya/${loan.id}?jenis=harian&source=${loan.source || 'internal_loan_log'}`)}
							>
								<IconClipboardCheck size={15} /> P2H Harian
							</button>
						{/if}
						{#if loan.source !== 'peminjaman_internal'}
							<button
								class="h-10 rounded-lg text-[12px] font-bold flex items-center justify-center gap-1.5"
								style="background: var(--sys-fill); color: var(--sys-label)"
								onclick={() => goto(`/maintenance/pinjaman-saya/${loan.id}?jenis=kembali`)}
							>
								Kembalikan
							</button>
						{/if}
					</div>
					{#if loan.ownership_type === 'subcon' || loan.ownership_type === 'customer'}
						<p class="text-[10px] mt-1.5 text-purple-700 font-medium">ℹ️ Unit milik Subcon/Customer diserahterimakan kembali di site via BAST (bukan retur gudang pusat).</p>
					{:else if loan.source === 'peminjaman_internal'}
						<p class="text-[10px] mt-1.5" style="color: var(--sys-label3)">Pengembalian unit ini diproses gudang/admin, bukan dari sini.</p>
					{/if}

					<button
						class="w-full h-10 mt-2 rounded-lg text-[12px] font-bold flex items-center justify-center gap-1.5"
						style="background: var(--rel); color: var(--red)"
						onclick={() => goto(loan.source === 'peminjaman_internal' ? `/maintenance/survey/baru?equipment_id=${loan.equipment_id}` : `/maintenance/survey/baru?equipment_id=${loan.equipment_id}&loan_id=${loan.id}`)}
					>
						<IconAlertTriangle size={15} /> Lapor Kendala
					</button>
				</div>
			{/each}
		</div>
	{/if}
	{/if}
</div>
