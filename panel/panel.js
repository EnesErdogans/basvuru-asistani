/* Başvuru Asistanı — panel */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let D = null;           // tüm veri
let view = 'board';
let editing = null;     // düzenlenen ilan id

function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2600); }
const toDate = (ms) => { if (!ms) return ''; const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fromDate = (s) => s ? new Date(s + 'T12:00:00').getTime() : null;
const fmt = (ms) => ms ? new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '';
const ago = (ms) => { if (!ms) return ''; const d = Math.floor((Date.now() - ms) / 864e5); return d <= 0 ? 'bugün' : d === 1 ? 'dün' : d + ' gün önce'; };

async function load() { D = await IA.store.get(); }
async function save(part) { Object.assign(D, part); await IA.store.set(part); }

// ---------------- Sekmeler ----------------
function showTab(name) {
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
  ({ jobs: renderJobs, profile: renderProfile, cvs: renderCvs, answers: renderAnswers, templates: renderTemplates, settings: renderSettings }[name] || (() => {}))();
}
$('#nav').addEventListener('click', e => { const a = e.target.closest('a[data-tab]'); if (a) { history.replaceState(null, '', '#tab=' + a.dataset.tab); showTab(a.dataset.tab); } });
$('#welcomeX').addEventListener('click', () => $('#welcome').hidden = true);

// ---------------- Başvurular ----------------
function filteredJobs() {
  const q = IA.norm($('#search').value), site = $('#siteFilter').value;
  return D.jobs.filter(j => (!site || j.site === site) && (!q || IA.norm([j.title, j.company, j.location, j.notes, j.site].join(' ')).includes(q)));
}
function renderStats() {
  const now = Date.now(), week = now - 7 * 864e5;
  const applied = D.jobs.filter(j => j.status !== 'saved');
  const answered = applied.filter(j => ['interview', 'offer', 'rejected'].includes(j.status)).length;
  const items = [
    ['Toplam başvuru', applied.length],
    ['Bu hafta', applied.filter(j => (j.appliedAt || j.createdAt) >= week).length],
    ['Dönüş oranı', applied.length ? Math.round(answered / applied.length * 100) + '%' : '–'],
    ['Mülakat', D.jobs.filter(j => j.status === 'interview').length],
    ['Takip bekleyen', D.jobs.filter(j => j.status === 'applied' && j.followUpAt && j.followUpAt <= now).length],
    ['Kaydedilen ilan', D.jobs.filter(j => j.status === 'saved').length],
  ];
  $('#stats').innerHTML = items.map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}
function cardHtml(j) {
  const due = j.status === 'applied' && j.followUpAt && j.followUpAt <= Date.now();
  const dl = j.deadline ? `<span class="tag">son: ${fmt(new Date(j.deadline).getTime())}</span>` : '';
  return `<div class="jc" draggable="true" data-id="${j.id}">
    <div class="t">${esc(j.title || '(başlıksız)')}</div>
    <div class="c">${esc(j.company || '')}${j.location ? ' · ' + esc(j.location) : ''}</div>
    <div class="m"><span class="tag">${esc(j.site || '')}</span><span class="tag">${ago(j.appliedAt || j.createdAt)}</span>${dl}${due ? '<span class="tag due">takip et</span>' : ''}</div>
  </div>`;
}
function renderJobs() {
  const sites = [...new Set(D.jobs.map(j => j.site).filter(Boolean))].sort();
  const cur = $('#siteFilter').value;
  $('#siteFilter').innerHTML = '<option value="">Tüm siteler</option>' + sites.map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
  renderStats();
  const jobs = filteredJobs();
  $('#board').hidden = view !== 'board'; $('#list').hidden = view !== 'list';
  if (view === 'board') {
    $('#board').innerHTML = IA.STATUSES.map(s => {
      const list = jobs.filter(j => j.status === s.id);
      return `<div class="col" data-status="${s.id}"><h3><div><i style="background:${s.color}"></i>${s.label}</div><span>${list.length}</span></h3>
        ${list.map(cardHtml).join('') || '<div class="empty">Buraya sürükle</div>'}</div>`;
    }).join('');
  } else {
    const st = Object.fromEntries(IA.STATUSES.map(s => [s.id, s]));
    $('#list').innerHTML = jobs.length ? `<table><thead><tr><th>Pozisyon</th><th>Şirket</th><th>Site</th><th>Durum</th><th>Başvuru</th><th>Takip</th></tr></thead><tbody>
      ${jobs.map(j => `<tr data-id="${j.id}"><td>${esc(j.title)}</td><td>${esc(j.company)}</td><td>${esc(j.site)}</td>
        <td><span class="pill" style="background:${st[j.status]?.color}">${st[j.status]?.label}</span></td>
        <td>${fmt(j.appliedAt)}</td><td>${j.status === 'applied' ? fmt(j.followUpAt) : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Henüz kayıt yok. Bir ilan sayfasında “＋ Takip”e bas ya da buradan elle ekle.</div>';
  }
}
$('#search').addEventListener('input', renderJobs);
$('#siteFilter').addEventListener('change', renderJobs);
$$('.seg button').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; $$('.seg button').forEach(x => x.classList.toggle('on', x === b)); renderJobs(); }));
document.addEventListener('click', e => { const c = e.target.closest('.jc, tr[data-id]'); if (c) openJob(c.dataset.id); });

