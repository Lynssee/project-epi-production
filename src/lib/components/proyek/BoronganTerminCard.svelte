<script lang="ts">
	// Fase 4 — kartu satu termin borongan (mobile-first). Reusable.
	// Aksi PL: hanya "Verifikasi Progres" (foto + catatan + % progres). Pengajuan ke
	// Finance tetap di Admin ERP.
	import { STATUS_LABEL, type BoronganTermin } from '$lib/services/manpowerBorongan';

	let { termin, onVerify }: { termin: BoronganTermin; onVerify: (t: BoronganTermin) => void } = $props();

	const rupiah = (v: any) => 'Rp ' + (Number(v) || 0).toLocaleString('id-ID');

	const STATUS_STYLE: Record<string, string> = {
		draft: 'background: var(--sys-fill2, #f1f5f9); color: var(--sys-label2, #475569)',
		verified: 'background: #e0f2fe; color: #0369a1',
		submitted: 'background: #fef3c7; color: #b45309',
		approved: 'background: #dbeafe; color: #1d4ed8',
		partial: 'background: #f3e8ff; color: #7e22ce',
		paid: 'background: #dcfce7; color: #15803d',
		cancelled: 'background: var(--sys-fill2, #f1f5f9); color: var(--sys-label3, #94a3b8)'
	};

	let overdue = $derived(
		!!termin.tanggal_rencana &&
		!['paid', 'cancelled'].includes(termin.status) &&
		new Date(termin.tanggal_rencana) < new Date()
	);
</script>

<div class="rounded-2xl p-3.5 flex flex-col gap-2" style="background: var(--sys-bg2, #fff); border: 1px solid var(--sys-border, #e2e8f0)">
	<div class="flex items-start justify-between gap-2">
		<div>
			<p class="text-[13px] font-bold" style="color: var(--sys-label)">
				{termin.label}
				{#if termin.is_pelunasan}
					<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded-full" style="background:#f3e8ff;color:#7e22ce">pelunasan</span>
				{/if}
			</p>
			<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Termin ke-{termin.urutan}</p>
		</div>
		<span class="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap" style={STATUS_STYLE[termin.status]}>
			{STATUS_LABEL[termin.status] || termin.status}
		</span>
	</div>

	<div class="flex items-center justify-between text-[12px]">
		<span style="color: var(--sys-label3)">Nominal</span>
		<span class="font-bold" style="color: var(--sys-label)">{rupiah(termin.amount)}</span>
	</div>

	{#if Number(termin.progress_required) > 0}
		<div class="flex items-center justify-between text-[11px]">
			<span style="color: var(--sys-label3)">Syarat progres proyek</span>
			<span style="color: var(--sys-label2)">≥ {termin.progress_required}%</span>
		</div>
	{/if}

	{#if termin.tanggal_rencana}
		<div class="flex items-center justify-between text-[11px]">
			<span style="color: var(--sys-label3)">Target tanggal</span>
			<span style={overdue ? 'color:#dc2626;font-weight:700' : 'color: var(--sys-label2)'}>
				{termin.tanggal_rencana}{#if overdue} · lewat{/if}
			</span>
		</div>
	{/if}

	{#if termin.deskripsi_pekerjaan}
		<p class="text-[11px] mt-0.5 rounded-lg p-2" style="background: var(--sys-fill2, #f8fafc); color: var(--sys-label2)">
			🎯 {termin.deskripsi_pekerjaan}
		</p>
	{/if}

	{#if termin.is_pelunasan && termin.status === 'draft'}
		<p class="text-[10.5px] rounded-lg p-2" style="background:#fef9c3;color:#854d0e">
			⚠ Termin pelunasan: Admin baru bisa mengajukan bila aset/alat proyek sudah dikembalikan lengkap & tidak ada kendala.
		</p>
	{/if}

	<!-- Rencana B2B Payment, Fase 2 (3 Okt 2026) — pembayaran termin ini ditahan sampai
	     termin klien terkait cair. TANPA detail klien (keputusan Lead), hanya status umum. -->
	{#if termin.b2b_hold_status === 'waiting_client'}
		<p class="text-[10.5px] rounded-lg p-2" style="background:#fef3c7;color:#92400e">
			🔒 Pembayaran ditahan — menunggu termin pembayaran klien terkait proyek ini cair dulu.
		</p>
	{:else if termin.b2b_hold_status === 'partial_released'}
		<p class="text-[10.5px] rounded-lg p-2" style="background:#dbeafe;color:#1e40af">
			◐ Sebagian sudah boleh dicairkan — sisanya menunggu termin klien lunas penuh.
		</p>
	{/if}

	{#if termin.status === 'verified'}
		<p class="text-[10.5px]" style="color: var(--sys-label3)">
			✓ Diverifikasi {termin.verified_date || ''}{#if termin.verified_progress_pct != null} · progres {termin.verified_progress_pct}%{/if}
			{#if termin.verified_photos?.length} · {termin.verified_photos.length} foto{/if}
		</p>
	{:else if ['submitted', 'approved'].includes(termin.status)}
		<p class="text-[10.5px]" style="color: var(--sys-label3)">Menunggu proses Finance (pengajuan #{termin.pengajuan_anggaran_id?.id ?? termin.pengajuan_anggaran_id ?? '-'})</p>
	{:else if termin.status === 'partial'}
		<p class="text-[10.5px]" style="color:#7e22ce">Terbayar sebagian: {rupiah(termin.paid_amount)}</p>
	{:else if termin.status === 'paid'}
		<p class="text-[10.5px]" style="color:#15803d">Lunas {termin.paid_date || ''}</p>
	{/if}

	{#if termin.status === 'draft'}
		<button
			type="button"
			onclick={() => onVerify(termin)}
			class="mt-1 w-full rounded-xl py-2 text-[12px] font-bold"
			style="background: var(--p); color: #fff"
		>
			📸 Verifikasi Progres
		</button>
	{/if}
</div>
