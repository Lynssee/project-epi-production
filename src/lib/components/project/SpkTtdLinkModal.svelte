<!-- Modal "TTD SPK via Tautan" — dipakai admin (Penugasan Manpower & tabel SPK). Dibuka hanya bila
     manpower.spk_doc.ttd_link_aktif = true dan SPK berstatus "Menunggu TTD".
     Jalur: kirim tautan WA / salin tautan / tanda tangan di perangkat ini (kiosk) / dispensasi / cabut. -->
<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { buatLinkSpk, daftarLinkSpk, cabutLinkSpk, dispensasiSpk } from '$lib/services/spkTtdLinkApi';

  // Pola toast global repo ini: Toast.svelte lewat window.__showToast (bukan svelte-sonner)
  const toast = {
    success: (m) => typeof window !== 'undefined' && window.__showToast?.(m, 'success'),
    error: (m) => typeof window !== 'undefined' && window.__showToast?.(m, 'error'),
    info: (m) => typeof window !== 'undefined' && window.__showToast?.(m, 'info'),
    warning: (m) => typeof window !== 'undefined' && (window.__showToast?.(m, 'info') || window.__showToast?.(m, 'error'))
  };

  let {
    assignment,
    namaManpower = '',
    kruKandidat = [],
    onclose,
    onchanged
  } = $props();

  const dispatch = createEventDispatcher();

  function triggerClose() {
    if (typeof onclose === 'function') onclose();
    dispatch('close');
  }

  function triggerChanged() {
    if (typeof onchanged === 'function') onchanged();
    dispatch('changed');
  }

  let loading = $state(true);
  let aktif = $state(true);
  let links = $state([]);
  let busy = $state('');
  let urlBaru = $state('');
  let info = $state('');
  let alasan = $state('');
  let tampilDispensasi = $state(false);
  let kruId = $state('');

  const fmt = (d) => (d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

  async function muat() {
    loading = true;
    const r = await daftarLinkSpk(assignment.id);
    if (r.success === false) toast.error(r.error || 'Gagal memuat tautan');
    aktif = r.aktif !== false;
    links = r.links || [];
    loading = false;
  }
  onMount(muat);

  function statusLink(l) {
    if (l.digunakan_at) return { t: 'Sudah dipakai TTD', c: 'text-emerald-700' };
    if (l.dicabut) return { t: 'Dicabut', c: 'text-gray-400' };
    if (new Date(l.kedaluwarsa) < new Date()) return { t: 'Kedaluwarsa', c: 'text-gray-400' };
    return { t: `Aktif · dibuka ${l.jumlah_dibuka || 0}×`, c: 'text-blue-700' };
  }

  async function salin(url) {
    try { await navigator.clipboard.writeText(url); toast.success('Tautan disalin'); } catch { toast.info('Salin manual dari kotak di bawah'); }
  }

  async function buat({ kirimWa }) {
    busy = kirimWa ? 'wa' : 'salin';
    const r = await buatLinkSpk({ assignmentId: assignment.id, kirimWa });
    busy = '';
    if (!r.success) { toast.error(r.error || 'Gagal membuat tautan'); return; }
    urlBaru = r.url;
    info = kirimWa
      ? (r.sent ? `Tautan terkirim ke WhatsApp ${namaManpower}.` : (r.warning || 'Tautan dibuat, tetapi WhatsApp tidak terkirim.'))
      : `Tautan dibuat — berlaku ${r.hari} hari, hanya bisa dipakai sekali.`;
    if (!kirimWa) await salin(r.url);
    else if (r.warning) toast.warning(r.warning); else toast.success('Tautan dikirim via WhatsApp');
    await muat();
  }

  // Pakta tata tertib untuk ANGGOTA KRU: dokumen TANPA harga (nominal tak pernah dikirim), TTD dicatat pada tautan.
  async function buatPakta({ kirimWa }) {
    if (!kruId) { toast.error('Pilih anggota kru dulu.'); return; }
    busy = kirimWa ? 'pakta-wa' : 'pakta';
    const r = await buatLinkSpk({ assignmentId: assignment.id, varian: 'tanpa_harga', manpowerId: Number(kruId), kirimWa });
    busy = '';
    if (!r.success) { toast.error(r.error || 'Gagal membuat tautan pakta'); return; }
    urlBaru = r.url;
    const nm = kruKandidat.find((k) => String(k.manpowerId) === String(kruId))?.nama || 'kru';
    info = kirimWa
      ? (r.sent ? `Pakta terkirim ke WhatsApp ${nm}.` : (r.warning || 'Tautan dibuat, tetapi WhatsApp tidak terkirim.'))
      : `Tautan pakta untuk ${nm} dibuat — berlaku ${r.hari} hari, sekali pakai.`;
    if (!kirimWa) await salin(r.url); else if (r.warning) toast.warning(r.warning); else toast.success('Pakta dikirim via WhatsApp');
    await muat();
  }

  // window.open WAJIB sebelum await (anti pop-up blocker); tab diarahkan ke tautan setelah dibuat.
  async function kiosk() {
    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up diblokir browser. Izinkan pop-up lalu coba lagi.'); return; }
    busy = 'kiosk';
    const r = await buatLinkSpk({ assignmentId: assignment.id, mode: 'kiosk_pl' });
    busy = '';
    if (!r.success) { try { w.close(); } catch { /* sudah tertutup */ } toast.error(r.error || 'Gagal membuat tautan kiosk'); return; }
    w.location.href = r.url;
    await muat();
  }

  async function cabut() {
    if (!confirm('Cabut semua tautan aktif SPK ini? Tautan yang sudah dikirim tidak bisa dipakai lagi.')) return;
    busy = 'cabut';
    const r = await cabutLinkSpk(assignment.id);
    busy = '';
    if (!r.success) { toast.error(r.error || 'Gagal mencabut tautan'); return; }
    toast.success(`${r.dicabut || 0} tautan dicabut`);
    urlBaru = '';
    await muat();
  }

  async function dispensasi() {
    if (alasan.trim().length < 10) { toast.error('Alasan minimal 10 karakter.'); return; }
    if (!confirm('Aktifkan SPK TANPA tanda tangan manpower? Alasan akan tercatat permanen.')) return;
    busy = 'disp';
    const r = await dispensasiSpk(assignment.id, alasan.trim());
    busy = '';
    if (!r.success) { toast.error(r.error || 'Gagal menyimpan dispensasi'); return; }
    toast.success('SPK diaktifkan dengan dispensasi');
    triggerChanged();
    triggerClose();
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
  <div class="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
    <div class="flex items-start justify-between p-4 border-b border-gray-100">
      <div>
        <h3 class="font-bold text-gray-900">TTD SPK via Tautan</h3>
        <p class="text-xs text-gray-500">{namaManpower || 'Manpower'} · {assignment.nomor_spk || `#${assignment.id}`}</p>
      </div>
      <button class="text-gray-400 hover:text-gray-600 p-1" onclick={triggerClose} aria-label="Tutup">✕</button>
    </div>

    <div class="p-4 space-y-4 text-sm">
      <div class="rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs p-3 space-y-1">
        <div class="font-bold">Cara pakai</div>
        <ol class="list-decimal ml-4 space-y-0.5">
          <li>Klik <b>Buat &amp; salin tautan</b>, lalu kirim ke mandor lewat WhatsApp/chat Anda. Mandor membaca SPK dan tanda tangan dari HP-nya.</li>
          <li>Tautan berlaku sekali pakai; membuat tautan baru otomatis mematikan yang lama.</li>
          <li>Status SPK berubah menjadi <b>Aktif</b> setelah mandor menandatangani. Halaman ini tidak perlu dibuka lagi.</li>
        </ol>
      </div>

      {#if !aktif}
        <div class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Fitur TTD via tautan belum aktif. Gunakan tombol ✍️ TTD di layar, atau minta Lead mengaktifkannya.</div>
      {:else}
        <div class="grid grid-cols-1 gap-2">
          <button class="px-3 py-2.5 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 font-semibold text-xs disabled:opacity-50" disabled={!!busy} onclick={() => buat({ kirimWa: false })}
            title="Membuat tautan lalu menyalinnya — kirim sendiri lewat chat lain">{busy === 'salin' ? 'Membuat…' : '🔗 Buat & salin tautan'}</button>
          <button class="px-3 py-2.5 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 font-semibold text-xs disabled:opacity-50" disabled={!!busy} onclick={kiosk}
            title="Mandor tidak punya kuota/HP? Buka tautan di perangkat ini dan serahkan ke mandor. Tanpa OTP; pembuat tercatat.">{busy === 'kiosk' ? 'Membuka…' : '📱 Tanda tangan di perangkat ini (mandor tanpa HP/kuota)'}</button>
        </div>

        {#if kruKandidat.length > 0}
          <div class="border border-gray-200 rounded-xl p-3 space-y-2">
            <div class="text-xs font-bold text-gray-700">Pakta tata tertib untuk anggota kru</div>
            <p class="text-[11px] text-gray-500">Kru ikut menandatangani syarat &amp; tata tertib kerja <b>tanpa melihat nilai kontrak</b> (versi tanpa harga). Pilih anggota kru, lalu kirim tautannya.</p>
            <select class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs" bind:value={kruId}>
              <option value="">— pilih anggota kru —</option>
              {#each kruKandidat as k (k.manpowerId)}<option value={String(k.manpowerId)}>{k.nama}</option>{/each}
            </select>
            <div class="flex flex-wrap gap-2">
              <button class="px-3 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 font-semibold text-xs disabled:opacity-50" disabled={!!busy || !kruId} onclick={() => buatPakta({ kirimWa: false })}>{busy === 'pakta' ? 'Membuat…' : '🔗 Buat & salin tautan pakta'}</button>
            </div>
          </div>
        {/if}

        {#if urlBaru}
          <div class="space-y-1">
            <div class="text-xs text-gray-600">{info}</div>
            <div class="flex gap-2">
              <input readonly class="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono" value={urlBaru} onfocus={(e) => e.currentTarget.select()} />
              <button class="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50" onclick={() => salin(urlBaru)}>Salin</button>
            </div>
            <div class="text-[11px] text-amber-700">Tautan hanya ditampilkan sekarang (OTP dikirim otomatis ke WhatsApp mandor saat tautan dibuka). Jangan dibagikan ke orang lain.</div>
          </div>
        {/if}

        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-semibold text-gray-700">Riwayat tautan</span>
            <button class="text-[11px] text-red-600 hover:underline disabled:opacity-40" disabled={!!busy || !links.some((l) => !l.dicabut && !l.digunakan_at)} onclick={cabut}>Cabut semua tautan aktif</button>
          </div>
          {#if loading}
            <div class="text-xs text-gray-400">Memuat…</div>
          {:else if links.length === 0}
            <div class="text-xs text-gray-400">Belum ada tautan.</div>
          {:else}
            <ul class="divide-y divide-gray-100 border border-gray-100 rounded-lg text-xs">
              {#each links as l (l.id)}
                {@const s = statusLink(l)}
                <li class="px-3 py-2 flex items-center justify-between gap-2">
                  <span>#{l.id} · {l.mode === 'kiosk_pl' ? 'Kiosk PL' : l.tipe === 'spk_syarat' ? 'Syarat (tanpa harga)' : 'Tautan HP'}<br /><span class="text-gray-400">berlaku s/d {fmt(l.kedaluwarsa)}{l.ttd_nama ? ` · TTD: ${l.ttd_nama}` : ''}</span></span>
                  <span class="font-semibold {s.c} text-right">{s.t}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="border-t border-gray-100 pt-3">
          <button class="text-xs font-semibold text-gray-600 hover:underline" onclick={() => (tampilDispensasi = !tampilDispensasi)}>
            {tampilDispensasi ? '▾' : '▸'} Mandor benar-benar tidak bisa TTD? Gunakan dispensasi
          </button>
          {#if tampilDispensasi}
            <div class="mt-2 space-y-2">
              <p class="text-[11px] text-gray-500">SPK diaktifkan tanpa tanda tangan manpower. Alasan wajib dan tercatat permanen (beserta nama Anda).</p>
              <textarea rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs" placeholder="Contoh: mandor di lokasi tanpa sinyal, SPK dibacakan langsung oleh PL" bind:value={alasan}></textarea>
              <button class="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50" disabled={!!busy || alasan.trim().length < 10} onclick={dispensasi}>{busy === 'disp' ? 'Menyimpan…' : 'Aktifkan SPK dengan dispensasi'}</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
