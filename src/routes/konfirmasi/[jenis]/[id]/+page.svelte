<script lang="ts">
	// Pengajuan Darurat Atas Nama — konfirmasi lewat TAUTAN WhatsApp tanpa login.
	// Langkah 1: masukkan 4 digit terakhir nomor HP (faktor kedua, dicocokkan dengan master karyawan).
	// Langkah 2: tampilan konfirmasi yang sama dengan jalur login. Rute publik (dikecualikan di root layout).
	import { page } from '$app/stores';
	import KonfirmasiPengajuanView from '$lib/components/konfirmasi/KonfirmasiPengajuanView.svelte';
	import { IconLoader2, IconAlertTriangle, IconShieldLock } from '@tabler/icons-svelte';

	const jenis = $page.params.jenis;
	const id = Number($page.params.id);
	const token = $page.url.searchParams.get('t') || '';
	const jenisLabel = jenis === 'pr' ? 'Pengajuan Pembelian (PR)' : 'Pengajuan Anggaran';

	let tail = $state('');
	let opening = $state(false);
	let errorMsg = $state('');
	let data = $state<any>(null);
	let locked = $state(false);

	async function buka() {
		if (opening) return;
		errorMsg = '';
		if (!/^\d{4}$/.test(tail)) { errorMsg = 'Isi tepat 4 digit angka.'; return; }
		opening = true;
		try {
			const res = await fetch('/api/pengajuan-konfirmasi/buka', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jenis, id, token, tail })
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) {
				// 410/429 = tautan mati / terlalu banyak percobaan -> tidak ada gunanya mencoba lagi di sini.
				locked = res.status === 410 || res.status === 429 || (res.status === 403 && !/4 digit/.test(j?.message || ''));
				throw new Error(j?.message || `HTTP ${res.status}`);
			}
			data = j.data;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal membuka pengajuan.';
		} finally {
			opening = false;
		}
	}

	async function submit(action: 'approve' | 'reject', p: { note?: string; ttdDataUrl?: string }) {
		const res = await fetch('/api/pengajuan-konfirmasi', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jenis, pengajuanId: id, action, versi: data?.versi, token, tail, note: p.note, ttdDataUrl: p.ttdDataUrl })
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
	}
</script>

<svelte:head>
	<title>Konfirmasi Pengajuan</title>
	<!-- Token ada di URL: jangan bocor lewat Referer / mesin pencari -->
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="w-full p-4 md:p-6 pb-28 max-w-2xl mx-auto" style="background: var(--sys-bg); min-height: 100vh">
	<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Konfirmasi Pengajuan</h1>
	<p class="text-sm mt-1 mb-4 font-medium" style="color: var(--sys-label3)">{jenisLabel} yang dibuatkan atas nama Anda</p>

	{#if !token}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<IconAlertTriangle size={30} class="mx-auto mb-3" style="color: var(--red, #dc2626)" />
			<p class="text-sm font-medium" style="color: var(--sys-label2)">Tautan tidak lengkap. Buka tautan dari pesan WhatsApp secara utuh, atau masuk lewat dashboard lapangan.</p>
		</div>
	{:else if !data}
		<div class="glass-panel rounded-2xl p-5">
			<div class="flex items-center gap-2 mb-2" style="color: var(--sys-label)">
				<IconShieldLock size={20} /><strong class="text-sm">Verifikasi singkat</strong>
			</div>
			<p class="text-xs mb-3" style="color: var(--sys-label3)">
				Demi keamanan, masukkan <strong>4 digit terakhir nomor HP</strong> Anda yang terdaftar di data karyawan.
			</p>
			<input
				type="text"
				inputmode="numeric"
				autocomplete="off"
				maxlength="4"
				bind:value={tail}
				onkeydown={(e) => { if (e.key === 'Enter') buka(); }}
				placeholder="0000"
				disabled={locked}
				class="w-full h-14 rounded-xl text-center text-2xl tracking-[0.5em] font-bold border outline-none"
				style="border-color: var(--sys-sep); background: var(--sys-bg2)"
			/>
			{#if errorMsg}
				<div class="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium mt-3">
					<IconAlertTriangle size={18} class="shrink-0 mt-0.5" />{errorMsg}
				</div>
			{/if}
			<button
				class="w-full h-12 mt-4 rounded-2xl text-[15px] font-bold text-white flex items-center justify-center gap-2 gradient-bg shadow-lg disabled:opacity-40"
				disabled={opening || locked}
				onclick={buka}
			>
				{#if opening}<IconLoader2 size={18} class="animate-spin" />{/if}
				Buka Pengajuan
			</button>
			<p class="text-[11px] mt-3 text-center" style="color: var(--sys-label4)">Tautan ini pribadi — jangan dibagikan ke orang lain.</p>
		</div>
	{:else}
		<KonfirmasiPengajuanView {data} {jenis} {submit} doneLabel="Selesai" />
	{/if}
</div>
