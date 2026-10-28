// src/lib/utils/richContent.ts
// Port dari erp-epi-1 (src/lib/utils/richContent.js) — sisi BACA konten rich
// text (panduan_steps.isi, panduan_faq.jawab) yang ditulis lewat editor
// TipTap di erp-epi-1 (/settings/panduan-editor). Data dibagi lewat Directus
// yang sama (panduan_steps/panduan_faq), jadi project-epi HARUS ikut
// merender HTML ini dgn benar (bukan lagi teks polos) — kalau tidak, admin
// yang mengedit modul lewat editor baru akan melihat tag HTML mentah
// muncul di halaman lapangan.

import DOMPurify from 'isomorphic-dompurify';
import { getSecureAssetUrl } from '$lib/actions/secureAsset';

export function sanitizeRichHtml(html: string | null | undefined): string {
	if (!html) return '';
	const hasHtmlTag = /<(p|div|table|ul|ol|li|h[1-6]|span|br|strong|em|blockquote|button|a)\b[^>]*>/i.test(html);
	if (!hasHtmlTag) {
		const escaped = html
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
		const formatted = escaped
			.split(/\n\n+/)
			.map((block) => `<p class="mb-3">${block.replace(/\n/g, '<br/>')}</p>`)
			.join('');
		return DOMPurify.sanitize(formatted);
	}
	return DOMPurify.sanitize(html);
}

/**
 * Action: resolusikan `<img src="/assets/<id>">` di dalam node (hasil
 * {@html}) jadi blob URL terautentikasi — pola sama secureAssetSrc di
 * erp-epi-1. Pakai: <div use:resolveRichImages={htmlString}>{@html html}</div>
 */
export function resolveRichImages(node: HTMLElement, _param?: string) {
	async function run() {
		const imgs = node.querySelectorAll('img[src^="/assets/"]');
		for (const img of Array.from(imgs)) {
			const path = img.getAttribute('src');
			if (!path) continue;
			try {
				(img as HTMLImageElement).src = await getSecureAssetUrl(path);
			} catch (e) {
				console.warn('[resolveRichImages] gagal memuat gambar:', e);
			}
		}
	}
	run();
	return {
		update() {
			run();
		},
		destroy() {}
	};
}
