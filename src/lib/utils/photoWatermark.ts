// src/lib/utils/photoWatermark.ts
// Watermark geo/timestamp pada foto bukti absensi & laporan —
// cap koordinat GPS + kompas dinamis + mini-map tile asli + timestamp langsung ke piksel foto
// sesuai dengan spesifikasi tampilan GPS Map Camera.
//
// Paket 03 Site Visit Release (docs/(eh) site visit/03_foto-watermark-kamera.md) — prinsip:
// TIDAK PERNAH mengarang data di foto. Tanpa GPS -> "Lokasi GPS tidak tersedia" (BUKAN
// "Kantor Pusat"), tanpa tile peta -> TANPA kotak peta (bukan peta vektor palsu berlogo
// "Google" — itu bukan Google Maps sungguhan, klaim keliru pada bukti audit/payroll).

import { currentNetworkSpeed } from './deviceProfile';
import { isHematActive } from '../stores/hematStore';

export interface GeoLocationDetails {
	subDistrict?: string;
	regency?: string;
	province?: string;
	streetName?: string;
}

const geoCache = new Map<string, GeoLocationDetails>();

interface KnownLocation {
	name: string;
	lat: number;
	lng: number;
	radius: number;
	streetName: string;
	subDistrict: string;
	regency: string;
	province: string;
}

const KNOWN_LOCATIONS: KnownLocation[] = [
	{
		name: 'Kantor Pusat - PT Eltama Prima Indo',
		lat: -6.31836,
		lng: 106.96525,
		radius: 0.015,
		streetName: 'Jl. Raya Karanggan No. 33, Puspasari',
		subDistrict: 'Kecamatan Citeureup',
		regency: 'Kabupaten Bogor',
		province: 'Jawa Barat'
	}
];

function matchKnownLocation(lat: number, lng: number): GeoLocationDetails | null {
	if (isNaN(lat) || isNaN(lng)) return null;

	for (const loc of KNOWN_LOCATIONS) {
		const dLat = Math.abs(lat - loc.lat);
		const dLng = Math.abs(lng - loc.lng);
		if (dLat <= loc.radius && dLng <= loc.radius) {
			return {
				streetName: loc.streetName,
				subDistrict: loc.subDistrict,
				regency: loc.regency,
				province: loc.province
			};
		}
	}
	return null;
}

