<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchActivePrograms, submitPenerima, type CsrProgram } from '$lib/services/csr';
	import SignaturePad from '$lib/components/shared/SignaturePadCallback.svelte';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { csrPenerimaSchema } from '$lib/schemas/csrPenerima';

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let programs = $state<CsrProgram[]>([]);

	let programId = $state<number | null>(Number(page.url.searchParams.get('program_id')) || null);
	let nama = $state('');
	let kategori = $state<'individu' | 'kelompok' | 'lembaga'>('individu');
	let desaWilayah = $state('');
	let kontak = $state('');
	let nik = $state('');
	let consentPdp = $state(false);
	let signatureFile = $state<File | null>(null);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_csr', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			programs = await fetchActivePrograms();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat program CSR.';
		}
		loading = false;
	});

	async function submit() {
		errorMsg = '';
		successMsg = '';
		const parsed = csrPenerimaSchema.safeParse({
			program_id: programId,
			nama,
			kategori,
			desa_wilayah: desaWilayah,
			kontak,
			nik,
			consent_pdp: consentPdp
		});
		if (!parsed.success) {
			errorMsg = parsed.error.issues[0]?.message || 'Data penerima manfaat tidak valid.';
			return;
		}

		saving = true;
		try {
			await submitPenerima({ ...parsed.data, signature: signatureFile });
			successMsg = 'Penerima manfaat berhasil didaftarkan.';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mendaftarkan penerima.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/csr')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Daftar Penerima Manfaat</h1>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat data penerima manfaat..." />
		{:else}
			{#if errorMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
			{/if}
			{#if successMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>
			{/if}

			{#if !successMsg}
				<div class="flex flex-col gap-3">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Program CSR</label>
						<select
							class="w-full rounded-lg px-3 py-2.5 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={programId}
						>
							<option value={null}>— pilih program —</option>
							{#each programs as p (p.id)}<option value={p.id}>{p.nama} ({p.pilar})</option>{/each}
						</select>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Nama Penerima</label>
						<input
							type="text"
							class="w-full rounded-lg px-3 py-2.5 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={nama}
						/>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Kategori</label>
							<select
								class="w-full rounded-lg px-3 py-2.5 text-[13px]"
								style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
								bind:value={kategori}
							>
								<option value="individu">Individu</option>
								<option value="kelompok">Kelompok</option>
								<option value="lembaga">Lembaga</option>
							</select>
						</div>
						<div>
							<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Desa / Wilayah</label>
							<input
								type="text"
								class="w-full rounded-lg px-3 py-2.5 text-[13px]"
								style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
								bind:value={desaWilayah}
							/>
						</div>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Kontak</label>
						<input
							type="text"
							class="w-full rounded-lg px-3 py-2.5 text-[13px]"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={kontak}
						/>
					</div>

					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">
							NIK <span style="color: var(--sys-label3); font-weight: 400">(otomatis di-mask, tidak disimpan mentah)</span>
						</label>
						<input
							type="text"
							inputmode="numeric"
							maxlength="16"
							class="w-full rounded-lg px-3 py-2.5 text-[13px] font-mono"
							style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
							bind:value={nik}
						/>
					</div>

					<label class="flex items-start gap-2 text-[12px] p-3 rounded-lg" style="background: var(--sys-fill); color: var(--sys-label)">
						<input type="checkbox" class="mt-0.5" bind:checked={consentPdp} />
						Penerima telah menyetujui penggunaan data pribadinya untuk keperluan program CSR ini (persetujuan sesuai UU No. 27/2022 tentang PDP).
					</label>

					<div>
						<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Tanda Tangan Serah Terima (opsional)</p>
						<SignaturePad onSign={(file) => (signatureFile = file)} />
					</div>

					<button
						class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
						style="background: var(--g)"
						disabled={saving}
						onclick={submit}
					>
						{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
						{saving ? 'Mengirim…' : 'Simpan Penerima'}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>
