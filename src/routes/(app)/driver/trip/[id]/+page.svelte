<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getTripById, finishTrip, sendCheckpoint, getCurrentPosition, submitPod, getTripExpenses, submitTripExpense, type SubmitExpenseParams } from '$lib/services/driver';
	import { IconLoader2, IconArrowLeft, IconMapPin, IconFlag, IconPackage, IconPlus } from '@tabler/icons-svelte';
	import SignaturePad from '$lib/components/shared/SignaturePadCallback.svelte';
	import { driverTripExpenseSchema } from '$lib/schemas/driverTripExpense';
	import { driverPodSchema } from '$lib/schemas/driverPod';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	const tripId = page.params.id as string;

	// Penyelamatan draf (rencana v2, Fase 3, 3.2 prioritas 5): form Selesai Trip & POD
	// menyakitkan bila harus diulang (POD punya foto+TTD) gara-gara tab ter-refresh.
	interface TripDraft {
		kmAkhir: number | null; catatanDriver: string;
		podPenerimaNama: string; podCatatan: string;
	}
	const tripPersist = createFormPersist<TripDraft>(`driver_trip_${tripId}`);
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);
	const POD_PHOTO_KEY = 'foto';
	const POD_TTD_KEY = 'ttd';

	function tripSnapshot(): TripDraft {
		return { kmAkhir, catatanDriver, podPenerimaNama, podCatatan };
	}

	let loading = $state(true);
	let saving = $state(false);
	let sendingCheckpoint = $state(false);
	let errorMsg = $state('');
	let checkpointMsg = $state('');
	let trip = $state<any>(null);

	let showFinishForm = $state(false);
	let kmAkhir = $state<number | null>(null);
	let catatanDriver = $state('');

	let expenses = $state<any[]>([]);
	let showExpenseForm = $state(false);
	let savingExpense = $state(false);
	let expenseErrorMsg = $state('');
	let expenseJenis = $state<SubmitExpenseParams['jenis']>('bbm');
	let expenseNominal = $state<number | null>(null);
	let expenseCatatan = $state('');
	let expenseFoto = $state<File | null>(null);

	const JENIS_LABEL: Record<string, string> = { bbm: 'BBM', tol: 'Tol', parkir: 'Parkir', lain: 'Lain-lain' };

	let showPodForm = $state(false);
	let savingPod = $state(false);
	let podErrorMsg = $state('');
	let podPenerimaNama = $state('');
	let podCatatan = $state('');
	let podFoto = $state<File | null>(null);
	let podTtd: File | null = null;

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'execute_trip', roles)) {
			goto('/driver');
		}
	});

	onMount(async () => {
		trip = await getTripById(tripId);
		if (!trip) {
			errorMsg = 'Trip tidak ditemukan.';
		} else {
			expenses = await getTripExpenses(tripId);
		}
		loading = false;

		const draft = tripPersist.restore();
		if (draft) {
			kmAkhir = draft.kmAkhir;
			catatanDriver = draft.catatanDriver;
			podPenerimaNama = draft.podPenerimaNama;
			podCatatan = draft.podCatatan;
			if (draft.kmAkhir != null || draft.catatanDriver) showFinishForm = true;
			if (draft.podPenerimaNama || draft.podCatatan) showPodForm = true;
			const photoBlob = await tripPersist.restorePhoto(POD_PHOTO_KEY);
			if (photoBlob) podFoto = new File([photoBlob], 'pod-foto.jpg', { type: photoBlob.type || 'image/jpeg' });
			const ttdBlob = await tripPersist.restorePhoto(POD_TTD_KEY);
			if (ttdBlob) podTtd = new File([ttdBlob], 'pod-ttd.png', { type: ttdBlob.type || 'image/png' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	$effect(() => {
		void tripSnapshot();
		if (!draftArmed) return;
		tripPersist.save(tripSnapshot());
		draftSavedAt = new Date();
	});

	onMount(() => registerFormPersistSaveTriggers(tripPersist, () => tripSnapshot()));

	function onExpenseFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		expenseFoto = input.files?.[0] || null;
	}

	async function submitExpenseForm() {
		expenseErrorMsg = '';
		const parsed = driverTripExpenseSchema.safeParse({
			jenis: expenseJenis,
			nominal: expenseNominal,
			catatan: expenseCatatan
		});
		if (!parsed.success) {
			expenseErrorMsg = parsed.error.issues[0]?.message || 'Data biaya tidak valid.';
			return;
		}
		savingExpense = true;
		try {
			const compressedExpenseFoto = expenseFoto ? await compressPhoto(expenseFoto) : null;
			await submitTripExpense(tripId, { ...parsed.data, foto_struk: compressedExpenseFoto });
			expenses = await getTripExpenses(tripId);
			showExpenseForm = false;
			expenseNominal = null;
			expenseCatatan = '';
			expenseFoto = null;
		} catch (err) {
			expenseErrorMsg = err instanceof Error ? err.message : 'Gagal menyimpan biaya.';
		} finally {
			savingExpense = false;
		}
	}

	async function handleCheckpoint() {
		checkpointMsg = '';
		sendingCheckpoint = true;
		try {
			const pos = await getCurrentPosition();
			const res = await sendCheckpoint({
				trip_log_id: tripId,
				label: 'Checkpoint Manual',
				latitude: pos.coords.latitude,
				longitude: pos.coords.longitude
			});
			checkpointMsg = 'queued' in res ? 'Lokasi disimpan, akan dikirim saat online.' : 'Lokasi berhasil dikirim.';
		} catch (err) {
			checkpointMsg = err instanceof Error ? err.message : 'Gagal mengambil lokasi.';
		} finally {
			sendingCheckpoint = false;
		}
	}

	function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		podFoto = input.files?.[0] || null;
		if (podFoto) tripPersist.savePhoto(POD_PHOTO_KEY, podFoto);
	}

	async function submitPodForm(status: 'tiba' | 'gagal') {
		podErrorMsg = '';
		const parsed = driverPodSchema.safeParse({
			status,
			penerima_nama: podPenerimaNama,
			catatan: podCatatan
		});
		if (!parsed.success) {
			podErrorMsg = parsed.error.issues[0]?.message || 'Data POD tidak valid.';
			return;
		}
		savingPod = true;
		try {
			let lat: number | undefined;
			let lng: number | undefined;
			try {
				const pos = await getCurrentPosition();
				lat = pos.coords.latitude;
				lng = pos.coords.longitude;
			} catch {
				/* lokasi opsional */
			}

			const compressedPodFoto = podFoto ? await compressPhoto(podFoto) : null;
			await submitPod(tripId, { ...parsed.data, lat, lng, foto: compressedPodFoto, ttd: podTtd });

			trip = await getTripById(tripId);
			showPodForm = false;
			podPenerimaNama = '';
			podCatatan = '';
			podFoto = null;
			podTtd = null;
			await tripPersist.clearPhotos();
			tripPersist.save(tripSnapshot());
			draftSavedAt = new Date();
		} catch (err) {
			podErrorMsg = err instanceof Error ? err.message : 'Gagal mengirim POD.';
		} finally {
			savingPod = false;
		}
	}

	async function submitFinish() {
		errorMsg = '';
		if (kmAkhir == null || kmAkhir < (trip?.km_awal ?? 0)) {
			errorMsg = 'KM akhir tidak valid.';
			return;
		}
		saving = true;
		try {
			const res = await finishTrip(tripId, {
				km_akhir: kmAkhir,
				catatan_driver: catatanDriver.trim()
			});

			// Checkpoint tiba — opsional, tidak menghalangi alur utama.
			try {
				const pos = await getCurrentPosition();
				await sendCheckpoint({
					trip_log_id: tripId,
					label: 'Tiba',
					latitude: pos.coords.latitude,
					longitude: pos.coords.longitude,
					odometer: kmAkhir
				});
			} catch {
				/* opsional */
			}

			tripPersist.clear();
			await tripPersist.clearPhotos();

			if ('queued' in res) {
				goto('/driver');
				return;
			}
			goto('/driver');
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyelesaikan trip.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/driver')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Detail Trip</h1>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat detail trip driver..." />
		{:else if errorMsg && !trip}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else if trip}
			<div class="rounded-xl p-4 mb-4" style="background: var(--sys-fill)">
				<p class="text-[14px] font-bold mb-1" style="color: var(--sys-label)">{trip.tujuan || 'Tanpa tujuan tercatat'}</p>
				<p class="text-[11px]" style="color: var(--sys-label3)">{trip.keperluan || '-'}</p>
				<div class="grid grid-cols-2 gap-2 mt-3 text-[11px]" style="color: var(--sys-label3)">
					<p>KM Awal: <span style="color: var(--sys-label)">{trip.km_awal ?? '-'}</span></p>
					<p>Status: <span style="color: var(--sys-label)">{trip.status === 'active' ? 'Berjalan' : 'Selesai'}</span></p>
				</div>
			</div>

			{#if trip.status === 'active'}
				{#if errorMsg}
					<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
				{/if}

				<button
					class="w-full rounded-lg py-3 text-[13px] font-semibold flex items-center justify-center gap-2 mb-3 disabled:opacity-50"
					style="background: var(--sys-fill); color: var(--sys-label)"
					disabled={sendingCheckpoint}
					onclick={handleCheckpoint}
				>
					{#if sendingCheckpoint}
						<IconLoader2 size={16} class="animate-spin" />
					{:else}
						<IconMapPin size={16} />
					{/if}
					Ambil Lokasi Saya
				</button>
				{#if checkpointMsg}
					<p class="text-[11px] mb-3 text-center" style="color: var(--sys-label3)">{checkpointMsg}</p>
				{/if}

				{#if trip.jenis === 'logistik_harian'}
					{#if trip.pod_status}
						<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: {trip.pod_status === 'tiba' ? 'var(--gg)' : 'var(--rel)'}; color: {trip.pod_status === 'tiba' ? 'var(--ggd)' : 'var(--red)'}">
							POD tercatat: {trip.pod_status === 'tiba' ? `Tiba (${trip.pod_penerima_nama || '-'})` : 'Gagal'}
						</div>
					{:else if !showPodForm}
						<button
							class="w-full rounded-lg py-3 text-[13px] font-semibold flex items-center justify-center gap-2 mb-3"
							style="background: var(--sys-fill); color: var(--sys-label)"
							onclick={() => (showPodForm = true)}
						>
							<IconPackage size={16} />
							Serah Terima (POD)
						</button>
					{:else}
						<div class="rounded-xl p-4 mb-3 flex flex-col gap-3" style="background: var(--sys-fill)">
							{#if podErrorMsg}
								<div class="rounded-lg p-2 text-[11px]" style="background: var(--rel); color: var(--red)">{podErrorMsg}</div>
							{/if}
							<div>
								<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Nama Penerima</label>
								<input class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: white; border: 1px solid var(--sys-sep)" bind:value={podPenerimaNama} />
							</div>
							<div>
								<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Foto Bukti</label>
								<input type="file" accept="image/*" capture="environment" onchange={onFotoChange} class="text-[12px]" />
							</div>
							<div>
								<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Tanda Tangan</label>
								<SignaturePad onSign={(f) => { podTtd = f; tripPersist.savePhoto(POD_TTD_KEY, f); }} />
							</div>
							<div>
								<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Catatan (opsional, isi bila gagal/parsial)</label>
								<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: white; border: 1px solid var(--sys-sep)" bind:value={podCatatan}></textarea>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<button
									class="rounded-lg py-2.5 text-[12px] font-semibold text-white disabled:opacity-50"
									style="background: #DC2626"
									disabled={savingPod}
									onclick={() => submitPodForm('gagal')}
								>
									Tandai Gagal
								</button>
								<button
									class="rounded-lg py-2.5 text-[12px] font-semibold text-white disabled:opacity-50"
									style="background: var(--ggd)"
									disabled={savingPod}
									onclick={() => submitPodForm('tiba')}
								>
									{savingPod ? 'Mengirim…' : 'Tandai Tiba'}
								</button>
							</div>
						</div>
					{/if}
				{/if}

				<div class="rounded-xl p-4 mb-3" style="background: var(--sys-fill)">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Biaya Trip</p>
						<button class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--g)" onclick={() => (showExpenseForm = !showExpenseForm)}>
							<IconPlus size={12} /> Catat Biaya
						</button>
					</div>

					{#if expenses.length === 0 && !showExpenseForm}
						<p class="text-[11px]" style="color: var(--sys-label3)">Belum ada biaya tercatat.</p>
					{:else if !showExpenseForm}
						<div class="flex flex-col gap-1.5">
							{#each expenses as exp}
								<div class="flex items-center justify-between text-[11px]">
									<span style="color: var(--sys-label)">{JENIS_LABEL[exp.jenis] || exp.jenis}{exp.catatan ? ` — ${exp.catatan}` : ''}</span>
									<span class="font-semibold" style="color: var(--sys-label)">Rp {Number(exp.nominal).toLocaleString('id-ID')}</span>
								</div>
							{/each}
						</div>
					{/if}

					{#if showExpenseForm}
						<div class="flex flex-col gap-2 mt-2">
							{#if expenseErrorMsg}
								<div class="rounded-lg p-2 text-[11px]" style="background: var(--rel); color: var(--red)">{expenseErrorMsg}</div>
							{/if}
							<select class="w-full rounded-lg px-3 py-2 text-[12px]" style="background: white; border: 1px solid var(--sys-sep)" bind:value={expenseJenis}>
								<option value="bbm">BBM</option>
								<option value="tol">Tol</option>
								<option value="parkir">Parkir</option>
								<option value="lain">Lain-lain</option>
							</select>
							<input type="number" min="0" placeholder="Nominal (Rp)" class="w-full rounded-lg px-3 py-2 text-[12px]" style="background: white; border: 1px solid var(--sys-sep)" bind:value={expenseNominal} />
							<input type="file" accept="image/*" capture="environment" onchange={onExpenseFotoChange} class="text-[11px]" />
							<input placeholder="Catatan (opsional)" class="w-full rounded-lg px-3 py-2 text-[12px]" style="background: white; border: 1px solid var(--sys-sep)" bind:value={expenseCatatan} />
							<button
								class="w-full rounded-lg py-2 text-[12px] font-semibold text-white disabled:opacity-50"
								style="background: var(--g)"
								disabled={savingExpense}
								onclick={submitExpenseForm}
							>
								{savingExpense ? 'Menyimpan…' : 'Simpan Biaya'}
							</button>
						</div>
					{/if}
				</div>

				{#if !showFinishForm}
					<button
						class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
						style="background: var(--g)"
						onclick={() => (showFinishForm = true)}
					>
						<IconFlag size={16} />
						Selesai Trip
					</button>
				{:else}
					<div class="flex flex-col gap-3">
						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">KM Akhir</label>
							<input type="number" min={trip.km_awal ?? 0} class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={kmAkhir} />
						</div>
						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Catatan (opsional)</label>
							<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={catatanDriver}></textarea>
						</div>
						<div class="flex justify-center">
							<DraftIndicator savedAt={draftSavedAt} />
						</div>
						<button
							class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
							style="background: var(--g)"
							disabled={saving}
							onclick={submitFinish}
						>
							{#if saving}
								<IconLoader2 size={16} class="animate-spin" />
							{/if}
							{saving ? 'Menyimpan…' : 'Konfirmasi Selesai'}
						</button>
					</div>
				{/if}
			{/if}
		{/if}
	</div>
</div>