// Sürükle bırak
let dragId = null;
$('#board').addEventListener('dragstart', e => { const c = e.target.closest('.jc'); if (c) { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
$('#board').addEventListener('dragover', e => { const col = e.target.closest('.col'); if (col && dragId) { e.preventDefault(); $$('.col').forEach(c => c.classList.toggle('over', c === col)); } });
$('#board').addEventListener('dragleave', e => { if (!e.relatedTarget || !e.relatedTarget.closest?.('.col')) $$('.col').forEach(c => c.classList.remove('over')); });
$('#board').addEventListener('drop', async e => {
  const col = e.target.closest('.col'); $$('.col').forEach(c => c.classList.remove('over'));
  if (!col || !dragId) return; e.preventDefault();
  const j = D.jobs.find(x => x.id === dragId); dragId = null;
  if (!j || j.status === col.dataset.status) return;
  await IA.upsertJob({ id: j.id, url: j.url, status: col.dataset.status });
  await load(); renderJobs(); toast(`${j.company || j.title}: ${IA.STATUS_LABEL[col.dataset.status]}`);
});

// Düzenleme penceresi
function openJob(id) {
  const j = id ? D.jobs.find(x => x.id === id) : { status: 'applied', site: 'Elle', appliedAt: Date.now() };
  if (!j) return;
  editing = id || null;
  const f = $('#jobForm');
  $('#dlgTitle').textContent = id ? (j.company ? `${j.company} — ${j.title}` : j.title) : 'Yeni başvuru';
  f.status.innerHTML = IA.STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  f.cvId.innerHTML = '<option value="">—</option>' + D.cvs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  ['title', 'company', 'location', 'site', 'url', 'contact', 'notes', 'status', 'cvId'].forEach(k => f[k].value = j[k] || (k === 'status' ? 'saved' : ''));
  f.appliedAt.value = toDate(j.appliedAt); f.followUpAt.value = toDate(j.followUpAt);
  f.deadline.value = j.deadline ? String(j.deadline).slice(0, 10) : '';
  $('#openUrl').href = /^https?:/.test(j.url || '') ? j.url : '#';
  $('#descBox').hidden = !j.description; $('#desc').textContent = j.description || '';
  $('#hist').innerHTML = (j.history || []).map(h => `<span class="tag">${IA.STATUS_LABEL[h.status] || h.status} · ${new Date(h.at).toLocaleDateString('tr-TR')}</span>`).join(' ');
  $('#delJob').hidden = !id;
  $('#jobDlg').showModal();
}
$('#addJob').addEventListener('click', () => openJob(null));
$('#jobDlg').addEventListener('close', async () => {
  if ($('#jobDlg').returnValue !== 'save') return;
  const f = $('#jobForm');
  const data = {
    title: f.title.value.trim(), company: f.company.value.trim(), location: f.location.value.trim(), site: f.site.value.trim(),
    url: f.url.value.trim() || ('manual:' + IA.uid('m')), contact: f.contact.value.trim(), notes: f.notes.value, status: f.status.value,
    cvId: f.cvId.value, deadline: f.deadline.value, _replace: true
  };
  const before = editing ? D.jobs.find(x => x.id === editing) : null;
  if (editing) data.id = editing;
  const saved = await IA.upsertJob(data);
  // Tarihler: sadece kullanıcı değiştirdiyse uygula
  const { jobs } = await IA.store.get(['jobs']);
  const j = jobs.find(x => x.id === saved.id);
  if (f.appliedAt.value !== toDate(before && before.appliedAt)) j.appliedAt = fromDate(f.appliedAt.value);
  if (f.followUpAt.value !== toDate(before && before.followUpAt)) { j.followUpAt = fromDate(f.followUpAt.value); j.followUpNotified = false; }
  await IA.store.set({ jobs });
  await load(); renderJobs(); toast('Kaydedildi');
});
$('#delJob').addEventListener('click', async () => {
  if (!editing || !confirm('Bu başvuru kaydı silinsin mi?')) return;
  await save({ jobs: D.jobs.filter(j => j.id !== editing) });
  $('#jobDlg').close(); renderJobs(); toast('Silindi');
});
$('#followMail').addEventListener('click', async () => {
  const f = $('#jobForm'), p = D.profile;
  const j = editing ? D.jobs.find(x => x.id === editing) : {};
  const tr = /kariyer|youthall|toptalent|anbean|secretcv|yenibiris/i.test(f.site.value) || /[çğıöşüİ]/.test((j.description || '') + f.title.value);
  const days = j.appliedAt ? Math.max(1, Math.round((Date.now() - j.appliedAt) / 864e5)) : null;
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const text = tr
    ? `Konu: ${f.title.value} başvurum hakkında\n\nMerhaba,\n\n${days ? days + ' gün önce' : 'Kısa süre önce'} ${f.company.value || 'şirketinizdeki'} ${f.title.value} pozisyonu için başvuru yaptım. Pozisyona olan ilgimin devam ettiğini belirtmek ve başvurumun durumu hakkında bilgi alıp alamayacağımı sormak istedim.\n\nEk bilgi ya da belge gerekirse memnuniyetle iletirim.\n\nİyi çalışmalar,\n${name}\n${p.phone || ''}`
    : `Subject: Following up on my ${f.title.value} application\n\nHello,\n\nI applied for the ${f.title.value} position at ${f.company.value || 'your company'}${days ? ' ' + days + ' days ago' : ' recently'}. I am still very interested in the role, and I wanted to ask if there is any update on my application.\n\nI am happy to share anything else you need.\n\nBest regards,\n${name}\n${p.phone || ''}`;
  await navigator.clipboard.writeText(text.trim());
  toast('Takip e-postası panoya kopyalandı');
});

// ---------------- Profil ----------------
function renderProfile() {
  const form = $('#profileForm');
  if (form.contains(document.activeElement)) return;
  const groups = {};
  IA.FIELDS.filter(f => !f.derived).forEach(f => (groups[f.group] = groups[f.group] || []).push(f));
  form.innerHTML = Object.entries(groups).map(([g, fs]) => `<h2>${g}</h2>` + fs.map(f => {
    const v = esc(D.profile[f.key] || '');
    let input;
    if (f.options) input = `<select name="${f.key}"><option value="">—</option>${f.options.map(o => `<option ${o === D.profile[f.key] ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (f.long) input = `<textarea name="${f.key}" rows="4" placeholder="${esc(f.placeholder || '')}">${v}</textarea>`;
    else input = `<input name="${f.key}" type="${f.type || 'text'}" value="${v}" placeholder="${esc(f.placeholder || '')}">`;
    return `<label class="${f.long ? 'full' : ''}">${f.label}${input}</label>`;
  }).join('')).join('');
}
let pTimer = null;
$('#profileForm').addEventListener('input', () => {
  clearTimeout(pTimer);
  $('#profileSaved').textContent = 'kaydediliyor…';
  pTimer = setTimeout(async () => {
    const fd = new FormData($('#profileForm'));
    const profile = Object.assign({}, D.profile);
    for (const [k, v] of fd.entries()) profile[k] = String(v).trim();
    await save({ profile });
    $('#profileSaved').textContent = '✓ kaydedildi';
  }, 450);
});

// ---------------- CV ----------------
function renderCvs() {
  $('#cvList').innerHTML = D.cvs.length ? D.cvs.map(c => `<div class="cardx cv" data-id="${c.id}">
      <button class="star ${c.id === D.settings.defaultCvId ? 'on' : ''}" title="Varsayılan yap">★</button>
      <input value="${esc(c.name)}" data-k="name" title="Görünen ad">
      <select data-k="lang"><option value="tr" ${c.lang === 'tr' ? 'selected' : ''}>TR</option><option value="en" ${c.lang === 'en' ? 'selected' : ''}>EN</option></select>
      <span class="small muted grow">${esc(c.fileName)} · ${(c.size / 1024).toFixed(0)} KB · ${fmt(c.addedAt)}</span>
      <button class="btn dl">İndir</button><button class="btn bad del">Sil</button></div>`).join('')
    : '<div class="empty">Henüz CV yok.</div>';
}
async function addCvFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Dosya 5 MB’tan büyük');
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
  const lang = /\b(en|eng|english|resume)\b/i.test(file.name) ? 'en' : 'tr';
  const cv = { id: IA.uid('cv'), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, type: file.type || 'application/pdf', size: file.size, lang, data, addedAt: Date.now() };
  const cvs = D.cvs.concat(cv);
  const settings = Object.assign({}, D.settings); if (!settings.defaultCvId) settings.defaultCvId = cv.id;
  await save({ cvs, settings }); renderCvs(); toast('CV eklendi');
}
$('#cvFile').addEventListener('change', e => { addCvFile(e.target.files[0]); e.target.value = ''; });
const drop = $('#drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addCvFile(e.dataTransfer.files[0]); });
$('#cvList').addEventListener('click', async e => {
  const row = e.target.closest('.cv'); if (!row) return;
  const c = D.cvs.find(x => x.id === row.dataset.id);
  if (e.target.closest('.star')) { await save({ settings: Object.assign({}, D.settings, { defaultCvId: c.id }) }); renderCvs(); }
  if (e.target.closest('.dl')) { const a = document.createElement('a'); a.href = URL.createObjectURL(IA.b64ToBlob(c.data, c.type)); a.download = c.fileName; a.click(); }
  if (e.target.closest('.del') && confirm(`“${c.name}” silinsin mi?`)) {
    const cvs = D.cvs.filter(x => x.id !== c.id);
    const settings = Object.assign({}, D.settings); if (settings.defaultCvId === c.id) settings.defaultCvId = cvs[0]?.id || '';
    await save({ cvs, settings }); renderCvs();
  }
});
$('#cvList').addEventListener('change', async e => {
  const row = e.target.closest('.cv'); const k = e.target.dataset.k; if (!row || !k) return;
  const cvs = D.cvs.map(c => c.id === row.dataset.id ? Object.assign({}, c, { [k]: e.target.value }) : c);
  await save({ cvs }); toast('Güncellendi');
});

// ---------------- Hazır cevaplar ----------------
function renderAnswers() {
  const q = IA.norm($('#ansSearch').value);
  const list = D.answers.filter(a => !q || IA.norm(a.question + ' ' + a.answer).includes(q));
  $('#ansList').innerHTML = list.length ? list.map(a => `<div class="cardx qa stack" data-id="${a.id}">
      <input data-k="question" value="${esc(a.question)}" placeholder="Soru">
      <textarea data-k="answer" rows="3" placeholder="Cevabın">${esc(a.answer)}</textarea>
      <div class="meta small muted"><span>${a.uses ? a.uses + ' kez kullanıldı' : 'henüz kullanılmadı'}</span><button class="btn bad del">Sil</button></div></div>`).join('')
    : '<div class="empty">Henüz kayıtlı cevap yok.</div>';
}
$('#ansSearch').addEventListener('input', renderAnswers);
$('#addAns').addEventListener('click', async () => {
  await save({ answers: [{ id: IA.uid('ans'), question: '', answer: '', uses: 0, createdAt: Date.now() }].concat(D.answers) });
  $('#ansSearch').value = ''; renderAnswers(); $('#ansList input')?.focus();
});
$('#ansList').addEventListener('change', async e => {
  const row = e.target.closest('.qa'); const k = e.target.dataset.k; if (!row || !k) return;
  await save({ answers: D.answers.map(a => a.id === row.dataset.id ? Object.assign({}, a, { [k]: e.target.value }) : a) });
  toast('Kaydedildi');
});
$('#ansList').addEventListener('click', async e => {
  const row = e.target.closest('.qa'); if (!row || !e.target.closest('.del')) return;
  await save({ answers: D.answers.filter(a => a.id !== row.dataset.id) }); renderAnswers();
});

// ---------------- Şablonlar ----------------
function renderTemplates() {
  const s = D.settings;
  $('#tplList').innerHTML = D.templates.map(t => `<div class="cardx stack tp" data-id="${t.id}">
      <div class="row"><input data-k="name" value="${esc(t.name)}"><select data-k="lang" style="max-width:90px"><option value="tr" ${t.lang === 'tr' ? 'selected' : ''}>TR</option><option value="en" ${t.lang === 'en' ? 'selected' : ''}>EN</option></select>
        <label class="sw small"><input type="radio" name="def-${t.lang}" class="def" ${(t.lang === 'tr' ? s.defaultTemplateTr : s.defaultTemplateEn) === t.id ? 'checked' : ''}> ${t.lang.toUpperCase()} varsayılanı</label></div>
      <textarea data-k="body" rows="9">${esc(t.body)}</textarea>
      <div class="row"><button class="btn pv">Önizle</button><button class="btn copy">Panoya kopyala</button><span class="grow"></span><button class="btn bad del">Sil</button></div>
      <pre class="prev" hidden></pre></div>`).join('') || '<div class="empty">Şablon yok.</div>';
}
$('#addTpl').addEventListener('click', async () => {
  await save({ templates: D.templates.concat({ id: IA.uid('tpl'), name: 'Yeni şablon', lang: 'tr', body: 'Merhaba,\n\n{sirket} şirketindeki {pozisyon} pozisyonu için…\n\n{ad} {soyad}' }) });
  renderTemplates();
});
$('#tplList').addEventListener('change', async e => {
  const row = e.target.closest('.tp'); if (!row) return;
  const t = D.templates.find(x => x.id === row.dataset.id);
  if (e.target.classList.contains('def')) {
    await save({ settings: Object.assign({}, D.settings, t.lang === 'tr' ? { defaultTemplateTr: t.id } : { defaultTemplateEn: t.id }) });
    return toast('Varsayılan şablon güncellendi');
  }
  const k = e.target.dataset.k; if (!k) return;
  await save({ templates: D.templates.map(x => x.id === t.id ? Object.assign({}, x, { [k]: e.target.value }) : x) });
  if (k === 'lang') renderTemplates();
  toast('Kaydedildi');
});
$('#tplList').addEventListener('click', async e => {
  const row = e.target.closest('.tp'); if (!row) return;
  const t = D.templates.find(x => x.id === row.dataset.id);
  const sample = { company: 'Örnek Teknoloji A.Ş.', title: 'Yazılım Stajyeri' };
  const body = $('textarea', row).value;
  if (e.target.closest('.pv')) { const p = $('.prev', row); p.hidden = !p.hidden; p.textContent = IA.fillTemplate(body, D.profile, sample); }
  if (e.target.closest('.copy')) { await navigator.clipboard.writeText(IA.fillTemplate(body, D.profile, {})); toast('Kopyalandı'); }
  if (e.target.closest('.del') && confirm('Şablon silinsin mi?')) { await save({ templates: D.templates.filter(x => x.id !== t.id) }); renderTemplates(); }
});

// ---------------- Ayarlar ----------------
async function renderSettings() {
  $$('[data-set]').forEach(i => { const v = D.settings[i.dataset.set]; if (i.type === 'checkbox') i.checked = !!v; else i.value = v; });
  const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  $('#permState').textContent = has ? '✓ Tüm sitelerde açık' : 'Şu an sadece bilinen iş sitelerinde';
  $('#permBtn').textContent = has ? 'İzni geri al' : 'İzin ver';
}
$('#tab-settings').addEventListener('change', async e => {
  const k = e.target.dataset.set; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : Math.max(1, Number(e.target.value) || 7);
  await save({ settings: Object.assign({}, D.settings, { [k]: v }) }); toast('Ayar kaydedildi');
});
$('#permBtn').addEventListener('click', async () => {
  const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (has) await chrome.permissions.remove({ origins: ['<all_urls>'] });
  else await chrome.permissions.request({ origins: ['<all_urls>'] });
  await chrome.runtime.sendMessage({ cmd: 'permissionsChanged' }).catch(() => {});
  renderSettings();
});
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}
$('#expJson').addEventListener('click', async () => {
  const all = await IA.store.get();
  if (!$('#expWithCv').checked) all.cvs = all.cvs.map(({ data, ...rest }) => rest);
  download(`basvuru-asistani-yedek-${toDate(Date.now())}.json`, JSON.stringify({ app: 'basvuru-asistani', version: 1, exportedAt: new Date().toISOString(), data: all }, null, 1), 'application/json');
});
$('#impJson').addEventListener('click', () => $('#impFile').click());
$('#impFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const data = j.data || j;
    if (!data.jobs && !data.profile) throw new Error('Bu dosya bir Başvuru Asistanı yedeği değil.');
    if (!confirm('Mevcut veriler yedektekiyle değiştirilecek. Devam edilsin mi?')) return;
    const keep = {};
    Object.keys(IA.DEFAULTS).forEach(k => { if (data[k] !== undefined) keep[k] = data[k]; });
    if (keep.cvs) keep.cvs = keep.cvs.filter(c => c.data); // dosyası olmayan CV kayıtlarını alma
    await IA.store.set(keep); await load(); showTab('jobs'); toast('Yedek geri yüklendi');
  } catch (err) { alert('Yüklenemedi: ' + err.message); }
});
$('#expCsv').addEventListener('click', () => {
  const cols = [['title', 'Pozisyon'], ['company', 'Şirket'], ['location', 'Konum'], ['site', 'Site'], ['status', 'Durum'], ['appliedAt', 'Başvuru tarihi'], ['followUpAt', 'Takip'], ['contact', 'İletişim'], ['url', 'Link'], ['notes', 'Notlar']];
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const rows = D.jobs.map(j => cols.map(([k]) => k === 'status' ? IA.STATUS_LABEL[j.status] : /At$/.test(k) ? (j[k] ? new Date(j[k]).toLocaleDateString('tr-TR') : '') : j[k]).map(cell).join(';'));
  download(`basvurular-${toDate(Date.now())}.csv`, '﻿' + [cols.map(c => cell(c[1])).join(';')].concat(rows).join('\r\n'), 'text/csv;charset=utf-8');
});
$('#wipe').addEventListener('click', async () => {
  if (!confirm('Tüm veriler silinsin mi? Bu işlem geri alınamaz.')) return;
  await chrome.storage.local.clear(); await load(); showTab('profile'); toast('Tüm veriler silindi');
});

// ---------------- Başlat ----------------
chrome.storage.onChanged.addListener(async (ch) => {
  await load();
  const active = $('.tab.on')?.id;
  if (ch.jobs && active === 'tab-jobs' && !$('#jobDlg').open) renderJobs();
  if (ch.answers && active === 'tab-answers' && !$('#tab-answers').contains(document.activeElement)) renderAnswers();
});
(async () => {
  await load();
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('welcome')) $('#welcome').hidden = false;
  showTab(h.get('tab') || (h.get('job') ? 'jobs' : 'jobs'));
  if (h.get('job')) openJob(h.get('job'));
})();
