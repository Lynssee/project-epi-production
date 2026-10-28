<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getVehiclesForCheck, getTodayVehicleCheck, submitVehicleCheck, submitFuelLog, getP2HChecklistTemplate } from '$lib/services/driver';
	import P2HChecklistForm from '$lib/components/fleet/P2HChecklistForm.svelte';
	import { DEFAULT_P2H_TEMPLATE, type P2HTemplateItem } from '$lib/data/p2hChecklist';
	import { IconLoader2, IconArrowLeft, IconClipboardCheck, IconGasStation } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { driverFuelLogSchema } from '$lib/schemas/driverFuelLog';
	import { driverVehicleCheckSchema } from '$lib/schemas/driverVehicleCheck';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let mode = $state<'p2h' | 'bbm'>('p2h');

	// --- state BBM ---
	let bbmVehicleId = $state('');
	let bbmLiter = $state('');
	let bbmTotalBiaya = $state('');
	let bbmOdometer = $state('');
	let bbmCatatan = $state('');
	let bbmFoto = $state<File | null>(null);
	let bbmSaving = $state(false);
	let bbmSuccess = $state('');
	let bbmError = $state('');

	function onBbmFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		bbmFoto = input.files?.[0] || null;
		if (bbmFoto) checkPersist.savePhoto(BBM_PHOTO_KEY, bbmFoto);
	}

	async function submitBbm() {
		bbmError = '';
		bbmSuccess = '';
		const parsed = driverFuelLogSchema.safeParse({
			vehicle_id: bbmVehicleId,
			liter: bbmLiter,
			total_biaya: bbmTotalBiaya,
			odometer: bbmOdometer || null,
			catatan: bbmCatatan
		});
		if (!parsed.success) {
			bbmError = parsed.error.issues[0]?.message || 'Data log BBM tidak valid.';
			return;
		}

		bbmSaving = true;
		try {
			const compressedBbmFoto = bbmFoto ? await compressPhoto(bbmFoto) : null;
			await submitFuelLog({ ...parsed.data, foto: compressedBbmFoto });
			bbmSuccess = 'Log BBM tersimpan.';
			bbmLiter = ''; bbmTotalBiaya = ''; bbmOdometer = ''; bbmCatatan = ''; bbmFoto = null;
			// Hanya foto struk BBM yang dibuang — draf P2H di tab sebelah harus tetap utuh.
			// Sisa field yang baru saja dikosongkan ikut tertulis oleh autosave.
			await checkPersist.clearPhoto(BBM_PHOTO_KEY);
		} catch (err) {
			bbmError = err instanceof Error ? err.message : 'Gagal menyimpan log BBM.';
		} finally {
			bbmSaving = false;
		}
	}

	// ESS Redesign — daftar item P2H dari config (fleet_settings.checklist_template_peminjam),
	// sama untuk semua pengemudi (driver/sales/leader). Fallback DEFAULT_P2H_TEMPLATE.
	let template = $state<P2HTemplateItem[]>(DEFAULT_P2H_TEMPLATE);

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let vehicles = $state<any[]>([]);
	let vehicleId = $state('');
	let alreadyChecked = $state(false);
	let dailyTaskBookingId = $state<string | null>(null);

	let itemStatus = $state<Record<string, 'ok' | 'rusak' | 'tidak_ada'>>({});
	let kmSaatCek = $state(0);
	let temuan = $state('');
	let foto = $state<File | null>(null);

	// Jaring pengaman draf: OS bisa membunuh tab selagi kamera native terbuka (foto
	// temuan kerusakan / struk BBM). Halaman ini punya DUA form terpisah (P2H & BBM),
	// keduanya ikut dipulihkan — termasuk tab mana yang sedang dibuka.
	interface DriverCheckDraft {
		mode: 'p2h' | 'bbm';
		vehicleId: string;
		itemStatus: Record<string, 'ok' | 'rusak' | 'tidak_ada'>;
		kmSaatCek: number;
		temuan: string;
		bbmVehicleId: string;
		bbmLiter: string;
		bbmTotalBiaya: string;
		bbmOdometer: string;
		bbmCatatan: string;
	}
	const P2H_PHOTO_KEY = 'temuan';
	const BBM_PHOTO_KEY = 'struk';
	const checkPersist = createFormPersist<DriverCheckDraft>('driver_check');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function checkSnapshot(): DriverCheckDraft {
		return {
			mode,
			vehicleId,
			itemStatus,
			kmSaatCek,
			temuan,
			bbmVehicleId,
			bbmLiter,
			bbmTotalBiaya,
			bbmOdometer,
			bbmCatatan
		};
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'submit_vehicle_check', roles)) {
			goto('/driver');
		}
	});

	onMount(async () => {
		[vehicles, template] = await Promise.all([getVehiclesForCheck(), getP2HChecklistTemplate()]);

		const draft = checkPersist.restore();
		if (draft) {
			mode = draft.mode;
			vehicleId = draft.vehicleId;
			if (draft.itemStatus && typeof draft.itemStatus === 'object') itemStatus = draft.itemStatus;
			kmSaatCek = draft.kmSaatCek ?? 0;
			temuan = draft.temuan;
			bbmVehicleId = draft.bbmVehicleId;
			bbmLiter = draft.bbmLiter;
			bbmTotalBiaya = draft.bbmTotalBiaya;
			bbmOdometer = draft.bbmOdometer;
			bbmCatatan = draft.bbmCatatan;

			const [temuanBlob, strukBlob] = await Promise.all([
				checkPersist.restorePhoto(P2H_PHOTO_KEY),
				checkPersist.restorePhoto(BBM_PHOTO_KEY)
			]);
			if (temuanBlob) foto = new File([temuanBlob], 'temuan.jpg', { type: temuanBlob.type || 'image/jpeg' });
			if (strukBlob) bbmFoto = new File([strukBlob], 'struk.jpg', { type: strukBlob.type || 'image/jpeg' });

			// Cek ulang ke server: bisa jadi P2H kendaraan ini sudah diisi dari perangkat lain
			// selagi draf menganggur, jadi jangan langsung percaya draf.
			if (vehicleId) await onVehicleChange();
			draftSavedAt = new Date();
		}

		// Datang dari tombol "Mulai Tugas Hari Ini" — vehicle & booking sudah ditentukan sistem.
		const qVehicle = $page.url.searchParams.get('vehicle');
		const qBooking = $page.url.searchParams.get('booking');
		if (qVehicle) {
			mode = 'p2h';
			vehicleId = qVehicle;
			dailyTaskBookingId = qBooking;
			await onVehicleChange();
		}

		draftArmed = true;
		loading = false;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void checkSnapshot();
		if (!draftArmed) return;
		checkPersist.save(checkSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(checkPersist, checkSnapshot));

	async function onVehicleChange() {
		alreadyChecked = false;
		if (!vehicleId) return;
		const today = new Date().toISOString().split('T')[0];
		const existing = await getTodayVehicleCheck(vehicleId, today);
		alreadyChecked = !!existing;
	}

	// Simpan foto P2H ke draf saat berubah (dulu dikerjakan onFotoChange; kini <input> ada di
	// P2HChecklistForm, jadi pakai efek reaktif).
	$effect(() => {
		if (draftArmed && foto) checkPersist.savePhoto(P2H_PHOTO_KEY, foto);
	});

	async function submit() {
		errorMsg = '';
		successMsg = '';
		const items = template.map((t) => ({
			key: t.key,
			label: t.label,
			kritis: !!t.kritis,
			status: itemStatus[t.key] || ('ok' as const)
		}));
		const parsed = driverVehicleCheckSchema.safeParse({
			vehicle_id: vehicleId,
			items,
			temuan,
			km_saat_cek: kmSaatCek
		});
		if (!parsed.success) {
			errorMsg = parsed.error.issues[0]?.message || 'Data checklist kendaraan tidak valid.';
			return;
		}

		saving = true;
		try {
			const compressedFoto = foto ? await compressPhoto(foto) : null;
			const res = await submitVehicleCheck({
				vehicle_id: parsed.data.vehicle_id,
				items: parsed.data.items,
				temuan: parsed.data.temuan,
				kmSaatCek,
				foto: compressedFoto,
				bookingId: dailyTaskBookingId
			});
			successMsg = res.work_order
				? 'Checklist tersimpan. Ada item bermasalah — tiket maintenance otomatis dibuat.'
				: 'Checklist tersimpan. Kendaraan dinyatakan laik jalan.';
			alreadyChecked = true;
			// P2H terkirim: kosongkan isian + foto temuannya, tapi jangan sentuh draf BBM.
			itemStatus = {};
			temuan = '';
			foto = null;
			await checkPersist.clearPhoto(P2H_PHOTO_KEY);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan checklist.';
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
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Cek Kendaraan (P2H) & BBM</h1>
			<div class="ml-auto"><DraftIndicator savedAt={draftSavedAt} hasPhotos={!!foto || !!bbmFoto} /></div>
		</div>

		<div class="flex rounded-lg p-1 mb-4" style="background: var(--sys-fill)">
			<button
				class="flex-1 rounded-md py-2 text-[12px] font-semibold flex items-center justify-center gap-1"
				style={mode === 'p2h' ? 'background: white; color: #1F6592' : 'color: var(--sys-label3)'}
				onclick={() => (mode = 'p2h')}
			><IconClipboardCheck size={14} /> P2H</button>
			<button
				class="flex-1 rounded-md py-2 text-[12px] font-semibold flex items-center justify-center gap-1"
				style={mode === 'bbm' ? 'background: white; color: #1F6592' : 'color: var(--sys-label3)'}
				onclick={() => (mode = 'bbm')}
			><IconGasStation size={14} /> BBM</button>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat checklist armada..." />
		{:else if mode === 'bbm'}
			{#if bbmError}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{bbmError}</div>
			{/if}
			{#if bbmSuccess}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{bbmSuccess}</div>
			{/if}

			<div class="mb-3">
				<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Kendaraan</label>
				<select class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={bbmVehicleId}>
					<option value="">Pilih kendaraan…</option>
					{#each vehicles as v}
						<option value={v.id}>{v.name} {v.code ? `(${v.code})` : ''}</option>
					{/each}
				</select>
			</div>
			<div class="grid grid-cols-2 gap-2 mb-3">
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Liter</label>
					<input type="number" step="0.01" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={bbmLiter} />
				</div>
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Total Biaya (Rp)</label>
					<input type="number" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={bbmTotalBiaya} />
				</div>
			</div>
			<div class="mb-3">
				<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Odometer Saat Ini (opsional)</label>
				<input type="number" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={bbmOdometer} />
			</div>
			<div class="mb-3">
				<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Catatan (opsional)</label>
				<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={bbmCatatan}></textarea>
			</div>
			<div class="mb-4">
				<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Foto Struk (opsional)</label>
				<input type="file" accept="image/*" capture="environment" onchange={onBbmFotoChange} class="text-[12px]" />
			</div>
			<button
				class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
				style="background: #1F6592"
				disabled={bbmSaving}
				onclick={submitBbm}
			>
				{#if bbmSaving}<IconLoader2 size={16} class="animate-spin" />{:else}<IconGasStation size={16} />{/if}
				{bbmSaving ? 'Menyimpan…' : 'Simpan Log BBM'}
			</button>
		{:else}
			{#if errorMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
			{/if}
			{#if successMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>
			{/if}

			<div class="mb-4">
				<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Kendaraan</label>
				<select class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={vehicleId} onchange={onVehicleChange}>
					<option value="">Pilih kendaraan…</option>
					{#each vehicles as v}
						<option value={v.id}>{v.name} {v.code ? `(${v.code})` : ''}</option>
					{/each}
				</select>
			</div>

			{#if alreadyChecked}
				<div class="rounded-lg p-4 text-[12px] text-center" style="background: var(--sys-fill); color: var(--sys-label3)">
					Kendaraan ini sudah dicek hari ini.
				</div>
			{:else if vehicleId}
				<P2HChecklistForm
					{template}
					bind:itemStatus
					bind:kmSaatCek
					bind:temuan
					bind:fotoFile={foto}
					kmLabel="Odometer Saat Cek (KM)"
					disabled={saving}
				/>

				<button
					class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
					style="background: #1F6592"
					disabled={saving}
					onclick={submit}
				>
					{#if saving}
						<IconLoader2 size={16} class="animate-spin" />
					{:else}
						<IconClipboardCheck size={16} />
					{/if}
					{saving ? 'Menyimpan…' : 'Simpan Checklist'}
				</button>
			{/if}
		{/if}
	</div>
</div>
