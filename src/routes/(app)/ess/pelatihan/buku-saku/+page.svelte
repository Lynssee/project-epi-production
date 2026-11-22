<script lang="ts">
	// Buku Saku Cat (EPI Academy, Fase 3): alat hitung & kartu referensi cepat untuk lapangan.
	// Kalkulator & kartu 100% sisi klien. Tab "Barang & Bahan" memuat referensi 360°/R&D sekali (salinan lokal 24 jam) — hemat kuota.
	import { getReferensiSaku, getKartuTroubleshoot, type ReferensiSakuData, type KartuTroubleshoot } from '$lib/services/ess/training';
	import { IconCalculator, IconCloudRain, IconCards, IconInfoCircle, IconTool, IconCircleCheck, IconAlertTriangle } from '@tabler/icons-svelte';
	import { cekAplikasi, wftDariDft, dftDariWft, tsr, kebutuhanCat, kehilanganTekanan, DEW_MARGIN_C, RH_MAX_PERSEN } from '$lib/utils/coatingCalc';

	type Tab = 'kalkulator' | 'cuaca' | 'kartu' | 'referensi' | 'troubleshoot';
	let tab = $state<Tab>('cuaca');

	// --- Referensi Barang & Bahan (profil 360° terverifikasi + bahaya R&D). Dimuat malas saat tab dibuka; salinan lokal 24 jam. ---
	let ref = $state<ReferensiSakuData | null>(null);
	let refLoading = $state(false);
	let refError = $state('');
	let refDariCache = $state(false);
	let refCari = $state('');
	async function muatReferensi() {
		if (ref || refLoading) return;
		refLoading = true;
		refError = '';
		try {
			const r = await getReferensiSaku();
			ref = r.data;
			refDariCache = r.dariCache;
		} catch (e: any) {
			refError = e?.message || 'Gagal memuat referensi.';
		} finally {
			refLoading = false;
		}
	}
	$effect(() => { if (tab === 'referensi') muatReferensi(); });

	// --- Troubleshoot Quick Reference: dimuat malas, salinan lokal agar tetap terbaca tanpa sinyal. ---
	let tsCards = $state<KartuTroubleshoot[]>([]);
	let tsLoaded = $state(false);
	let tsLoading = $state(false);
	let tsError = $state('');
	let tsDariCache = $state(false);
	let tsCari = $state('');
	let tsBuka = $state<string | null>(null);
	async function muatTroubleshoot() {
		if (tsLoaded || tsLoading) return;
		tsLoading = true;
		tsError = '';
		try {
			const r = await getKartuTroubleshoot();
			tsCards = r.cards;
			tsDariCache = r.dariCache;
			tsLoaded = true;
		} catch (e: any) {
			tsError = e?.message || 'Gagal memuat kartu troubleshoot.';
		} finally {
			tsLoading = false;
		}
	}
	$effect(() => { if (tab === 'troubleshoot') muatTroubleshoot(); });
	const tsTampil = $derived(tsCards.filter((c) => !tsCari.trim() || `${c.judul} ${c.alat} ${c.gejala}`.toLowerCase().includes(tsCari.trim().toLowerCase())));
	let refBarang = $derived((ref?.barang ?? []).filter((b) => !refCari.trim() || b.nama.toLowerCase().includes(refCari.trim().toLowerCase())));
	let refMaterial = $derived((ref?.material ?? []).filter((m) => !refCari.trim() || m.nama.toLowerCase().includes(refCari.trim().toLowerCase())));

	// --- Kalkulator cat ---
	let vs = $state('');
	let dft = $state('');
	let thinner = $state('');
	let wftUkur = $state('');
	let luas = $state('');
	let efisiensi = $state('0,8');
	let psiNozzle = $state('');

	let wft = $derived(wftDariDft(dft, vs, thinner));
	let dftHasil = $derived(dftDariWft(wftUkur, vs, thinner));
	let rate = $derived(tsr(vs, dft));
	let butuh = $derived(kebutuhanCat(luas, vs, dft, efisiensi));
	let tekanan = $derived(kehilanganTekanan(psiNozzle));

	// --- Cek cuaca ---
	let suhuUdara = $state('');
	let rh = $state('');
	let suhuBaja = $state('');
	let cek = $derived(cekAplikasi(suhuUdara, rh, suhuBaja));
	let dewSaja = $derived(cekAplikasi(suhuUdara, rh, suhuUdara)?.dewPoint ?? null);

	const SA = [
		{ k: 'Sa 1 · SSPC-SP7', d: 'Brush-off: hanya membuang mill scale/karat/cat yang lepas.' },
		{ k: 'Sa 2 · SSPC-SP6', d: 'Commercial: ± dua pertiga permukaan bersih dari mill scale/karat.' },
		{ k: 'Sa 2.5 · SSPC-SP10', d: 'Near-white: ± 95% bersih, hanya bayangan/garis tipis. STANDAR UMUM EPI.' },
		{ k: 'Sa 3 · SSPC-SP5', d: 'White metal: 100% logam putih. Untuk immersion/lingkungan sangat korosif.' }
	];
	const CACAT = [
		{ k: 'Blistering (gelembung)', d: 'Solvent/kelembaban terjebak, garam di bawah film. Cek kontaminasi & kondisi cuaca.' },
		{ k: 'Pinhole / cratering', d: 'Udara terjebak, solvent menguap terlalu cepat, kontaminasi minyak/silikon.' },
		{ k: 'Runs / sags (meleleh)', d: 'Cat terlalu encer, WFT terlalu tebal, gerakan gun terlalu lambat.' },
		{ k: 'Dry spray / overspray', d: 'Tekanan terlalu tinggi, jarak terlalu jauh, angin kencang.' },
		{ k: 'Orange peel', d: 'Cat terlalu kental, tekanan kurang, thinner tidak cocok.' },
		{ k: 'Amine blush', d: 'Epoxy lengket keputihan akibat curing di kelembaban tinggi. Jangan di-overcoat sebelum dibersihkan sesuai TDS.' }
	];
	const K3 = [
		'Ruang terbatas: izin kerja, gas testing, ventilasi, standby man. Jangan masuk menolong tanpa alat.',
		'Airless ≥ 3000 PSI: luka kecil bisa fluid injection. Segera ke medis, bawa info produk.',
		'Grounding nozzle & blast pot untuk mencegah percikan statis di area uap solvent.',
		'Ketinggian: tag perancah hijau = layak, merah = dilarang. 100% tie-off.'
	];
