<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		findKaryawanWajib, fetchTodayDepositForKaryawan, fetchDaftarLoker,
		fetchBelumDiambilHariIni, fetchBelumSetorHariIni, submitDeposit, submitPickup,
		type KaryawanWajib, type DepositLog
	} from '$lib/services/phoneDeposit';
	import { IconArrowLeft, IconLoader2, IconDeviceMobile, IconLock, IconLockOpen } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let successMsg = $state('');

	let scanInput = $state('');
	let scanInputEl = $state<HTMLInputElement | null>(null);
	let searching = $state(false);

	let found = $state<KaryawanWajib | null>(null);
	let foundStatus = $state<DepositLog | null>(null); // null = belum ada catatan hari ini

	let lockerOptions = $state<string[]>([]);
	let selectedLocker = $state('');
	let submitting = $state(false);

	let belumDiambil = $state<DepositLog[]>([]);
	let belumSetor = $state<KaryawanWajib[]>([]);

	async function focusScan() {
		await tick();
		scanInputEl?.focus();
	}

	async function loadRingkasan() {
		const [diambil, setor, loker] = await Promise.all([fetchBelumDiambilHariIni(), fetchBelumSetorHariIni(), fetchDaftarLoker()]);
		belumDiambil = diambil;
		belumSetor = setor;
		lockerOptions = loker;
	}

	onMount(async () => {
		loading = true;
		try {
			await loadRingkasan();
		} catch (e) {
			// Bisa terpicu di celah waktu sebelum redirect layout root ke /login selesai
			// (authChecked belum settle) -- tangani lunak, jangan biarkan unhandled rejection.
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat ringkasan deposit HP.';
		}
		loading = false;
		focusScan();
	});

	async function handleScan() {
		const q = scanInput.trim();
		if (!q) return;
		errorMsg = '';
		successMsg = '';
		found = null;
		foundStatus = null;
		searching = true;
		try {
			const results = await findKaryawanWajib(q);
			if (results.length === 0) {
				errorMsg = `"${q}" tidak ditemukan di divisi wajib deposit HP. Kalau ini karyawan baru/divisi lain, hubungi admin HRD.`;
				scanInput = '';
				focusScan();
				searching = false;
				return;
			}
			// Ambil match persis no_badge dulu, baru nama pertama
			found = results.find((r) => r.no_badge === q) || results[0];
			foundStatus = await fetchTodayDepositForKaryawan(found.id);
			selectedLocker = lockerOptions[0] || '';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencari karyawan.';
		}
		searching = false;
	}

	function resetScan() {
		scanInput = '';
		found = null;
		foundStatus = null;
		errorMsg = '';
		focusScan();
	}

	async function doSetor() {
		if (!found) return;
		submitting = true;
		errorMsg = '';
		try {
			await submitDeposit({ karyawanId: found.id, lockerCode: selectedLocker || null, petugasId: $authStore.karyawanId });
			successMsg = `HP ${found.nama_karyawan} berhasil disetor${selectedLocker ? ` (loker ${selectedLocker})` : ''}.`;
			await loadRingkasan();
			resetScan();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencatat setoran HP.';
		}
		submitting = false;
	}

	async function doAmbil() {
		if (!foundStatus) return;
		submitting = true;
		errorMsg = '';
		try {
			await submitPickup(foundStatus.id, $authStore.karyawanId);
			successMsg = `HP ${found?.nama_karyawan} berhasil diambil kembali.`;
			await loadRingkasan();
			resetScan();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencatat pengambilan HP.';
		}
		submitting = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-1">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Deposit HP</h1>
		</div>

		<!-- SectionGuide (panduan wajib per fitur baru) -->
		<div class="rounded-xl p-3 mb-4 text-[11px]" style="background: var(--gl); border: 1px solid var(--g); color: var(--sys-label)">
			Scan badge karyawan. Kalau HP-nya belum disetor, tombol akan jadi <strong>SETOR</strong>. Kalau sudah, tombolnya jadi <strong>AMBIL KEMBALI</strong>.
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<input
			bind:this={scanInputEl}
			bind:value={scanInput}
			onkeydown={(e) => e.key === 'Enter' && handleScan()}
			class="w-full rounded-lg px-3 py-3 text-[14px] mb-4"
			style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
			placeholder="Scan badge / ketik no. karyawan atau nama…"
			disabled={searching}
		/>

		{#if searching}
			<div class="flex flex-col items-center justify-center py-8">
				<CircularProgressGauge size={44} strokeWidth={3.5} label="Mencari data karyawan..." />
			</div>
		{:else if found}
			<div class="rounded-xl p-4 mb-4 shadow-sm" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<div class="flex items-center gap-2 mb-2">
					<IconDeviceMobile size={18} style="color: var(--sys-label3)" />
					<div>
						<p class="text-[14px] font-bold" style="color: var(--sys-label)">{found.nama_karyawan}</p>
						<p class="text-[11px]" style="color: var(--sys-label3)">{found.divisi}</p>
					</div>
				</div>

				{#if !foundStatus}
					<p class="text-[12px] mb-3" style="color: var(--sys-label3)">Belum setor HP hari ini.</p>
					{#if lockerOptions.length > 0}
						<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: white; border: 1px solid var(--sys-sep)" bind:value={selectedLocker}>
							{#each lockerOptions as loker}
								<option value={loker}>Loker {loker}</option>
							{/each}
						</select>
					{:else}
						<p class="text-[11px] mb-3 italic" style="color: var(--sys-label3)">Daftar loker belum diisi admin — HP dicatat tanpa nomor loker.</p>
					{/if}
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50" style="background: var(--g)" disabled={submitting} onclick={doSetor}>
						<IconLock size={16} /> {submitting ? 'Menyimpan…' : 'SETOR HP'}
					</button>
				{:else if foundStatus.status === 'deposited'}
					<p class="text-[12px] mb-3" style="color: var(--sys-label3)">
						Loker {foundStatus.locker_code || '-'}, setor {foundStatus.deposit_time ? new Date(foundStatus.deposit_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
					</p>
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50" style="background: var(--am)" disabled={submitting} onclick={doAmbil}>
						<IconLockOpen size={16} /> {submitting ? 'Menyimpan…' : 'KEMBALIKAN HP'}
					</button>
				{:else}
					<p class="text-[12px]" style="color: var(--sys-label3)">Status: {foundStatus.status} — sudah selesai untuk hari ini.</p>
				{/if}

				<button class="w-full mt-2 text-[11px] underline" style="color: var(--sys-label3)" onclick={resetScan}>Batal / scan ulang</button>
			</div>
		{/if}

		{#if loading}
			<div class="flex flex-col items-center justify-center py-8">
				<CircularProgressGauge size={50} strokeWidth={4} label="Memuat rekap deposit HP..." />
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-2 mt-2">
				<div class="rounded-xl p-3" style="background: var(--aml); border: 1px solid var(--am)">
					<p class="text-[10px]" style="color: var(--amd)">Belum diambil</p>
					<p class="text-[18px] font-bold" style="color: var(--amd)">{belumDiambil.length}</p>
				</div>
				<div class="rounded-xl p-3" style="background: var(--rel); border: 1px solid #fca5a5">
					<p class="text-[10px]" style="color: var(--red)">Belum setor</p>
					<p class="text-[18px] font-bold" style="color: var(--red)">{belumSetor.length}</p>
				</div>
			</div>

			{#if belumDiambil.length === 0 && belumSetor.length === 0}
				<p class="text-[11px] text-center mt-4" style="color: var(--sys-label3)">Belum ada aktivitas deposit HP hari ini. Scan badge karyawan pertama untuk mulai.</p>
			{/if}
		{/if}
	</div>
</div>