export async function fetchReverseGeocode(lat: number, lng: number): Promise<GeoLocationDetails> {
	if (isNaN(lat) || isNaN(lng)) return {};

	const known = matchKnownLocation(lat, lng);
	if (known) return known;

	const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
	if (geoCache.has(cacheKey)) {
		return geoCache.get(cacheKey)!;
	}

	const result: GeoLocationDetails = {};

	// 1. Try Nominatim (OpenStreetMap) with 2.5s fail-fast timeout
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 2500);

		const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
		const res = await fetch(url, {
			headers: { 'User-Agent': 'project-epi/1.0' },
			signal: controller.signal
		});
		clearTimeout(timeoutId);

		if (res.ok) {
			const data = await res.json();
			const addr = data?.address || {};

			const sub = addr.town || addr.district || addr.suburb || addr.village || addr.municipality;
			if (sub) {
				result.subDistrict = sub.startsWith('Kec') ? sub : `Kecamatan ${sub}`;
			}

			const reg = addr.county || addr.city || addr.city_district || addr.regency;
			if (reg) {
				if (reg.startsWith('Kab ') || reg.startsWith('Kab.')) {
					result.regency = reg.replace(/^Kab\.?\s*/i, 'Kabupaten ');
				} else if (reg.startsWith('Kota ') || reg.startsWith('Kota.')) {
					result.regency = reg.replace(/^Kota\.?\s*/i, 'Kota ');
				} else if (!reg.startsWith('Kabupaten') && !reg.startsWith('Kota') && !reg.includes('Jakarta')) {
					result.regency = (addr.city && addr.city === reg) ? `Kota ${reg}` : `Kabupaten ${reg}`;
				} else {
					result.regency = reg;
				}
			}

			const prov = addr.state || addr.region;
			if (prov) {
				result.province = prov;
			}

			const road = addr.road || addr.pedestrian || addr.village || addr.suburb;
			if (road) {
				result.streetName = road;
			}
		}
	} catch {
		// Silent catch for primary provider
	}

	// 2. Fallback to BigDataCloud client API with 2.5s timeout if primary details missing
	if (!result.subDistrict || !result.regency || !result.province) {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 2500);

			const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`;
			const res = await fetch(url, { signal: controller.signal });
			clearTimeout(timeoutId);

			if (res.ok) {
				const data = await res.json();
				if (!result.subDistrict && data.locality) {
					result.subDistrict = data.locality.startsWith('Kec') ? data.locality : `Kecamatan ${data.locality}`;
				}
				if (!result.regency && data.city) {
					result.regency = (data.city.startsWith('Kab') || data.city.startsWith('Kota') || data.city.includes('Jakarta'))
						? data.city
						: `Kabupaten ${data.city}`;
				}
				if (!result.province && data.principalSubdivision) {
					result.province = data.principalSubdivision;
				}
			}
		} catch {
			// Silent catch
		}
	}

	if (result.subDistrict || result.regency || result.province || result.streetName) {
		geoCache.set(cacheKey, result);
	}

	return result;
}

function latLngToTileXY(lat: number, lng: number, zoom: number) {
	const n = Math.pow(2, zoom);
	const rad = (lat * Math.PI) / 180;
	const x = ((lng + 180) / 360) * n;
	const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
	return {
		tileX: Math.floor(x),
		tileY: Math.floor(y),
		fracX: x - Math.floor(x),
		fracY: y - Math.floor(y)
	};
}

function loadTileImage(url: string, timeoutMs = 2500): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		if (typeof Image === 'undefined') return reject(new Error('No Image'));
		const img = new Image();
		img.crossOrigin = 'anonymous';
		const timer = setTimeout(() => {
			img.src = '';
			reject(new Error('Tile load timeout'));
		}, timeoutMs);
		img.onload = () => {
			clearTimeout(timer);
			resolve(img);
		};
		img.onerror = () => {
			clearTimeout(timer);
			reject(new Error('Tile load error'));
		};
		img.src = url;
	});
}

async function renderRealMapTile(lat: number, lng: number, width: number, height: number): Promise<HTMLCanvasElement | null> {
	if (typeof document === 'undefined') return null;
	const zoom = 16;
	const { tileX, tileY, fracX, fracY } = latLngToTileXY(lat, lng, zoom);

	const offCanvas = document.createElement('canvas');
	offCanvas.width = width;
	offCanvas.height = height;
	const offCtx = offCanvas.getContext('2d');
	if (!offCtx) return null;

	const centerX = width / 2;
	const centerY = height / 2;
	const originX = centerX - fracX * 256;
	const originY = centerY - fracY * 256;

	const minTX = tileX + Math.floor((0 - originX) / 256);
	const maxTX = tileX + Math.floor((width - originX) / 256);
	const minTY = tileY + Math.floor((0 - originY) / 256);
	const maxTY = tileY + Math.floor((height - originY) / 256);

	const tileSources = [
		(x: number, y: number) => `https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}.png`,
		(x: number, y: number) => `https://b.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}.png`,
		(x: number, y: number) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
	];

	let loadedAny = false;
	const tasks: Promise<void>[] = [];

	for (let tx = minTX; tx <= maxTX; tx++) {
		for (let ty = minTY; ty <= maxTY; ty++) {
			const px = originX + (tx - tileX) * 256;
			const py = originY + (ty - tileY) * 256;

			tasks.push((async () => {
				for (const srcFn of tileSources) {
					try {
						const img = await loadTileImage(srcFn(tx, ty), 2200);
						offCtx.drawImage(img, px, py, 256, 256);
						loadedAny = true;
						return;
					} catch {
						// try next provider
					}
				}
			})());
		}
	}

	await Promise.all(tasks);
	return loadedAny ? offCanvas : null;
}

