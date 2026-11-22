/* Başvuru Asistanı — ortak çekirdek (content script, popup, panel ve arka plan birlikte kullanır) */
(function (g) {
  if (g.IA) return;

  // ---------- Metin normalizasyonu ----------
  function norm(s) {
    return (s == null ? '' : String(s))
      .replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
      .toLocaleLowerCase('tr')
      .replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9@+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const STOP = new Set(('the a an and or of to for in on at is are be you your yours do does did with what which how when please if this that ' +
    've veya ile bir bu su icin mi mu misiniz musunuz nedir nasil hangi ne kadar lutfen olarak olan var yok size sizin').split(' '));
  function tokens(s) { return norm(s).split(' ').filter(t => t.length > 1 && !STOP.has(t)); }
  function similarity(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  // ---------- Profil alanları ----------
  // re: normalize edilmiş metinde aranır. not: eşleşirse bu alan elenir.
  const FIELDS = [
    { key: 'fullName', label: 'Ad Soyad', group: 'Kişisel', derived: true,
      re: /\bad ?soyad|\bad ve soyad|\bfull ?name\b|\byour name\b|\bisim soyisim\b|\bname surname\b|\bcandidate name\b|^name$|^isim$|^ad soyadi?$/ },
    { key: 'firstName', label: 'Ad', group: 'Kişisel', placeholder: 'Ad',
      re: /\bfirst ?name\b|\bgiven name\b|\bfname\b|\bforename\b|^ad$|^adi(niz)?$|^isim$|\badiniz\b|\bfirst\b/,
      not: /soyad|surname|last|full|company|school|sirket|firma|okul|universite|kullanici|user/ },
    { key: 'lastName', label: 'Soyad', group: 'Kişisel', placeholder: 'Soyad',
      re: /\blast ?name\b|\bsurname\b|\bfamily name\b|\blname\b|\bsoyad(i|iniz)?\b|\bsoyisim\b|^last$/,
      not: /\bad ?soyad|\bad ve soyad|name surname|full ?name|isim soyisim/ },
    { key: 'email', label: 'E-posta', group: 'Kişisel', type: 'email',
      re: /\be ?mail\b|\be ?posta\b|\beposta\b|\bemail address\b/, not: /confirm|tekrar|dogrula|verify/ },
    { key: 'phone', label: 'Telefon', group: 'Kişisel', type: 'tel', placeholder: '+90 5xx xxx xx xx',
      re: /\bphone\b|\bmobile\b|\btelefon\b|\btel\b|\bgsm\b|\bcep\b|\bcell\b|phone number/, not: /country code|ulke kodu|extension|dahili/ },
    { key: 'birthDate', label: 'Doğum tarihi', group: 'Kişisel', type: 'date',
      re: /\bbirth\b|\bdob\b|\bdogum tarihi\b|date of birth/ },
    { key: 'city', label: 'Şehir', group: 'Kişisel', placeholder: 'İstanbul',
      re: /\bcity\b|\btown\b|\bsehir\b|\bil\b|\bikamet\b|yasadiginiz|current location|^location$|\blokasyon\b/, not: /country|ulke|birth|dogum|ilce|district|willing|tercih/ },
    { key: 'country', label: 'Ülke', group: 'Kişisel', placeholder: 'Türkiye',
      re: /\bcountry\b|\bulke\b/, not: /code|kodu|phone|telefon/ },
    { key: 'address', label: 'Adres', group: 'Kişisel',
      re: /\baddress\b|\badres\b|\bstreet\b|\bsokak\b|address line/, not: /e ?mail|e ?posta|web|ip address/ },
    { key: 'postalCode', label: 'Posta kodu', group: 'Kişisel',
      re: /\bpostal\b|\bzip\b|\bposta kodu\b|\bpostcode\b/ },

    { key: 'linkedin', label: 'LinkedIn', group: 'Bağlantılar', placeholder: 'https://linkedin.com/in/...', re: /\blinked ?in\b/ },
    { key: 'github', label: 'GitHub', group: 'Bağlantılar', placeholder: 'https://github.com/...', re: /\bgit ?hub\b/ },
    { key: 'website', label: 'Web sitesi / Portfolyo', group: 'Bağlantılar',
      re: /\bportfol|\bwebsite\b|\bweb site|\bweb sitesi\b|personal (site|url|page)|\bblog\b|other (link|url)/, not: /linked ?in|git ?hub/ },

    { key: 'university', label: 'Üniversite', group: 'Eğitim', placeholder: 'Üniversite adı',
      re: /\buniversit|\bschool\b|\bokul\b|\binstitution\b|\bcollege\b|egitim kurumu/, not: /high school|lise|bolum|department|major|year|yil|grade|ortalama|gpa/ },
    { key: 'department', label: 'Bölüm', group: 'Eğitim', placeholder: 'Bilgisayar Mühendisliği',
      re: /\bmajor\b|field of study|\bdepartment\b|\bbolum\b|\bdiscipline\b|\bprogram\b|area of study/ },
    { key: 'degree', label: 'Eğitim düzeyi', group: 'Eğitim', options: ['Lisans', 'Yüksek Lisans', 'Doktora', 'Ön Lisans', 'Lise'],
      re: /\bdegree\b|education level|egitim (duzeyi|seviyesi|durumu)|\bderece\b|highest education|ogrenim durumu/ },
    { key: 'classYear', label: 'Sınıf', group: 'Eğitim', options: ['1', '2', '3', '4', 'Hazırlık', 'Mezun'],
      re: /\bsinif\b|\bkacinci\b|year of study|current year|class year|study year/ },
    { key: 'gradYear', label: 'Mezuniyet yılı', group: 'Eğitim', placeholder: '2027',
      re: /\bgrad(uation)?\b|\bmezuniyet\b|end year|expected graduation|bitis yili/ },
    { key: 'gpa', label: 'Not ortalaması (GNO)', group: 'Eğitim', placeholder: '3.20 / 4.00',
      re: /\bgpa\b|\bcgpa\b|\bgno\b|grade point|not ortalamasi|\bortalama\b|\bortalamaniz\b|\bano\b/ },

    { key: 'currentCompany', label: 'Şu anki şirket', group: 'Deneyim',
      re: /current (company|employer)|\bemployer\b|\bsirket\b|\bfirma\b|calistiginiz (kurum|yer)|company name/, not: /why|neden|hear|duydu/ },
    { key: 'currentTitle', label: 'Unvan', group: 'Deneyim',
      re: /job title|current title|current position|position title|\bunvan(iniz)?\b|mevcut pozisyon/, not: /applying|basvurulan|desired|istenen/ },
    { key: 'experienceYears', label: 'Deneyim (yıl)', group: 'Deneyim', placeholder: '0',
      re: /years? of (experience|work)|\bdeneyim(iniz)?\b|\btecrube|experience years|total experience/ },

    { key: 'salary', label: 'Maaş beklentisi', group: 'Tercihler', placeholder: 'Örn. 45.000 TL net',
      re: /\bsalary\b|\bcompensation\b|\bmaas\b|\bucret beklenti|expected pay|desired pay|beklentiniz/ },
    { key: 'startDate', label: 'Başlayabileceğin tarih', group: 'Tercihler', type: 'date',
      re: /start date|\bavailab|earliest (start|date)|ise baslama|baslayabilece|ne zaman basla|when can you start/ },
    { key: 'noticePeriod', label: 'İhbar süresi', group: 'Tercihler', placeholder: 'Yok / 2 hafta',
      re: /\bnotice\b|\bihbar\b/ },
    { key: 'internshipPeriod', label: 'Staj dönemi / süresi', group: 'Tercihler', placeholder: 'Temmuz–Ağustos 2027, 30 iş günü',
      re: /staj (suresi|donemi|tarih|gun)|internship (duration|period|dates)|kac gun staj/ },
    { key: 'heardFrom', label: 'İlanı nereden duydun', group: 'Tercihler', placeholder: 'LinkedIn',
      re: /hear about|how did you (find|hear)|nereden (duydu|ogrendi)|\breferral source\b|\bsource\b/ },

    { key: 'military', label: 'Askerlik durumu', group: 'Türkiye', options: ['Yapıldı', 'Muaf', 'Tecilli', 'Yapılmadı'],
      re: /\baskerlik\b|\bmilitary\b|military service/ },
    { key: 'license', label: 'Ehliyet', group: 'Türkiye', placeholder: 'B',
      re: /\bdriver|\bdriving licen|\behliyet\b|surucu belgesi/ },
    { key: 'englishLevel', label: 'İngilizce seviyesi', group: 'Türkiye', options: ['A2', 'B1', 'B2', 'C1', 'C2'],
      re: /english (level|proficiency|skill)|ingilizce (seviye|duzey|bilgi)|level of english/ },
    { key: 'languages', label: 'Yabancı diller', group: 'Türkiye', placeholder: 'İngilizce (B2), Almanca (A2)',
      re: /foreign language|\byabanci dil|languages? (you speak|spoken)|\bdil bilgisi\b|^languages?$/ },

    { key: 'summary', label: 'Kısa tanıtım (hakkımda)', group: 'Metinler', long: true,
      re: /about (you|yourself)|tell us about|kendini(zi)? (tanit|anlat)|hakkinizda|\bsummary\b|\bozet\b/ },
  ];
  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'family-name': 'lastName', 'name': 'fullName', 'email': 'email',
    'tel': 'phone', 'tel-national': 'phone', 'address-level2': 'city', 'country': 'country', 'country-name': 'country',
    'street-address': 'address', 'address-line1': 'address', 'postal-code': 'postalCode', 'organization': 'currentCompany',
    'organization-title': 'currentTitle', 'url': 'website', 'bday': 'birthDate'
  };

  // Asla doldurulmayacak ve kullanıcıya bırakılacak alanlar
  const SENSITIVE = /\b(password|sifre|parola|captcha|otp|tc ?kimlik|kimlik (no|numara)|tckn|\btc no|national id|identity number|ssn|social security|iban|card number|kart (no|numara)|cvv|passport|pasaport)\b/;
  // Hassas / yasal olarak isteğe bağlı sorular: dokunma
  const SKIP = /\b(gender|cinsiyet|ethnic|race|\birk\b|disabilit|engel(li)?(lik)? durum|veteran|religion|\bdin\b|marital|medeni|sexual|pronoun|criminal|sabika|adli sicil|visa|sponsorship|work (authori|permit)|calisma izni|health|saglik)\b/;

  const SYNONYMS = [
    ['lisans', 'bachelor', 'bachelors', 'undergraduate', 'bsc', 'b sc', 'bs', 'licence', 'university degree'],
    ['yuksek lisans', 'master', 'masters', 'msc', 'm sc', 'ms', 'graduate'],
    ['doktora', 'phd', 'doctorate', 'doctoral'],
    ['on lisans', 'associate', 'associate degree', 'meslek yuksekokulu'],
    ['lise', 'high school', 'secondary'],
    ['turkiye', 'turkey', 'tr', 'turkiye cumhuriyeti', 'republic of turkiye'],
    ['yapildi', 'completed', 'done', 'tamamlandi', 'yapti'],
    ['muaf', 'exempt', 'exempted'],
    ['tecilli', 'postponed', 'deferred', 'tecil'],
    ['yapilmadi', 'not done', 'not completed', 'yapmadi'],
    ['evet', 'yes', 'var'], ['hayir', 'no', 'yok'],
    ['mezun', 'graduated', 'graduate', 'alumni'],
    ['hazirlik', 'prep', 'preparatory'],
    ['1', '1 sinif', 'first year', 'freshman'], ['2', '2 sinif', 'second year', 'sophomore'],
    ['3', '3 sinif', 'third year', 'junior'], ['4', '4 sinif', 'fourth year', 'senior', 'final year'],
    ['ingilizce', 'english'], ['almanca', 'german'], ['fransizca', 'french'],
  ];
  function synonymsOf(v) {
    const n = norm(v);
    for (const group of SYNONYMS) if (group.includes(n)) return group;
    return [n];
  }

  // ---------- Depolama ----------
  const DEFAULTS = {
    profile: {},
    cvs: [],
    answers: [],
    templates: [
      { id: 'tpl-tr', name: 'Genel ön yazı (TR)', lang: 'tr',
        body: 'Merhaba,\n\n{sirket} bünyesindeki {pozisyon} ilanınızı büyük bir ilgiyle inceledim. {bolum} alanındaki eğitimim ve yaptığım projeler sayesinde bu pozisyona katkı sağlayabileceğime inanıyorum.\n\nÖzgeçmişimi ekte bulabilirsiniz. Değerlendirmeniz için teşekkür ederim.\n\nSaygılarımla,\n{ad} {soyad}\n{telefon} · {eposta}' },
      { id: 'tpl-en', name: 'General cover letter (EN)', lang: 'en',
        body: 'Hello,\n\nI am writing to apply for the {pozisyon} position at {sirket}. I study {bolum} at {universite}, and I have worked on several hands-on projects that I think fit this role well.\n\nI would be happy to talk about how I can help your team. My CV is attached.\n\nThank you for your time.\n\nBest regards,\n{ad} {soyad}\n{telefon} · {eposta}' }
    ],
    jobs: [],
    settings: { followUpDays: 7, floatingButton: true, highlight: true, askOnApply: true, overwrite: false, defaultCvId: '', defaultTemplateTr: 'tpl-tr', defaultTemplateEn: 'tpl-en' }
  };
  const store = {
    async get(keys) {
      const ks = keys || Object.keys(DEFAULTS);
      const res = await chrome.storage.local.get(ks);
      const out = {};
      for (const k of ks) {
        const def = DEFAULTS[k];
        let v = res[k];
        if (v === undefined) v = JSON.parse(JSON.stringify(def));
        else if (def && !Array.isArray(def) && typeof def === 'object') v = Object.assign(JSON.parse(JSON.stringify(def)), v);
        out[k] = v;
      }
      return out;
    },
    set(obj) { return chrome.storage.local.set(obj); }
  };

  // ---------- İlan / takip yardımcıları ----------
  const STATUSES = [
    { id: 'saved', label: 'Kaydedildi', color: '#64748b' },
    { id: 'applied', label: 'Başvuruldu', color: '#2563eb' },
    { id: 'interview', label: 'Test / Mülakat', color: '#a855f7' },
    { id: 'offer', label: 'Teklif', color: '#16a34a' },
    { id: 'rejected', label: 'Red', color: '#dc2626' },
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.id, s.label]));

  function siteName(host) {
    host = (host || '').replace(/^www\./, '');
    const map = [
      [/linkedin\./, 'LinkedIn'], [/kariyer\.net/, 'Kariyer.net'], [/youthall/, 'Youthall'], [/toptalent/, 'Toptalent'],
      [/anbean/, 'Anbean'], [/myworkday/, 'Workday'], [/greenhouse/, 'Greenhouse'], [/lever\.co/, 'Lever'],
      [/successfactors|sapsf/, 'SuccessFactors'], [/smartrecruiters/, 'SmartRecruiters'], [/secretcv/, 'SecretCV'],
      [/yenibiris/, 'Yenibiris'], [/indeed/, 'Indeed'], [/glassdoor/, 'Glassdoor']
    ];
    for (const [re, n] of map) if (re.test(host)) return n;
    return host;
  }

  function canonicalUrl(href) {
    try {
      const u = new URL(href);
      if (/linkedin\./.test(u.hostname)) {
        const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1];
        if (id) return 'https://www.linkedin.com/jobs/view/' + id + '/';
      }
      u.hash = '';
      [...u.searchParams.keys()].forEach(k => { if (/^(utm_|trk|refid|trackingid|ref|source|src|gh_src|lever-source|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); });
      return u.toString().replace(/\/$/, '');
    } catch (e) { return href; }
  }

  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function fillTemplate(body, profile, job) {
    const p = profile || {}, j = job || {};
    const today = new Date().toLocaleDateString('tr-TR');
    const map = {
      sirket: j.company || 'şirketiniz', pozisyon: j.title || 'ilgili', ad: p.firstName || '', soyad: p.lastName || '',
      bolum: p.department || '', universite: p.university || '', telefon: p.phone || '', eposta: p.email || '',
      tarih: today, sehir: p.city || '', linkedin: p.linkedin || ''
    };
    return (body || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/ · $/m, '');
  }

  async function upsertJob(job) {
    const { jobs, settings } = await store.get(['jobs', 'settings']);
    const url = canonicalUrl(job.url);
    const replace = !!job._replace; delete job._replace;
    let existing = jobs.find(j => j.id === job.id) || jobs.find(j => canonicalUrl(j.url) === url);
    const now = Date.now();
    if (existing) {
      const prevStatus = existing.status;
      Object.keys(job).forEach(k => { if (job[k] !== undefined && (replace || job[k] !== '') && k !== 'id' && k !== 'history') existing[k] = job[k]; });
      if (job.status && job.status !== prevStatus) existing.history = (existing.history || []).concat({ status: job.status, at: now });
      existing.updatedAt = now;
    } else {
      existing = Object.assign({ id: uid('job'), title: '', company: '', location: '', site: '', status: 'saved', notes: '', createdAt: now }, job);
      existing.url = url;
      existing.history = [{ status: existing.status, at: now }];
      existing.updatedAt = now;
      jobs.unshift(existing);
    }
    if (existing.status === 'applied' && !existing.appliedAt) existing.appliedAt = now;
    if (existing.status === 'applied' && !existing.followUpAt) {
      existing.followUpAt = existing.appliedAt + (Number(settings.followUpDays) || 7) * 864e5;
      existing.followUpNotified = false;
    }
    await store.set({ jobs });
    return existing;
  }

  async function findJobByUrl(href) {
    const { jobs } = await store.get(['jobs']);
    const url = canonicalUrl(href);
    return jobs.find(j => canonicalUrl(j.url) === url) || null;
  }

  function b64ToBlob(b64, type) {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'application/pdf' });
  }

  // Popup / arka plandan bir sekmedeki tüm çerçevelerde içerik betiğini çalıştırır
  async function runInTab(tabId, method, args) {
    const files = ['src/core.js', 'src/content.js'];
    let all = true;
    try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files }); }
    catch (e) { all = false; await chrome.scripting.executeScript({ target: { tabId }, files }); }
    let res;
    const run = (target) => chrome.scripting.executeScript({
      target, args: [method, args || {}],
      func: (m, a) => (self.__IA_API && self.__IA_API[m]) ? self.__IA_API[m](a) : null
    });
    try { res = await run(all ? { tabId, allFrames: true } : { tabId }); }
    catch (e) { res = await run({ tabId }); }
    return res.filter(r => r && r.result).map(r => Object.assign({ frameId: r.frameId }, r.result));
  }

  g.IA = { runInTab, norm, tokens, similarity, FIELDS, FIELD_BY_KEY, AUTOCOMPLETE, SENSITIVE, SKIP, synonymsOf, store, DEFAULTS,
    STATUSES, STATUS_LABEL, siteName, canonicalUrl, uid, fillTemplate, upsertJob, findJobByUrl, b64ToBlob };
})(typeof self !== 'undefined' ? self : this);