</script>

<div class="w-full p-4 md:p-6 pb-24 max-w-3xl mx-auto">
	<div class="mb-5">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Buku Saku Cat</h1>
		<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">Alat hitung & kartu cepat untuk lapangan. Tanpa kuota data setelah halaman terbuka.</p>
	</div>

	<div class="grid grid-cols-5 gap-2 mb-5" role="tablist" aria-label="Menu Buku Saku">
		{#each [{ id: 'cuaca', label: 'Cek Cuaca', icon: IconCloudRain }, { id: 'kalkulator', label: 'Kalkulator', icon: IconCalculator }, { id: 'referensi', label: 'Barang & Bahan', icon: IconInfoCircle }, { id: 'kartu', label: 'Kartu Cepat', icon: IconCards }, { id: 'troubleshoot', label: 'Troubleshoot', icon: IconTool }] as t (t.id)}
			<button
				role="tab"
				aria-selected={tab === t.id}
				class="flex flex-col items-center gap-1 py-3 rounded-2xl text-xs font-bold transition-colors {tab === t.id ? 'gradient-bg text-white' : 'glass-panel'}"
				onclick={() => (tab = t.id as Tab)}
			>
				<t.icon size={20} />
				{t.label}
			</button>
		{/each}
	</div>

	{#if tab === 'cuaca'}
		<div class="glass-panel rounded-2xl p-5 flex flex-col gap-4">
			<p class="text-xs flex gap-2" style="color: var(--sys-label3)">
				<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
				Ukur dulu suhu udara & kelembaban (RH), lalu suhu permukaan baja. Aman mengecat bila suhu baja ≥ dew point + {DEW_MARGIN_C}°C dan RH ≤ {RH_MAX_PERSEN}%. Cek ulang tiap beberapa jam atau saat cuaca berubah.
			</p>
			<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">
				Suhu udara (°C)
				<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="mis. 30" bind:value={suhuUdara} />
			</label>
			<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">
				Kelembaban relatif / RH (%)
				<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="mis. 75" bind:value={rh} />
			</label>
			<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">
				Suhu permukaan baja (°C)
				<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="ukur dengan termometer permukaan" bind:value={suhuBaja} />
			</label>

			{#if cek}
				<div class="rounded-2xl p-4 flex flex-col gap-1.5" style="background: {cek.boleh ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)'}">
					<div class="flex items-center gap-2 text-base font-extrabold" style="color: {cek.boleh ? '#15803d' : '#DC2626'}">
						{#if cek.boleh}<IconCircleCheck size={22} /> BOLEH MENGECAT{:else}<IconAlertTriangle size={22} /> JANGAN MENGECAT{/if}
					</div>
					<div class="text-sm font-semibold" style="color: var(--sys-label2)">Dew point {cek.dewPoint}°C · selisih baja {cek.selisih}°C · RH {rh}%</div>
					{#each cek.alasan as a}<div class="text-xs font-semibold" style="color: #DC2626">• {a}</div>{/each}
					{#if !cek.boleh}<div class="text-xs" style="color: var(--sys-label3)">Tunda pengecatan atau ubah kondisi (pemanas / dehumidifier), lalu ukur ulang.</div>{/if}
				</div>
			{:else if dewSaja !== null}
				<div class="rounded-2xl p-4 text-sm font-semibold" style="background: rgba(0,0,0,0.04); color: var(--sys-label2)">Dew point {dewSaja}°C. Isi suhu permukaan baja untuk keputusan.</div>
			{:else}
				<p class="text-xs" style="color: var(--sys-label4)">Isi ketiga kolom untuk melihat keputusan. Angka dengan koma (30,5) diterima.</p>
			{/if}
		</div>
	{:else if tab === 'kalkulator'}
		<div class="flex flex-col gap-4">
			<div class="glass-panel rounded-2xl p-5 flex flex-col gap-4">
				<h2 class="text-sm font-extrabold" style="color: var(--sys-label)">WFT ↔ DFT & Spreading Rate</h2>
				<p class="text-xs flex gap-2" style="color: var(--sys-label3)">
					<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
					Ambil %Volume Solid (%VS) dari TDS cat. WFT = tebal basah, DFT = tebal kering (µm). Isi %VS dan DFT target untuk tahu WFT yang harus dicapai saat menyemprot.
				</p>
				<div class="grid grid-cols-2 gap-3">
					<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">%VS (dari TDS)
						<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="mis. 60" bind:value={vs} />
					</label>
					<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">DFT target (µm)
						<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="mis. 150" bind:value={dft} />
					</label>
					<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">Thinner (%) <span class="font-medium" style="color: var(--sys-label4)">opsional</span>
						<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="0" bind:value={thinner} />
					</label>
					<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">WFT terukur (µm) <span class="font-medium" style="color: var(--sys-label4)">opsional</span>
						<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="alat WFT comb" bind:value={wftUkur} />
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="rounded-xl p-3" style="background: rgba(0,0,0,0.04)">
						<div class="text-[11px] font-bold uppercase" style="color: var(--sys-label4)">Target WFT</div>
						<div class="text-xl font-extrabold" style="color: var(--sys-label)">{wft !== null ? `${wft} µm` : '—'}</div>
					</div>
					<div class="rounded-xl p-3" style="background: rgba(0,0,0,0.04)">
						<div class="text-[11px] font-bold uppercase" style="color: var(--sys-label4)">DFT dari WFT terukur</div>
						<div class="text-xl font-extrabold" style="color: var(--sys-label)">{dftHasil !== null ? `${dftHasil} µm` : '—'}</div>
					</div>
					<div class="rounded-xl p-3 col-span-2" style="background: rgba(0,0,0,0.04)">
						<div class="text-[11px] font-bold uppercase" style="color: var(--sys-label4)">Spreading rate teoritis (TSR)</div>
						<div class="text-xl font-extrabold" style="color: var(--sys-label)">{rate !== null ? `${rate} m²/liter` : '—'}</div>
					</div>
				</div>
			</div>

			<div class="glass-panel rounded-2xl p-5 flex flex-col gap-4">
				<h2 class="text-sm font-extrabold" style="color: var(--sys-label)">Kebutuhan Cat</h2>
				<p class="text-xs flex gap-2" style="color: var(--sys-label3)">
					<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
					Memakai %VS & DFT di atas. Efisiensi (0–1) = kehilangan lapangan (angin, overspray, profil). Pakai angka dari RAP/standar proyek; 0,8 hanya contoh awal.
				</p>
				<div class="grid grid-cols-2 gap-3">
					<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">Luas (m²)
						<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="mis. 200" bind:value={luas} />
					</label>
					<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">Efisiensi (0–1)
						<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" bind:value={efisiensi} />
					</label>
				</div>
				<div class="rounded-xl p-3" style="background: rgba(0,0,0,0.04)">
					<div class="text-[11px] font-bold uppercase" style="color: var(--sys-label4)">Perkiraan kebutuhan</div>
					<div class="text-xl font-extrabold" style="color: var(--sys-label)">{butuh ? `${butuh.liter} liter` : '—'}</div>
					{#if butuh}<div class="text-xs font-medium" style="color: var(--sys-label3)">TSR {butuh.tsr} → praktis {butuh.psr} m²/liter</div>{/if}
				</div>
			</div>

			<div class="glass-panel rounded-2xl p-5 flex flex-col gap-4">
				<h2 class="text-sm font-extrabold" style="color: var(--sys-label)">Tekanan Nozzle Blasting</h2>
				<p class="text-xs flex gap-2" style="color: var(--sys-label3)">
					<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
					Ukur tekanan DI nozzle dengan needle gauge (bukan di kompresor). Ideal ± 100 PSI; tiap 1 PSI turun ≈ 1,5% produktivitas hilang.
				</p>
				<label class="flex flex-col gap-1 text-xs font-bold" style="color: var(--sys-label2)">Tekanan terukur di nozzle (PSI)
					<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" inputmode="decimal" placeholder="mis. 88" bind:value={psiNozzle} />
				</label>
				<div class="rounded-xl p-3" style="background: rgba(0,0,0,0.04)">
					<div class="text-[11px] font-bold uppercase" style="color: var(--sys-label4)">Perkiraan kehilangan produktivitas</div>
					<div class="text-xl font-extrabold" style="color: var(--sys-label)">{tekanan ? `${tekanan.kehilanganPersen}% (turun ${tekanan.turunPsi} PSI)` : '—'}</div>
					{#if tekanan && tekanan.kehilanganPersen >= 10}<div class="text-xs font-semibold mt-1" style="color: #DC2626">Cek panjang/diameter selang, kopling bocor, dan nozzle aus.</div>{/if}
				</div>
			</div>
		</div>
	{:else if tab === 'troubleshoot'}
		<div class="flex flex-col gap-3">
			<p class="text-[11px]" style="color: var(--sys-label4)">Gejala → langkah periksa, urut dari yang paling mudah. Selalu utamakan keselamatan dan ikuti manual OEM. Salinan disimpan di HP{tsDariCache ? ' (dari salinan lokal)' : ''} sehingga tetap bisa dibaca tanpa sinyal.</p>
			{#if tsLoading}
				<p class="text-xs" style="color: var(--sys-label3)">Memuat kartu…</p>
			{:else if tsError}
				<p class="text-xs text-red-500">{tsError}</p>
			{:else if tsCards.length === 0}
				<div class="glass-panel rounded-2xl p-6 text-center text-xs" style="color: var(--sys-label3)">Belum ada kartu troubleshoot yang aktif. HRD/trainer mengaktifkannya di ERP setelah isinya ditinjau.</div>
			{:else}
				<input type="search" bind:value={tsCari} placeholder="Cari gejala / alat…" class="w-full px-3 py-2 text-sm rounded-xl border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12))" />
				{#each tsTampil as c (c.id)}
					<div class="glass-panel rounded-2xl overflow-hidden">
						<button class="w-full text-left p-4 flex items-start justify-between gap-2" onclick={() => (tsBuka = tsBuka === c.id ? null : c.id)} aria-expanded={tsBuka === c.id}>
							<span class="min-w-0">
								<span class="block text-sm font-extrabold" style="color: var(--sys-label)">{c.judul}</span>
								<span class="block text-[11px]" style="color: var(--sys-label3)">{c.alat}{c.gejala ? ' · ' + c.gejala : ''}</span>
							</span>
							<span class="text-xs" style="color: var(--sys-label4)">{tsBuka === c.id ? '▲' : '▼'}</span>
						</button>
						{#if tsBuka === c.id}
							<div class="px-4 pb-4 flex flex-col gap-3">
								{#if c.keselamatan}
									<div class="rounded-xl px-3 py-2 text-xs font-semibold" style="background:#FEF3C7;color:#92400E">⚠️ {c.keselamatan}</div>
								{/if}
								<ol class="flex flex-col gap-1.5 list-decimal pl-5">
									{#each c.langkah as l}<li class="text-xs" style="color: var(--sys-label2)">{l}</li>{/each}
								</ol>
								{#if c.programId}
									<a href="/ess/pelatihan/{c.programId}" class="text-xs font-bold" style="color: var(--p, var(--g))">🎓 Pelajari lengkap di modul pelatihan →</a>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>

	{:else if tab === 'referensi'}
		<div class="flex flex-col gap-3">
			<input class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white/70 text-base font-semibold" placeholder="Cari barang / bahan…" bind:value={refCari} />
			{#if refLoading}<p class="text-xs" style="color: var(--sys-label3)">Memuat…</p>{/if}
			{#if refError}<p class="text-xs font-semibold" style="color: #DC2626">{refError}</p>{/if}
			{#if ref}
				<p class="text-[11px]" style="color: var(--sys-label4)">Dari profil Inventory 360° terverifikasi & profil bahan R&D. Salinan disimpan di HP{refDariCache ? ' (dari salinan lokal)' : ''} — diperbarui otomatis tiap 24 jam.</p>
				{#each refBarang as b (b.itemId)}
					<div class="glass-panel rounded-2xl p-4">
						<div class="flex items-start justify-between gap-2"><h3 class="text-sm font-extrabold" style="color: var(--sys-label)">{b.nama}</h3>{#if b.kritis}<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">KRITIS</span>{/if}</div>
						{#if b.ringkasan}<p class="text-xs mt-1" style="color: var(--sys-label3)">{b.ringkasan}</p>{/if}
						{#if b.spesifikasi?.length}
							<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs rounded-xl p-2.5" style="background: var(--sys-fill2)">
								{#each b.spesifikasi as sp}
									<dt class="font-bold" style="color: var(--sys-label3)">{sp.label}</dt>
									<dd class="font-semibold" style="color: var(--sys-label)">{sp.nilai}</dd>
								{/each}
							</dl>
							<p class="text-[10px] mt-1 font-medium" style="color: var(--sys-label4)">Angka dari profil 360° yang sudah diverifikasi TDS. Tetap cek TDS/label kemasan terbaru di lapangan.</p>
						{/if}
						<ul class="mt-2 flex flex-col gap-1 text-xs" style="color: var(--sys-label3)">
							{#if b.interval}<li>⏱ Ganti tiap {b.interval}</li>{/if}
							{#if b.tandaGanti}<li>🔧 Tanda harus ganti: {b.tandaGanti}</li>{/if}
							{#if b.tandaPalsu}<li>⚠️ Tanda palsu: {b.tandaPalsu}</li>{/if}
							{#if b.apd.length}<li>🦺 APD: {b.apd.join(', ')}</li>{/if}
							{#if b.bahaya}<li>☣️ {b.bahaya}</li>{/if}
						</ul>
					</div>
				{/each}
				{#each refMaterial as m (m.materialId)}
					<div class="glass-panel rounded-2xl p-4">
						<h3 class="text-sm font-extrabold" style="color: var(--sys-label)">🧪 {m.nama}</h3>
						{#if m.fungsi}<p class="text-xs mt-1" style="color: var(--sys-label3)">{m.fungsi}</p>{/if}
						<p class="text-xs mt-1" style="color: var(--sys-label3)">☣️ Bahaya: {m.bahaya}</p>
					</div>
				{/each}
				{#if !refBarang.length && !refMaterial.length}<p class="text-xs" style="color: var(--sys-label3)">Belum ada referensi{refCari ? ' yang cocok' : ''}.</p>{/if}
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			<div class="glass-panel rounded-2xl p-5">
				<h2 class="text-sm font-extrabold mb-3" style="color: var(--sys-label)">Kebersihan Permukaan (ISO 8501 / SSPC)</h2>
				<div class="flex flex-col gap-2.5">
					{#each SA as s}
						<div><div class="text-xs font-extrabold" style="color: var(--sys-label2)">{s.k}</div><div class="text-xs" style="color: var(--sys-label3)">{s.d}</div></div>
					{/each}
				</div>
				<p class="text-[11px] mt-3" style="color: var(--sys-label4)">Spesifikasi proyek/customer selalu menang. Jangan menurunkan grade tanpa persetujuan tertulis.</p>
			</div>
			<div class="glass-panel rounded-2xl p-5">
				<h2 class="text-sm font-extrabold mb-3" style="color: var(--sys-label)">Kartu Cacat Cat</h2>
				<div class="flex flex-col gap-2.5">
					{#each CACAT as c}
						<div><div class="text-xs font-extrabold" style="color: var(--sys-label2)">{c.k}</div><div class="text-xs" style="color: var(--sys-label3)">{c.d}</div></div>
					{/each}
				</div>
				<p class="text-[11px] mt-3" style="color: var(--sys-label4)">Foto, ukur, catat lokasi dulu. Jangan langsung menutup dengan cat baru.</p>
			</div>
			<div class="glass-panel rounded-2xl p-5">
				<h2 class="text-sm font-extrabold mb-3" style="color: var(--sys-label)">Pengingat K3</h2>
				<ul class="flex flex-col gap-2">
					{#each K3 as k}<li class="text-xs" style="color: var(--sys-label3)">• {k}</li>{/each}
				</ul>
			</div>
		</div>
	{/if}
</div>
