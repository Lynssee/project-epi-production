<script lang="ts">
	// Pengajuan Darurat Atas Nama — panel form lapangan (PA & PR). Tampil HANYA bila server menyatakan
	// pengguna berhak untuk proyek terpilih (Leader/Wakil Leader proyek itu, atau Supervisor berizin).
	// Hak & daftar pemohon ditentukan server (/api/pengajuan-atas-nama/anggota) — bukan logika klien.
	import { getIdToken } from '$lib/services/secureDirectus';

	let {
		projectId = null,
		enabled = $bindable(false),
		alasan = $bindable(''),
		pemohonId = $bindable<number | null>(null),
		pemohonNama = $bindable(''),
		jenisLabel = 'pengajuan'
	}: {
		projectId?: number | null;
		enabled?: boolean;
		alasan?: string;
		pemohonId?: number | null;
		pemohonNama?: string;
		jenisLabel?: string;
	} = $props();

	let allowed = $state(false);
	let anggota = $state<Array<{ karyawanId: number; nama: string; divisi: string | null; punyaHp: boolean }>>([]);
	let loading = $state(false);
	let lastProject: number | null = null;

	async function muat(pid: number | null) {
		if (!pid) {
			allowed = false;
			anggota = [];
			return;
		}
		loading = true;
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/pengajuan-atas-nama/anggota?projectId=${pid}`, { headers: { Authorization: `Bearer ${token}` } });
			const j = await res.json().catch(() => ({}));
			allowed = !!j?.allowed;
			anggota = j?.anggota || [];
		} catch {
			allowed = false;
			anggota = [];
		} finally {
			loading = false;
		}
	}

	// Muat ulang hanya saat proyek berganti (hemat API); reset pilihan bila proyek berubah.
	$effect(() => {
		const pid = projectId;
		if (pid === lastProject) return;
		lastProject = pid;
		pemohonId = null;
		pemohonNama = '';
		muat(pid);
	});

	// Tidak berhak untuk proyek ini -> pastikan mode mati supaya form tidak mengirim flag.
	$effect(() => {
		if (!allowed && enabled) enabled = false;
	});

	function pilih(e: Event) {
		const v = Number((e.target as HTMLSelectElement).value);
		const a = anggota.find((x) => x.karyawanId === v);
		pemohonId = a ? a.karyawanId : null;
		pemohonNama = a ? a.nama : '';
	}
</script>

{#if allowed}
	<div class="rounded-2xl p-3 mb-4 space-y-2" style="background: rgba(234, 88, 12, 0.07); border: 1px solid rgba(234, 88, 12, 0.5)">
		<label class="flex items-start gap-3 cursor-pointer select-none">
			<input type="checkbox" bind:checked={enabled} class="mt-0.5 w-5 h-5 shrink-0" />
			<span class="text-sm">
				<strong style="color: var(--sys-label)">⚡ Ajukan Atas Nama Anggota Proyek</strong>
				<span class="block text-xs" style="color: var(--sys-label3)">
					Untuk anggota yang tidak bisa mengisi sendiri (sinyal/kuota/di lapangan). Yang bersangkutan wajib memeriksa &amp; menandatangani dulu sebelum {jenisLabel} masuk approval. Anda bisa menariknya selama belum dikonfirmasi.
				</span>
			</span>
		</label>

		{#if enabled}
			<div>
				<label for="pemohon-atas-nama" class="text-xs font-bold block mb-1" style="color: var(--sys-label3)">Pemohon (anggota proyek) <span class="text-red-500">*</span></label>
				<select
					id="pemohon-atas-nama"
					class="w-full px-3 py-2.5 rounded-xl border text-sm"
					style="border-color: var(--sys-sep); background: var(--sys-bg2)"
					value={pemohonId ?? ''}
					onchange={pilih}
				>
					<option value="">{loading ? 'Memuat anggota...' : 'Pilih anggota proyek'}</option>
					{#each anggota as a (a.karyawanId)}
						<option value={a.karyawanId}>{a.nama}{a.divisi ? ` — ${a.divisi}` : ''}{a.punyaHp ? '' : ' (tanpa nomor HP)'}</option>
					{/each}
				</select>
				{#if !loading && anggota.length === 0}
					<p class="text-xs mt-1 text-red-600">Belum ada anggota aktif proyek ini yang tertaut ke data karyawan.</p>
				{/if}
			</div>
			<div>
				<label for="alasan-atas-nama" class="text-xs font-bold block mb-1" style="color: var(--sys-label3)">Alasan kebutuhan darurat <span class="text-red-500">*</span></label>
				<textarea
					id="alasan-atas-nama"
					rows="2"
					bind:value={alasan}
					placeholder="Contoh: lokasi remote / sinyal padam, anggota tidak bisa mengisi sendiri"
					class="w-full p-3 rounded-xl text-sm border outline-none"
					style="border-color: var(--sys-sep); background: var(--sys-bg2)"
				></textarea>
			</div>
			<p class="text-xs rounded-xl p-2" style="background: rgba(234, 88, 12, 0.12); color: #9a3412">
				💡 Pemohon akan menerima pemberitahuan (WhatsApp bila nomor HP tersedia) dan kartu "Perlu konfirmasi Anda" di Pusat Pengajuan. Jika ada angka yang salah, pemohon menolaknya dan Anda membuat ulang.
			</p>
		{/if}
	</div>
{/if}
