// src/routes/api/preventive/p2h/export-pdf/p2hPdfHtml.js
// Builder HTML A4 murni untuk PDF Dossier P2H 1-Unit (lengkap foto & TTD digital) di Gotenberg.

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Susun HTML lengkap laporan P2H 1 unit (untuk dirender Gotenberg menjadi PDF).
 * @param {object} data
 * @returns {string}
 */
export function buildP2hUnitPdfHtml(data) {
  const eq = data?.equipment || {};
  const sess = data?.session || {};
  const items = Array.isArray(data?.checklistItems) ? data.checklistItems : [];
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  const overall = data?.overallResult === 'No-Go' ? 'No-Go' : 'Go';
  const wo = data?.workOrder || null;

  const isNoGo = overall === 'No-Go';
  const statusBg = isNoGo ? '#be123c' : '#047857';
  const statusLabel = isNoGo ? 'NO-GO — TEMUAN / PERLU TINDAK LANJUT' : 'GO — LAIK OPERASI';

  const rowsHtml = items
    .map((item, idx) => {
      const rowIsNoGo = item.result === 'No-Go';
      const valText =
        item.numericValue != null
          ? `${esc(item.numericValue)} ${esc(item.unitOfMeasure || '')}`.trim()
          : item.textValue
            ? esc(item.textValue)
            : '-';
      return `
        <tr style="background:${rowIsNoGo ? '#fff1f2' : idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
          <td style="text-align:center;color:#64748b;">${idx + 1}</td>
          <td>
            <strong>${esc(item.itemName)}</strong>
            ${item.isCritical ? '<span class="badge-crit">KRITIS</span>' : ''}
            ${item.wajibFoto ? '<span class="badge-foto">WAJIB FOTO</span>' : ''}
          </td>
          <td style="text-align:center;">
            <span class="${rowIsNoGo ? 'res-nogo' : 'res-go'}">${esc(item.result)}</span>
          </td>
          <td style="text-align:center;font-family:monospace;">${valText}</td>
          <td>${esc(item.notes || (rowIsNoGo && item.nogoCriteria ? item.nogoCriteria : '-'))}</td>
          <td style="text-align:center;">${item.hasPhoto ? '✓ Ada' : item.wajibFoto ? '<span style="color:#b45309;font-weight:700;">Kosong</span>' : '-'}</td>
        </tr>`;
    })
    .join('');

  const photosHtml = photos.length
    ? `
      <div class="section">
        <div class="section-title">Galeri Bukti Foto (${photos.length})</div>
        <div class="photo-grid">
          ${photos
            .map(
              (p) => `
            <div class="photo-card ${p.result === 'No-Go' ? 'photo-nogo' : ''}">
              <img src="${esc(p.dataUrl)}" alt="${esc(p.label)}" />
              <div class="photo-cap">
                <div class="cap-title">${p.result ? `[${esc(p.result)}] ` : ''}${esc(p.label)}</div>
                ${p.notes ? `<div class="cap-note">${esc(p.notes)}</div>` : ''}
              </div>
            </div>`
            )
            .join('')}
        </div>
      </div>`
    : '';

  const startSigHtml = data?.startSigSrc
    ? `<img src="${esc(data.startSigSrc)}" alt="TTD Mulai" style="max-height:56px;max-width:160px;object-fit:contain;" />`
    : '<span style="color:#94a3b8;font-size:10px;">Tidak ada TTD</span>';

  const endSigHtml = data?.endSigSrc
    ? `<img src="${esc(data.endSigSrc)}" alt="TTD Selesai" style="max-height:56px;max-width:160px;object-fit:contain;" />`
    : `<span style="color:#94a3b8;font-size:10px;">${sess.jam_selesai_pakai ? 'Sudah ditutup tanpa gambar' : 'Sesi masih terbuka'}</span>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>P2H ${esc(eq.code || eq.name)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 11mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 10px; line-height: 1.35; margin: 0; }
  .kop { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .kop h1 { margin: 0; font-size: 14px; font-weight: 800; letter-spacing: 0.3px; }
  .kop .sub { font-size: 10px; color: #475569; margin-top: 2px; }
  .status-pill { display: inline-block; background: ${statusBg}; color: #fff; font-weight: 800; font-size: 10px; padding: 4px 10px; border-radius: 6px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 10px; background: #f8fafc; border: 1px solid #cbd5e1; }
  .meta td { padding: 5px 8px; border: 1px solid #e2e8f0; font-size: 9.5px; }
  .meta .lbl { font-weight: 700; color: #475569; width: 17%; background: #f1f5f9; }
  .notes-box { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 6px 9px; margin-bottom: 10px; font-size: 9.5px; }
  .section { margin-top: 10px; }
  .section-title { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin-bottom: 6px; }
  table.chk { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.chk th, table.chk td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
  table.chk th { background: #f1f5f9; text-transform: uppercase; font-size: 8px; color: #334155; }
  .badge-crit { display: inline-block; background: #ffe4e6; color: #9f1239; border: 1px solid #fda4af; font-size: 7.5px; font-weight: 700; padding: 0 3px; border-radius: 3px; margin-left: 4px; }
  .badge-foto { display: inline-block; background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; font-size: 7.5px; font-weight: 700; padding: 0 3px; border-radius: 3px; margin-left: 3px; }
  .res-go { display: inline-block; background: #dcfce7; color: #166534; font-weight: 800; font-size: 8px; padding: 1px 5px; border-radius: 3px; }
  .res-nogo { display: inline-block; background: #e11d48; color: #fff; font-weight: 800; font-size: 8px; padding: 1px 5px; border-radius: 3px; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo-card { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; background: #fff; }
  .photo-nogo { border-color: #e11d48; background: #fff1f2; }
  .photo-card img { width: 100%; height: 115px; object-fit: cover; display: block; background: #f1f5f9; }
  .photo-cap { padding: 4px 6px; border-top: 1px solid #e2e8f0; }
  .cap-title { font-size: 8.5px; font-weight: 700; }
  .cap-note { font-size: 8px; color: #475569; margin-top: 1px; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; break-inside: avoid; page-break-inside: avoid; }
  .sig-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; text-align: center; background: #f8fafc; }
  .sig-box .sig-img { height: 60px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; margin: 5px 0; }
  .footer-meta { margin-top: 10px; font-size: 8px; color: #64748b; text-align: right; }
</style>
</head>
<body>
  <div class="kop">
    <div>
      <h1>LAPORAN HASIL PEMERIKSAAN HARIAN (P2H)</h1>
      <div class="sub">PT. ELTAMA PRIMA INDO &bull; Dokumen Bukti Lapangan &amp; Foto</div>
    </div>
    <div style="text-align:right;">
      <div class="status-pill">${statusLabel}</div>
      <div class="sub" style="margin-top:3px;">Tanggal: <strong>${esc(sess.date || '-')}</strong></div>
    </div>
  </div>

  <table class="meta">
    <tr>
      <td class="lbl">Nama Unit</td><td><strong>${esc(eq.name || '-')}</strong></td>
      <td class="lbl">Kode Unit</td><td style="font-family:monospace;">${esc(eq.code || '-')}</td>
    </tr>
    <tr>
      <td class="lbl">Kategori</td><td>${esc(data?.categoryName || '-')}</td>
      <td class="lbl">Lokasi / Site</td><td>${esc(data?.locationName || '-')}</td>
    </tr>
    <tr>
      <td class="lbl">Operator</td><td><strong>${esc(data?.operatorName || '-')}</strong></td>
      <td class="lbl">HM / KM</td><td style="font-family:monospace;">${sess.hoursmeter != null ? esc(Number(sess.hoursmeter).toLocaleString('id-ID')) : '-'}</td>
    </tr>
    <tr>
      <td class="lbl">Metode / GPS</td><td>${esc((sess.scan_method || '-').toUpperCase())}${sess.gps_lat != null ? ` (${Number(sess.gps_lat).toFixed(4)}, ${Number(sess.gps_lng).toFixed(4)})` : ''}</td>
      <td class="lbl">Work Order</td><td>${wo ? `<strong>${esc(wo.wo_number || wo.id)}</strong>` : 'Tidak ada WO'}</td>
    </tr>
  </table>

  ${
    sess.keterangan_tambahan || sess.catatan_selesai || wo?.keluhan
      ? `<div class="notes-box">
          ${sess.keterangan_tambahan ? `<div><strong>Catatan Operator:</strong> ${esc(sess.keterangan_tambahan)}</div>` : ''}
          ${sess.catatan_selesai ? `<div><strong>Catatan Tutup Pemakaian (${esc(sess.status_unit_selesai || '-')}):</strong> ${esc(sess.catatan_selesai)}</div>` : ''}
          ${wo?.keluhan ? `<div style="color:#9f1239;"><strong>Keluhan WO:</strong> ${esc(wo.keluhan)}</div>` : ''}
        </div>`
      : ''
  }

  <div class="section">
    <div class="section-title">Rincian Item Checklist (${items.length} Item)</div>
    <table class="chk">
      <thead>
        <tr>
          <th style="width:5%;text-align:center;">No</th>
          <th style="width:36%;">Item Pemeriksaan</th>
          <th style="width:11%;text-align:center;">Hasil</th>
          <th style="width:14%;text-align:center;">Nilai Ukur</th>
          <th style="width:24%;">Catatan / Temuan</th>
          <th style="width:10%;text-align:center;">Foto</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#64748b;">Tidak ada item checklist.</td></tr>'}
      </tbody>
    </table>
  </div>

  ${photosHtml}

  <div class="sigs">
    <div class="sig-box">
      <div style="font-weight:700;font-size:9px;color:#475569;">TANDA TANGAN MULAI OPERASI</div>
      <div class="sig-img">${startSigHtml}</div>
      <div style="font-weight:700;">${esc(data?.operatorName || '-')}</div>
    </div>
    <div class="sig-box">
      <div style="font-weight:700;font-size:9px;color:#475569;">TANDA TANGAN TUTUP PEMAKAIAN</div>
      <div class="sig-img">${endSigHtml}</div>
      <div style="color:#475569;">${sess.jam_selesai_pakai ? `Ditutup (${esc(sess.status_unit_selesai || '-')})` : 'Belum Ditutup'}</div>
    </div>
  </div>

  <div class="footer-meta">Dicetak oleh ${esc(data?.printedBy || '-')} &bull; Sesi ID: ${esc(sess.id || '-')}</div>
</body>
</html>`;
}
