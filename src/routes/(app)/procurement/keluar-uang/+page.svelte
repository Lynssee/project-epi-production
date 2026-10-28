<script lang="ts">
	// R1 (§6 Penajaman Petty Cash & LPJ v2) — "Saya keluar uang duluan": satu pintu yang
	// menanyakan 3 hal lalu merutekan ke kanal yang benar (bukan kanal baru — deep-link ke
	// form yang sudah ada). Menutup akar T4: orang tak tahu harus lewat mana.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconWallet, IconChevronRight, IconRefresh } from '@tabler/icons-svelte';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { applyRoutingOverride } from '$lib/shared/moneyRouting';

	type Sudah = 'sudah' | 'belum' | null;
	type Untuk = 'proyek' | 'operasional' | null;
	type Uang = 'pribadi' | 'direksi' | 'kas_kecil' | null;
	type KasKecilJenis = 'beli_barang' | 'lainnya' | null;

	let sudah = $state<Sudah>(null);
	let untuk = $state<Untuk>(null);
	let uang = $state<Uang>(null);
	let kasKecilJenis = $state<KasKecilJenis>(null);
	let darurat = $state<boolean>(false);
	// PRJ-29: dari detail proyek tombol "Keluar Uang" membawa ?project_id= — diteruskan ke form tujuan.
	const projectId = $derived(page.url.searchParams.get('project_id'));
	// PRJ-29: BBM/tol/parkir punya pintu sendiri (Biaya Lapangan), bukan Pengajuan Anggaran/Kas Kecil.
	type Jenis = 'bbm' | 'jasa' | 'gaji' | 'lain' | null;
	// Override routing dari setelan project.money_routing (Finance mengubah tanpa deploy); gagal muat = default kode.
	let routingOverride = $state<Record<string, { href?: string; label?: string; why?: string }>>({});
	onMount(async () => {
		try {
			await loadProjectSettings();
			const r = getProjectSetting('project.money_routing');
			if (r && typeof r === 'object') routingOverride = r as typeof routingOverride;
		} catch (e) {
			console.warn('[keluar-uang] gagal memuat money_routing, pakai default:', e);
		}
	});
	let jenis = $state<Jenis>(null);
	const withProject = (href: string) => {
		if (!projectId) return href;
		return href + (href.includes('?') ? '&' : '?') + 'project_id=' + encodeURIComponent(projectId);
	};

	// Kanal hasil routing. href sudah termasuk query prefill bila relevan.
	let hasil = $derived.by(() => {
		const h = hasilRaw();
		if (!h) return null;
		// Override dari setelan; tujuan hanya diterima bila jalur internal aman (cegah pengalihan ke alamat luar).
		const r = applyRoutingOverride({ label: h.label, why: h.why, href: h.href }, routingOverride[h.key]);
		return { label: r.label, why: r.why, href: withProject(r.href) };
	});

	function hasilRaw(): { key: string; label: string; href: string; why: string } | null {
		if (untuk === 'proyek' && jenis === 'gaji') {
			return { key: 'gaji', label: 'Payroll Manpower Terpusat', href: '/manpower/payroll-terpusat', why: 'Gaji/upah manpower proyek dibayar lewat Payroll Terpusat (periode gaji), bukan Pengajuan Anggaran biasa — agar tidak terhitung dobel dengan akrual absensi.' };
		}
		if (untuk === 'proyek' && jenis === 'jasa') {
			return { key: 'jasa', label: 'Pengajuan Anggaran — Jasa / Borongan', href: '/anggaran', why: 'Jasa dan borongan diajukan lewat Pengajuan Anggaran kategori jasa/termin borongan, dengan memilih SPK-nya. Satu termin = satu pengajuan; jangan mengajukan ulang termin yang sama.' };
		}
		if (untuk === 'proyek' && jenis === 'bbm') {
			return { key: 'bbm', label: 'Biaya Lapangan (BBM / Tol / Parkir)', href: '/biaya-lapangan', why: 'BBM, e-toll, dan parkir proyek dicatat lewat Biaya Lapangan — lengkap dengan kunjungan dan bukti, tanpa perlu pengajuan anggaran terpisah.' };
		}
		if (sudah === 'belum') {
			if (untuk === 'proyek') return { key: 'pa_proyek', label: 'Pengajuan Anggaran (Proyek)', href: '/anggaran', why: 'Belum keluar uang & terkait proyek — minta pencairan dana lewat Pengajuan Anggaran, nanti dipertanggungjawabkan (SPJ).' };
			if (untuk === 'operasional') return { key: 'pa_kaskecil', label: 'Pengajuan Anggaran (Kas Kecil)', href: '/anggaran', why: 'Belum keluar uang, kebutuhan operasional non-proyek — ajukan lewat Pengajuan Anggaran kategori Kas Kecil. SPJ maksimal 7 hari.' };
			return { key: 'kasbon', label: 'Kasbon', href: '/kasbon-terpusat', why: 'Butuh dana talangan pribadi yang akan dipotong dari gaji — pakai Kasbon.' };
		}
		if (sudah === 'sudah') {
			if (uang === 'pribadi') {
				if (untuk === 'proyek') return { key: 'beli_lokal', label: 'Beli Lokal Proyek (Reimburse)', href: `/procurement/beli-lokal${darurat ? '?darurat=1' : ''}`, why: 'Uang pribadi, barang untuk proyek — ajukan penggantian lewat Beli Lokal Proyek. Wajib foto nota.' };
				return { key: 'reimburse', label: 'Klaim Reimbursement', href: '/reimburse', why: 'Uang pribadi, keperluan operasional non-proyek — ajukan Klaim Reimbursement (ESS).' };
			}
			if (uang === 'direksi') return { key: 'beli_lokal', label: 'Beli Lokal Proyek — sumber dana Direksi', href: `/procurement/beli-lokal${darurat ? '?darurat=1' : ''}`, why: 'Dana talangan direksi — catat lewat Beli Lokal Proyek, pilih sumber dana "Direksi". Sistem otomatis membuat utang usaha ke direksi.' };
			if (uang === 'kas_kecil') {
				if (kasKecilJenis === 'beli_barang') return { key: 'beli_lokal', label: 'Beli Lokal Proyek — sumber dana Kas Kecil Lapangan', href: `/procurement/beli-lokal${darurat ? '?darurat=1' : ''}`, why: 'Beli barang/material pakai kas kecil — catat lewat Beli Lokal Proyek, pilih sumber dana "Petty cash lapangan".' };
				if (kasKecilJenis === 'lainnya') return { key: 'kaskecil_ess', label: 'Pengajuan Kas Kecil (ESS)', href: '/ess/petty-cash/baru?mode=reimburse', why: 'Bukan beli barang (mis. BBM, konsumsi, ongkos) — laporkan lewat Pengajuan Kas Kecil, langsung diverifikasi kasir tanpa dicatat sebagai pembelian.' };
				return null; // menunggu jawaban Q4
			}
		}
		return null;
	}

	function reset() {
		sudah = null; untuk = null; uang = null; kasKecilJenis = null; darurat = false; jenis = null;
	}
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-4 sm:px-6 py-4 flex items-center gap-3">
			<button onclick={() => goto('/procurement')} class="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 shrink-0">
				<IconArrowLeft size={20} />
			</button>
			<div class="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white shrink-0">
				<IconWallet size={20} />
			</div>
			<div>
				<h1 class="text-lg font-black text-slate-900 tracking-tight">Saya Keluar Uang Duluan</h1>
				<p class="text-xs font-medium" style="color: var(--sys-label3)">Jawab 3 pertanyaan, kami arahkan ke form yang benar</p>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-24">
		<div class="max-w-lg mx-auto w-full space-y-4">

			<!-- Panduan kanal (PRJ-29) -->
			<details class="glass-panel rounded-2xl p-4 text-xs text-slate-600">
				<summary class="font-bold text-slate-800 cursor-pointer">Kapan pakai form yang mana?</summary>
				<table class="mt-2 w-full text-left">
					<tbody>
						<tr><td class="py-1 pr-2 font-semibold">Pengajuan Anggaran</td><td>Mau minta dana dulu (proyek, jasa, borongan)</td></tr>
						<tr><td class="py-1 pr-2 font-semibold">Biaya Lapangan</td><td>BBM, e-toll, parkir</td></tr>
						<tr><td class="py-1 pr-2 font-semibold">Beli Lokal Proyek</td><td>Sudah beli barang proyek pakai uang sendiri/kas kecil</td></tr>
						<tr><td class="py-1 pr-2 font-semibold">Reimburse</td><td>Uang pribadi, keperluan non-proyek</td></tr>
						<tr><td class="py-1 pr-2 font-semibold">Kasbon</td><td>Pinjaman pribadi, dipotong gaji</td></tr>
						<tr><td class="py-1 pr-2 font-semibold">Payroll Manpower</td><td>Gaji/upah pekerja proyek</td></tr>
					</tbody>
				</table>
				<p class="mt-2">Satu biaya cukup lewat <b>satu</b> pintu — jangan juga dicatat manual di Aktualisasi.</p>
			</details>

			<!-- Q1 -->
			<div class="glass-panel rounded-2xl p-5">
				<p class="text-sm font-bold text-slate-800 mb-3">1. Uangnya sudah keluar, atau mau minta dulu?</p>
				<div class="grid grid-cols-2 gap-2">
					<button class="opt {sudah === 'sudah' ? 'on' : ''}" onclick={() => { sudah = 'sudah'; }}>Sudah keluar</button>
					<button class="opt {sudah === 'belum' ? 'on' : ''}" onclick={() => { sudah = 'belum'; uang = null; }}>Mau minta dulu</button>
				</div>
			</div>

			<!-- Q2 -->
			{#if sudah}
				<div class="glass-panel rounded-2xl p-5">
					<p class="text-sm font-bold text-slate-800 mb-3">2. Untuk apa?</p>
					<div class="grid grid-cols-2 gap-2">
						<button class="opt {untuk === 'proyek' ? 'on' : ''}" onclick={() => { untuk = 'proyek'; }}>Proyek tertentu</button>
						<button class="opt {untuk === 'operasional' ? 'on' : ''}" onclick={() => { untuk = 'operasional'; }}>Operasional / non-proyek</button>
					</div>
				</div>
			{/if}

			<!-- Q2b: jenis biaya (hanya proyek) — PRJ-29 -->
			{#if sudah && untuk === 'proyek'}
				<div class="glass-panel rounded-2xl p-5">
					<p class="text-sm font-bold text-slate-800 mb-3">Jenis biayanya?</p>
					<div class="grid grid-cols-1 gap-2">
						<button class="opt {jenis === 'bbm' ? 'on' : ''}" onclick={() => { jenis = 'bbm'; }}>BBM, e-toll, atau parkir</button>
						<button class="opt {jenis === 'jasa' ? 'on' : ''}" onclick={() => { jenis = 'jasa'; }}>Jasa atau borongan (termin)</button>
						<button class="opt {jenis === 'gaji' ? 'on' : ''}" onclick={() => { jenis = 'gaji'; }}>Gaji / upah manpower</button>
						<button class="opt {jenis === 'lain' ? 'on' : ''}" onclick={() => { jenis = 'lain'; }}>Lainnya (belanja barang/material, dll.)</button>
					</div>
					<p class="text-[11px] text-slate-500 mt-2">Satu biaya cukup lewat satu pintu — jangan dicatat dobel (mis. di Aktualisasi dan di Pengajuan).</p>
				</div>
			{/if}

			<!-- Q3 (hanya bila sudah keluar) -->
			{#if sudah === 'sudah' && untuk && !(untuk === 'proyek' && (jenis === 'bbm' || jenis === 'jasa' || jenis === 'gaji' || jenis === null))}
				<div class="glass-panel rounded-2xl p-5">
					<p class="text-sm font-bold text-slate-800 mb-3">3. Uang siapa yang dipakai?</p>
					<div class="grid grid-cols-1 gap-2">
						<button class="opt {uang === 'pribadi' ? 'on' : ''}" onclick={() => { uang = 'pribadi'; kasKecilJenis = null; }}>Uang saya sendiri (minta ganti)</button>
						<button class="opt {uang === 'direksi' ? 'on' : ''}" onclick={() => { uang = 'direksi'; kasKecilJenis = null; }}>Dana talangan direksi</button>
						<button class="opt {uang === 'kas_kecil' ? 'on' : ''}" onclick={() => { uang = 'kas_kecil'; }}>Kas kecil lapangan</button>
					</div>
				</div>
			{/if}

			<!-- Q4 (hanya bila dari kas kecil lapangan) -->
			{#if sudah === 'sudah' && uang === 'kas_kecil'}
				<div class="glass-panel rounded-2xl p-5">
					<p class="text-sm font-bold text-slate-800 mb-3">4. Dipakai untuk beli barang, atau keperluan lain?</p>
					<div class="grid grid-cols-1 gap-2">
						<button class="opt {kasKecilJenis === 'beli_barang' ? 'on' : ''}" onclick={() => { kasKecilJenis = 'beli_barang'; }}>Beli barang / material</button>
						<button class="opt {kasKecilJenis === 'lainnya' ? 'on' : ''}" onclick={() => { kasKecilJenis = 'lainnya'; }}>Keperluan lain (BBM, konsumsi, ongkos, dll)</button>
					</div>
				</div>
			{/if}

			<!-- Darurat (hanya utk jalur yang benar-benar tercatat sebagai pembelian) -->
			{#if sudah === 'sudah' && (uang === 'pribadi' || uang === 'direksi' || (uang === 'kas_kecil' && kasKecilJenis === 'beli_barang'))}
				<label class="glass-panel rounded-2xl p-4 flex items-center gap-3 cursor-pointer">
					<input type="checkbox" bind:checked={darurat} class="w-4 h-4" />
					<span class="text-sm font-semibold text-slate-700">Darurat — tidak bisa menunggu hari kerja</span>
				</label>
			{/if}

			<!-- Hasil -->
			{#if hasil}
				<div class="glass-panel rounded-2xl p-5 border-2 border-emerald-300 bg-emerald-50/40">
					<p class="text-xs font-bold uppercase text-emerald-700 mb-1">Gunakan form ini</p>
					<p class="text-base font-black text-slate-900">{hasil.label}</p>
					<p class="text-xs text-slate-600 mt-1.5 leading-relaxed">{hasil.why}</p>
					{#if darurat}
						<p class="text-xs font-semibold text-orange-700 mt-1.5">🚨 Mode darurat akan diaktifkan — siapkan foto nota & alasan.</p>
					{/if}
					<button
						class="mt-3 w-full px-4 py-3 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-1.5"
						onclick={() => goto(hasil.href)}
					>
						Lanjut ke {hasil.label} <IconChevronRight size={16} />
					</button>
				</div>
				<button class="w-full text-xs font-medium text-slate-500 flex items-center justify-center gap-1 py-2" onclick={reset}>
					<IconRefresh size={13} /> Ulang dari awal
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.opt {
		padding: 0.6rem 0.75rem; border-radius: 0.75rem; font-size: 0.8125rem; font-weight: 600;
		border: 1px solid #e2e8f0; background: #fff; color: #334155; text-align: left; transition: all 0.15s;
	}
	.opt:hover { border-color: #a7f3d0; }
	.opt.on { border-color: #10b981; background: #ecfdf5; color: #065f46; box-shadow: 0 0 0 3px rgba(16,185,129,0.12); }
</style>