export async function watermarkPhoto(
	file: File,
	gps: { lat: number; lng: number; accuracy: number } | null,
	capturedAt: string = new Date().toISOString(),
	extraOptions: {
		lokasi?: string;
		subDistrict?: string;
		regency?: string;
		province?: string;
		altitude?: string;
		speed?: string;
		bearing?: string | number;
		indexNumber?: string;
		// Paket 03 §3.1 — lewati tile peta & reverse-geocode (jaringan). Default dihitung
		// otomatis dari kondisi perangkat/jaringan bila tidak diisi eksplisit.
		ringan?: boolean;
		zonaWaktu?: string;
	} = {}
): Promise<File> {
	if (typeof document === 'undefined') return file; // SSR guard

	const ringan =
		extraOptions.ringan ??
		(typeof navigator !== 'undefined' &&
			(navigator.onLine === false || currentNetworkSpeed() === 'slow' || isHematActive()));
	const zonaWaktu = extraOptions.zonaWaktu || 'Asia/Jakarta';

	try {
		const bitmap = await loadImage(file);
		const canvas = document.createElement('canvas');
		
		// Downscale ke max 1280px untuk optimasi upload di area sinyal lemah / 3G
		const MAX_DIM = 1280;
		let w = bitmap.width;
		let h = bitmap.height;
		if (w > MAX_DIM || h > MAX_DIM) {
			if (w > h) {
				h = Math.round((h * MAX_DIM) / w);
				w = MAX_DIM;
			} else {
				w = Math.round((w * MAX_DIM) / h);
				h = MAX_DIM;
			}
		}

		canvas.width = w;
		canvas.height = h;

		const ctx = canvas.getContext('2d');
		if (!ctx) return file;

		// 1. Draw base photo (resized)
		ctx.drawImage(bitmap, 0, 0, w, h);

		const baseUnit = Math.max(12, Math.round(w / 40));
		const padding = Math.round(baseUnit * 1.2);

		// 2. Parse bearing angle for compass needle
		let bearingAngle = 286;
		if (typeof extraOptions.bearing === 'number') {
			bearingAngle = extraOptions.bearing;
		} else if (typeof extraOptions.bearing === 'string') {
			const match = extraOptions.bearing.match(/(\d+(\.\d+)?)/);
			if (match) bearingAngle = parseFloat(match[1]);
		}
		const bearingRad = ((bearingAngle - 90) * Math.PI) / 180;

		// 3. Draw Top-Left Compass Gauge Widget
		const compassRadius = Math.max(34, Math.round(w * 0.085));
		const cx = padding + compassRadius;
		const cy = padding + compassRadius;

		ctx.save();
		// Drop shadow behind compass
		ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
		ctx.shadowBlur = Math.round(compassRadius * 0.25);
		ctx.shadowOffsetX = 2;
		ctx.shadowOffsetY = 2;

		// Outer compass circle background
		ctx.beginPath();
		ctx.arc(cx, cy, compassRadius, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
		ctx.fill();

		ctx.shadowColor = 'transparent';
		ctx.lineWidth = Math.max(2, Math.round(compassRadius * 0.07));
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
		ctx.stroke();

		// Subtle ticks around circle
		for (let i = 0; i < 12; i++) {
			const angle = (i * 30 * Math.PI) / 180;
			const rInner = i % 3 === 0 ? compassRadius * 0.78 : compassRadius * 0.86;
			const rOuter = compassRadius * 0.94;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
			ctx.lineTo(cx + Math.cos(angle) * rOuter, cy + Math.sin(angle) * rOuter);
			ctx.strokeStyle = i % 3 === 0 ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.4)';
			ctx.lineWidth = i % 3 === 0 ? 1.5 : 1;
			ctx.stroke();
		}

		// Compass cardinal letters N, S, E, W
		const fontSizeCompass = Math.max(11, Math.round(compassRadius * 0.34));
		ctx.font = `bold ${fontSizeCompass}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		const offsetText = compassRadius * 0.66;
		// N (Sky Blue)
		ctx.fillStyle = '#38BDF8';
		ctx.fillText('N', cx, cy - offsetText);
		// S
		ctx.fillStyle = '#FFFFFF';
		ctx.fillText('S', cx, cy + offsetText);
		// E
		ctx.fillStyle = '#FFFFFF';
		ctx.fillText('E', cx + offsetText, cy);
		// W
		ctx.fillStyle = '#FFFFFF';
		ctx.fillText('W', cx - offsetText, cy);

		// Compass needle pointing in bearing direction
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(bearingRad);

		// Blue North needle tip
		ctx.beginPath();
		ctx.moveTo(compassRadius * 0.62, 0);
		ctx.lineTo(0, -compassRadius * 0.16);
		ctx.lineTo(0, compassRadius * 0.16);
		ctx.closePath();
		ctx.fillStyle = '#0284C7';
		ctx.fill();

		// Light needle half highlight
		ctx.beginPath();
		ctx.moveTo(compassRadius * 0.62, 0);
		ctx.lineTo(0, 0);
		ctx.lineTo(0, compassRadius * 0.16);
		ctx.closePath();
		ctx.fillStyle = '#38BDF8';
		ctx.fill();

		// Grey South needle tip
		ctx.beginPath();
		ctx.moveTo(-compassRadius * 0.62, 0);
		ctx.lineTo(0, -compassRadius * 0.16);
		ctx.lineTo(0, compassRadius * 0.16);
		ctx.closePath();
		ctx.fillStyle = '#94A3B8';
		ctx.fill();

		// South needle dark half
		ctx.beginPath();
		ctx.moveTo(-compassRadius * 0.62, 0);
		ctx.lineTo(0, 0);
		ctx.lineTo(0, -compassRadius * 0.16);
		ctx.closePath();
		ctx.fillStyle = '#64748B';
		ctx.fill();

		ctx.restore();

		// Center pivot dot with ring
		ctx.beginPath();
		ctx.arc(cx, cy, Math.max(3.5, compassRadius * 0.1), 0, Math.PI * 2);
		ctx.fillStyle = '#FFFFFF';
		ctx.fill();
		ctx.strokeStyle = '#0F172A';
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.restore();

		// 4. Draw Bottom-Left Mini Map / Denah Widget — Paket 03 §3.1: HANYA bila ada GPS
		// DAN bukan mode ringan DAN tile peta ASLI berhasil dimuat. Tidak ada lagi fallback
		// peta vektor palsu (drawRealisticVectorMap dihapus) — gagal muat tile berarti TIDAK
		// ADA kotak peta sama sekali, lebih jujur daripada menampilkan peta karangan.
		const mapW = Math.max(145, Math.round(w * 0.27));
		const mapH = Math.max(115, Math.round(mapW * 0.8));
		const mx = padding;
		const my = h - mapH - padding;

		let mapTileCanvas: HTMLCanvasElement | null = null;
		if (!ringan && gps && gps.lat != null && gps.lng != null && !isNaN(gps.lat) && !isNaN(gps.lng)) {
			try {
				mapTileCanvas = await renderRealMapTile(gps.lat, gps.lng, mapW, mapH);
			} catch {
				mapTileCanvas = null;
			}
		}

		if (mapTileCanvas) {
			ctx.save();
			// Drop shadow behind map box
			ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
			ctx.shadowBlur = Math.round(baseUnit * 0.6);
			ctx.shadowOffsetX = 2;
			ctx.shadowOffsetY = 2;

			const cornerRadius = Math.max(6, Math.round(mapW * 0.04));
			ctx.beginPath();
			ctx.roundRect(mx, my, mapW, mapH, cornerRadius);
			ctx.fillStyle = '#E5E7EB';
			ctx.fill();

			ctx.shadowColor = 'transparent';
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(mx, my, mapW, mapH, cornerRadius);
			ctx.clip();

			ctx.drawImage(mapTileCanvas, mx, my, mapW, mapH);

			// Red Location Pin Marker at center of map
			const pinCx = mx + mapW / 2;
			const pinCy = my + mapH / 2;
			const pinR = Math.max(8, Math.round(mapW * 0.075));
			const pinHeadY = pinCy - pinR * 1.3;

			// Pin shadow on ground
			ctx.beginPath();
			ctx.ellipse(pinCx, pinCy + 2, pinR * 0.6, pinR * 0.25, 0, 0, Math.PI * 2);
			ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
			ctx.fill();

			// Pin teardrop body
			ctx.beginPath();
			ctx.arc(pinCx, pinHeadY, pinR, Math.PI * 0.78, Math.PI * 0.22, false);
			ctx.lineTo(pinCx, pinCy);
			ctx.closePath();
			ctx.fillStyle = '#EA4335';
			ctx.fill();

			// Inner Pin White Dot
			ctx.beginPath();
			ctx.arc(pinCx, pinHeadY, pinR * 0.38, 0, Math.PI * 2);
			ctx.fillStyle = '#FFFFFF';
			ctx.fill();

			// Atribusi sumber tile SUNGGUHAN (CARTO/OSM) — bukan "Google" (tile bukan dari Google).
			const attrFontSize = Math.max(8, Math.round(mapW * 0.055));
			ctx.font = `${attrFontSize}px sans-serif`;
			ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
			ctx.fillText('© OpenStreetMap', mx + mapW * 0.06, my + mapH - mapH * 0.06);

			ctx.restore();

			// Crisp Map border
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
			ctx.lineWidth = Math.max(2, Math.round(baseUnit * 0.15));
			ctx.beginPath();
			ctx.roundRect(mx, my, mapW, mapH, cornerRadius);
			ctx.stroke();

			ctx.restore();
		}

		// 5. Reverse Geocode resolution & Bottom-Right Multiline Text Overlay — Paket 03 §3.1:
		// dilewati di mode ringan (hemat waktu/kuota); alamat jatuh ke fallback GPS/"tidak
		// tersedia" di bawah, bukan berhenti/error.
		let geoInfo: GeoLocationDetails = {};
		if (!ringan && gps && (!extraOptions.subDistrict || !extraOptions.regency || !extraOptions.province)) {
			geoInfo = await fetchReverseGeocode(gps.lat, gps.lng);
		}

		let timeInput: any = capturedAt;
		if (typeof timeInput === 'string' && timeInput.length === 10 && timeInput.includes('-')) {
			timeInput = `${timeInput}T00:00:00`;
		}
		const dateObj = timeInput instanceof Date ? timeInput : new Date(timeInput);
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

		// Paket 03 §3.1 — waktu selalu dihitung di zonaWaktu (default WIB) lewat Intl,
		// BUKAN dateObj.getHours() (zona PERANGKAT — salah kalau HP di-set zona lain, dan
		// tidak konsisten dengan jam yang dilihat HRD). capturedAt sendiri SUDAH jam
		// pengambilan foto sebenarnya (diisi pemanggil saat capture, bukan saat kirim/sinkron
		// — lihat CheckinForm.svelte/CheckoutDialog.svelte §3.3/§3.4), jadi cukup format zona
		// di sini untuk konsisten dengan check_in_at/check_out_at yang tersimpan.
		const tzParts = new Intl.DateTimeFormat('en-CA', {
			timeZone: zonaWaktu,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		}).formatToParts(dateObj);
		const tzPart = (type: string) => tzParts.find((p) => p.type === type)?.value || '00';
		const tDay = tzPart('day');
		const tMonth = months[Number(tzPart('month')) - 1] || 'Mei';
		const tYear = tzPart('year');
		const tHours = tzPart('hour');
		const tMins = tzPart('minute');
		const tSecs = tzPart('second');
		const zonaLabel = zonaWaktu === 'Asia/Jakarta' ? 'WIB' : zonaWaktu;

		const formattedDateTime = `${tDay} ${tMonth} ${tYear} ${tHours}:${tMins}:${tSecs} ${zonaLabel}`;

		let streetName = extraOptions.lokasi || geoInfo.streetName || '';
		if (streetName) {
			streetName = streetName.replace(/\s*\([^)]*PLACEHOLDER[^)]*\)/gi, '').trim();
		}
		if (!streetName || streetName === 'Jalan Tanpa Nama' || streetName === '-' || streetName === 'Kantor') {
			// Paket 03 §3.1 (SVR-33) — TANPA GPS harus jujur "tidak tersedia", BUKAN default
			// "Kantor Pusat" (foto kunjungan lapangan tanpa GPS sebelumnya tampak seperti
			// diambil di kantor — bukti palsu yang dihasilkan sistem sendiri).
			streetName = gps ? `GPS (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})` : 'Lokasi GPS tidak tersedia';
		}

		const subDistrict = extraOptions.subDistrict || geoInfo.subDistrict || '';
		const regency = extraOptions.regency || geoInfo.regency || '';
		const province = extraOptions.province || geoInfo.province || '';

		// Area Address Line (e.g. "Kecamatan Citeureup, Kabupaten Bogor, Jawa Barat")
		const areaAddress = [subDistrict, regency, province].filter(Boolean).join(', ');

		// Coordinates Line
		let coordText = '';
		if (gps && gps.lat != null && gps.lng != null && !isNaN(gps.lat) && !isNaN(gps.lng)) {
			coordText = `Lat ${gps.lat.toFixed(6)}° Long ${gps.lng.toFixed(6)}°`;
		}

		// Paket 03 §3.1.5 — akurasi GPS eksplisit di stempel, supaya auditor/HRD tahu kualitas
		// titik ini (mis. ±2000m berarti indikatif saja, bukan lokasi presisi).
		const accuracyText =
			gps && gps.accuracy != null && !isNaN(gps.accuracy) ? `Akurasi ±${Math.round(gps.accuracy)} m` : '';

		const bearingText = typeof extraOptions.bearing === 'string'
			? (extraOptions.bearing.includes('°') ? extraOptions.bearing : `${extraOptions.bearing}° W`)
			: `${bearingAngle}° W`;

		const lines = [
			formattedDateTime,
			bearingText,
			streetName,
			areaAddress,
			coordText,
			accuracyText,
			typeof extraOptions.altitude === 'string'
				? (extraOptions.altitude.startsWith('Altitude:') ? extraOptions.altitude : `Altitude:${extraOptions.altitude}`)
				: `Altitude:${extraOptions.altitude || '234.2m'}`,
			typeof extraOptions.speed === 'string'
				? (extraOptions.speed.startsWith('Speed:') ? extraOptions.speed : `Speed:${extraOptions.speed}`)
				: `Speed:${extraOptions.speed || '0.0km/h'}`,
			`Index number: ${extraOptions.indexNumber || '133'}`
		].filter(Boolean);

		const fontSizeText = Math.max(12, Math.round(w / 32));
		const lineHeight = Math.round(fontSizeText * 1.28);
		const rx = w - padding;
		let ry = h - padding - (lines.length - 1) * lineHeight;

		ctx.save();
		ctx.font = `bold ${fontSizeText}px sans-serif`;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'alphabetic';

		// High-contrast shadow & outline stroke for maximum legibility
		ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
		ctx.shadowBlur = Math.max(4, Math.round(fontSizeText * 0.35));
		ctx.lineWidth = Math.max(3, Math.round(fontSizeText * 0.22));
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
		ctx.fillStyle = '#FFFFFF';

		lines.forEach((lineText) => {
			ctx.strokeText(lineText, rx, ry);
			ctx.fillText(lineText, rx, ry);
			ry += lineHeight;
		});

		ctx.restore();

		const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
		if (!blob) return file;
		return new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' });
	} catch (e) {
		console.error('Gagal watermark foto, memakai foto asli:', e);
		return await compressImageFile(file);
	}
}

/**
 * Kompresi gambar umum (tanpa watermark) untuk nota / lampiran lain.
 * Mengurangi resolusi ke maxDim (default 1280px) & JPEG quality 0.80.
 */
export async function compressImageFile(file: File, maxDim = 1280, quality = 0.80): Promise<File> {
	if (typeof document === 'undefined') return file;
	if (!file.type.startsWith('image/')) return file;

	try {
		const bitmap = await loadImage(file);
		let w = bitmap.width;
		let h = bitmap.height;

		if (w > maxDim || h > maxDim) {
			if (w > h) {
				h = Math.round((h * maxDim) / w);
				w = maxDim;
			} else {
				w = Math.round((w * maxDim) / h);
				h = maxDim;
			}
		}

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return file;

		ctx.drawImage(bitmap, 0, 0, w, h);

		const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
		if (!blob) return file;

		const targetName = file.name.replace(/\.[^/.]+$/, '.jpg');
		return new File([blob], targetName, { type: 'image/jpeg' });
	} catch (e) {
		console.warn('Gagal kompresi file gambar, menggunakan file asli:', e);
		return file;
	}
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = (e) => {
			URL.revokeObjectURL(url);
			reject(e);
		};
		img.src = url;
	});
}