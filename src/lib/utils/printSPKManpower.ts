// Print SPK Manpower (Surat Perintah Kerja) — A4 format
import { secureDirectusFetch } from '$lib/services/secureDirectus';

/** Ambil asset Directus lewat proxy terautentikasi lalu ubah jadi data URL (aman untuk <img src>). */
async function fetchAssetAsDataUrl(fileId: string): Promise<string | null> {
  try {
    const res = await secureDirectusFetch(`/assets/${fileId}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function formatDatePrint(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function terbilang(date) {
  const HARI  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const d = new Date(date);
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

function formatRupiah(value) {
  if (!value) return '-';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);
}

const STYLES = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    color: #000;
    background: #fff;
    max-width: 210mm;
    margin: 0 auto;
    padding: 15mm 20mm 15mm 25mm;
    line-height: 1.5;
  }
  @page { margin: 0; size: A4 portrait; }
  @media print { body { padding: 15mm 20mm 15mm 25mm; max-width: none; } }
  .header { display:flex; align-items:center; border-bottom:3px double #000; padding-bottom:8px; margin-bottom:16px; }
  .logo img { width:55px; height:55px; object-fit:contain; border-radius:50%; margin-right:14px; }
  .company-name { font-size:15pt; font-weight:bold; letter-spacing:0.5px; }
  .company-addr { font-size:8pt; color:#333; line-height:1.4; margin-top:2px; }
  .doc-title { text-align:center; margin:18px 0 4px; }
  .doc-title h2 { font-size:14pt; font-weight:bold; text-decoration:underline; text-transform:uppercase; letter-spacing:2px; }
  .doc-number { text-align:center; font-size:10pt; margin-bottom:18px; }
  .preamble { margin-bottom:14px; text-align:justify; }
  .assigns-to { margin:14px 0 14px 20px; }
  .assigns-to table { border-collapse:collapse; }
  .assigns-to td { padding:3px 6px 3px 0; vertical-align:top; font-size:11pt; }
  .assigns-to td:first-child { min-width:160px; color:#222; }
  .assigns-to td.colon { padding:3px 8px; }
  .task-box { border:1px solid #000; padding:10px 14px; margin:14px 0; background:#fafafa; }
  .task-box td { padding:4px 0; vertical-align:top; }
  .task-box td:first-child { min-width:160px; color:#444; }
  .task-box td.colon { padding:4px 8px; }
  .note-section { margin:12px 0; font-size:10.5pt; text-align:justify; }
  .note-section ol { margin:8px 0 8px 20px; line-height:1.8; }
  .signatures { display:flex; justify-content:space-between; margin-top:40px; }
  .sig-block { width:44%; text-align:center; }
  .sig-label { font-size:10.5pt; margin-bottom:4px; }
  .sig-city { font-size:10pt; margin-bottom:60px; }
  .sig-line { border-top:1px solid #000; padding-top:4px; font-size:10.5pt; font-weight:bold; }
  .sig-role { font-size:9.5pt; color:#444; }
  .stamp-note { text-align:center; font-size:8pt; color:#666; margin-top:30px; border-top:1px dashed #ccc; padding-top:8px; }
`;

function companyHeader() {
  return `
  <div class="header">
    <div class="logo">
      <img src="/src/lib/assets/logo-eltama.png" alt="Logo" onerror="this.style.display='none'" />
    </div>
    <div>
      <div class="company-name">PT. ELTAMA PRIMA INDO</div>
      <div class="company-addr">
        Jl. Raya Parpostel Gang Nangka RT. 02 RW. 03 No 88<br>
        Kel. Bojong Kulur, Kec. Gunung Putri, Bogor, Jawa Barat
      </div>
    </div>
  </div>`;
}

export function printSPKManpower(spk, project) {
  const win = window.open('', '_blank');
  if (!win) { alert('Popup diblokir browser. Izinkan popup untuk halaman ini.'); return; }

  const namaManpower   = spk.nama_manpower || '-';
  const posisi         = spk.posisi || 'Tenaga Kerja';
  const nik            = spk.NIK || '-';
  const noTelpon       = spk.no_telpon || '-';
  const namaProject    = project?.name || '-';
  const nomorPO        = project?.nomor_po || '-';
  const lokasiProject  = spk.lokasi || project?.lokasi || '-';
  const jenisPekerjaan = spk.jenis_pekerjaan || project?.jenis_project || '-';
  const periodeFrom    = spk.periode_mulai  ? formatDatePrint(spk.periode_mulai)  : '-';
  const periodeTo      = spk.periode_selesai ? formatDatePrint(spk.periode_selesai) : '-';
  const tanggalSurat   = spk.tanggal_spk ? terbilang(spk.tanggal_spk) : '-';
  const nomorSPK       = spk.nomor_spk || '-';
  const keterangan     = spk.keterangan || '';
  const upahHarian     = spk.upah_harian ? formatRupiah(spk.upah_harian) : null;
  const totalUpah      = spk.total_upah  ? formatRupiah(spk.total_upah)  : null;

  const body = `
  <div class="doc-title"><h2>Surat Perintah Kerja</h2></div>
  <div class="doc-number">No. ${nomorSPK}</div>

  <div class="preamble">
    <p>Yang bertanda tangan di bawah ini, Pimpinan PT. Eltama Prima Indo, dengan ini memberikan perintah kerja kepada:</p>
  </div>

  <div class="assigns-to">
    <table>
      <tr><td>Nama</td><td class="colon">:</td><td><strong>${namaManpower}</strong></td></tr>
      <tr><td>Jabatan / Posisi</td><td class="colon">:</td><td>${posisi}</td></tr>
      ${nik !== '-' ? `<tr><td>NIK</td><td class="colon">:</td><td>${nik}</td></tr>` : ''}
      ${noTelpon !== '-' ? `<tr><td>No. Telepon</td><td class="colon">:</td><td>${noTelpon}</td></tr>` : ''}
    </table>
  </div>

  <div class="preamble">
    <p>Untuk melaksanakan pekerjaan pada proyek dengan rincian sebagai berikut:</p>
  </div>

  <div class="task-box">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td>Nama Project</td>
        <td class="colon">:</td>
        <td><strong>${namaProject}</strong></td>
      </tr>
      <tr>
        <td>Nomor PO</td>
        <td class="colon">:</td>
        <td>${nomorPO}</td>
      </tr>
      <tr>
        <td>Lokasi Pekerjaan</td>
        <td class="colon">:</td>
        <td>${lokasiProject}</td>
      </tr>
      <tr>
        <td>Jenis Pekerjaan</td>
        <td class="colon">:</td>
        <td>${jenisPekerjaan}</td>
      </tr>
      <tr>
        <td>Periode Kerja</td>
        <td class="colon">:</td>
        <td>${periodeFrom} &nbsp;s/d&nbsp; ${periodeTo}</td>
      </tr>
      ${upahHarian ? `<tr><td>Upah Harian</td><td class="colon">:</td><td>${upahHarian}</td></tr>` : ''}
      ${totalUpah  ? `<tr><td>Total Upah</td><td class="colon">:</td><td><strong>${totalUpah}</strong></td></tr>` : ''}
    </table>
  </div>

  <div class="note-section">
    <p>Yang bersangkutan wajib memenuhi ketentuan sebagai berikut:</p>
    <ol>
      <li>Melaksanakan pekerjaan sesuai instruksi Project Leader dan standar keselamatan kerja yang berlaku.</li>
      <li>Hadir tepat waktu dan mengisi daftar hadir harian sesuai ketentuan.</li>
      <li>Menjaga kebersihan dan keselamatan di area kerja selama pelaksanaan proyek.</li>
      <li>Melaporkan setiap kendala atau permasalahan kepada Project Leader sesegera mungkin.</li>
      ${keterangan ? `<li>${keterangan}</li>` : ''}
    </ol>
    <p style="margin-top:10px;">Demikian Surat Perintah Kerja ini dibuat untuk dapat dilaksanakan dengan penuh tanggung jawab.</p>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-label">Mengetahui,</div>
      <div class="sig-city">Bogor, ${tanggalSurat}</div>
      <div class="sig-line">Direktur</div>
      <div class="sig-role">PT. Eltama Prima Indo</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Yang Menerima Perintah,</div>
      <div class="sig-city">&nbsp;</div>
      <div class="sig-line">${namaManpower}</div>
      <div class="sig-role">${posisi}</div>
    </div>
  </div>`;

  win.document.write(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>SPK - ${nomorSPK}</title>
  <style>${STYLES}</style>
</head>
<body>
  ${companyHeader()}
  ${body}
  <div class="stamp-note">Dokumen ini dicetak dari sistem ERP EPI &bull; ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}</div>
  <script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`);
  win.document.close();
}

/**
 * Cetak SPK dari record `manpower_assignment` (sistem manpower terpadu).
 * Menampilkan gambar tanda tangan manpower bila sudah ditandatangani.
 * @param {object} a  assignment (boleh dengan manpower_id/project_id ter-expand)
 * @param {object} project objek project (opsional, untuk nama/PO)
 * @param {object} manpower objek manpower (opsional, untuk identitas)
 */
export async function printSpkAssignment(a, project = null, manpower = null) {
  const win = window.open('', '_blank');
  if (!win) { alert('Popup diblokir browser. Izinkan popup untuk halaman ini.'); return; }

  const mp = manpower || (typeof a.manpower_id === 'object' ? a.manpower_id : {});
  const pr = project || (typeof a.project_id === 'object' ? a.project_id : {});

  const namaManpower   = mp.nama || a.ttd_nama || '-';
  const posisi         = a.jabatan || mp.posisi || 'Tenaga Kerja';
  const nik            = mp.NIK || '-';
  const noTelpon       = mp.no_telpon || '-';
  const namaProject    = pr.name || '-';
  const nomorPO        = pr.nomor_po || '-';
  const lokasiProject  = a.lokasi || pr.lokasi || '-';
  const jenisPekerjaan = a.jenis_pekerjaan || pr.jenis_project || '-';
  const periodeFrom    = a.tanggal_mulai   ? formatDatePrint(a.tanggal_mulai)   : '-';
  const periodeTo      = a.tanggal_selesai ? formatDatePrint(a.tanggal_selesai) : '-';
  const tanggalSurat   = a.tanggal_spk ? terbilang(a.tanggal_spk) : terbilang(new Date());
  const nomorSPK       = a.nomor_spk || '-';
  const keterangan     = a.catatan || '';
  const isBorongan     = a.rate_tipe === 'borongan';
  const upahLabel      = isBorongan ? 'Nilai Borongan' : 'Upah Harian';
  const upahNilai      = isBorongan ? a.nilai_borongan : a.rate_harian;
  const upahStr        = upahNilai ? formatRupiah(upahNilai) : null;

  const ttdDataUrl = a.ttd_manpower ? await fetchAssetAsDataUrl(a.ttd_manpower) : null;
  const ttdImg = ttdDataUrl
    ? `<img src="${ttdDataUrl}" alt="ttd" style="max-height:60px;max-width:90%;object-fit:contain;margin:0 auto 2px;display:block;" onerror="this.style.display='none'" />`
    : '<div style="height:60px;"></div>';

  const body = `
  <div class="doc-title"><h2>Surat Perintah Kerja</h2></div>
  <div class="doc-number">No. ${nomorSPK}</div>

  <div class="preamble">
    <p>Yang bertanda tangan di bawah ini, Pimpinan PT. Eltama Prima Indo, dengan ini memberikan perintah kerja kepada:</p>
  </div>

  <div class="assigns-to">
    <table>
      <tr><td>Nama</td><td class="colon">:</td><td><strong>${namaManpower}</strong></td></tr>
      <tr><td>Jabatan / Posisi</td><td class="colon">:</td><td>${posisi}</td></tr>
      ${nik !== '-' ? `<tr><td>NIK</td><td class="colon">:</td><td>${nik}</td></tr>` : ''}
      ${noTelpon !== '-' ? `<tr><td>No. Telepon</td><td class="colon">:</td><td>${noTelpon}</td></tr>` : ''}
    </table>
  </div>

  <div class="preamble"><p>Untuk melaksanakan pekerjaan pada proyek dengan rincian sebagai berikut:</p></div>

  <div class="task-box">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td>Nama Project</td><td class="colon">:</td><td><strong>${namaProject}</strong></td></tr>
      <tr><td>Nomor PO</td><td class="colon">:</td><td>${nomorPO}</td></tr>
      <tr><td>Lokasi Pekerjaan</td><td class="colon">:</td><td>${lokasiProject}</td></tr>
      <tr><td>Jenis Pekerjaan</td><td class="colon">:</td><td>${jenisPekerjaan}</td></tr>
      <tr><td>Periode Kerja</td><td class="colon">:</td><td>${periodeFrom} &nbsp;s/d&nbsp; ${periodeTo}</td></tr>
      ${upahStr ? `<tr><td>${upahLabel}</td><td class="colon">:</td><td><strong>${upahStr}</strong></td></tr>` : ''}
    </table>
  </div>

  <div class="note-section">
    <p>Yang bersangkutan wajib memenuhi ketentuan sebagai berikut:</p>
    <ol>
      <li>Melaksanakan pekerjaan sesuai instruksi Project Leader dan standar keselamatan kerja yang berlaku.</li>
      <li>Hadir tepat waktu dan melakukan absensi (foto masuk &amp; pulang) di lokasi proyek sebagai dasar perhitungan upah.</li>
      <li>Menjaga kebersihan dan keselamatan di area kerja selama pelaksanaan proyek.</li>
      <li>Melaporkan setiap kendala atau permasalahan kepada Project Leader sesegera mungkin.</li>
      ${keterangan ? `<li>${keterangan}</li>` : ''}
    </ol>
    <p style="margin-top:10px;">Demikian Surat Perintah Kerja ini dibuat untuk dapat dilaksanakan dengan penuh tanggung jawab.</p>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-label">Mengetahui,</div>
      <div class="sig-city">Bogor, ${tanggalSurat}</div>
      <div class="sig-line">Direktur</div>
      <div class="sig-role">PT. Eltama Prima Indo</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Yang Menerima Perintah,</div>
      ${ttdImg}
      <div class="sig-line">${namaManpower}</div>
      <div class="sig-role">${posisi}</div>
    </div>
  </div>`;

  win.document.write(`<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><title>SPK - ${nomorSPK}</title><style>${STYLES}</style></head>
<body>
  ${companyHeader()}
  ${body}
  <div class="stamp-note">Dokumen ini dicetak dari sistem ERP EPI &bull; ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}</div>
  <script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`);
  win.document.close();
}
