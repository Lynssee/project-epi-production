<script lang="ts">
	// Tampilan konfirmasi pemohon (Pengajuan Darurat Atas Nama) — dipakai halaman login DAN halaman tautan
	// WhatsApp (tanpa login). Murni presentasi + aturan UI; pengiriman diserahkan ke `submit` dari induk.
	// KEPUTUSAN: pemohon TIDAK boleh mengoreksi nominal/item. Salah -> Tolak, admin input ulang
	// (tanda tangan pemohon selalu berarti "angka ini yang saya setujui").
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { IconLoader2, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';

	let {
		data,
		jenis,
		submit,
		doneLabel = 'Kembali',
		onDone
	}: {
		data: any;
		jenis: string;
		submit: (action: 'approve' | 'reject', p: { note?: string; ttdDataUrl?: string }) => Promise<void>;
		doneLabel?: string;
		onDone?: () => void;
	} = $props();

	let signaturePad: any = $state();
	let sudahPeriksa = $state(false);
	let mode = $state<'konfirmasi' | 'tolak'>('konfirmasi');
	let alasanTolak = $state('');
	let submitting = $state(false);
	let errorMsg = $state('');
	let doneState = $state<'' | 'approve' | 'reject'>('');

	const rp = (n: any) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
	let rec = $derived(data?.record);

	async function kirim(action: 'approve' | 'reject') {
		if (submitting) return;
		errorMsg = '';
		if (action === 'approve') {
			if (!sudahPeriksa) { errorMsg = 'Centang dulu bahwa Anda sudah memeriksa isi pengajuan.'; return; }
			if (!signaturePad || signaturePad.isEmpty()) { errorMsg = 'Tanda tangan belum diisi.'; return; }
		} else if (alasanTolak.trim().length < 5) {
			errorMsg = 'Alasan penolakan wajib diisi (minimal 5 karakter).';
			return;
		}
		submitting = true;
		try {
			await submit(action, action === 'reject' ? { note: alasanTolak.trim() } : { ttdDataUrl: signaturePad.toDataURL() });
			doneState = action;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal mengirim keputusan.';
		} finally {
			submitting = false;
		}
	}
</script>

{#if doneState}
	<div class="glass-panel rounded-2xl p-8 text-center">
		<div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 {doneState === 'approve' ? 'bg-green-100' : 'bg-gray-100'}">
			<IconCircleCheck size={32} class={doneState === 'approve' ? 'text-green-600' : 'text-gray-500'} />
		</div>
		<h3 class="text-lg font-bold mb-2" style="color: var(--sys-label)">
			{doneState === 'approve' ? 'Pengajuan Dikonfirmasi' : 'Pengajuan Ditolak'}
		</h3>
		<p class="text-sm mb-6" style="color: var(--sys-label3)">
			{doneState === 'approve'
				? 'Pengajuan sekarang masuk ke antrean approval. Terima kasih.'
				: 'Pengajuan dibatalkan. Admin yang menginput akan membuat ulang bila diperlukan.'}
		</p>
		{#if onDone}
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg shadow-lg" onclick={onDone}>{doneLabel}</button>
		{/if}
	</div>
{:else}
	<div class="rounded-2xl p-3 mb-4 text-sm font-medium" style="background: rgba(234, 88, 12, 0.10); border: 1px solid #ea580c; color: #9a3412">
		⚠️ Pengajuan ini dibuatkan oleh <strong>{data.pengisiNama || 'Admin'}</strong> atas nama Anda.
		{#if rec?.alasan_darurat}<div class="mt-1 text-xs font-normal">Alasan: {rec.alasan_darurat}</div>{/if}
	</div>

	{#if !data.menunggu}
		<div class="glass-panel rounded-2xl p-5 text-center mb-4">
			<p class="text-sm font-semibold" style="color: var(--sys-label2)">Pengajuan ini sudah diproses (status: {rec?.status}). Tidak ada tindakan yang diperlukan.</p>
		</div>
	{/if}

	<!-- Ringkasan (hanya baca) -->
	<div class="glass-panel rounded-2xl p-4 mb-4 space-y-2 text-sm">
		{#if rec?.nomor_pengajuan}<div class="flex justify-between gap-3"><span style="color: var(--sys-label3)">No. Pengajuan</span><strong>{rec.nomor_pengajuan}</strong></div>{/if}
		<div class="flex justify-between gap-3"><span style="color: var(--sys-label3)">Keperluan</span><strong class="text-right">{rec?.tujuan_pengajuan || '—'}</strong></div>
		{#if data.projectNama}<div class="flex justify-between gap-3"><span style="color: var(--sys-label3)">Proyek</span><strong class="text-right">{data.projectNama}</strong></div>{/if}
		<div class="flex justify-between gap-3"><span style="color: var(--sys-label3)">Departemen</span><strong>{rec?.department || '—'}</strong></div>
		{#if rec?.tanggal_dibutuhkan}<div class="flex justify-between gap-3"><span style="color: var(--sys-label3)">Dibutuhkan</span><strong>{rec.tanggal_dibutuhkan}</strong></div>{/if}
		{#if rec?.penerima_dana_nama || rec?.bank_account_number}
			<div class="pt-2 border-t" style="border-color: var(--sys-sep)">
				<div class="text-xs mb-1" style="color: var(--sys-label3)">Rekening Tujuan</div>
				<strong>{rec.bank_name || ''} {rec.bank_account_number || ''}</strong>
				<div class="text-xs">a.n. {rec.bank_account_name || rec.penerima_dana_nama || '—'}</div>
			</div>
		{/if}
		<div class="flex justify-between gap-3 pt-2 border-t text-base" style="border-color: var(--sys-sep)">
			<span class="font-semibold">Total</span><strong class="gradient-text">{rp(data.total)}</strong>
		</div>
	</div>

	<div class="glass-panel rounded-2xl p-4 mb-4">
		<p class="text-xs font-bold mb-2" style="color: var(--sys-label3)">Rincian ({(data.items || []).length} baris)</p>
		<div class="space-y-2">
			{#each data.items || [] as it (it.id)}
				<div class="flex justify-between gap-3 text-sm">
					<div class="min-w-0">
						<div class="font-medium break-words">{it.deskripsi || it.nama_barang || '—'}</div>
						<div class="text-xs" style="color: var(--sys-label3)">{it.quantity ?? 0} {it.units || ''} × {rp(it.harga)}</div>
					</div>
					<strong class="shrink-0">{rp((parseFloat(it.harga) || 0) * (parseFloat(it.quantity) || 0))}</strong>
				</div>
			{:else}
				<p class="text-sm" style="color: var(--sys-label4)">Tidak ada rincian.</p>
			{/each}
		</div>
	</div>

	{#if data.menunggu}
		{#if errorMsg}
			<div class="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium mb-4">
				<IconAlertTriangle size={18} class="shrink-0" />{errorMsg}
			</div>
		{/if}

		<p class="text-xs mb-3 px-1" style="color: var(--sys-label3)">
			💡 Anda tidak dapat mengubah angka di layar ini. Jika ada yang salah, pilih <strong>Tolak</strong> — admin akan menginput ulang.
		</p>

		{#if mode === 'konfirmasi'}
			<label class="flex items-start gap-3 p-4 glass-panel rounded-2xl mb-4 cursor-pointer">
				<input type="checkbox" bind:checked={sudahPeriksa} class="mt-0.5 w-5 h-5 shrink-0" />
				<span class="text-sm font-medium" style="color: var(--sys-label)">
					Saya sudah memeriksa keperluan, rincian, dan nominal di atas, dan pengajuan ini benar atas nama saya.
				</span>
			</label>
			<div class="glass-panel rounded-2xl p-4 mb-4">
				<p class="text-xs font-bold mb-2" style="color: var(--sys-label3)">Tanda Tangan Anda</p>
				<SignaturePad bind:this={signaturePad} height={180} />
			</div>
			<button
				class="w-full h-14 rounded-2xl text-[15px] font-bold text-white flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 mb-3"
				style="background: #16a34a"
				disabled={submitting}
				onclick={() => kirim('approve')}
			>
				{#if submitting}<IconLoader2 size={20} class="animate-spin" />{/if}
				Konfirmasi &amp; Setujui Pengajuan
			</button>
			<button
				class="w-full h-12 rounded-2xl text-sm font-bold flex items-center justify-center"
				style="color: #dc2626; border: 1px solid #dc2626"
				disabled={submitting}
				onclick={() => { mode = 'tolak'; errorMsg = ''; }}
			>
				Tolak / Bukan Pengajuan Saya
			</button>
		{:else}
			<div class="glass-panel rounded-2xl p-4 mb-4">
				<label class="text-xs font-bold mb-2 block" style="color: var(--sys-label3)" for="alasan-tolak">Alasan Penolakan <span class="text-red-500">*</span></label>
				<textarea
					id="alasan-tolak"
					bind:value={alasanTolak}
					rows="3"
					placeholder="Contoh: nominal salah / bukan pengajuan saya / sudah tidak dibutuhkan"
					class="w-full p-3 rounded-xl text-sm border outline-none"
					style="border-color: var(--sys-sep); background: var(--sys-bg2)"
				></textarea>
			</div>
			<button
				class="w-full h-14 rounded-2xl text-[15px] font-bold text-white flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 mb-3"
				style="background: #dc2626"
				disabled={submitting}
				onclick={() => kirim('reject')}
			>
				{#if submitting}<IconLoader2 size={20} class="animate-spin" />{/if}
				Tolak Pengajuan Ini
			</button>
			<button class="w-full h-12 rounded-2xl text-sm font-bold" style="color: var(--sys-label2)" onclick={() => { mode = 'konfirmasi'; errorMsg = ''; }}>
				Kembali
			</button>
		{/if}
	{/if}
{/if}
