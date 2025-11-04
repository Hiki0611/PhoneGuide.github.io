// site/script.js

(() => {
  'use strict';

  /* ---------------------------
     Background particles canvas (Эффект "Матрицы")
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
      // Высокая плотность для эффекта дождя
      const PARTICLE_COUNT = Math.max(500, Math.floor((w * h) / 30000)); 
      const MAX_SPEED = 2; // Значительная скорость падения
      const BASE_ALPHA = 0.4; // Высокая базовая прозрачность

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.5 + Math.random() * 1.5, // Тонкие точки
          vx: 0, // Не двигаются по горизонтали
          vy: Math.random() * MAX_SPEED + 0.5, // Падают вниз
          alpha: BASE_ALPHA * (0.5 + Math.random() * 0.5) // Разная яркость
        });
      }

      function shouldThrottle() {
        const ua = navigator.userAgent || '';
        return /Android|iPhone|iPad|Mobi/i.test(ua);
      }
      if (shouldThrottle()) {
        // Уменьшение плотности и скорости на мобильных
        for (let p of particles) { p.vy *= 0.5; }
        if (w < 600) particles.splice(Math.floor(particles.length / 2));
      }

      let last = performance.now();
      function draw(now) {
        const dt = Math.min(40, now - last);
        last = now;
        
        // Более темное фоновое перекрытие для эффекта "шлейфа" (trail effect)
        ctx.fillStyle = 'rgba(6, 7, 9, 0.2)'; 
        ctx.fillRect(0, 0, w, h);
        
        for (let p of particles) {
          p.y += p.vy * (dt / 5);
          // Когда частица достигает дна, возвращаем её наверх с новой случайной позицией X
          if (p.y > h + 50) { 
             p.y = -10;
             p.x = Math.random() * w; // Новая позиция по горизонтали
             p.vy = Math.random() * MAX_SPEED + 0.5;
          }

          // Используем чистый зеленый цвет из CSS переменной для "Матрицы"
          const baseColor = '22ff88'; // var(--accent-green)
          
          ctx.beginPath();
          // Рисуем точку как маленький вертикальный "след"
          ctx.fillStyle = `rgba(34, 255, 136, ${p.alpha})`; // Чистый зеленый
          ctx.fillRect(p.x, p.y, p.r, p.r * 8); // Узкий вертикальный прямоугольник
          ctx.fill();
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
        
        // Пересоздание частиц при ресайзе для корректной плотности
        particles.length = 0;
        const newCount = Math.max(100, Math.floor((w * h) / 3000));
        for (let i = 0; i < newCount; i++) {
            particles.push({
              x: Math.random() * w,
              y: Math.random() * h,
              r: 0.5 + Math.random() * 1.5,
              vx: 0,
              vy: Math.random() * MAX_SPEED + 0.5,
              alpha: BASE_ALPHA * (0.5 + Math.random() * 0.5)
            });
        }
      });

      requestAnimationFrame(draw);
    } catch (e) {
      console.warn('BG canvas init failed', e);
    }
  })();

  /* ---------------------------
     Core app (unchanged)
     --------------------------- */
  // ... (Остальной код приложения остается без изменений)
  const BACK_BTN = document.getElementById('backBtn');
  const HOME_BTN = document.getElementById('homeBtn'); 
  const ABOUT_BTN = document.getElementById('aboutBtn'); 
  const LIST_EL = document.getElementById('list');
  const DETAIL_EL = document.getElementById('detail');
  const DETAIL_CONTENT = document.querySelector('.detail-content');
  const SEARCH = document.getElementById('search');
  const BRAND_FILTERS = document.getElementById('brandFilters');
  const TG_COPY_BTN_ID = 'tgCopyBtn';
  const TG_HANDLE = '@ill_hack_you';
  const STORAGE_KEY = 'phoneguide_details_cache_v1';
  let rawPhones = []; 
  let aggregatedByBrand = {};
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

  // LOGIC: parse filename to detect model, codename & issue from path
  // Expected path format: data/phones_db/[brand]/[model]-[codename]-[issue].json
  function parseDetailsPath(path) {
    if (!path) return {};
    const parts = path.split('/');
    const file = parts.pop();
    const brand = parts.length > 2 ? parts[parts.length - 1] : 'Other';

    // Regex to match: [model]-[codename]-[issue].json
    const m = file.match(/^(.*?)-([a-z0-9_\/]+)-(imei|frp|dead)\.json$/i);
    if (m) {
        return {
            brand: brand,
            model: (m[1] || '').replace(/_/g, ' '),
            codename: m[2],
            issue: m[3].toLowerCase()
        };
    }
    // Fallback: [model]-[issue].json
    const m2 = file.match(/^(.*)-(imei|frp|dead)\.json$/i);
    if (m2) {
        return {
            brand: brand,
            model: (m2[1] || '').replace(/_/g, ' '),
            codename: '',
            issue: m2[2].toLowerCase()
        };
    }
    return { brand: brand, model: file.replace(/_/g, ' ').replace(/\.json$/, ''), codename: '', issue: '' };
  }

  // LOGIC: Aggregate raw file paths into models with .issues map
  function aggregatePhones(paths) {
    aggregatedByBrand = {};
    paths.forEach(path => {
      const parsed = parseDetailsPath(path);
      const brand = parsed.brand || 'Other';
      const model = parsed.model || 'Model';
      const codename = parsed.codename || '';
      const issue = parsed.issue;

      if (!issue || !['imei','frp','dead'].includes(issue)) return;

      if (!aggregatedByBrand[brand]) aggregatedByBrand[brand] = {};

      const key = `${brand}||${model}||${codename}`;

      if (!aggregatedByBrand[brand][key]) {
        aggregatedByBrand[brand][key] = {
          brand, model, codename,
          cpu: 'Unknown', 
          series: '',
          issues: {}
        };
      }

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
    const allChip = makeChip('Hammasi', true);
    allChip.addEventListener('click', () => { activeBrand = null; updateActiveChips(); window.renderList(SEARCH.value || ''); });
    BRAND_FILTERS.appendChild(allChip);
    brands.forEach(brand => {
      const chip = makeChip(brand, false);
      chip.addEventListener('click', () => {
        activeBrand = (activeBrand === brand) ? null : brand;
        updateActiveChips();
        window.renderList(SEARCH.value || '');
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

  // Render list (Accessible globally via window.renderList)
  window.renderList = function(filter = '') {
    // Восстанавливаем состояние Главной страницы
    DETAIL_EL.classList.add('hidden'); 
    BACK_BTN.classList.add('hidden'); 
    LIST_EL.classList.remove('hidden');
    SEARCH.classList.remove('hidden'); // Показать поиск
    BRAND_FILTERS.classList.remove('hidden'); // Показать фильтры
    HOME_BTN?.classList.add('active'); 
    ABOUT_BTN?.classList.remove('active'); 
    
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
      // Хакерский стиль для заголовка
      const title = document.createElement('h2'); title.textContent = `[ ${brand.toUpperCase()} ]`; groupEl.appendChild(title);
      const list = document.createElement('div'); list.className = 'list';

      visibleModels.forEach(m => {
        const availableIssues = Object.keys(m.issues || {});
        if (!availableIssues || availableIssues.length === 0) return;

        anyItems = true;
        const item = document.createElement('div'); item.className = 'item';
        // Компактная мета-информация
        const metaHtml = `<div class="meta"><div class="model">${escapeHtml(m.model)}</div><div class="codename">${escapeHtml(m.codename || 'no_codename')} · ${escapeHtml(m.cpu || 'CPU')}</div></div>`;
        
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

        item.addEventListener('click', (ev) => {
          if (ev.target.closest('.issue-pill')) return; 
          openModelPanel(m);
        });

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
  };

  // open model panel: shows header + only existing category buttons
  function openModelPanel(model) {
    const modelKey = `${model.brand}||${model.model}||${model.codename}`;
    const state = { view: 'model', modelKey };
    history.pushState(state, '', `#model-${encodeURIComponent(modelKey)}`);
    
    // UI state management
    LIST_EL.classList.add('hidden'); 
    DETAIL_EL.classList.remove('hidden'); 
    BACK_BTN.classList.remove('hidden');
    SEARCH.classList.add('hidden'); // Скрыть поиск
    BRAND_FILTERS.classList.add('hidden'); // Скрыть фильтры
    HOME_BTN?.classList.remove('active'); 
    ABOUT_BTN?.classList.remove('active'); 

    const availableCount = Object.keys(model.issues || {}).length;
    DETAIL_CONTENT.innerHTML = `
      <h2 class="glow-title">${escapeHtml(model.brand)} — ${escapeHtml(model.model)}</h2>
      <div class="meta">codename: ${escapeHtml(model.codename || 'no_codename')} · cpu: ${escapeHtml(model.cpu || 'CPU')}</div>
      <div style="margin-top:8px">${buildIssueButtonsHtml(model)}</div>
      <p style="margin-top:12px;color:var(--muted)">[//] Нажмите на категорию чтобы загрузить инструкцию. Найдено файлов: ${availableCount}</p>
      
      <div style="margin-top:20px;display:flex;gap:8px;align-items:center">
        <button id="${TG_COPY_BTN_ID}" class="copy-tg-btn">[C] Copy TG Handle</button>
        <a class="nav-btn small" href="https://t.me/ill_hack_you" target="_blank" rel="noopener">@ill_hack_you</a>
      </div>
    `;

    // wire buttons
    DETAIL_CONTENT.querySelectorAll('.issue-pill.available').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const path = decodeURIComponent(btn.dataset.path);
        const issue = btn.dataset.issue;
        openIssueDetail(path, model, issue);
      });
    });

    // TG copy handler
    const copyBtn = document.getElementById(TG_COPY_BTN_ID);
    if (copyBtn) copyBtn.addEventListener('click', async () => { 
        try { 
            await navigator.clipboard.writeText(TG_HANDLE); 
            copyBtn.textContent = '[DONE] Скопировано!'; 
            setTimeout(()=> copyBtn.textContent='[C] Copy TG Handle',1400); 
        } catch(e){ 
            window.prompt('Скопируй вручную:', TG_HANDLE); 
        } 
    });
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
    DETAIL_CONTENT.innerHTML = `<div class="center">Загрузка инструкции ${issue.toUpperCase()}…</div>`;
    
    // UI state management (hide non-essential elements)
    SEARCH.classList.add('hidden');
    BRAND_FILTERS.classList.add('hidden');

    try {
      const cacheKey = details_path;
      if (detailsCache.has(cacheKey)) {
        const cachedDetail = detailsCache.get(cacheKey);
        model.cpu = cachedDetail.cpu || model.cpu;
        renderDetail(cachedDetail, model, issue);
        return;
      }
      const data = await fetchJson(details_path, 9000);
      const detail = {
        details_path,
        brand: data.brand || model.brand, model: data.model || model.model,
        codename: data.codename || model.codename, cpu: data.cpu || model.cpu || 'Unknown', 
        issue: data.issue || issue, instructions: data.instructions || data.text || 'Инструкции не найдены',
        raw: data
      };
      model.cpu = detail.cpu;
      detailsCache.set(cacheKey, detail);
      persistCache();
      renderDetail(detail, model, issue);
    } catch (err) {
      console.error('openIssueDetail error', err);
      DETAIL_CONTENT.innerHTML = `<div class="center">Не удалось загрузить детали. Проверь структуру файлов или путь: ${escapeHtml(details_path)}</div>`;
    }
  }

  function persistCache() {
    try {
      const toStore = Object.create(null);
      for (const [k,v] of detailsCache.entries()) {
        // Сохраняем только необходимые поля для быстрого кэша
        toStore[k] = { brand:v.brand, model:v.model, codename:v.codename, cpu:v.cpu, issue:v.issue, instructions:v.instructions };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (e) { console.warn('persistCache failed', e); }
  }

  function renderDetail(detail, model, issue) {
    // Обновляем хэш истории
    const state = { view: 'detail', details_path: detail.details_path || model.issues[issue] };
    history.pushState(state, '', `#${state.details_path}`);
    
    // UI state management
    LIST_EL.classList.add('hidden');
    DETAIL_EL.classList.remove('hidden');
    BACK_BTN.classList.remove('hidden');

    const safeInstructions = (detail.instructions || '').replace(/\n/g, '<br>');
    DETAIL_CONTENT.innerHTML = `
      <h2 class="glow-title">${escapeHtml(detail.brand)} — ${escapeHtml(detail.model)}</h2>
      <div class="meta">codename: ${escapeHtml(detail.codename || 'no_codename')} · cpu: ${escapeHtml(detail.cpu || 'Unknown')} · issue: ${escapeHtml(detail.issue || issue)}</div>
      <div class="instructions">${safeInstructions}</div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button id="${TG_COPY_BTN_ID}" class="copy-tg-btn">[C] Copy TG Handle</button>
        <a class="nav-btn small" href="https://t.me/ill_hack_you" target="_blank" rel="noopener noreferrer">Открыть @ill_hack_you</a>
      </div>
    `;
    // TG copy handler
    document.getElementById(TG_COPY_BTN_ID)?.addEventListener('click', async () => { 
        try { 
            await navigator.clipboard.writeText(TG_HANDLE); 
            const b = document.getElementById(TG_COPY_BTN_ID); 
            b.textContent='[DONE] Скопировано!'; 
            setTimeout(()=> b.textContent='[C] Copy TG Handle',1400); 
        } catch(e){ 
            window.prompt('Скопируй вручную:', TG_HANDLE); 
        } 
    });
  }

  // history handling: ПЕРЕКЛЮЧАЕМСЯ НА window.goToHome из index.html
  window.addEventListener('popstate', (ev) => {
    const st = ev.state;
    if (!st || st.view === 'list') {
      window.goToHome();
    } else if (st.view === 'about') {
       document.getElementById('aboutBtn')?.click(); 
    } else if (st.view === 'model') {
      const key = st.modelKey;
      for (const b in aggregatedByBrand) {
        const found = aggregatedByBrand[b].find(x => `${x.brand}||${x.model}||${x.codename}` === key);
        if (found) { openModelPanel(found); return; }
      }
      window.goToHome();
    } else if (st.view === 'detail') {
        const path = st.details_path;
        const parsed = parseDetailsPath(path);
        const aggKey = `${parsed.brand}||${parsed.model}||${parsed.codename}`;
        const agg = aggregatedByBrand[parsed.brand]?.find(x => `${x.brand}||${x.model}||${parsed.codename}` === aggKey);
        
        openIssueDetail(path, agg || parsed, parsed.issue || '');
    } else {
      window.goToHome();
    }
  });
  
  // Hash support on first load (to allow direct links)
  function handleInitialHash() {
      if (!location.hash) return;
      const hash = decodeURIComponent(location.hash.slice(1));

      if (hash === 'about') {
          document.getElementById('aboutBtn')?.click(); 
      } else if (hash.startsWith('model-')) {
          const key = hash.replace(/^model-/, '');
          for (const b in aggregatedByBrand) {
            const found = aggregatedByBrand[b].find(x => `${x.brand}||${x.model}||x.codename}` === key);
            if (found) { openModelPanel(found); return; }
          }
      } else if (hash.startsWith('data/')) {
          const parsed = parseDetailsPath(hash);
          const aggKey = `${parsed.brand}||${parsed.model}||${parsed.codename}`;
          const agg = aggregatedByBrand[parsed.brand]?.find(x => `${x.brand}||${x.model}||${parsed.codename}` === aggKey);
          
          openIssueDetail(hash, agg || parsed, parsed.issue || '');
      }
  }


  BACK_BTN.addEventListener('click', () => history.back());

  const onSearch = debounce((e) => window.renderList(e.target.value || ''), 160);
  SEARCH.addEventListener('input', onSearch);
  
  // Убеждаемся, что renderList доступен извне
  window.renderList = window.renderList || function() {}; 

  // init
  async function init() {
    LIST_EL.innerHTML = '<div class="center">Загрузка базы телефонов (автоматически)...</div>';
    
    // ----------------------------------------------------------------------------------
    // Загрузка индекса из сгенерированного list.json
    // ----------------------------------------------------------------------------------
    const FILE_LIST_PATH = 'list.json'; 
    
    try {
      const allFilePaths = await fetchJson(FILE_LIST_PATH, 15000);
      
      if (!Array.isArray(allFilePaths)) {
        throw new Error(`${FILE_LIST_PATH} не является массивом путей.`);
      }
      
      rawPhones = allFilePaths;
      aggregatePhones(rawPhones);
      renderBrandFilters();
      window.renderList();
      
      // Обработка хэша URL после полной загрузки списка
      handleInitialHash();

    } catch (err) {
      console.error(err);
      LIST_EL.innerHTML = `<div class="center">Ошибка загрузки базы: Проверьте, что файл ${FILE_LIST_PATH} сгенерирован и загружен на сервер. ${escapeHtml(err.message || '')}</div>`;
    }
  }

  init();

})();