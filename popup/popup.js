const $ = (id) => document.getElementById(id);
let tab = null, job = null, tracked = null;

function openPanel(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('panel/panel.html') + (hash ? '#' + hash : '') });
  window.close();
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { profile, cvs, templates, jobs, settings } = await IA.store.get();

  // Uyarılar
  const warns = [];
  if (!profile.firstName && !profile.email) warns.push('Profilin boş. <a href="#" data-go="tab=profile">Önce profilini doldur →</a>');
  if (!cvs.length) warns.push('Henüz CV yüklemedin. <a href="#" data-go="tab=cvs">CV ekle →</a>');
  if (warns.length) { $('warn').innerHTML = warns.join('<br>'); $('warn').hidden = false; }
  $('warn').addEventListener('click', e => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); openPanel(a.dataset.go); } });

  // CV ve şablon seçimleri
  $('cv').innerHTML = cvs.length
    ? cvs.map(c => `<option value="${c.id}" ${c.id === settings.defaultCvId ? 'selected' : ''}>${esc(c.name)} · ${c.lang.toUpperCase()}</option>`).join('')
    : '<option value="">CV yok</option>';
  $('tpl').innerHTML = '<option value="">Otomatik (sayfa diline göre)</option>' + templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

  // İstatistik
  const now = Date.now(), weekAgo = now - 7 * 864e5;
  const applied = jobs.filter(j => j.status !== 'saved');
  $('sTotal').textContent = applied.length;
  $('sWeek').textContent = applied.filter(j => (j.appliedAt || j.createdAt) >= weekAgo).length;
  $('sDue').textContent = jobs.filter(j => j.status === 'applied' && j.followUpAt && j.followUpAt <= now).length;

  $('status').innerHTML = IA.STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');

  // Sayfadaki ilanı oku
  try {
    const res = await IA.runInTab(tab.id, 'capture', {});
    job = res.find(r => r.detected && r.isTop) || res.find(r => r.detected) || res.find(r => r.isTop) || res[0] || null;
  } catch (e) {
    $('jobSite').textContent = 'Bu sayfada çalışamıyorum (tarayıcı sayfası ya da izin yok).';
    $('fill').disabled = true;
    return;
  }
  renderJob();
}

async function renderJob() {
  if (!job) { $('jobSite').textContent = 'Sayfa okunamadı.'; return; }
  tracked = await IA.findJobByUrl(job.url);
  $('jobSite').textContent = job.detected ? `${job.site} · ilan bulundu` : `${job.site} · ilan bilgisi tahmini`;
  $('jobTitle').textContent = (tracked && tracked.title) || job.title || '(başlık yok)';
  $('jobCompany').textContent = (tracked && tracked.company) || job.company || '';
  $('trackRow').hidden = !!tracked;
  $('statusRow').hidden = !tracked;
  if (tracked) $('status').value = tracked.status;
}

async function save(status) {
  if (!job) return;
  const { detected, isTop, formFields, frameId, ...data } = job;
  data.status = status;
  await IA.upsertJob(data);
  await renderJob();
  flash(status === 'applied' ? 'Başvuruldu olarak takibe eklendi.' : 'Takibe eklendi.', 'ok');
}

function flash(t, cls) { const r = $('result'); r.textContent = t; r.className = 'small result ' + (cls || ''); }
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('fill').addEventListener('click', async () => {
  $('fill').disabled = true; flash('Dolduruluyor…');
  try {
    const res = await IA.runInTab(tab.id, 'fill', { cvId: $('cv').value, templateId: $('tpl').value });
    const sum = res.reduce((a, r) => ({ filled: a.filled + (r.filled || 0), todo: a.todo + (r.todo || 0), sensitive: a.sensitive + (r.sensitive || 0), cv: a.cv || r.cv }), { filled: 0, todo: 0, sensitive: 0, cv: false });
    if (!sum.filled && !sum.todo && !sum.sensitive) flash('Bu sayfada doldurulacak form alanı bulamadım. Form bir sonraki adımda açılıyorsa tekrar dene.', 'err');
    else flash(`✓ ${sum.filled} alan dolduruldu${sum.cv ? ', CV eklendi' : ''}${sum.todo ? ` · ${sum.todo} alan sende` : ''}${sum.sensitive ? ` · ${sum.sensitive} hassas alan boş` : ''}`, 'ok');
  } catch (e) { flash('Hata: ' + (e.message || e), 'err'); }
  $('fill').disabled = false;
});
$('saveJob').addEventListener('click', () => save('saved'));
$('appliedJob').addEventListener('click', () => save('applied'));
$('status').addEventListener('change', async () => {
  if (!tracked) return;
  await IA.upsertJob({ id: tracked.id, url: tracked.url, status: $('status').value });
  flash('Durum güncellendi: ' + IA.STATUS_LABEL[$('status').value], 'ok');
  tracked = await IA.findJobByUrl(job.url);
});
$('openPanel').addEventListener('click', () => openPanel(tracked ? 'job=' + tracked.id : ''));

init();
