// src/routes/api/version-info/+server.ts
// Endpoint penyedia metadata versi aplikasi, git commit, catatan rilis lapangan,
// dan aturan konfigurasi lingkungan UI (project-epi, Fase 2 & Fase 4).
// Dirancang dengan Zero-Overhead & In-Memory Cache 5 Menit.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { directusServerJson } from '$lib/server/directus';

interface VersionInfo {
	version: string;
	pkgVersion: string;
	gitHash: string;
	gitBranch: string;
	commitDate: string;
	commitMessage: string;
	buildTimestamp: string;
}

interface ReleaseNoteItem {
	id: number;
	versi: string;
	judul: string;
	ringkasan: string;
	tipe: string;
	tanggal_rilis: string;
}

interface EnvRules {
	show_accent_bar: boolean;
	custom_sandbox_domains: string[];
}

let cachedVersionInfo: VersionInfo | null = null;
let cachedReleaseNotes: ReleaseNoteItem[] | null = null;
let cachedEnvRules: EnvRules | null = null;
let releaseNotesExpiresAt = 0;
let envRulesExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Menit

function getAppVersionInfo(): VersionInfo {
	if (cachedVersionInfo) {
		return cachedVersionInfo;
	}

	let pkgVersion = '1.0.0';
	let gitHash = 'unknown';
	let gitBranch = 'Major';
	let commitDate = '';
	let commitMessage = '';

	try {
		const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (pkg?.version) pkgVersion = pkg.version;
		}
	} catch {
		// fallback
	}

	try {
		gitHash = execSync('git rev-parse --short HEAD', { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'Major';
		commitDate = execSync('git log -1 --format=%cd --date=short', { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		commitMessage = execSync('git log -1 --format=%s', { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		try {
			const headPath = fileURLToPath(new URL('../../../.git/HEAD', import.meta.url));
			if (existsSync(headPath)) {
				const headContent = readFileSync(headPath, 'utf8').trim();
				if (headContent.startsWith('ref:')) {
					gitBranch = headContent.replace('ref: refs/heads/', '').trim();
				} else {
					gitHash = headContent.slice(0, 9);
				}
			}
		} catch {
			// default
		}
	}

	const displayVersion = pkgVersion !== '0.0.1' ? `v${pkgVersion}` : `v${commitDate ? commitDate.replace(/-/g, '.') : '2026.10.27'}`;

	cachedVersionInfo = {
		version: displayVersion,
		pkgVersion,
		gitHash: gitHash !== 'unknown' ? gitHash : '',
		gitBranch,
		commitDate: commitDate || new Date().toISOString().slice(0, 10),
		commitMessage: commitMessage || 'Latest release build',
		buildTimestamp: new Date().toISOString()
	};

	return cachedVersionInfo;
}

async function fetchLatestReleaseNotes(): Promise<ReleaseNoteItem[]> {
	const now = Date.now();
	if (cachedReleaseNotes && now < releaseNotesExpiresAt) {
		return cachedReleaseNotes;
	}

	try {
		const filter = encodeURIComponent('project-epi,both');
		const res = await directusServerJson<{ data: ReleaseNoteItem[] }>(
			`/items/release_notes?filter[status][_eq]=published&filter[target_app][_in]=${filter}&sort=-tanggal_rilis&limit=4&fields=id,versi,judul,ringkasan,tipe,tanggal_rilis`
		);

		const notes = res?.data || [];
		cachedReleaseNotes = notes;
		releaseNotesExpiresAt = now + CACHE_TTL_MS;
		return notes;
	} catch (err: any) {
		console.warn('[version-info:project] Gagal membaca release_notes:', err?.message || err);
		return cachedReleaseNotes || [];
	}
}

async function fetchEnvRules(): Promise<EnvRules> {
	const now = Date.now();
	if (cachedEnvRules && now < envRulesExpiresAt) {
		return cachedEnvRules;
	}

	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: string }> }>(
			`/items/app_settings?filter[setting_key][_eq]=system.environment_rules&limit=1`
		);
		if (res?.data?.[0]?.setting_value) {
			cachedEnvRules = JSON.parse(res.data[0].setting_value);
			envRulesExpiresAt = now + CACHE_TTL_MS;
			return cachedEnvRules!;
		}
	} catch (err: any) {
		console.warn('[version-info:project] Gagal membaca system.environment_rules:', err?.message || err);
	}

	return { show_accent_bar: true, custom_sandbox_domains: [] };
}

export const GET: RequestHandler = async () => {
	const versionInfo = getAppVersionInfo();
	const [releaseNotes, envRules] = await Promise.all([
		fetchLatestReleaseNotes(),
		fetchEnvRules()
	]);

	return json(
		{
			success: true,
			data: {
				...versionInfo,
				releaseNotes,
				envRules
			}
		},
		{
			headers: {
				'Cache-Control': 'public, max-age=180'
			}
		}
	);
};
