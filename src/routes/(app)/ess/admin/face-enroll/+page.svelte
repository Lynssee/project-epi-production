<script lang="ts">
	// ESS HRD v3 Fase 1 — halaman admin/HRD mendaftarkan wajah karyawan.
	// Foto referensi diambil manual (bukan liveness) — pendaftaran disaksikan HRD langsung,
	// beda dari clock-in/out yang butuh liveness anti-fake. Consent wajib dicentang sebelum
	// submit (UU PDP) — endpoint server (/api/ess/face/enroll) menolak tanpa consent.

	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { auth } from '$lib/firebase';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconX } from '@tabler/icons-svelte';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'admin_panel', roles)) {
			goto('/');
		}
	});

	let karyawanId = $state('');
	// FITUR-8 (Biometric Attendance Enhancement): multi-angle — depan wajib, kiri/kanan opsional
	// (meningkatkan akurasi match, terutama pencahayaan/sudut kamera lapangan yang bervariasi).
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let photoKiriFile = $state<File | null>(null);
	let photoKiriPreview = $state<string | null>(null);
	let photoKananFile = $state<File | null>(null);
	let photoKananPreview = $state<string | null>(null);
	let consent = $state(false);

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);

	const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB — L-03 fix: foto HP besar (10MB+) bisa 413 error tanpa validasi ini

	function handlePhotoChange(e: Event, angle: 'depan' | 'kiri' | 'kanan') {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > MAX_PHOTO_BYTES) {
			errorMsg = `Ukuran foto terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimum 8MB.`;
			input.value = '';
			return;
		}
		errorMsg = '';
		const url = URL.createObjectURL(file);
		if (angle === 'depan') { photoFile = file; photoPreview = url; }
		else if (angle === 'kiri') { photoKiriFile = file; photoKiriPreview = url; }
		else { photoKananFile = file; photoKananPreview = url; }
	}

	let canSubmit = $derived(!!karyawanId.trim() && !!photoFile && consent && !submitting);

	async function handleSubmit() {
		if (!canSubmit || !photoFile) return;
		submitting = true;
		errorMsg = '';
		try {
			const user = auth.currentUser;
			if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
			const idToken = await user.getIdToken();

			const formData = new FormData();
			formData.append('karyawan_id', karyawanId.trim());
			formData.append('foto', photoFile);
			if (photoKiriFile) formData.append('foto_kiri', photoKiriFile);
			if (photoKananFile) formData.append('foto_kanan', photoKananFile);
			formData.append('consent', 'true');

			const res = await fetch('/api/ess/face/enroll', {
				method: 'POST',
				headers: { Authorization: `Bearer ${idToken}` },
				body: formData
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.message || `Gagal (${res.status})`);
			}
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mendaftarkan wajah.';
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		karyawanId = '';
		photoFile = null;
		photoPreview = null;
		photoKiriFile = null;
		photoKiriPreview = null;
		photoKananFile = null;
		photoKananPreview = null;
		consent = false;
		success = false;
	}
</script>

<div class="w-full p-4 pb-24 max-w-md">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Wajah karyawan berhasil didaftarkan</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={resetForm}>
				Daftarkan Karyawan Lain
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Daftarkan Wajah Karyawan</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Untuk face recognition absensi ESS (Fase 1)</p>

		<div class="flex flex-col gap-4">
			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Karyawan ID</p>
				<input
					type="number"
					bind:value={karyawanId}
					placeholder="mis. 123"
					class="w-full h-10 px-3 rounded-lg text-[13px] border"
					style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
				/>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Referensi (Multi-Angle)</p>
				<p class="text-[10px] mb-2" style="color: var(--sys-label3)">Depan wajib. Kiri & kanan opsional — meningkatkan akurasi verifikasi.</p>
				<div class="flex gap-3 flex-wrap">
					{#each [{ key: 'depan', label: 'Depan *', file: photoFile, preview: photoPreview, clear: () => { photoFile = null; photoPreview = null; } }, { key: 'kiri', label: 'Kiri', file: photoKiriFile, preview: photoKiriPreview, clear: () => { photoKiriFile = null; photoKiriPreview = null; } }, { key: 'kanan', label: 'Kanan', file: photoKananFile, preview: photoKananPreview, clear: () => { photoKananFile = null; photoKananPreview = null; } }] as slot (slot.key)}
						<div class="flex flex-col items-center gap-1">
							{#if slot.preview}
								<div class="relative w-24 h-24">
									<img src={slot.preview} alt="Preview {slot.label}" class="w-24 h-24 object-cover rounded-lg" />
									<button
										class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white"
										style="background: #DC2626"
										onclick={slot.clear}
									>
										<IconX size={14} />
									</button>
								</div>
							{:else}
								<label class="w-24 h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
									<IconCamera size={20} style="color: var(--sys-label4)" />
									<span class="text-[10px]" style="color: var(--sys-label4)">Ambil foto</span>
									<input type="file" accept="image/*" capture="user" class="hidden" onchange={(e) => handlePhotoChange(e, slot.key as 'depan' | 'kiri' | 'kanan')} />
								</label>
							{/if}
							<span class="text-[10px] font-semibold" style="color: var(--sys-label3)">{slot.label}</span>
						</div>
					{/each}
				</div>
			</div>

			<label class="flex items-start gap-2 text-[12px]" style="color: var(--sys-label)">
				<input type="checkbox" bind:checked={consent} class="mt-0.5" />
				<span>
					Karyawan telah setuju wajahnya diproses untuk verifikasi absensi (UU PDP), data disimpan
					self-hosted dan dihapus otomatis 30 hari setelah resign.
				</span>
			</label>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Daftarkan Wajah
			</button>
		</div>
	{/if}
</div>
