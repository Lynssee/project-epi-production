// src/lib/utils/printSuratTugas.ts
// Print Surat Tugas Project Leader (Official PT. Eltama Prima Indo Format) - Field App

function pricingTableHtml(soItems: any[]) {
  if (!soItems || soItems.length === 0) return '';
  const items = soItems.filter(i => i.nama_barang || i.jenis_jasa || i.keterangan);
  if (items.length === 0) return '';

  const rows = items.map((item, idx) => {
    const deskripsi = item.nama_barang || item.jenis_jasa || item.keterangan || '-';
    return `<tr>
      <td style="text-align:center;padding:5px 8px;border:1px solid #94a3b8;">${idx + 1}</td>
      <td style="padding:5px 8px;border:1px solid #94a3b8;font-weight:500;">${deskripsi}</td>
      <td style="text-align:center;padding:5px 8px;border:1px solid #94a3b8;">${item.qty != null ? item.qty : '-'}</td>
      <td style="text-align:center;padding:5px 8px;border:1px solid #94a3b8;">${item.satuan || '-'}</td>
    </tr>`;
  }).join('');

  return `
  <div style="margin:14px 0;page-break-inside:avoid;break-inside:avoid;">
    <p style="font-weight:bold;font-size:10.5pt;margin-bottom:6px;text-decoration:underline;letter-spacing:0.5px;">RINCIAN ITEM JASA & PEKERJAAN (SO)</p>
    <table style="width:100%;border-collapse:collapse;font-size:9.5pt;">
      <thead>
        <tr style="background:#1e293b;color:#ffffff;">
          <th style="padding:6px 8px;border:1px solid #64748b;width:35px;text-align:center;">No</th>
          <th style="padding:6px 8px;border:1px solid #64748b;text-align:left;">Deskripsi Jasa / Pekerjaan</th>
          <th style="padding:6px 8px;border:1px solid #64748b;width:65px;text-align:center;">Qty</th>
          <th style="padding:6px 8px;border:1px solid #64748b;width:75px;text-align:center;">Satuan</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

function formatDatePrint(dateString?: string | null) {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

const SHARED_STYLES = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      color: #0f172a;
      background: #ffffff;
      max-width: 210mm;
      margin: 0 auto;
      padding: 12mm 18mm;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page {
      margin: 12mm 15mm;
      size: A4 portrait;
    }
    @media print {
      body {
        padding: 0;
        max-width: none;
      }
    }
    .header {
      display: flex;
      align-items: center;
      border-bottom: 3px double #0f172a;
      padding-bottom: 8px;
      margin-bottom: 14px;
    }
    .logo {
      width: 60px;
      margin-right: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo img {
      width: 55px;
      height: 55px;
      object-fit: contain;
    }
    .company-name {
      font-size: 15pt;
      font-weight: bold;
      letter-spacing: 0.8px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #0f172a;
    }
    .company-addr {
      font-size: 8.5pt;
      color: #334155;
      line-height: 1.35;
      margin-top: 2px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    .doc-title {
      text-align: center;
      margin: 16px 0 4px;
    }
    .doc-title h2 {
      font-size: 14pt;
      font-weight: bold;
      text-decoration: underline;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    .doc-number {
      text-align: center;
      font-size: 10pt;
      margin-bottom: 16px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    .preamble {
      margin-bottom: 10px;
      text-align: justify;
    }
    .preamble p {
      margin-bottom: 4px;
    }
    .assigns-to {
      margin: 10px 0 12px 18px;
    }
    .assigns-to table {
      border-collapse: collapse;
    }
    .assigns-to td {
      padding: 2px 6px 2px 0;
      vertical-align: top;
      font-size: 11pt;
    }
    .assigns-to td:first-child {
      min-width: 140px;
      color: #334155;
    }
    .assigns-to td.colon {
      padding: 2px 6px;
    }
    .task-box {
      border: 1px solid #1e293b;
      padding: 9px 12px;
      margin: 12px 0;
      background: #f8fafc;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .task-box table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
    }
    .task-box td {
      padding: 3px 0;
      vertical-align: top;
    }
    .task-box td.label-col {
      width: 150px;
      color: #475569;
    }
    .task-box td.colon {
      width: 16px;
      padding: 3px 4px;
    }
    .note-section {
      margin: 12px 0;
      font-size: 10pt;
      text-align: justify;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .note-section ol {
      margin: 6px 0 8px 20px;
      line-height: 1.6;
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 30px;
      gap: 20px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sig-block {
      flex: 1;
      text-align: center;
    }
    .sig-block .sig-label {
      font-size: 10.5pt;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .sig-block .sig-city {
      font-size: 9.5pt;
      color: #475569;
      margin-bottom: 55px;
    }
    .sig-block .sig-line {
      border-top: 1px solid #0f172a;
      padding-top: 4px;
      font-size: 10.5pt;
      font-weight: bold;
      display: inline-block;
      min-width: 180px;
    }
    .sig-block .sig-role {
      font-size: 9.5pt;
      color: #475569;
      margin-top: 1px;
    }
    .stamp-note {
      text-align: center;
      font-size: 8pt;
      color: #64748b;
      margin-top: 24px;
      border-top: 1px dashed #cbd5e1;
      padding-top: 6px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      page-break-inside: avoid;
      break-inside: avoid;
    }
`;

function companyHeader() {
  return `
  <div class="header">
    <div class="logo">
      <img src="/src/lib/assets/logo-eltama.png" alt="Logo PT EPI" onerror="this.style.display='none'" />
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

function htmlWrapper(title: string, nomorSurat: string, body: string) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>${title} - ${nomorSurat}</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  ${companyHeader()}
  ${body}
  <script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;
}

export function printSuratTugas(surat: any, project: any, soItems: any[] = []) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Popup diblokir browser. Izinkan popup untuk halaman ini agar dokumen dapat dicetak.');
    return;
  }

  const namaLeader     = surat?.leader || project?.leader || '-';
  const jabatan        = surat?.jabatan || 'Project Leader';

  let namaProject = project?.name || (project?.nomor_so ? `Proyek ${project.customer_name || ''}` : 'Pekerjaan Jasa Lapangan');
  let nomorPO     = project?.nomor_po || project?.nomor_so || surat?.nomor_po || '-';
  if (namaProject.includes(' - PO/')) {
    const parts = namaProject.split(' - PO/');
    namaProject = parts[0];
    if (nomorPO === '-' || !nomorPO) nomorPO = 'PO/' + parts[1];
  }

  const customer       = project?.customer || project?.customer_name || surat?.customer || '-';
  const lokasiProject  = surat?.lokasi || project?.lokasi || project?.alamat || '-';
  const jenisPekerjaan = surat?.jenis_pekerjaan || project?.jenis_project || 'Jasa Lapangan';
  const periodeFrom    = surat?.periode_mulai ? formatDatePrint(surat.periode_mulai) : '-';
  const periodeTo      = surat?.periode_selesai ? formatDatePrint(surat.periode_selesai) : '(Selesai Proyek)';
  const tanggalSurat   = surat?.tanggal_surat ? formatDatePrint(surat.tanggal_surat) : formatDatePrint(new Date().toISOString());
  const nomorSurat     = surat?.nomor_surat || '-';
  const keterangan     = surat?.keterangan || '';

  const body = `
  <div class="doc-title"><h2>SURAT TUGAS</h2></div>
  <div class="doc-number">No. ${nomorSurat}</div>

  <div class="preamble">
    <p>Yang bertanda tangan di bawah ini, Pimpinan PT. Eltama Prima Indo, dengan ini menugaskan kepada:</p>
  </div>

  <div class="assigns-to">
    <table>
      <tr><td>Nama</td><td class="colon">:</td><td><strong style="text-transform:uppercase;">${namaLeader}</strong></td></tr>
      <tr><td>Jabatan</td><td class="colon">:</td><td>${jabatan}</td></tr>
    </table>
  </div>

  <div class="preamble">
    <p>Untuk melaksanakan tugas sebagai Project Leader pada pekerjaan dengan rincian sebagai berikut:</p>
  </div>

  <div class="task-box">
    <table>
      <tr>
        <td class="label-col">Nama Project</td>
        <td class="colon">:</td>
        <td><strong>${namaProject}</strong></td>
      </tr>
      <tr>
        <td class="label-col">Nomor PO / SO</td>
        <td class="colon">:</td>
        <td style="font-family:'Courier New', monospace;font-weight:600;">${nomorPO}</td>
      </tr>
      ${customer && customer !== '-' ? `
      <tr>
        <td class="label-col">Customer</td>
        <td class="colon">:</td>
        <td><strong>${customer}</strong></td>
      </tr>` : ''}
      <tr>
        <td class="label-col">Lokasi Pekerjaan</td>
        <td class="colon">:</td>
        <td>${lokasiProject}</td>
      </tr>
      <tr>
        <td class="label-col">Jenis Pekerjaan</td>
        <td class="colon">:</td>
        <td>${jenisPekerjaan}</td>
      </tr>
      <tr>
        <td class="label-col">Periode Tugas</td>
        <td class="colon">:</td>
        <td>${periodeFrom} &nbsp;s/d&nbsp; ${periodeTo}</td>
      </tr>
    </table>
  </div>

  ${pricingTableHtml(soItems)}

  <div class="note-section">
    <p>Yang bersangkutan diwajibkan untuk:</p>
    <ol>
      <li>Memimpin dan mengkoordinasikan seluruh kegiatan pekerjaan operasional di lapangan.</li>
      <li>Menjaga mutu dan kualitas pekerjaan sesuai dengan spesifikasi dan standar yang ditetapkan.</li>
      <li>Membuat serta menyampaikan laporan harian pekerjaan (P2H, logistik, progress) kepada manajemen.</li>
      <li>Bertanggung jawab penuh atas keselamatan kerja (K3/HSE) dan ketertiban di lokasi proyek.</li>
      <li>Melaksanakan pekerjaan operasional proyek lapangan sesuai SOP dan spesifikasi teknis PT Eltama Prima Indo.</li>
      ${keterangan && !keterangan.includes('SOP dan spesifikasi') ? `<li style="font-style:italic;">${keterangan}</li>` : ''}
    </ol>
    <p style="margin-top:6px;">Demikian Surat Tugas ini dibuat untuk dapat dilaksanakan dengan sebaik-baiknya dan penuh tanggung jawab.</p>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-label">Penerima Tugas,</div>
      <div class="sig-city">${jabatan}</div>
      <div class="sig-line" style="text-transform:uppercase;">${namaLeader}</div>
      <div class="sig-role">${jabatan}</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Mengetahui & Menyetujui,</div>
      <div class="sig-city">Bogor, ${tanggalSurat}</div>
      <div class="sig-line">Pimpinan Perusahaan</div>
      <div class="sig-role">PT. Eltama Prima Indo</div>
    </div>
  </div>

  <div class="stamp-note">
    Dokumen resmi SI-TAMA ERP EPI &bull; ID: ${surat?.id || 'DRAFT'} &bull; Dicetak secara digital &bull; ${formatDatePrint(new Date().toISOString())}
  </div>`;

  win.document.write(htmlWrapper('Surat Tugas', nomorSurat, body));
  win.document.close();
}
