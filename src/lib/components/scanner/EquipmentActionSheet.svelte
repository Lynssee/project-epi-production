<script lang="ts">
	// B3/B7 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): dulu scan QR equipment
	// SELALU langsung ke P2H (satu-satunya tujuan hardcode). Bottom-sheet ini kasih pilihan
	// aksi kontekstual sesudah scan, supaya mekanik tidak perlu hafal URL untuk Lapor/Riwayat/PM.
	//
	// Verifikasi Barcode Equipment Fase 2 (6 Nov 2026): bila `verify` diberikan (hasil POST /api/equipment/verify, hanya dari
	// halaman /scan/[code]), sheet menampilkan kartu pemegang unit + hasil gate G_FLT_DRIVER_LOCK / G_P2H_BORROWER_VERIFY.
	// Tanpa `verify` (mis. dipakai dari dashboard Maintenance) tampilan sama persis seperti sebelumnya.
	import { goto } from '$app/navigation';
	import { IconTool, IconAlertTriangle, IconClock, IconClipboardCheck, IconX, IconShieldCheck, IconShieldX } from '@tabler/icons-svelte';
	import UnitHolderCard from './UnitHolderCard.svelte';
	import { submitHandover, type EquipmentVerifyResult } from '$lib/services/equipmentVerify';

	let {
		equipment,
		verify = null,
		onClose
	}: { equipment: { id: string; name: string; code?: string | null }; verify?: EquipmentVerifyResult | null; onClose: () => void } = $props();

	const allActions = [
		{ id: 'p2h', label: 'Isi P2H', icon: IconClipboardCheck, href: (id: string) => `/preventive/p2h/${id}` },
		{ id: 'lapor', label: 'Lapor Kerusakan', icon: IconAlertTriangle, href: (id: string) => `/maintenance/survey/baru?equipment_id=${id}` },
		{ id: 'pm', label: 'Cek PM', icon: IconTool, href: (id: string) => `/preventive/pm/${id}` },
		{ id: 'riwayat', label: 'Info Unit', icon: IconClock, href: (id: string) => `/preventive/riwayat/${id}` }
	];

	const veh = $derived(verify?.kind === 'vehicle' ? verify : null);
	const tool = $derived(verify?.kind === 'tool' ? verify : null);
	const v = $derived(veh?.verification ?? null);

	let showHandover = $state(false);
	let reason = $state('');
	let busy = $state(false);
	let err = $state('');
	let handoverDone = $state(false);

	const reasonMin = $derived(veh?.override?.reasonMin ?? 0);
	const reasonOk = $derived(reason.trim().length >= reasonMin);
	// Blokir hanya mode hard; saat blokir, aksi operasional (P2H/PM) disembunyikan — Lapor Kerusakan & Info tetap ada (keselamatan).
	const blocked = $derived(!!v?.blocked && !handoverDone);
	const actions = $derived(blocked ? allActions.filter((a) => a.id === 'lapor' || a.id === 'riwayat') : allActions);

	function fmtDate(iso?: string | null) {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	function pick(href: string) {
		onClose();
		goto(href);
	}

	async function sendHandover() {
		if (!equipment.code || busy || !reasonOk) return;
		busy = true;
		err = '';
		try {
			await submitHandover(equipment.code, reason.trim());
			handoverDone = true;
			showHandover = false;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal mencatat alih pakai.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
	<button
		class="absolute inset-0 bg-black/40"
		aria-label="Tutup"
		onclick={onClose}
	></button>
	<div class="relative w-full max-w-md bg-white rounded-t-3xl p-5 pb-8 shadow-xl max-h-[92vh] overflow-y-auto" style="background: var(--sys-bg-secondary, #fff)">
		<div class="flex items-center justify-between mb-1">
			<div class="min-w-0">
				<p class="text-[15px] font-bold truncate" style="color: var(--sys-label)">{equipment.name}</p>
				{#if equipment.code}
					<p class="text-[11px]" style="color: var(--sys-label3)">{equipment.code}</p>
				{/if}
			</div>
			<button class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style="background: var(--sys-fill, #f1f5f9)" onclick={onClose} aria-label="Tutup">
				<IconX size={16} style="color: var(--sys-label3)" />
			</button>
		</div>

		{#if veh && v}
			<div class="mb-4 flex flex-col gap-2">
				{#if veh.vehicle.nomor_polisi}
					<p class="text-[11px]" style="color: var(--sys-label3)">{veh.vehicle.nomor_polisi} · {veh.vehicle.merk} {veh.vehicle.model}</p>
				{/if}

				{#if v.decision === 'denied' && (v.warn || v.blocked) && !handoverDone}
					<div class="rounded-2xl p-3 text-left" style="background: #FEE2E2; border: 1px solid #FCA5A5" role="alert">
						<p class="text-[13px] font-extrabold flex items-center gap-1.5" style="color: #B91C1C"><IconShieldX size={16} /> {v.blocked ? 'KENDARAAN DIKUNCI' : 'PERHATIAN: BUKAN PENGEMUDI TERDAFTAR'}</p>
						<p class="text-[12px] mt-1" style="color: #7F1D1D">{v.message}</p>
					</div>
				{/if}

				{#if handoverDone}
					<div class="rounded-2xl p-3 text-left" style="background: #DCFCE7; border: 1px solid #86EFAC" role="status">
						<p class="text-[12px] font-bold" style="color: #166534">Alih pakai darurat tercatat.</p>
						<p class="text-[11px] mt-0.5" style="color: #166534">Alasan Anda tersimpan dan dapat dilihat koordinator armada/GA. Penugasan resmi tetap diubah GA di Booking Armada.</p>
					</div>
				{/if}

				{#if veh.holder && v.decision !== 'authorized'}
					<UnitHolderCard
						person={veh.holder}
						title={v.decision === 'free' ? 'Pengemudi tetap unit' : 'Pemegang booking saat ini'}
						tone={v.decision === 'denied' && (v.warn || v.blocked) ? 'warn' : 'neutral'}
						lines={[veh.booking?.tujuan ? `Tujuan: ${veh.booking.tujuan}` : null, veh.booking?.keperluan, veh.booking?.tanggal_selesai_rencana ? `s/d ${fmtDate(veh.booking.tanggal_selesai_rencana)}` : null]}
					/>
				{/if}

				{#if v.decision === 'authorized'}
					<UnitHolderCard
						person={veh.holder}
						title="Anda pengemudi sah unit ini"
						tone="ok"
						lines={[veh.booking?.tujuan ? `Tujuan: ${veh.booking.tujuan}` : null, veh.booking?.keperluan, veh.booking?.kode_booking]}
					/>
					<button
						class="w-full rounded-xl py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
						style="background: var(--g)"
						title="Buka Cek Kendaraan (P2H pre-trip) lalu mulai perjalanan — alur yang sama dengan menu Driver."
						onclick={() => pick(veh.booking ? `/driver/check?vehicle=${veh.vehicle.id}&booking=${veh.booking.id}` : '/driver')}
					>
						<IconShieldCheck size={16} /> Cek Kendaraan & Mulai Trip
					</button>
				{:else if v.decision === 'passenger'}
					<p class="text-[11px]" style="color: var(--sys-label3)">Anda tercatat sebagai pemohon; unit ini dikemudikan driver yang ditugaskan.</p>
				{:else if v.decision === 'free'}
					<div class="rounded-2xl p-3 text-left" style="background: var(--sys-fill, #f1f5f9)">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Unit tersedia — belum ada booking aktif.</p>
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Ajukan booking dulu agar pemakaian tercatat dan P2H/BBM bisa dilacak.</p>
						<button
							class="mt-2 w-full rounded-lg py-2 text-[12px] font-semibold border"
							style="border-color: var(--g); color: var(--g)"
							onclick={() => pick('/fleet-booking')}
						>
							Buat Booking Armada
						</button>
					</div>
				{:else if v.decision === 'denied' && !handoverDone}
					{#if veh.override?.allowed}
						{#if !showHandover}
							<button
								class="w-full rounded-xl py-2.5 text-[12px] font-semibold border"
								style="border-color: #DC2626; color: #DC2626"
								title="Hanya bila pengemudi terdaftar berhalangan dan unit harus segera dipakai. Alasan tercatat sebagai jejak audit."
								onclick={() => (showHandover = true)}
							>
								Ajukan Alih Pakai Darurat
							</button>
						{:else}
							<div class="text-left">
								<label for="handover-reason" class="text-[11px] font-semibold" style="color: var(--sys-label3)">
									Alasan alih pakai{reasonMin ? ` (min. ${reasonMin} karakter)` : ''}
								</label>
								<textarea
									id="handover-reason"
									bind:value={reason}
									rows="3"
									class="w-full mt-1 rounded-lg p-2 text-[12px]"
									style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"
									placeholder="Mis. driver yang ditugaskan sakit mendadak, saya diminta atasan membawa unit ke site."
								></textarea>
								<p class="text-[10px] mt-0.5" style="color: var(--sys-label4)">Tulis singkat & jelas — alasan dan lokasi perangkat Anda dicatat, dilihat koordinator armada/GA, dan pemegang booking dikabari. {reason.trim().length}/{reasonMin || 0}</p>
								{#if err}<p class="text-[11px] mt-1" style="color: var(--red)">{err}</p>{/if}
								<div class="flex gap-2 mt-2">
									<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => (showHandover = false)}>Batal</button>
									<button
										class="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white disabled:opacity-50"
										style="background: #DC2626"
										disabled={busy || !reasonOk}
										onclick={sendHandover}
									>
										{busy ? 'Mencatat…' : 'Catat & Lanjutkan'}
									</button>
								</div>
							</div>
						{/if}
					{:else if v.blocked}
						<p class="text-[11px]" style="color: var(--sys-label3)">Hubungi koordinator armada/GA untuk penugasan ulang pengemudi.</p>
					{/if}
				{/if}
			</div>
		{:else if tool}
			<div class="mb-4 flex flex-col gap-2">
				{#if tool.borrower}
					<UnitHolderCard
						person={tool.borrower}
						title="Peminjam resmi unit"
						tone={tool.verification.decision === 'mismatch' ? 'warn' : tool.verification.matches ? 'ok' : 'neutral'}
						lines={[tool.loan?.projectName ? `Proyek: ${tool.loan.projectName}` : null, tool.loan?.endDatePlanned ? `Pinjam s/d ${tool.loan.endDatePlanned}` : null, tool.loan?.purpose]}
					/>
				{:else if tool.verification.decision === 'no_loan'}
					<p class="text-[11px]" style="color: var(--sys-label3)">Unit ini tidak sedang dipinjam.</p>
				{/if}
				{#if tool.verification.warn && tool.verification.message}
					<p class="text-[11px] rounded-lg p-2" style="background: #FEF9C3; color: #854D0E">{tool.verification.message}</p>
				{/if}
			</div>
		{/if}

		<p class="text-[12px] mb-3" style="color: var(--sys-label3)">{blocked ? 'Tindakan yang tersedia' : 'Pilih tindakan untuk unit ini'}</p>

		<div class="grid grid-cols-2 gap-3">
			{#each actions as a}
				<button
					class="glass-panel hover-lift rounded-2xl p-4 flex flex-col items-center gap-2 focus:outline-none"
					onclick={() => pick(a.href(equipment.id))}
				>
					<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--gl)">
						<a.icon size={20} style="color: var(--g)" />
					</div>
					<span class="text-[12px] font-semibold" style="color: var(--sys-label)">{a.label}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
