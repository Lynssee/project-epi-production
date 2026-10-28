<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getEquipmentById, logActivity } from '$lib/services/preventive';
	import ComponentVerifySection from '$lib/components/preventive/ComponentVerifySection.svelte';
	import {
		getWorkOrderById,
		getWorkOrderActivities,
		getCategoryNamesMap,
		isWorkOrderApproved,
		isWorkOrderPendingQc,
		markWorkOrderDone,
		submitUsulServisLuar,
		uploadUsulServisLuarPhoto,
		getDispatchStatusByWorkOrder,
		getServiceAgreementStatusByWorkOrder,
		deriveWoStepper,
		type WorkOrderRow,
		type MekanikActivityRow,
		type DispatchStatus,
		type ServiceAgreementStatus,
		type WoStepperStep
	} from '$lib/services/maintenance';
	import { IconArrowLeft, IconLoader2, IconPlus, IconAlertTriangle, IconClipboardList, IconFlag3, IconTruck, IconFileText, IconCamera, IconShare2 } from '@tabler/icons-svelte';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';

	let workOrderId = $derived($page.params.id as string);
	let showExportSheet = $state(false);

	let loading = $state(true);
	let errorMsg = $state('');
	let finishing = $state(false);
	let workOrder = $state<WorkOrderRow | null>(null);
	let equipment = $state<any>(null);
	let activities = $state<MekanikActivityRow[]>([]);
	let categoryMap = $state<Record<string, string>>({});
	let dispatchStatus = $state<DispatchStatus | null>(null);
	let saStatus = $state<ServiceAgreementStatus | null>(null);
	let usulAlasan = $state('');
	let usulFotoFile = $state<File | null>(null);
	let usulFotoUploading = $state(false);
	let usulFotoId = $state<string | null>(null);
	let submittingUsul = $state(false);
	let usulTersimpan = $state(false);

	async function handleUsulFotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		usulFotoFile = file;
		usulFotoUploading = true;
		try {
			usulFotoId = await uploadUsulServisLuarPhoto(file);
		} catch {
			errorMsg = 'Gagal mengunggah foto.';
		} finally {
			usulFotoUploading = false;
		}
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_maintenance', roles)) {
			goto('/');
		}
	});

	let approved = $derived(isWorkOrderApproved(categoryMap[workOrder?.approval_status || '']));
	let statusName = $derived(categoryMap[workOrder?.order_status || ''] || 'Open');
	let prioritas = $derived(categoryMap[workOrder?.kategori_perbaikan_id || ''] || '-');
	let pendingQc = $derived(isWorkOrderPendingQc(statusName));
	let canFinish = $derived(approved && !pendingQc && (workOrder?.progress || 0) >= 100);

	// Pusat Maintenance v2 Fase 5 — stepper ringkas 6 tahap ("status apa & menunggu siapa").
	let stepper = $derived<WoStepperStep[]>(
		workOrder
			? deriveWoStepper({
					orderStatusName: statusName,
					approved,
					hasActivity: activities.length > 0,
					butuhServisLuar: !!workOrder.butuh_servis_luar,
					dispatchStatus,
					pendingQc,
					qcPassed: workOrder.qc_status === 'passed'
				})
			: []
	);

	// F2 (Fase 4 "Export Maintenance v2" rencana) — Detail WO + log aktivitas, PDF saja
	// (dokumen naratif per-WO, tidak relevan sebagai CSV).
	const exportColumns = [
		{ key: 'tanggal', label: 'Tanggal' },
		{ key: 'kegiatan', label: 'Kegiatan' },
		{ key: 'status', label: 'Status' },
		{ key: 'sparepart', label: 'Sparepart' },
		{ key: 'kendala', label: 'Kendala' }
	];
	let exportRows = $derived(
		activities.map((a) => ({
			tanggal: new Date(a.tanggal_input).toLocaleDateString('id-ID'),
			kegiatan: a.kegiatan_repair || '-',
			status: categoryMap[a.status_repair_id || ''] || '-',
			sparepart: a.sparepart_ringkas || '-',
			kendala: a.kendala || '-'
		}))
	);

	async function handleSubmitUsul() {
		if (!workOrder || !usulAlasan.trim() || !usulFotoId || submittingUsul) return;
		submittingUsul = true;
		try {
			await submitUsulServisLuar(workOrder.id, usulAlasan.trim(), usulFotoId);
			workOrder = { ...workOrder, alasan_servis_luar: usulAlasan.trim(), foto_usul_servis_luar: usulFotoId };
			usulTersimpan = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan usul servis luar.';
		} finally {
			submittingUsul = false;
		}
	}

	async function handleFinish() {
		if (!canFinish || finishing || !workOrder) return;
		finishing = true;
		try {
			await markWorkOrderDone(workOrder.id);
			const karyawanName = $authStore.karyawanName;
			if (karyawanName) {
				await logActivity({
					user_name: karyawanName,
					action: 'update',
					entity_type: 'work_order',
					entity_id: workOrder.id,
					summary: `WO ${equipment?.name || workOrder.equipment_id} ditandai selesai — masuk antrian QC`
				});
			}
			workOrder = await getWorkOrderById(workOrderId);
			categoryMap = await getCategoryNamesMap([workOrder?.order_status, workOrder?.kategori_perbaikan_id, workOrder?.approval_status]);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menandai WO selesai.';
		} finally {
			finishing = false;
		}
	}

	onMount(async () => {
		try {
			workOrder = await getWorkOrderById(workOrderId);
			if (!workOrder) {
				errorMsg = 'Work Order tidak ditemukan.';
				return;
			}
			[equipment, activities] = await Promise.all([
				getEquipmentById(workOrder.equipment_id),
				getWorkOrderActivities(workOrderId)
			]);
			categoryMap = await getCategoryNamesMap([
				workOrder.order_status, workOrder.kategori_perbaikan_id, workOrder.approval_status,
				...activities.map((a) => a.status_repair_id)
			]);
			usulAlasan = workOrder.alasan_servis_luar || '';
			usulFotoId = workOrder.foto_usul_servis_luar || null;
			if (workOrder.butuh_servis_luar) {
				dispatchStatus = await getDispatchStatusByWorkOrder(workOrderId);
				saStatus = await getServiceAgreementStatusByWorkOrder(workOrderId);
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat detail Work Order.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
	<div class="flex items-center justify-between mb-3">
		<button class="flex items-center gap-1.5 text-[12px] font-medium" style="color: var(--sys-label3)" onclick={() => goto('/maintenance/work-order')}>
			<IconArrowLeft size={15} /> Kembali
		</button>
		{#if workOrder}
			<button
				onclick={() => (showExportSheet = true)}
				title="Bagikan detail WO sebagai PDF"
				class="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border"
				style="border-color: var(--sys-sep); color: var(--sys-label3)"
			>
				<IconShare2 size={13} /> Cetak/Bagikan
			</button>
		{/if}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian work order..." />
		</div>
	{:else if errorMsg}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if workOrder}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{equipment?.name || workOrder.equipment_id}</h1>
		<p class="text-[11px] mb-3" style="color: var(--sys-label3)">{equipment?.code || '-'}</p>

		<div class="flex items-center gap-2 flex-wrap mb-3">
			<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--pl); color:var(--pd)">{statusName}</span>
			<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--aml); color:var(--amd)">{prioritas}</span>
			{#if !approved}
				<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--rel); color:var(--red)">
					<IconAlertTriangle size={11} /> Menunggu approval admin
				</span>
			{/if}
			{#if pendingQc}
				<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:#DDD6FE; color:#5B21B6">
					<IconFlag3 size={11} /> Menunggu QC Admin
				</span>
			{/if}
		</div>

		<!-- Pusat Maintenance v2 Fase 5: stepper ringkas 6 tahap, read-only — tidak menegakkan apa pun -->
		<div class="flex items-stretch gap-1 mb-4 overflow-x-auto pb-1">
			{#each stepper as s (s.id)}
				<div
					class="flex-1 min-w-[92px] rounded-lg p-2 border text-center"
					style={s.state === 'selesai'
						? 'background: var(--gl); border-color: var(--g)'
						: s.state === 'aktif'
							? 'background: var(--pl); border-color: var(--pd)'
							: 'background: var(--sys-fill); border-color: var(--sys-sep)'}
					title={s.waitingFor || 'Selesai'}
				>
					<p
						class="text-[10px] font-bold"
						style={s.state === 'selesai' ? 'color: var(--g)' : s.state === 'aktif' ? 'color: var(--pd)' : 'color: var(--sys-label4)'}
					>
						{s.label}
					</p>
					<p class="text-[9px] mt-0.5 truncate" style="color: var(--sys-label4)">
						{s.state === 'selesai' ? '✓ Selesai' : s.state === 'aktif' ? 'Sedang berjalan' : 'Menunggu'}
					</p>
				</div>
			{/each}
		</div>
		{#if stepper.find((s) => s.state === 'aktif')?.waitingFor}
			<p class="text-[11px] mb-4 -mt-2" style="color: var(--sys-label3)">
				⏳ Menunggu: {stepper.find((s) => s.state === 'aktif')?.waitingFor}
			</p>
		{/if}

		<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--sys-sep)">
			<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Keluhan / Gejala</p>
			<p class="text-[13px]" style="color: var(--sys-label)">{workOrder.keluhan}</p>
		</div>

		{#if workOrder.butuh_servis_luar}
			<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--sys-sep); background: var(--sys-fill)">
				<p class="text-[11px] font-semibold mb-1.5 flex items-center gap-1.5" style="color: var(--sys-label3)">
					<IconTruck size={13} /> Status Dispatch Bengkel
				</p>
				{#if dispatchStatus}
					<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Surat Jalan {dispatchStatus.nomor_sj}</p>
					<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
						Ke {dispatchStatus.bengkel_name} — status: {dispatchStatus.status}, retur: {dispatchStatus.return_status}
					</p>
				{:else}
					<p class="text-[12px]" style="color: var(--sys-label3)">Ditandai butuh servis luar oleh supervisor — menunggu diterbitkan Surat Jalan di Admin.</p>
				{/if}
			</div>

			<!-- Gate Bengkel Fase 6: panel read-only "Status Perjanjian Kerja". Harga
			     quotation SENGAJA tidak ditampilkan (Q6 dokumen rencana) -- hanya
			     status, ringkasan scope/exclusion, estimasi durasi, status CR. -->
			<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--sys-sep)">
				<p class="text-[11px] font-semibold mb-1.5 flex items-center gap-1.5" style="color: var(--sys-label3)">
					<IconFileText size={13} /> Status Perjanjian Kerja
				</p>
				{#if saStatus}
					<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{saStatus.nomorPerjanjian} — {saStatus.status}</p>
					{#if saStatus.estimasiDurasiHari}
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Estimasi durasi: {saStatus.estimasiDurasiHari} hari</p>
					{/if}
					{#if saStatus.scopeSummary.length > 0}
						<p class="text-[11px] mt-1.5 font-semibold" style="color: var(--sys-label3)">Pekerjaan yang disepakati:</p>
						<ul class="text-[11px] list-disc pl-4" style="color: var(--sys-label)">
							{#each saStatus.scopeSummary as s}<li>{s}</li>{/each}
						</ul>
					{/if}
					{#if saStatus.exclusionSummary.length > 0}
						<p class="text-[11px] mt-1.5 font-semibold" style="color: var(--sys-label3)">Tidak termasuk:</p>
						<ul class="text-[11px] list-disc pl-4" style="color: var(--sys-label)">
							{#each saStatus.exclusionSummary as s}<li>{s}</li>{/each}
						</ul>
					{/if}
					{#if saStatus.openChangeRequestCount > 0}
						<p class="text-[11px] mt-1.5 font-semibold" style="color: #B45309">{saStatus.openChangeRequestCount} Change Request sedang diproses</p>
					{/if}
				{:else}
					<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada Perjanjian Kerja tercatat untuk WO ini.</p>
				{/if}
			</div>
		{:else}
			<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--sys-sep)">
				<p class="text-[11px] font-semibold mb-1.5" style="color: var(--sys-label3)">Usul Servis Luar</p>
				<p class="text-[11px] mb-2" style="color: var(--sys-label4)">
					Kalau perbaikan ini tidak bisa dikerjakan internal, tulis alasannya di sini — supervisor yang akan menandai & memutuskan dispatch ke bengkel.
				</p>
				<textarea
					bind:value={usulAlasan}
					rows="2"
					placeholder="Kenapa perlu dibawa ke bengkel..."
					class="w-full rounded-lg border text-[12px] p-2 mb-2"
					style="border-color: var(--sys-sep)"
				></textarea>
				<label class="flex items-center gap-2 text-[12px] font-semibold px-3 py-1.5 rounded-lg border mb-2 cursor-pointer w-fit" style="border-color: var(--sys-sep); color: var(--sys-label)">
					<IconCamera size={15} />
					{usulFotoUploading ? 'Mengunggah...' : usulFotoId ? 'Foto Terunggah ✓' : 'Unggah Foto Bukti (wajib)'}
					<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handleUsulFotoChange} />
				</label>
				<button
					class="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
					style="background: var(--g)"
					disabled={!usulAlasan.trim() || !usulFotoId || usulFotoUploading || submittingUsul}
					onclick={handleSubmitUsul}
				>
					{submittingUsul ? 'Menyimpan...' : usulTersimpan ? 'Usul Tersimpan ✓' : 'Simpan Usul'}
				</button>
			</div>
		{/if}

		<div class="mb-4">
			<div class="flex items-center justify-between mb-1">
				<p class="text-[11px] font-semibold" style="color: var(--sys-label3)">Progres</p>
				<p class="text-[12px] font-bold" style="color: var(--sys-label)">{workOrder.progress || 0}%</p>
			</div>
			<div class="w-full h-2 rounded-full" style="background: var(--sys-fill)">
				<div class="h-2 rounded-full" style="width: {workOrder.progress || 0}%; background: var(--g)"></div>
			</div>
		</div>

		{#if errorMsg}
			<p class="text-[12px] mb-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		{#if workOrder.equipment_id}
			<ComponentVerifySection equipmentId={workOrder.equipment_id} />
		{/if}

		<button
			class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 mb-3"
			style="background: var(--g)"
			disabled={!approved || pendingQc}
			onclick={() => goto(`/maintenance/work-order/${workOrderId}/lapor`)}
		>
			<IconPlus size={16} /> Tambah Laporan Harian
		</button>

		{#if !pendingQc}
			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 mb-6"
				style="background: #16A34A"
				disabled={!canFinish || finishing}
				onclick={handleFinish}
			>
				{#if finishing}<IconLoader2 size={16} class="animate-spin" />{:else}<IconFlag3 size={16} />{/if}
				Tandai Selesai (Kirim ke QC)
			</button>
		{/if}

		<div>
			<p class="text-[13px] font-semibold mb-2 flex items-center gap-1.5" style="color: var(--sys-label)">
				<IconClipboardList size={15} /> Riwayat Laporan Harian
			</p>
			{#if activities.length === 0}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label3)">Belum ada laporan harian.</p>
			{:else}
				<div class="flex flex-col gap-2.5">
					{#each activities as a (a.id)}
						<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<p class="text-[11px] font-semibold" style="color: var(--sys-label3)">{new Date(a.tanggal_input).toLocaleDateString('id-ID')}</p>
								{#if a.status_repair_id}
									<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:var(--pl); color:var(--pd)">
										{categoryMap[a.status_repair_id] || '-'}
									</span>
								{/if}
							</div>
							<p class="text-[12px] mb-1" style="color: var(--sys-label)">{a.kegiatan_repair || '-'}</p>
							{#if a.sparepart_ringkas}
								<p class="text-[11px]" style="color: var(--sys-label3)"><span class="font-semibold">Sparepart:</span> {a.sparepart_ringkas}</p>
							{/if}
							{#if a.kendala}
								<p class="text-[11px] mt-0.5" style="color: #DC2626"><span class="font-semibold">Kendala:</span> {a.kendala}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if workOrder}
	<FieldExportSheet
		open={showExportSheet}
		onClose={() => (showExportSheet = false)}
		judul={`Detail WO — ${equipment?.name || workOrder.equipment_id}`}
		filename={`wo-${workOrder.id}`}
		columns={exportColumns}
		rows={exportRows}
		formats={['pdf']}
	/>
{/if}
