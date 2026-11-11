<!-- PDP-33 — Kartu "Visit belum ditutup" di beranda + form Tutup Visit (catatan + foto). Nol tampil bila tidak ada visit terbuka.
     Server (/api/visit-leader/*) menegakkan kepemilikan, kegiatan wajib, dan jumlah foto minimal sesuai setelan. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { menitKeBatas, jamWIB, validasiTutup, type SetelanVisit } from '$lib/shared/visitTutup';
	import { IconCamera, IconX, IconLoader2, IconCheck, IconClipboardCheck } from '@tabler/icons-svelte';

	type Visit = {
		id: number;
		tanggal_kunjungan: string;
		project_name: string | null;
		lokasi?: string | null;
		kegiatan?: string | null;
		temuan?: string | null;
		tindak_lanjut?: string | null;
		rencana_besok?: string | null;
	};

	let visits = $state<Visit[]>([]);
	let setelan = $state<SetelanVisit>({ batasJam: '17:00', pengingatMenit: 60, rekapJam: '17:30', minFoto: 1 });
	let hariIni = $state('');
	let galat = $state('');

	let aktif = $state<Visit | null>(null);
	let kegiatan = $state('');
	let temuan = $state('');
	let tindakLanjut = $state('');
	let rencanaBesok = $state('');
	let foto = $state<{ file: File; url: string }[]>([]);
	let mengirim = $state(false);
	let pesanForm = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	const sisaMenit = $derived(menitKeBatas(jamWIB(), setelan.batasJam));
	const lewatBatas = $derived(sisaMenit != null && sisaMenit <= 0);

	async function muat() {
		try {
			const token = await getIdToken();
			const res = await fetch('/api/visit-leader/belum-ditutup', { headers: { Authorization: `Bearer ${token}` } });
			if (!res.ok) {
				// 403 (akun belum tertaut karyawan) bukan galat bagi pengguna biasa: kartu cukup tidak tampil.
				if (res.status !== 403) galat = 'Visit belum dapat dimuat.';
				return;
			}
			const d = await res.json();
			visits = d.visits || [];
			setelan = d.setelan || setelan;
			hariIni = d.hariIni || '';
		} catch (e) {
			console.warn('[VisitBelumDitutupWidget] gagal memuat visit:', e);
			galat = 'Visit belum dapat dimuat.';
		}
	}
	onMount(muat);

	function buka(v: Visit) {
		aktif = v;
		kegiatan = v.kegiatan || '';
		temuan = v.temuan || '';
		tindakLanjut = v.tindak_lanjut || '';
		rencanaBesok = v.rencana_besok || '';
		foto.forEach((f) => URL.revokeObjectURL(f.url));
		foto = [];
		pesanForm = '';
	}
	function tutupForm() {
		foto.forEach((f) => URL.revokeObjectURL(f.url));
		foto = [];
		aktif = null;
	}

	// Aturan #5: kamera dibuka langsung dari klik — tidak ada await sebelum .click().
	function ambilFoto() {
		if (fileInput) {
			fileInput.value = '';
			fileInput.click();
		}
	}
	function onFoto(e: Event) {
		const files = Array.from((e.target as HTMLInputElement).files || []);
		for (const f of files) foto = [...foto, { file: f, url: URL.createObjectURL(f) }];
	}
	function hapusFoto(i: number) {
		URL.revokeObjectURL(foto[i].url);
		foto = foto.filter((_, idx) => idx !== i);
	}

	async function kirim() {
		if (!aktif || mengirim) return;
		const v = validasiTutup({ kegiatan, fotoCount: foto.length, minFoto: setelan.minFoto });
		if (!v.ok) { pesanForm = v.error; return; }
		mengirim = true;
		pesanForm = '';
		try {
			const ids: string[] = [];
			for (const f of foto) {
				const kecil = await compressPhoto(f.file);
				const id = await uploadEvidencePhoto(kecil, `visit_leader:tutup:${aktif.id}`);
				if (!id) throw new Error('Gagal mengunggah foto. Periksa sinyal lalu coba lagi.');
				ids.push(id);
			}
			const token = await getIdToken();
			const res = await fetch('/api/visit-leader/tutup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ visitId: aktif.id, kegiatan, temuan, tindakLanjut, rencanaBesok, fotoIds: ids })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body?.message || `Gagal (${res.status})`);
			visits = visits.filter((x) => x.id !== aktif!.id);
			tutupForm();
		} catch (e: any) {
			pesanForm = e?.message || 'Gagal menutup visit.';
		} finally {
			mengirim = false;
		}
	}

	const tgl = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '');
</script>

<input type="file" accept="image/*" capture="environment" class="hidden" bind:this={fileInput} onchange={onFoto} />

{#if visits.length > 0}
	<div class="my-3 rounded-xl border p-3" style="border-color: {lewatBatas ? '#f59e0b' : 'var(--sys-separator)'}; background: {lewatBatas ? '#fffbeb' : 'var(--sys-bg2)'}">
		<div class="flex items-center gap-2">
			<IconClipboardCheck size={18} />
			<p class="text-[13px] font-bold" style="color: var(--sys-label)">Visit belum ditutup ({visits.length})</p>
		</div>
		<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
			Tutup visit sebelum pukul {setelan.batasJam} WIB: tulis apa yang dikerjakan dan lampirkan minimal {setelan.minFoto} foto. Ringkasan dikirim ke Admin Project dan PM sore ini.
			{#if lewatBatas}<b class="text-amber-700"> Batas hari ini sudah lewat — tetap bisa ditutup, tetapi akan tercatat belum ditutup di rekap.</b>{/if}
		</p>
		<ul class="mt-2 space-y-1.5">
			{#each visits as v (v.id)}
				<li class="flex items-center gap-2">
					<span class="flex-1 min-w-0 text-[12px]" style="color: var(--sys-label)">
						<span class="block truncate font-semibold">{v.project_name || 'Proyek'}</span>
						<span class="block text-[11px]" style="color: var(--sys-label3)">{tgl(v.tanggal_kunjungan)}{v.tanggal_kunjungan === hariIni ? ' (hari ini)' : ''}</span>
					</span>
					<button class="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white" style="background: var(--pl, #2563eb)" onclick={() => buka(v)}>Tutup Visit</button>
				</li>
			{/each}
		</ul>
	</div>
{:else if galat}
	<p class="text-[11px] my-2" style="color: var(--sys-label3)">{galat}</p>
{/if}

{#if aktif}
	<div class="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
		<div class="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-4 space-y-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-[15px] font-bold">Tutup Visit</h3>
					<p class="text-[11px] text-gray-500">{aktif.project_name || 'Proyek'} · {tgl(aktif.tanggal_kunjungan)}</p>
				</div>
				<button class="p-1 text-gray-400" onclick={tutupForm} aria-label="Tutup" disabled={mengirim}><IconX size={18} /></button>
			</div>

			<label class="block text-[12px] font-semibold">Kegiatan hari ini <span class="text-red-500">*</span>
				<textarea class="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px]" rows="3" bind:value={kegiatan} placeholder="Mis. Inspeksi coating area B, cek progres blasting, meeting dengan klien"></textarea>
			</label>
			<label class="block text-[12px] font-semibold">Temuan
				<textarea class="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px]" rows="2" bind:value={temuan} placeholder="Kendala / hal yang perlu perhatian (boleh kosong)"></textarea>
			</label>
			<label class="block text-[12px] font-semibold">Tindak lanjut
				<textarea class="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px]" rows="2" bind:value={tindakLanjut}></textarea>
			</label>
			<label class="block text-[12px] font-semibold">Rencana besok
				<textarea class="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[13px]" rows="2" bind:value={rencanaBesok}></textarea>
			</label>

			<div>
				<p class="text-[12px] font-semibold">Foto kunjungan <span class="text-red-500">*</span> <span class="font-normal text-gray-500">(minimal {setelan.minFoto})</span></p>
				<div class="flex flex-wrap gap-2 mt-1">
					{#each foto as f, i}
						<div class="relative">
							<img src={f.url} alt="Foto kunjungan {i + 1}" class="h-16 w-16 object-cover rounded-lg border" />
							<button class="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full p-0.5" onclick={() => hapusFoto(i)} aria-label="Hapus foto" disabled={mengirim}><IconX size={12} /></button>
						</div>
					{/each}
					<button class="h-16 w-16 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-500" onclick={ambilFoto} disabled={mengirim}>
						<IconCamera size={20} /><span class="text-[10px]">Foto</span>
					</button>
				</div>
			</div>

			{#if pesanForm}<p class="text-[12px] text-red-600">{pesanForm}</p>{/if}

			<button class="w-full py-2.5 rounded-xl text-white text-[14px] font-bold disabled:opacity-50 flex items-center justify-center gap-2" style="background: var(--pl, #2563eb)" onclick={kirim} disabled={mengirim}>
				{#if mengirim}<IconLoader2 size={16} class="animate-spin" /> Mengirim…{:else}<IconCheck size={16} /> Tutup Visit{/if}
			</button>
		</div>
	</div>
{/if}
