// src/lib/utils/autoDraftGlobal.ts
// Kembaran erp-epi/src/lib/utils/autoDraftGlobal.js — lihat file itu untuk penjelasan
// lengkap arsitektur rollout menyeluruh Lapis 1 (Fase 4).
import { autoDraft } from './autoDraft';
import { getDraftTier1Config, routePrefixesForGroups } from './draftTier1Config';

const wiredForms = new WeakSet<HTMLFormElement>();
let observerStarted = false;
let currentConfig: { enabled: boolean; groups: string[] } = { enabled: false, groups: [] };

function isRouteEnabled(pathname: string, groups: string[]): boolean {
	const prefixes = routePrefixesForGroups(groups);
	return prefixes.some((p) => pathname.startsWith(p));
}

function wireForm(form: HTMLFormElement) {
	if (wiredForms.has(form)) return;
	if (form.getAttribute('data-draft') === 'off') return;
	wiredForms.add(form);
	autoDraft(form, {});
}

function scanAndWire(root: Node) {
	if (!currentConfig.enabled) return;
	if (typeof location === 'undefined' || !isRouteEnabled(location.pathname, currentConfig.groups)) return;
	if (root instanceof HTMLFormElement) {
		wireForm(root);
		return;
	}
	if (!(root instanceof HTMLElement) && root !== document) return;
	(root as ParentNode).querySelectorAll?.('form').forEach((f) => wireForm(f as HTMLFormElement));
}

function startObserver() {
	if (observerStarted || typeof MutationObserver === 'undefined') return;
	observerStarted = true;
	const observer = new MutationObserver((mutations) => {
		if (!currentConfig.enabled) return;
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				scanAndWire(node);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

export function initGlobalAutoDraft() {
	if (typeof window === 'undefined') return;
	getDraftTier1Config().then((config) => {
		currentConfig = config;
		if (config.enabled) scanAndWire(document);
	});
	startObserver();
}
