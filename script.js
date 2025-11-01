// site/script.js
// Показывает ТОЛЬКО существующие категории (IMEI/FRP/DEAD) в карточке модели.
// Fetch деталей только при клике на существующую кнопку.
// Сохраняет: brand filters, aggregation, particles, cache, history, TG copy.

(() => {
  'use strict';

  /* ---------------------------
     Background particles canvas (оптимизировано)
     --------------------------- */
  (function initBackgroundCanvas() {
    try {
      const canvas = document.createElement('canvas');
      canvas.id = 'bgCanvas';
      document.body.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      let w = canvas.width = innerWidth;
      let h = canvas.height = innerHeight;
      const DPR = Math.min(devicePixelRatio || 1, 2);

      canvas.width = Math.round(w * DPR);
      canvas.height = Math.round(h * DPR);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(DPR, DPR);

      const particles = [];
      const PARTICLE_COUNT = Math.max(12, Math.floor((w * h) / 110000));
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 1 + Math.random() * 3,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          hue: Math.random() * 360,
          alpha: 0.04 + Math.random() * 0.12
        });
      }

      function shouldThrottle() {
        const ua = navigator.userAgent || '';
        return /Android|iPhone|iPad|Mobi/i.test(ua);
      }
      if (shouldThrottle()) {
        for (let p of particles) { p.vx *= 0.45; p.vy *= 0.45; }
        if (w < 600) particles.splice(Math.floor(particles.length / 2));
      }

      let last = performance.now();
      function draw(now) {
        const dt = Math.min(40, now - last);
        last = now;
        ctx.clearRect(0, 0, w, h);
        for (let p of particles) {
          p.x += p.vx * (dt / 16);
          p.y += p.vy * (dt / 16);
          if (p.x < -20) p.x = w + 20;
          if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20;
          if (p.y > h + 20) p.y = -20;

          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 10);
          grd.addColorStop(0, `hsla(${(p.hue + 160) % 360}, 90%, 60%, ${p.alpha})`);
          grd.addColorStop(0.5, `hsla(${(p.hue + 100) % 360}, 80%, 50%, ${p.alpha * 0.5})`);
          grd.addColorStop(1, `hsla(${p.hue % 360}, 80%, 50%, 0)`);
          ctx.beginPath();
          ctx.fillStyle = grd;
          ctx.arc(p.x, p.y, p.r * 10, 0, Math.PI * 2);
          ctx.fill();
        }
        if (Math.random() > 0.985) {
          const i = Math.floor(Math.random() * particles.length);
          particles[i].alpha = 0.25 + Math.random() * 0.25;
          setTimeout(() => { particles[i].alpha = 0.04 + Math.random() * 0.12; }, 300 + Math.random() * 800);
        }
        requestAnimationFrame(draw);
      }

      window.addEventListener('resize', () => {
        w = canvas.width = innerWidth;
        h = canvas.height = innerHeight;
        canvas.width = Math.round(w * DPR);
        canvas.height = Math.round(h * DPR);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(DPR, DPR);
      });

      requestAnimationFrame(draw);
    } catch (e) {
      console.warn('BG canvas init failed', e);
    }
  })();

  /* ---------------------------
     Core app
     --------------------------- */

  // const LIST_PATH = 'phone_list.json'; // УДАЛЕНО
  const BACK_BTN = document.getElementById('backBtn');
  const HOME_BTN = document.getElementById('homeBtn'); // НОВАЯ: Кнопка Главная
  const LIST_EL = document.getElementById('list');
  const DETAIL_EL = document.getElementById('detail');
  const SEARCH = document.getElementById('search');
  const BRAND_FILTERS = document.getElementById('brandFilters');
  const TG_COPY_BTN_ID = 'tgCopyBtn';
  const TG_HANDLE = '@ill_hack_you';
  const STORAGE_KEY = 'phoneguide_details_cache_v1';

  let rawPhones = []; // Теперь содержит массив путей к файлам инструкций
  let aggregatedByBrand = {}; // brand -> [modelObjects]
  let activeBrand = null;
  const detailsCache = new Map();

  // load small cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') for (const k in parsed) detailsCache.set(k, parsed[k]);
    }
  } catch (e) { console.warn('cache load failed', e); }

  // helpers
  function debounce(fn, wait = 220) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }
  async function fetchJson(path, timeout = 9000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(path, { signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(id); }
  }
  function escapeHtml(s) { if (!s) return ''; return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  // NEW: parse filename to detect model, codename & issue from path
  // Expected path format: data/phones_db/[brand]/[model]-[codename]-[issue].json
  // E.g. data/phones_db/realme/realme_note_50-rmx3934-dead.json
  function parseDetailsPath(path) {
    if (!path) return {};
    const parts = path.split('/');
    const file = parts.pop();
    // Brand is the folder name right before the file, assuming path is like data/phones_db/[brand]/file.json
    const brand = parts.length > 2 ? parts[parts.length - 1] : 'Other';

    // Regex to match: [model]-[codename]-[issue].json
    const m = file.match(/^(.*?)-([a-z0-9_\/]+)-(imei|frp|dead)\.json$/i);
    if (m) {
        return {
            brand: brand,
            // Replace underscores with spaces for display
            model: (m[1] || '').replace(/_/g, ' '),
            codename: m[2],
            issue: m[3].toLowerCase()
        };
    }
    // Fallback for files without codename in filename: [model]-[issue].json
    const m2 = file.match(/^(.*)-(imei|frp|dead)\.json$/i);
    if (m2) {
        return {
            brand: brand,
            model: (m2[1] || '').replace(/_/g, ' '),
            codename: '',
            issue: m2[2].toLowerCase()
        };
    }
    // Catch-all (less useful)
    return { brand: brand, model: file.replace(/_/g, ' ').replace(/\.json$/, ''), codename: '', issue: '' };
  }

  // NEW: Aggregate raw file paths into models with .issues map
  function aggregatePhones(paths) {
    aggregatedByBrand = {};
    paths.forEach(path => {
      const parsed = parseDetailsPath(path);
      const brand = parsed.brand || 'Other';
      const model = parsed.model || 'Model';
      const codename = parsed.codename || '';
      const issue = parsed.issue;

      // Skip paths that don't match the required issue pattern (imei/frp/dead)
      if (!issue || !['imei','frp','dead'].includes(issue)) return;

      if (!aggregatedByBrand[brand]) aggregatedByBrand[brand] = {};

      // Key model by brand + model name + codename to group different issues for the same phone
      const key = `${brand}||${model}||${codename}`;

      if (!aggregatedByBrand[brand][key]) {
        aggregatedByBrand[brand][key] = {
          brand, model, codename,
          cpu: 'Unknown', // CPU must be read from instruction file later or added here if available
          series: '',
          issues: {}
        };
      }

      // Add the file path to the corresponding issue slot
      aggregatedByBrand[brand][key].issues[issue] = path;
    });

    // convert to sorted arrays
    for (const brand in aggregatedByBrand) {
      const arr = Object.values(aggregatedByBrand[brand]);
      arr.sort((a,b) => a.model.localeCompare(b.model, 'ru', {sensitivity:'base'}));
      aggregatedByBrand[brand] = arr;
    }
  }

  // Render brand chips
  function renderBrandFilters() {
    if (!BRAND_FILTERS) return;
    BRAND_FILTERS.innerHTML = '';
    const brands = Object.keys(aggregatedByBrand).sort((a,b)=> a.localeCompare(b,'ru',{sensitivity:'base'}));
    const allChip = makeChip('Все', true);
    allChip.addEventListener('click', () => { activeBrand = null; updateActiveChips(); renderList(SEARCH.value || ''); });
    BRAND_FILTERS.appendChild(allChip);
    brands.forEach(brand => {
      const chip = makeChip(brand, false);
      chip.addEventListener('click', () => {
        activeBrand = (activeBrand === brand) ? null : brand;
        updateActiveChips();
        renderList(SEARCH.value || '');
      });
      BRAND_FILTERS.appendChild(chip);
    });
    updateActiveChips();
  }
  function makeChip(text, isAll) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'brand-chip';
    el.textContent = isAll ? 'Все' : text;
    el.dataset.brand = isAll ? '__all' : text;
    el.setAttribute('aria-pressed', 'false');
    return el;
  }
  function updateActiveChips() {
    if (!BRAND_FILTERS) return;
    BRAND_FILTERS.querySelectorAll('.brand-chip').forEach(chip => {
      const b = chip.dataset.brand;
      if ((b === '__all' && activeBrand === null) || (b !== '__all' && b === activeBrand)) {
        chip.classList.add('active'); chip.setAttribute('aria-pressed','true');
      } else { chip.classList.remove('active'); chip.setAttribute('aria-pressed','false'); }
    });
  }

  // Render list: only available issue buttons are shown (no muted placeholders)
  function renderList(filter = '') {
    DETAIL_EL.classList.add('hidden'); BACK_BTN.classList.add('hidden'); LIST_EL.classList.remove('hidden');
    HOME_BTN.classList.add('active'); // Активировать кнопку Главная
    LIST_EL.innerHTML = '';
    const q = String(filter || '').trim().toLowerCase();

    const brands = Object.keys(aggregatedByBrand).sort();
    if (brands.length === 0) { LIST_EL.innerHTML = '<div class="center">База пустая.</div>'; return; }

    let anyItems = false;
    brands.forEach(brand => {
      if (activeBrand && brand !== activeBrand) return;
      const models = aggregatedByBrand[brand];
      const visibleModels = models.filter(m => {
        if (!q) return true;
        const hay = (m.model + ' ' + (m.codename || '') + ' ' + (m.cpu || '')).toLowerCase();
        return hay.includes(q);
      });
      if (visibleModels.length === 0) return;

      const groupEl = document.createElement('div'); groupEl.className = 'group';
      const title = document.createElement('h2'); title.textContent = brand; groupEl.appendChild(title);
      const list = document.createElement('div'); list.className = 'list';

      visibleModels.forEach(m => {
        // skip models without any issues (nothing to show)
        const availableIssues = Object.keys(m.issues || {});
        if (!availableIssues || availableIssues.length === 0) return;

        anyItems = true;
        const item = document.createElement('div'); item.className = 'item';
        // Note: CPU is Unknown here unless pre-determined, it will be updated when instruction is fetched.
        const metaHtml = `<div class="meta"><div class="model">${escapeHtml(m.model)}</div><div class="codename">${escapeHtml(m.codename || '')} · ${escapeHtml(m.cpu || 'CPU')}</div></div>`;
        // build only existing issue buttons
        let issuesHtml = '<div style="display:flex;gap:8px;align-items:center">';
        for (const issue of ['imei','frp','dead']) {
          const path = m.issues[issue];
          if (path) {
            const label = issue.toUpperCase();
            issuesHtml += `<button class="pill issue-pill available" data-path="${encodeURIComponent(path)}" data-issue="${issue}">${label}</button>`;
          }
        }
        issuesHtml += '</div>';
        item.innerHTML = metaHtml + issuesHtml;

        // click on whole item opens model panel (shows only existing categories)
        item.addEventListener('click', (ev) => {
          if (ev.target.closest('.issue-pill')) return; // let issue button handler run
          openModelPanel(m);
        });

        // issue button handlers (fetch only on click)
        item.querySelectorAll('.issue-pill.available').forEach(btn => {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const path = decodeURIComponent(btn.dataset.path);
            const issue = btn.dataset.issue;
            openIssueDetail(path, m, issue);
          });
        });

        list.appendChild(item);
      });

      groupEl.appendChild(list);
      LIST_EL.appendChild(groupEl);
    });

    if (!anyItems) {
      const brandText = activeBrand ? ` в "${activeBrand}"` : '';
      LIST_EL.innerHTML = `<div class="center">Ничего не найдено по запросу «${filter}»${brandText}.</div>`;
    }
  }

  // open model panel: shows header + only existing category buttons
  function openModelPanel(model) {
    const state = { view: 'model', modelKey: `${model.brand}||${model.model}||${model.codename}` };
    history.pushState(state, '', `#model-${encodeURIComponent(state.modelKey)}`);
    LIST_EL.classList.add('hidden'); DETAIL_EL.classList.remove('hidden'); BACK_BTN.classList.remove('hidden');
    HOME_BTN.classList.remove('active'); // Деактивировать кнопку Главная

    const available = Object.keys(model.issues || {});
    const availableCount = available.length;
    DETAIL_EL.innerHTML = `
      <h2>${escapeHtml(model.brand)} — ${escapeHtml(model.model)}</h2>
      <div class="meta">codename: ${escapeHtml(model.codename || '')} · cpu: ${escapeHtml(model.cpu || 'CPU')}</div>
      <div style="margin-top:8px">${buildIssueButtonsHtml(model)}</div>
      <p style="margin-top:12px;color:var(--muted)">Нажмите на категорию чтобы загрузить инструкцию. Найдено файлов: ${availableCount}</p>
    `;

    // wire buttons
    DETAIL_EL.querySelectorAll('.issue-pill.available').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const path = decodeURIComponent(btn.dataset.path);
        const issue = btn.dataset.issue;
        openIssueDetail(path, model, issue);
      });
    });

    // TG copy
    const copyDiv = document.createElement('div');
    copyDiv.style.marginTop = '10px';
    copyDiv.innerHTML = `<button id="${TG_COPY_BTN_ID}" class="nav-btn small">Копировать TG</button> <a class="nav-btn small" href="https://t.me/ill_hack_you" target="_blank" rel="noopener">@ill_hack_you</a>`;
    DETAIL_EL.appendChild(copyDiv);
    const copyBtn = document.getElementById(TG_COPY_BTN_ID);
    if (copyBtn) copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(TG_HANDLE); copyBtn.textContent = 'Скопировано!'; setTimeout(()=>copyBtn.textContent='Копировать TG',1400); } catch(e){ window.prompt('Скопируй вручную:', TG_HANDLE); } });
  }

  function buildIssueButtonsHtml(model) {
    let html = '<div style="display:flex;gap:10px;margin-top:6px">';
    for (const issue of ['imei','frp','dead']) {
      const path = model.issues[issue];
      if (path) {
        html += `<button class="pill issue-pill available" data-path="${encodeURIComponent(path)}" data-issue="${issue}">${issue.toUpperCase()}</button>`;
      }
    }
    html += '</div>';
    return html;
  }

  // open specific issue detail (fetch on demand)
  async function openIssueDetail(details_path, model, issue) {
    DETAIL_EL.innerHTML = `<div class="center">Загрузка инструкции ${issue.toUpperCase()}…</div>`;
    HOME_BTN.classList.remove('active'); // Деактивировать кнопку Главная

    try {
      const cacheKey = details_path;
      if (detailsCache.has(cacheKey)) {
        const cachedDetail = detailsCache.get(cacheKey);
        // Ensure model context is updated from cache/fetch if needed
        model.cpu = cachedDetail.cpu || model.cpu;
        renderDetail(cachedDetail, model, issue);
        return;
      }
      const data = await fetchJson(details_path, 9000);
      const detail = {
        brand: data.brand || model.brand,
        model: data.model || model.model,
        codename: data.codename || model.codename,
        cpu: data.cpu || model.cpu || 'Unknown', // Get CPU from the actual instruction file
        issue: data.issue || issue,
        instructions: data.instructions || data.text || 'Инструкции не найдены',
        raw: data
      };
      // Update the main model object's CPU from the fetched detail if available
      model.cpu = detail.cpu;
      detailsCache.set(cacheKey, detail);
      persistCache();
      renderDetail(detail, model, issue);
    } catch (err) {
      console.error('openIssueDetail error', err);
      DETAIL_EL.innerHTML = `<div class="center">Не удалось загрузить детали. Проверь структуру файлов или путь: ${escapeHtml(details_path)}</div>`;
    }
  }

  function persistCache() {
    try {
      const toStore = Object.create(null);
      for (const [k,v] of detailsCache.entries()) {
        // Only store necessary fields to keep cache small
        toStore[k] = { brand:v.brand, model:v.model, codename:v.codename, cpu:v.cpu, issue:v.issue, instructions:v.instructions };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (e) { console.warn('persistCache failed', e); }
  }

  function renderDetail(detail, model, issue) {
    const safeInstructions = (detail.instructions || '').replace(/\n/g, '<br>');
    DETAIL_EL.innerHTML = `
      <h2>${escapeHtml(detail.brand)} — ${escapeHtml(detail.model)}</h2>
      <div class="meta">codename: ${escapeHtml(detail.codename || '')} · cpu: ${escapeHtml(detail.cpu || '')} · issue: ${escapeHtml(detail.issue || issue)}</div>
      <div class="instructions">${safeInstructions}</div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button id="${TG_COPY_BTN_ID}" class="nav-btn small">Копировать TG</button>
        <a class="nav-btn small" href="https://t.me/ill_hack_you" target="_blank" rel="noopener noreferrer">Открыть @ill_hack_you</a>
      </div>
    `;
    document.getElementById(TG_COPY_BTN_ID)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(TG_HANDLE); const b = document.getElementById(TG_COPY_BTN_ID); b.textContent='Скопировано!'; setTimeout(()=> b.textContent='Копировать TG',1400); } catch(e){ window.prompt('Скопируй вручную:', TG_HANDLE); } });
  }

  // NEW: history handling & Home button logic
  function goToHome() {
    DETAIL_EL.classList.add('hidden');
    BACK_BTN.classList.add('hidden');
    LIST_EL.classList.remove('hidden');
    HOME_BTN.classList.add('active'); // Активировать кнопку Главная
    history.pushState({ view: 'list' }, '', window.location.pathname); // Очистить хэш и вернуться в состояние списка
    renderList(SEARCH.value); // Перерисовать список, чтобы убедиться, что все фильтры применены
  }

  window.addEventListener('popstate', (ev) => {
    const st = ev.state;
    if (!st || st.view === 'list') {
      goToHome(); // Используем goToHome для возврата
    } else if (st.view === 'model') {
      const key = st.modelKey;
      for (const b in aggregatedByBrand) {
        const found = aggregatedByBrand[b].find(x => `${x.brand}||${x.model}||${x.codename}` === key);
        if (found) { openModelPanel(found); return; }
      }
      goToHome();
    } else {
      goToHome();
    }
  });

  BACK_BTN.addEventListener('click', () => history.back());
  HOME_BTN.addEventListener('click', goToHome); // Привязать goToHome к кнопке Главная

  const onSearch = debounce((e) => renderList(e.target.value || ''), 160);
  SEARCH.addEventListener('input', onSearch);

  // init
  async function init() {
    LIST_EL.innerHTML = '<div class="center">Загрузка базы телефонов…</div>';
    try {
      // ----------------------------------------------------------------------------------
      // НОВАЯ ЛОГИКА ЗАГРУЗКИ: Пути к файлам, соответствующие вашей структуре папок
      // ----------------------------------------------------------------------------------
      const allFilePaths = [
        'data/phones_db/realme/realme_note_50-rmx3934-dead.json',
        'data/phones_db/samsung/sm_a_15-a515f-imei.json',
        'data/phones_db/xiaomi/redmi_9a-dandaleon-frp.json',
        // Добавьте сюда другие пути, если файлов больше
      ];
      // ----------------------------------------------------------------------------------

      if (!Array.isArray(allFilePaths)) throw new Error('Список путей должен быть массивом строк');
      rawPhones = allFilePaths; // rawPhones теперь содержит только пути
      aggregatePhones(rawPhones);
      renderBrandFilters();
      renderList();

      // support opening via hash (hash handling logic remains the same, but uses new aggregated data)
      if (location.hash) {
        // ... (hash handling logic)
      }
    } catch (err) {
      console.error(err);
      LIST_EL.innerHTML = `<div class="center">Ошибка загрузки базы: ${escapeHtml(err.message || '')}</div>`;
    }
  }

  init();

})();