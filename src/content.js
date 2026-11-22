/* Başvuru Asistanı — içerik betiği: alan tespiti, doldurma, CV ekleme, ilan yakalama */
(function () {
  if (self.__IA_API) return;
  const IA = self.IA;
  const isTop = window === window.top;
  const KNOWN_SITE = /linkedin\.|kariyer\.net|youthall|toptalent|anbean|greenhouse|lever\.co|myworkday|successfactors|sapsf|smartrecruiters|secretcv|yenibiris|indeed|glassdoor/.test(location.hostname);

  // ---------- Stil ----------
  const STYLE_CSS = `
    [data-ia="filled"]{outline:2px solid #22c55e !important;outline-offset:1px !important;transition:outline-color .3s}
    [data-ia="todo"]{outline:2px dashed #f59e0b !important;outline-offset:1px !important}
    [data-ia="sensitive"]{outline:2px dashed #ef4444 !important;outline-offset:1px !important}`;
  function injectStyle(root) {
    const host = root === document ? (document.head || document.documentElement) : root;
    if (!host || host.querySelector?.(':scope > style[data-ia-style]')) return;
    const s = document.createElement('style'); s.setAttribute('data-ia-style', ''); s.textContent = STYLE_CSS; host.appendChild(s);
  }

  // ---------- DOM gezinme ----------
  function roots() {
    const out = [document];
    const visit = (root) => {
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { out.push(el.shadowRoot); visit(el.shadowRoot); } });
    };
    visit(document);
    return out;
  }
  function controls() {
    const list = [];
    for (const r of roots()) r.querySelectorAll('input, select, textarea').forEach(el => list.push({ el, root: r }));
    return list;
  }
  function visible(el) {
    if (el.disabled || el.readOnly && el.type !== 'file') return false;
    if (el.type === 'hidden') return false;
    if (el.type === 'file') return true; // dosya alanları çoğu zaman gizli
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    return el.getClientRects().length > 0;
  }
  function textOf(node) {
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll?.('select, option, textarea, script, style, button, svg, input').forEach(n => n.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function labelText(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(textOf(l));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const rn = el.getRootNode();
      lb.split(/\s+/).forEach(id => {
        const n = (rn.getElementById && rn.getElementById(id)) || document.getElementById(id);
        if (n) parts.push(textOf(n));
      });
    }
    const lab = el.closest('label'); if (lab && !(el.labels && [...el.labels].includes(lab))) parts.push(textOf(lab));
    return parts.join(' ').trim();
  }
  const CONTROL_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
  function nearbyText(el) {
    const fs = el.closest('fieldset');
    let legend = fs && fs.querySelector('legend');
    let a = el.parentElement;
    for (let i = 0; i < 5 && a; i++, a = a.parentElement) {
      if ((a.textContent || '').length > 700) break;
      const ctrls = [...a.querySelectorAll(CONTROL_SEL)].filter(c => !(el.type === 'radio' && c.name === el.name) && c !== el);
      if (ctrls.length) break;
      const t = textOf(a);
      if (t.length >= 2 && t.length <= 220) return t;
    }
    return legend ? textOf(legend) : '';
  }
  function describe(el) {
    const label = labelText(el);
    const aria = el.getAttribute('aria-label') || '';
    const near = (label || aria) ? '' : nearbyText(el);
    return {
      label, aria, near,
      ph: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      auto: (el.getAttribute('data-automation-id') || el.getAttribute('data-qa') || el.getAttribute('data-testid') || ''),
      ac: (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop(),
      question: (label || aria || near || el.getAttribute('placeholder') || el.getAttribute('name') || '').slice(0, 240)
    };
  }

  // ---------- Eşleştirme ----------
  function matchKey(el, d) {
    const all = IA.norm([d.label, d.aria, d.near, d.ph, d.name, d.id, d.auto].join(' '));
    if (IA.SENSITIVE.test(all)) return { key: null, sensitive: true };
    if (IA.SKIP.test(all)) return { key: null, skip: true };
    const score = {};
    const add = (k, w) => { score[k] = (score[k] || 0) + w; };
    if (IA.AUTOCOMPLETE[d.ac]) add(IA.AUTOCOMPLETE[d.ac], 10);
    const signals = [[d.label, 6], [d.aria, 6], [d.auto, 7], [d.ph, 3], [d.name, 4], [d.id, 4], [d.near, 3]];
    for (const [txt, w] of signals) {
      if (!txt) continue;
      const n = IA.norm(txt);
      if (!n || n.length > 260) continue;
      for (const f of IA.FIELDS) if (f.re.test(n) && !(f.not && f.not.test(n))) add(f.key, w);
    }
    const t = (el.type || '').toLowerCase();
    if (t === 'email') add('email', 6);
    if (t === 'tel') add('phone', 6);
    if (t === 'url') { ['linkedin', 'github', 'website'].forEach(k => { if (score[k]) add(k, 1); }); }
    for (const k of Object.keys(score)) {
      if (t === 'email' && k !== 'email') score[k] -= 6;
      if (t === 'tel' && k !== 'phone') score[k] -= 6;
      if (t === 'date' && !IA.FIELD_BY_KEY[k]?.type?.includes('date')) score[k] -= 4;
    }
    let best = null, bs = 0;
    for (const f of IA.FIELDS) { const s = score[f.key] || 0; if (s > bs) { bs = s; best = f.key; } }
    return bs >= 3 ? { key: best, score: bs } : { key: null };
  }

  // ---------- Değer yazma ----------
  function formatDate(iso, el) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
    const t = (el.type || '').toLowerCase();
    if (t === 'date') return iso;
    if (t === 'month') return iso.slice(0, 7);
    const [y, m, d] = iso.split('-');
    const ph = IA.norm(el.getAttribute('placeholder') || '');
    if (/mm dd/.test(ph)) return `${m}/${d}/${y}`;
    if (/dd mm/.test(ph) && (el.getAttribute('placeholder') || '').includes('/')) return `${d}/${m}/${y}`;
    return `${d}.${m}.${y}`;
  }
  function setNative(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    try { el.focus({ preventScroll: true }); } catch (e) {}
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
  }
  function isPlaceholderOption(t) { return !t || /^(select|choose|please|seciniz|sec|lutfen|secim yap|bir secenek|none selected|\-+)/.test(t); }
  function bestOption(opts, value) {
    const cands = new Set();
    String(value).split(/[,;/]/).forEach(part => IA.synonymsOf(part).forEach(c => c && cands.add(c)));
    IA.synonymsOf(value).forEach(c => c && cands.add(c));
    let best = null, bs = 0;
    for (const o of opts) {
      const t = IA.norm(o.text), vv = IA.norm(o.value);
      if (isPlaceholderOption(t) && !vv) continue;
      const ownGroup = IA.synonymsOf(t); // ör. "Ön Lisans" ayrı bir grup; "Lisans" ararken onu seçme
      for (const c of cands) {
        if (ownGroup.length > 1 && !ownGroup.includes(c)) continue;
        let s = 0;
        if (t === c || vv === c) s = 3;
        else if ((' ' + t + ' ').includes(' ' + c + ' ') || (t.length > 1 && (' ' + c + ' ').includes(' ' + t + ' '))) s = 2;
        else {
          const ct = new Set(IA.tokens(c)); if (IA.tokens(t).some(x => x.length > 2 && ct.has(x))) s = 1;
        }
        if (s > bs) { bs = s; best = o; }
      }
    }
    return best;
  }
  function fillSelect(el, value) {
    const opts = [...el.options].map(o => ({ text: o.textContent, value: o.value, el: o }));
    const o = bestOption(opts, value);
    if (!o) return false;
    setNative(el, o.value);
    return true;
  }
  function isCombobox(el) {
    return el.tagName === 'INPUT' && (el.getAttribute('role') === 'combobox' || /list|both/.test(el.getAttribute('aria-autocomplete') || ''));
  }
  async function fillCombobox(el, value) {
    setNative(el, '');
    try { el.focus(); } catch (e) {}
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));
    await new Promise(r => setTimeout(r, 800));
    const opts = [];
    roots().forEach(r => r.querySelectorAll('[role="option"]').forEach(o => { if (o.getClientRects().length) opts.push({ text: o.textContent, value: '', el: o }); }));
    const o = bestOption(opts, value);
    if (o) { o.el.click(); return true; }
    return false;
  }
  function fitValue(el, key, raw) {
    let v = raw;
    const f = IA.FIELD_BY_KEY[key];
    if (f && f.type === 'date') v = formatDate(raw, el);
    if ((el.type || '').toLowerCase() === 'number') {
      const m = String(v).match(/\d+(?:[.,]\d+)?/); v = m ? m[0].replace(',', '.') : '';
    }
    const max = Number(el.getAttribute('maxlength'));
    if (max > 0 && v.length > max) v = v.slice(0, max);
    return v;
  }
  function profileValue(key, p) {
    if (key === 'fullName') return [p.firstName, p.lastName].filter(Boolean).join(' ');
    return p[key] || '';
  }
  function hasValue(el) {
    if (el.type === 'file') return el.files && el.files.length > 0;
    if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; return !!(o && el.value && !isPlaceholderOption(IA.norm(o.textContent))); }
    return !!(el.value && el.value.trim());
  }

  // ---------- Sayfa / ilan bilgisi ----------
  const clean = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n || 200);
  const q = (sel, root) => { try { return (root || document).querySelector(sel); } catch (e) { return null; } };
  const qt = (sel) => clean(q(sel)?.textContent);
  const meta = (p) => q(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content') || '';

  function fromJsonLd() {
    const items = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const push = (x) => { if (!x) return; if (Array.isArray(x)) x.forEach(push); else { items.push(x); if (x['@graph']) push(x['@graph']); } };
        push(data);
      } catch (e) {}
    });
    const jp = items.find(x => [].concat(x['@type'] || []).includes('JobPosting'));
    if (!jp) return null;
    const org = jp.hiringOrganization;
    let loc = '';
    const jl = [].concat(jp.jobLocation || [])[0];
    if (jl && jl.address) {
      const a = jl.address; const c = typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry;
      loc = [a.addressLocality, a.addressRegion, c].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
    }
    if (!loc && jp.jobLocationType === 'TELECOMMUTE') loc = 'Uzaktan';
    const div = document.createElement('div'); div.innerHTML = String(jp.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n');
    return {
      title: clean(jp.title), company: clean(typeof org === 'string' ? org : org && org.name), location: clean(loc),
      employmentType: clean([].concat(jp.employmentType || []).join(', ')), datePosted: jp.datePosted || '', deadline: jp.validThrough || '',
      description: (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000)
    };
  }
  function siteSpecific() {
    const h = location.hostname;
    if (/linkedin\./.test(h)) {
      const title = qt('.job-details-jobs-unified-top-card__job-title h1') || qt('.job-details-jobs-unified-top-card__job-title') || qt('.jobs-unified-top-card__job-title') || qt('.top-card-layout__title') || qt('h1.t-24');
      const company = qt('.job-details-jobs-unified-top-card__company-name a') || qt('.job-details-jobs-unified-top-card__company-name') || qt('.jobs-unified-top-card__company-name') || qt('.topcard__org-name-link') || qt('.top-card-layout__second-subline a');
      const location = qt('.job-details-jobs-unified-top-card__primary-description-container .tvm__text') || qt('.job-details-jobs-unified-top-card__bullet') || qt('.topcard__flavor--bullet');
      const description = clean(q('#job-details, .jobs-description__content, .show-more-less-html__markup')?.innerText, 8000);
      if (title) return { title, company, location, description };
    }
    if (/kariyer\.net/.test(h) && /\/is-ilani\//.test(location.pathname)) {
      const title = qt('h1');
      const company = qt('a[href*="/firma/"]') || qt('[class*="company-name"]') || qt('[class*="firma-adi"]');
      if (title) return { title, company };
    }
    if (/greenhouse\.io/.test(h)) {
      const title = qt('h1.app-title') || qt('.job__title h1') || qt('h1');
      const company = qt('.company-name') || clean(document.title.split(/ at | - /).pop());
      const location = qt('.location') || qt('.job__location');
      if (title) return { title, company: company.replace(/^at /i, ''), location };
    }
    if (/lever\.co/.test(h)) {
      const title = qt('.posting-headline h2');
      const company = clean(document.title.split(' - ')[0]);
      const location = qt('.posting-categories .location') || qt('.sort-by-location');
      if (title) return { title, company, location };
    }
    if (/myworkday/.test(h)) {
      const title = qt('[data-automation-id="jobPostingHeader"]');
      const location = qt('[data-automation-id="locations"] dd') || qt('[data-automation-id="locations"]');
      const company = clean((h.split('.')[0] || '').replace(/[-_]/g, ' '));
      if (title) return { title, company, location };
    }
    if (/youthall|toptalent|anbean|secretcv|yenibiris/.test(h) && /ilan|job|is-|staj|intern|career|kariyer|position|program/.test(location.pathname)) {
      const title = qt('h1');
      const company = qt('[class*="company"] a') || qt('[class*="company-name"]') || qt('[class*="company"]');
      if (title) return { title, company };
    }
    return null;
  }
  function capture() {
    const ld = fromJsonLd();
    const ss = siteSpecific();
    const job = Object.assign({}, ld || {}, Object.fromEntries(Object.entries(ss || {}).filter(([, v]) => v)));
    if (ld) Object.keys(ld).forEach(k => { if (ld[k] && k === 'description' && (!ss || !ss.description)) job[k] = ld[k]; });
    job.title = job.title || clean(meta('og:title') || qt('h1') || document.title, 160);
    job.company = job.company || clean(meta('og:site_name'), 120);
    job.url = IA.canonicalUrl(location.href);
    job.site = IA.siteName(location.hostname);
    job.detected = !!(ld || ss);
    job.isTop = isTop;
    job.formFields = countFields();
    return job;
  }
  function countFields() {
    let n = 0;
    try { document.querySelectorAll(CONTROL_SEL).forEach(el => { if (el.type !== 'checkbox' && el.type !== 'radio' && visible(el)) n++; }); } catch (e) {}
    return n;
  }

  // ---------- Ana doldurma ----------
  async function fill(opts) {
    opts = opts || {};
    const { profile, cvs, answers, templates, settings } = await IA.store.get();
    const res = { filled: 0, todo: 0, sensitive: 0, cv: false, frames: 1, fields: [] , noProfile: !profile.firstName && !profile.email };
    const job = capture();
    const lang = (document.documentElement.lang || '').toLowerCase().startsWith('tr') || /\.tr$|kariyer\.net|youthall|secretcv|yenibiris|anbean|toptalent/.test(location.hostname) ? 'tr' : 'en';
    const cv = cvs.find(c => c.id === opts.cvId) || cvs.find(c => c.id === settings.defaultCvId && (!opts.autoLang || c.lang === lang)) || cvs.find(c => c.lang === lang) || cvs.find(c => c.id === settings.defaultCvId) || cvs[0];
    const tpl = templates.find(t => t.id === opts.templateId) || templates.find(t => t.id === (lang === 'tr' ? settings.defaultTemplateTr : settings.defaultTemplateEn)) || templates.find(t => t.lang === lang);
    const overwrite = !!settings.overwrite;
    const mark = (el, state) => { if (settings.highlight !== false) el.setAttribute('data-ia', state); };

    roots().forEach(injectStyle);
    const list = controls();
    const fileInputs = list.filter(x => x.el.type === 'file' && !x.el.disabled);
    const doneRadio = new Set();

    for (const { el } of list) {
      const t = (el.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'image', 'checkbox', 'search', 'range', 'color', 'password'].includes(t)) continue;
      if (!visible(el)) continue;
      const d = describe(el);

      // --- Dosya: CV ---
      if (t === 'file') {
        if (!cv || hasValue(el)) continue;
        const qn = IA.norm([d.label, d.aria, d.near, d.name, d.id, d.auto].join(' '));
        if (/cover|on yazi|motivation|transcript|transkript|photo|fotograf|resim|image|avatar|picture|diploma|sertifika|certificate/.test(qn)) continue;
        const accept = (el.getAttribute('accept') || '').toLowerCase();
        if (accept && !/pdf|\*\/\*|application\/\*|^$/.test(accept)) continue;
        const looksCv = /\bcv\b|resume|ozgecmis|curriculum|vitae|attach|dosya|upload|yukle/.test(qn) || fileInputs.length === 1;
        if (!looksCv) continue;
        try {
          const file = new File([IA.b64ToBlob(cv.data, cv.type)], cv.fileName || 'CV.pdf', { type: cv.type || 'application/pdf' });
          const dt = new DataTransfer(); dt.items.add(file);
          el.files = dt.files;
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          res.cv = cv.name; res.filled++;
          const shown = el.getClientRects().length ? el : el.closest('div,label,section');
          if (shown) mark(shown, 'filled');
        } catch (e) { res.cvError = String(e); }
        continue;
      }

      // --- Radyo grupları ---
      if (t === 'radio') {
        if (!el.name || doneRadio.has(el.name)) continue;
        doneRadio.add(el.name);
        const group = [...el.getRootNode().querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        if (group.some(r => r.checked)) continue;
        let container = el.closest('fieldset, [role=radiogroup]') || el.parentElement;
        for (let i = 0; i < 4 && container && !group.every(r => container.contains(r)); i++) container = container.parentElement;
        const legend = container && (container.querySelector('legend') || container.querySelector('[class*=label], [class*=question], label:not(:has(input))'));
        const question = clean(legend ? textOf(legend) : (container ? textOf(container).slice(0, 220) : ''), 240);
        const qn = IA.norm(question);
        if (!qn || IA.SENSITIVE.test(qn) || IA.SKIP.test(qn)) continue;
        let value = '';
        const fk = IA.FIELDS.find(f => f.options && f.re.test(qn) && !(f.not && f.not.test(qn)));
        if (fk) value = profile[fk.key] || '';
        if (!value) { const a = bestAnswer(answers, question); if (a) value = a.answer; }
        if (!value) { group.forEach(r => mark(r.closest('label') || r, 'todo')); res.todo++; res.fields.push({ q: question, state: 'todo' }); attachLearn(group[0], question, 'radio'); continue; }
        const opts2 = group.map(r => ({ text: labelText(r) || r.value, value: r.value, el: r }));
        const o = bestOption(opts2, value);
        if (o) { o.el.click(); mark(o.el.closest('label') || o.el, 'filled'); res.filled++; res.fields.push({ q: question, state: 'filled' }); }
        else { res.todo++; group.forEach(r => mark(r.closest('label') || r, 'todo')); }
        continue;
      }

      if (hasValue(el) && !overwrite) continue;
      const m = matchKey(el, d);
      if (m.sensitive) { mark(el, 'sensitive'); res.sensitive++; res.fields.push({ q: d.question, state: 'sensitive' }); continue; }
      if (m.skip) continue;

      let value = '', how = '';
      const qn = IA.norm(d.question);
      // Ön yazı
      if (el.tagName === 'TEXTAREA' && /cover letter|on yazi|motivation letter|motivasyon mektubu|onyazi/.test(IA.norm([d.label, d.aria, d.near, d.name, d.id, d.ph].join(' ')))) {
        if (tpl) { value = IA.fillTemplate(tpl.body, profile, job); how = 'template'; }
      }
      if (!value && m.key) { value = profileValue(m.key, profile); how = 'profile'; }
      if (!value && qn) { const a = bestAnswer(answers, d.question); if (a) { value = a.answer; how = 'answer'; a.uses = (a.uses || 0) + 1; } }

      if (!value) {
        // Gerekli ya da soru gibi duran boş alanları işaretle
        const required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(d.label);
        if (required || qn.length > 2) { mark(el, 'todo'); res.todo++; res.fields.push({ q: d.question, state: 'todo' }); }
        if (qn.length > 2) attachLearn(el, d.question, el.tagName.toLowerCase());
        continue;
      }

      let ok = false;
      if (el.tagName === 'SELECT') ok = fillSelect(el, value);
      else if (isCombobox(el)) ok = await fillCombobox(el, fitValue(el, m.key, value));
      else { const v = fitValue(el, m.key, value); if (v) { setNative(el, v); ok = true; } }
      if (ok) { mark(el, 'filled'); res.filled++; res.fields.push({ q: d.question, state: 'filled', how }); }
      else { mark(el, 'todo'); res.todo++; res.fields.push({ q: d.question, state: 'todo' }); attachLearn(el, d.question, el.tagName.toLowerCase()); }
    }

    if (answers.some(a => a.uses)) await IA.store.set({ answers });
    if (res.filled || res.todo || res.sensitive) {
      showToast(summaryText(res), res.noProfile ? [{ label: 'Profili doldur', act: () => chrome.runtime.sendMessage({ cmd: 'openPanel', tab: 'profile' }) }] : null);
      const first = document.querySelector('[data-ia="todo"], [data-ia="sensitive"]');
      if (first && opts.scroll !== false) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return res;
  }
  function summaryText(r) {
    const parts = [`✓ ${r.filled} alan dolduruldu`];
    if (r.cv) parts.push(`CV eklendi (${r.cv})`);
    if (r.todo) parts.push(`${r.todo} alan sende (turuncu)`);
    if (r.sensitive) parts.push(`${r.sensitive} hassas alan boş bırakıldı (kırmızı)`);
    if (r.noProfile) parts.push('Profilin boş görünüyor');
    return parts.join(' · ');
  }
  function bestAnswer(answers, question) {
    const qn = IA.norm(question);
    let best = null, bs = 0;
    for (const a of answers) {
      const an = IA.norm(a.question);
      const s = an === qn ? 1 : IA.similarity(an, qn);
      if (s > bs) { bs = s; best = a; }
    }
    return bs >= 0.5 ? best : null;
  }

  // ---------- Cevap öğrenme ----------
  function attachLearn(el, question, kind) {
    if (!question || el.__iaLearn) return;
    el.__iaLearn = true;
    const handler = async () => {
      let answer = '';
      if (kind === 'radio') {
        const g = [...el.getRootNode().querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].find(r => r.checked);
        answer = g ? (labelText(g) || g.value) : '';
      } else if (el.tagName === 'SELECT') {
        const o = el.options[el.selectedIndex]; answer = o && !isPlaceholderOption(IA.norm(o.textContent)) ? clean(o.textContent) : '';
      } else answer = (el.value || '').trim();
      if (!answer || answer.length > 4000) return;
      showToast(`“${clean(question, 70)}” sorusunun cevabını hatırlayayım mı?`, [{
        label: 'Hatırla', act: async () => {
          const { answers } = await IA.store.get(['answers']);
          const qn = IA.norm(question);
          const ex = answers.find(a => IA.norm(a.question) === qn);
          if (ex) ex.answer = answer; else answers.push({ id: IA.uid('ans'), question: clean(question, 240), answer, uses: 0, createdAt: Date.now() });
          await IA.store.set({ answers });
          showToast('Kaydedildi. Bir dahaki sefere bu soruyu ben doldururum.');
        }
      }], 9000);
    };
    const target = kind === 'radio' ? el.getRootNode() : el;
    if (kind === 'radio') {
      el.getRootNode().querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`).forEach(r => r.addEventListener('change', handler, { once: true }));
    } else target.addEventListener('change', handler, { once: true });
  }

  // ---------- Arayüz (Shadow DOM içinde, sitenin CSS'inden etkilenmez) ----------
  let uiRoot = null;
  function ui() {
    if (uiRoot) return uiRoot;
    const host = document.createElement('div');
    host.id = 'basvuru-asistani-ui';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;right:16px;bottom:16px;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      .wrap{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
      .toast{max-width:360px;background:#0f172a;color:#f8fafc;border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:8px;animation:in .2s ease-out}
      .toast .row{display:flex;gap:6px;justify-content:flex-end}
      .toast button{border:0;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:#334155;color:#f8fafc}
      .toast button.p{background:#f59e0b;color:#111827;font-weight:600}
      .fab{display:flex;background:#0f172a;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);overflow:hidden}
      .fab button{border:0;background:transparent;color:#f8fafc;padding:9px 13px;font-size:13px;cursor:pointer;display:flex;gap:6px;align-items:center}
      .fab button:hover{background:#1e293b}
      .fab .sep{width:1px;background:#334155}
      .fab .st{font-size:11px;padding:2px 7px;border-radius:999px;background:#334155}
      .fab .x{padding:9px 9px;color:#94a3b8}
      @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    </style><div class="wrap"><div class="toasts wrap"></div><div class="fabslot"></div></div>`;
    (document.body || document.documentElement).appendChild(host);
    uiRoot = sh;
    return sh;
  }
  function showToast(text, actions, ms) {
    const sh = ui();
    const t = document.createElement('div'); t.className = 'toast';
    const p = document.createElement('div'); p.textContent = text; t.appendChild(p);
    const row = document.createElement('div'); row.className = 'row';
    (actions || []).forEach((a, i) => {
      const b = document.createElement('button'); b.textContent = a.label; if (i === 0) b.className = 'p';
      b.onclick = async () => { t.remove(); await a.act(); }; row.appendChild(b);
    });
    const close = document.createElement('button'); close.textContent = actions ? 'Hayır' : 'Kapat'; close.onclick = () => t.remove(); row.appendChild(close);
    t.appendChild(row);
    sh.querySelector('.toasts').appendChild(t);
    setTimeout(() => t.remove(), ms || (actions ? 12000 : 6000));
  }

  async function saveCurrentJob(status) {
    const job = capture();
    delete job.detected; delete job.isTop; delete job.formFields;
    if (status) job.status = status;
    const saved = await IA.upsertJob(job);
    showToast(`Takibe eklendi: ${saved.title || 'İlan'}${saved.company ? ' · ' + saved.company : ''} (${IA.STATUS_LABEL[saved.status]})`);
    refreshFab();
    return saved;
  }

  // ---------- Yüzen buton ----------
  let fabHiddenFor = '';
  async function refreshFab() {
    const { settings } = await IA.store.get(['settings']);
    const job = capture();
    const show = settings.floatingButton !== false && fabHiddenFor !== location.href &&
      ((isTop && KNOWN_SITE && (job.detected || job.formFields >= 3)) || (!isTop && job.formFields >= 3) || (isTop && !KNOWN_SITE && job.formFields >= 4));
    if (!show) { if (uiRoot) uiRoot.querySelector('.fabslot').innerHTML = ''; return; }
    const sh = ui(); const slot = sh.querySelector('.fabslot');
    const tracked = await IA.findJobByUrl(job.url);
    slot.innerHTML = `<div class="fab"><button class="fill" title="Formu doldur (Alt+Shift+F)">⚡ Doldur</button><span class="sep"></span>
      <button class="save" title="İlanı takibe ekle (Alt+Shift+S)">${tracked ? '✓ <span class="st">' + IA.STATUS_LABEL[tracked.status] + '</span>' : '＋ Takip'}</button>
      <button class="x" title="Bu sayfada gizle">×</button></div>`;
    slot.querySelector('.fill').onclick = () => fill({});
    slot.querySelector('.save').onclick = () => tracked ? chrome.runtime.sendMessage({ cmd: 'openPanel', jobId: tracked.id }) : saveCurrentJob('saved');
    slot.querySelector('.x').onclick = () => { fabHiddenFor = location.href; slot.innerHTML = ''; };
  }

  // ---------- "Başvur" tıklamasını yakala ----------
  const asked = new Set();
  const APPLY_RE = /^(submit|submit application|submit your application|send application|complete application|apply now|basvur|hemen basvur|basvuruyu gonder|basvuruyu tamamla|basvuru gonder|basvurumu gonder|gonder|basvuruyu bitir|finish|tamamla)$/;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('button, a, input[type=submit], [role=button]');
    if (!b) return;
    const txt = IA.norm(b.innerText || b.value || b.getAttribute('aria-label') || '');
    if (!APPLY_RE.test(txt)) return;
    const { settings } = await IA.store.get(['settings']);
    if (!settings.askOnApply) return;
    const job = capture();
    if (asked.has(job.url)) return;
    asked.add(job.url);
    const ex = await IA.findJobByUrl(job.url);
    if (ex && ex.status !== 'saved') return;
    setTimeout(() => showToast(`Bu ilana başvurdun mu? “${clean(job.title, 60)}”`, [{ label: 'Evet, takibe ekle', act: () => saveCurrentJob('applied') }], 15000), 600);
  }, true);

  // ---------- Mesajlar / API ----------
  self.__IA_API = {
    fill: (o) => fill(o),
    capture: () => capture(),
    save: (o) => saveCurrentJob((o && o.status) || 'saved'),
    refresh: () => refreshFab()
  };

  // Tek sayfalık uygulamalarda (LinkedIn vb.) URL değişimini izle
  let lastUrl = location.href;
  setTimeout(refreshFab, 1200);
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(refreshFab, 900); } }, 1200);
  chrome.storage.onChanged.addListener((ch) => { if (ch.jobs || ch.settings) refreshFab(); });
})();
