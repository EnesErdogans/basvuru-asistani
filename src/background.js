/* Başvuru Asistanı — arka plan: kısayollar, sağ tık menüsü, takip hatırlatmaları */
importScripts('core.js');

const PANEL = 'panel/panel.html';

chrome.runtime.onInstalled.addListener(async (info) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ia-fill', title: 'Bu formu doldur', contexts: ['page', 'editable', 'frame'] });
    chrome.contextMenus.create({ id: 'ia-save', title: 'Bu ilanı takibe ekle', contexts: ['page', 'frame'] });
    chrome.contextMenus.create({ id: 'ia-panel', title: 'Başvuru panelini aç', contexts: ['action'] });
  });
  chrome.alarms.create('ia-check', { periodInMinutes: 60, delayInMinutes: 1 });
  if (info.reason === 'install') openPanel({ tab: 'profile', welcome: 1 });
  await registerEverywhere();
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('ia-check', { periodInMinutes: 60, delayInMinutes: 1 }); updateBadge(); });

function openPanel(p) {
  const qs = new URLSearchParams(p || {}).toString();
  chrome.tabs.create({ url: chrome.runtime.getURL(PANEL) + (qs ? '#' + qs : '') });
}

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

async function doFill(tabId) {
  try { await IA.runInTab(tabId, 'fill', {}); }
  catch (e) { notify('ia-err', 'Bu sayfada çalışamıyorum', 'Chrome bu sayfaya eklenti erişimine izin vermiyor (ör. Chrome Web Mağazası, ayarlar sayfaları).'); }
}
async function doSave(tabId) {
  try {
    const res = await IA.runInTab(tabId, 'capture', {});
    const pick = res.find(r => r.detected && r.isTop) || res.find(r => r.detected) || res.find(r => r.isTop) || res[0];
    if (!pick) return;
    const { detected, isTop, formFields, frameId, ...job } = pick;
    const saved = await IA.upsertJob(job);
    notify('ia-saved', 'Takibe eklendi', `${saved.title || 'İlan'}${saved.company ? ' · ' + saved.company : ''}`);
  } catch (e) { notify('ia-err', 'Bu sayfada çalışamıyorum', String(e.message || e)); }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ia-fill' && tab) doFill(tab.id);
  if (info.menuItemId === 'ia-save' && tab) doSave(tab.id);
  if (info.menuItemId === 'ia-panel') openPanel();
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab = tab || await activeTab(); if (!tab) return;
  if (cmd === 'fill-form') doFill(tab.id);
  if (cmd === 'save-job') doSave(tab.id);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.cmd === 'openPanel') { openPanel(msg.jobId ? { job: msg.jobId } : (msg.tab ? { tab: msg.tab } : null)); reply({ ok: true }); }
  if (msg && msg.cmd === 'permissionsChanged') { registerEverywhere().then(() => reply({ ok: true })); return true; }
});

// ---------- "Tüm sitelerde çalış" izni verilirse içerik betiğini her yere kaydet ----------
async function registerEverywhere() {
  const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['ia-all'] }).catch(() => []);
  if (has && !existing.length) {
    await chrome.scripting.registerContentScripts([{
      id: 'ia-all', matches: ['<all_urls>'], js: ['src/core.js', 'src/content.js'],
      runAt: 'document_idle', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true
    }]).catch(e => console.warn(e));
  } else if (!has && existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: ['ia-all'] }).catch(() => {});
  }
}
chrome.permissions.onAdded.addListener(registerEverywhere);
chrome.permissions.onRemoved.addListener(registerEverywhere);

// ---------- Takip hatırlatmaları ----------
function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title, message, priority: 1 });
}

async function checkFollowUps() {
  const { jobs } = await IA.store.get(['jobs']);
  const now = Date.now();
  let changed = false;
  for (const j of jobs) {
    if (j.status === 'applied' && j.followUpAt && j.followUpAt <= now && !j.followUpNotified) {
      const days = Math.max(1, Math.round((now - (j.appliedAt || j.createdAt)) / 864e5));
      notify('ia-fu-' + j.id, `Takip zamanı: ${j.company || j.title || 'başvuru'}`,
        `${j.title || 'Bu başvuru'} için ${days} gündür ses yok. Kısa bir takip e-postası atmak isteyebilirsin.`);
      j.followUpNotified = true; changed = true;
    }
  }
  if (changed) await IA.store.set({ jobs });
  updateBadge(jobs);
}

async function updateBadge(jobs) {
  if (!jobs) ({ jobs } = await IA.store.get(['jobs']));
  const now = Date.now();
  const due = jobs.filter(j => j.status === 'applied' && j.followUpAt && j.followUpAt <= now).length;
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  chrome.action.setBadgeText({ text: due ? String(due) : '' });
}

chrome.alarms.onAlarm.addListener(a => { if (a.name === 'ia-check') checkFollowUps(); });
chrome.notifications.onClicked.addListener(id => {
  if (id.startsWith('ia-fu-')) openPanel({ job: id.slice(6) });
  chrome.notifications.clear(id);
});
chrome.storage.onChanged.addListener((ch) => { if (ch.jobs) updateBadge(ch.jobs.newValue || []); });
