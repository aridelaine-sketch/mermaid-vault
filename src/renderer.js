'use strict';

(function () {
  /* ---------------------------------------------------------------------
   * Small utilities
   * ------------------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function slugTitle(code) {
    const firstLine = (code || '').split('\n').find((l) => l.trim().length > 0) || 'Untitled diagram';
    return firstLine.replace(/^[a-zA-Z-]+\s*/, '').trim().slice(0, 40) || 'Untitled diagram';
  }

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  let library = { folders: [], diagrams: [] };
  let filter = { folderId: null, tag: null, favoritesOnly: false, query: '' };
  let sortBy = 'updated';
  let currentDiagramId = null;
  let drawerOpen = false;
  const thumbCache = new Map(); // key: `${id}@${updatedAt}` -> svg string or null

  /* ---------------------------------------------------------------------
   * Mermaid setup
   * ------------------------------------------------------------------- */
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
    theme: 'base',
    themeVariables: {
      primaryColor: '#eee6cf',
      primaryBorderColor: '#c9a34e',
      primaryTextColor: '#202b33',
      secondaryColor: '#dceef1',
      tertiaryColor: '#f6f3ea',
      lineColor: '#5b6a75',
      textColor: '#202b33',
      mainBkg: '#eee6cf',
      nodeBorder: '#c9a34e',
      clusterBkg: '#efe9db',
      clusterBorder: '#d8d0ba',
      titleColor: '#202b33',
      edgeLabelBackground: '#f6f3ea',
      actorBkg: '#eee6cf',
      actorBorder: '#c9a34e',
      signalColor: '#5b6a75',
      signalTextColor: '#202b33'
    }
  });

  async function renderMermaidToSvg(code) {
    const id = 'mv-render-' + uid();
    const { svg } = await mermaid.render(id, code);
    return svg;
  }

  /* ---------------------------------------------------------------------
   * Persistence
   * ------------------------------------------------------------------- */
  const persist = debounce(async () => {
    await window.vault.saveLibrary(library);
  }, 350);

  function touch(diagram) {
    diagram.updatedAt = new Date().toISOString();
  }

  /* ---------------------------------------------------------------------
   * Derived data
   * ------------------------------------------------------------------- */
  function allTags() {
    const counts = new Map();
    for (const d of library.diagrams) {
      for (const t of d.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  function folderCounts() {
    const counts = new Map();
    for (const d of library.diagrams) {
      const key = d.folderId || 'unfiled';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function filteredDiagrams() {
    const q = filter.query.trim().toLowerCase();
    let list = library.diagrams.filter((d) => {
      if (filter.favoritesOnly && !d.favorite) return false;
      if (filter.folderId && d.folderId !== filter.folderId) return false;
      if (filter.tag && !(d.tags || []).includes(filter.tag)) return false;
      if (q) {
        const hay = [d.title, d.description, ...(d.tags || []), d.code].join(' \n ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list = list.slice().sort((a, b) => {
      if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'created') return new Date(b.createdAt) - new Date(a.createdAt);
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    return list;
  }

  function currentViewTitle() {
    if (filter.favoritesOnly) return 'Favorites';
    if (filter.tag) return '#' + filter.tag;
    if (filter.folderId) {
      const f = library.folders.find((x) => x.id === filter.folderId);
      return f ? f.name : 'Folder';
    }
    return 'All Diagrams';
  }

  /* ---------------------------------------------------------------------
   * Sidebar rendering
   * ------------------------------------------------------------------- */
  function renderSidebar() {
    const counts = folderCounts();
    const total = library.diagrams.length;

    const folderList = $('#folder-list');
    folderList.innerHTML = '';

    const allLi = document.createElement('li');
    allLi.innerHTML = `<div class="nav-item ${!filter.folderId && !filter.tag && !filter.favoritesOnly ? 'active' : ''}" data-folder="__all__">
      <button class="nav-item-name">All Diagrams</button><span class="nav-item-count">${total}</span></div>`;
    folderList.appendChild(allLi);

    for (const f of library.folders) {
      const li = document.createElement('li');
      const count = counts.get(f.id) || 0;
      const active = filter.folderId === f.id;
      li.innerHTML = `<div class="nav-item ${active ? 'active' : ''}" data-folder="${f.id}">
        <button class="nav-item-name">${escapeHtml(f.name)}</button>
        <span class="nav-item-count">${count}</span>
        <button class="nav-item-delete" data-delete-folder="${f.id}" title="Delete folder" aria-label="Delete folder">×</button>
      </div>`;
      folderList.appendChild(li);
    }

    const tagList = $('#tag-list');
    tagList.innerHTML = '';
    for (const [tag, count] of allTags()) {
      const li = document.createElement('li');
      const active = filter.tag === tag;
      li.innerHTML = `<div class="nav-item ${active ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
        <button class="nav-item-name">#${escapeHtml(tag)}</button><span class="nav-item-count">${count}</span></div>`;
      tagList.appendChild(li);
    }

    $('#favorites-toggle').classList.toggle('active', filter.favoritesOnly);

    // Folder <select> in the details drawer
    const sel = $('#folder-select');
    const preserveValue = sel.value;
    sel.innerHTML = '<option value="">Unfiled</option>' +
      library.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    const openDiagramNow = currentDiagram();
    sel.value = openDiagramNow ? (openDiagramNow.folderId || '') : preserveValue;
  }

  /* ---------------------------------------------------------------------
   * Library grid rendering
   * ------------------------------------------------------------------- */
  async function renderGrid() {
    $('#view-title').textContent = currentViewTitle();
    const list = filteredDiagrams();
    const grid = $('#card-grid');
    const empty = $('#empty-state');

    if (list.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    // Render placeholders first so the grid feels instant, then fill in
    // thumbnails as they resolve (cached after first render).
    grid.innerHTML = list.map((d) => cardSkeleton(d)).join('');

    list.forEach(async (d) => {
      const svg = await getThumb(d);
      const el = grid.querySelector(`[data-card="${d.id}"] .card-thumb`);
      if (!el) return;
      if (svg === null) {
        el.classList.add('thumb-error');
        el.textContent = 'Could not render this diagram';
      } else {
        el.innerHTML = svg;
      }
    });
  }

  function cardSkeleton(d) {
    const folder = library.folders.find((f) => f.id === d.folderId);
    const tags = (d.tags || []).slice(0, 3).map((t) => `<span class="card-tag">#${escapeHtml(t)}</span>`).join('');
    return `
      <button class="diagram-card ${d.favorite ? 'is-favorite' : ''}" data-card="${d.id}">
        <div class="card-thumb thumb-empty">Rendering…</div>
        <div class="card-body">
          <p class="card-title">${escapeHtml(d.title || 'Untitled diagram')}</p>
          <p class="card-desc">${escapeHtml(d.description || '')}</p>
          <div class="card-meta-row">
            <div class="card-tags">${tags}</div>
            ${folder ? `<span class="card-folder">${escapeHtml(folder.name)}</span>` : ''}
          </div>
        </div>
      </button>`;
  }

  async function getThumb(d) {
    const key = d.id + '@' + d.updatedAt;
    if (thumbCache.has(key)) return thumbCache.get(key);
    try {
      const svg = await renderMermaidToSvg(d.code || 'flowchart TD\n A --> B');
      thumbCache.set(key, svg);
      return svg;
    } catch (err) {
      thumbCache.set(key, null);
      return null;
    }
  }

  /* ---------------------------------------------------------------------
   * Editor view
   * ------------------------------------------------------------------- */
  function currentDiagram() {
    return library.diagrams.find((d) => d.id === currentDiagramId) || null;
  }

  function openDiagram(id) {
    currentDiagramId = id;
    const d = currentDiagram();
    if (!d) return;

    $('#library-view').classList.add('hidden');
    $('#editor-view').classList.remove('hidden');

    $('#title-input').value = d.title || '';
    $('#code-input').value = d.code || '';
    $('#desc-input').value = d.description || '';
    $('#folder-select').value = d.folderId || '';
    $('#favorite-btn').textContent = d.favorite ? '★' : '☆';
    $('#favorite-btn').classList.toggle('active', !!d.favorite);
    $('#meta-created').textContent = formatDate(d.createdAt);
    $('#meta-updated').textContent = formatDate(d.updatedAt);
    renderTagChips(d);
    closeDrawer();
    updatePreview();
  }

  function closeEditor() {
    currentDiagramId = null;
    $('#editor-view').classList.add('hidden');
    $('#library-view').classList.remove('hidden');
    closeDrawer();
    renderSidebar();
    renderGrid();
  }

  const updatePreview = debounce(async () => {
    const code = $('#code-input').value;
    const banner = $('#error-banner');
    if (!code.trim()) {
      $('#preview-render').innerHTML = '';
      banner.classList.add('hidden');
      return;
    }
    try {
      const svg = await renderMermaidToSvg(code);
      $('#preview-render').innerHTML = svg;
      banner.classList.add('hidden');
    } catch (err) {
      banner.textContent = (err && err.message) ? err.message : 'This Mermaid code could not be parsed.';
      banner.classList.remove('hidden');
      // Deliberately leave the last successful render in place, mirroring
      // how a good code editor keeps the last good preview visible.
    }
  }, 300);

  function saveField(field, value) {
    const d = currentDiagram();
    if (!d) return;
    d[field] = value;
    touch(d);
    persist();
  }

  function renderTagChips(d) {
    const wrap = $('#tag-chips');
    wrap.innerHTML = (d.tags || []).map((t) => `
      <span class="tag-chip">#${escapeHtml(t)}<button data-remove-tag="${escapeHtml(t)}" aria-label="Remove tag">×</button></span>
    `).join('');
  }

  /* ---------------------------------------------------------------------
   * Diagram CRUD
   * ------------------------------------------------------------------- */
  function createDiagram({ code = '', title = null, folderId = null } = {}) {
    const now = new Date().toISOString();
    const d = {
      id: uid(),
      title: title || slugTitle(code) || 'Untitled diagram',
      description: '',
      tags: [],
      folderId: folderId || filter.folderId || null,
      code,
      favorite: false,
      createdAt: now,
      updatedAt: now
    };
    library.diagrams.unshift(d);
    persist();
    return d;
  }

  function deleteDiagram(id) {
    library.diagrams = library.diagrams.filter((d) => d.id !== id);
    persist();
  }

  /* ---------------------------------------------------------------------
   * Folders
   * ------------------------------------------------------------------- */
  function createFolder(name) {
    const f = { id: uid(), name: name.trim(), parentId: null };
    library.folders.push(f);
    persist();
    return f;
  }

  function deleteFolder(id) {
    library.folders = library.folders.filter((f) => f.id !== id);
    for (const d of library.diagrams) {
      if (d.folderId === id) d.folderId = null;
    }
    if (filter.folderId === id) filter.folderId = null;
    persist();
  }

  /* ---------------------------------------------------------------------
   * Modal / drawer helpers
   * ------------------------------------------------------------------- */
  function openDrawer() {
    drawerOpen = true;
    $('#details-drawer').classList.remove('hidden');
  }
  function closeDrawer() {
    drawerOpen = false;
    $('#details-drawer').classList.add('hidden');
  }

  function showModal(id) { $(id).classList.remove('hidden'); }
  function hideModal(id) { $(id).classList.add('hidden'); }

  let confirmResolver = null;
  function confirmDialog(message) {
    $('#confirm-message').textContent = message;
    showModal('#confirm-modal');
    return new Promise((resolve) => { confirmResolver = resolve; });
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
  }

  /* ---------------------------------------------------------------------
   * Template gallery
   * ------------------------------------------------------------------- */
  function renderTemplateGrid() {
    const grid = $('#template-grid');
    grid.innerHTML = window.VAULT_TEMPLATES.map((t) => `
      <button class="template-card" data-template="${t.id}">
        <span class="t-name">${escapeHtml(t.name)}</span>
        <span class="t-tag">#${escapeHtml(t.tag)}</span>
      </button>
    `).join('');
  }

  /* ---------------------------------------------------------------------
   * Export
   * ------------------------------------------------------------------- */
  function safeFileName(name) {
    return (name || 'diagram').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'diagram';
  }

  async function exportPNG() {
    const d = currentDiagram();
    if (!d) return;
    const svgString = $('#preview-render svg') ? $('#preview-render').innerHTML : await renderMermaidToSvg(d.code);

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;
    const viewBox = svgEl.getAttribute('viewBox');
    let w = parseFloat(svgEl.getAttribute('width')) || 800;
    let h = parseFloat(svgEl.getAttribute('height')) || 600;
    if (viewBox) {
      const parts = viewBox.split(/\s+/).map(Number);
      if (parts.length === 4) { w = parts[2]; h = parts[3]; }
    }

    const res = await window.vault.exportPng({
      svgMarkup: svgString,
      width: w,
      height: h,
      defaultPath: safeFileName(d.title) + '.png'
    });
    if (res.ok) toast('Exported ' + res.filePath.split('/').pop());
  }

  async function exportSVG() {
    const d = currentDiagram();
    if (!d) return;
    const svgString = $('#preview-render svg') ? $('#preview-render').innerHTML : await renderMermaidToSvg(d.code);
    const full = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
    const res = await window.vault.saveText({
      defaultPath: safeFileName(d.title) + '.svg',
      filters: [{ name: 'SVG Vector', extensions: ['svg'] }],
      content: full
    });
    if (res.ok) toast('Exported ' + res.filePath.split('/').pop());
  }

  async function exportPDF() {
    const d = currentDiagram();
    if (!d) return;
    const svgString = $('#preview-render svg') ? $('#preview-render').innerHTML : await renderMermaidToSvg(d.code);
    const res = await window.vault.exportPdf({
      svgMarkup: svgString,
      title: d.title || 'Untitled diagram',
      defaultPath: safeFileName(d.title) + '.pdf'
    });
    if (res.ok) toast('Exported ' + res.filePath.split('/').pop());
  }

  async function exportLibraryBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await window.vault.saveText({
      defaultPath: `mermaid-vault-backup-${stamp}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      content: JSON.stringify(library, null, 2)
    });
    if (res.ok) toast('Library exported');
  }

  async function importLibraryBackup() {
    const res = await window.vault.openJson();
    if (!res.ok) return;
    let incoming;
    try {
      incoming = JSON.parse(res.content);
    } catch (err) {
      toast('That file is not valid JSON');
      return;
    }
    if (!Array.isArray(incoming.diagrams) || !Array.isArray(incoming.folders)) {
      toast('That file is not a Mermaid Vault backup');
      return;
    }

    // Merge additively with fresh ids, so importing never clobbers the
    // library already on this machine.
    const folderIdMap = new Map();
    for (const f of incoming.folders) {
      if (f.id === 'root') continue;
      const newId = uid();
      folderIdMap.set(f.id, newId);
      library.folders.push({ id: newId, name: f.name, parentId: null });
    }
    for (const d of incoming.diagrams) {
      library.diagrams.unshift({
        id: uid(),
        title: d.title || 'Untitled diagram',
        description: d.description || '',
        tags: Array.isArray(d.tags) ? d.tags : [],
        folderId: d.folderId ? (folderIdMap.get(d.folderId) || null) : null,
        code: d.code || '',
        favorite: !!d.favorite,
        createdAt: d.createdAt || new Date().toISOString(),
        updatedAt: d.updatedAt || new Date().toISOString()
      });
    }
    persist();
    renderSidebar();
    renderGrid();
    toast(`Imported ${incoming.diagrams.length} diagram(s)`);
  }

  /* ---------------------------------------------------------------------
   * Event wiring
   * ------------------------------------------------------------------- */
  function wireEvents() {
    $('#new-diagram-btn').addEventListener('click', () => { renderTemplateGrid(); showModal('#template-modal'); });
    $('#empty-new-btn').addEventListener('click', () => { renderTemplateGrid(); showModal('#template-modal'); });
    $('#close-template-modal').addEventListener('click', () => hideModal('#template-modal'));
    $('#template-modal').addEventListener('click', (e) => { if (e.target.id === 'template-modal') hideModal('#template-modal'); });

    $('#template-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-template]');
      if (!btn) return;
      const tpl = window.VAULT_TEMPLATES.find((t) => t.id === btn.dataset.template);
      const d = createDiagram({ code: tpl.code, title: tpl.name });
      hideModal('#template-modal');
      renderSidebar();
      openDiagram(d.id);
    });

    $('#blank-diagram-btn').addEventListener('click', () => {
      const d = createDiagram({ code: 'flowchart TD\n    A[Start] --> B[End]' });
      hideModal('#template-modal');
      renderSidebar();
      openDiagram(d.id);
    });

    // Sidebar navigation
    $('#folder-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-delete-folder]');
      if (del) {
        e.stopPropagation();
        confirmDialog('Delete this folder? Diagrams inside it will become unfiled, not deleted.').then((ok) => {
          hideModal('#confirm-modal');
          if (ok) { deleteFolder(del.dataset.deleteFolder); renderSidebar(); renderGrid(); }
        });
        return;
      }
      const item = e.target.closest('[data-folder]');
      if (!item) return;
      filter = { folderId: item.dataset.folder === '__all__' ? null : item.dataset.folder, tag: null, favoritesOnly: false, query: '' };
      $('#search-input').value = '';
      renderSidebar();
      renderGrid();
    });

    $('#tag-list').addEventListener('click', (e) => {
      const item = e.target.closest('[data-tag]');
      if (!item) return;
      const tag = item.dataset.tag;
      filter = { folderId: null, tag: filter.tag === tag ? null : tag, favoritesOnly: false, query: '' };
      renderSidebar();
      renderGrid();
    });

    $('#favorites-toggle').addEventListener('click', () => {
      filter = { folderId: null, tag: null, favoritesOnly: !filter.favoritesOnly, query: '' };
      renderSidebar();
      renderGrid();
    });

    $('#add-folder-btn').addEventListener('click', () => {
      $('#folder-name-input').value = '';
      showModal('#folder-modal');
      setTimeout(() => $('#folder-name-input').focus(), 30);
    });
    $('#close-folder-modal').addEventListener('click', () => hideModal('#folder-modal'));
    $('#folder-cancel-btn').addEventListener('click', () => hideModal('#folder-modal'));
    $('#folder-create-btn').addEventListener('click', () => {
      const name = $('#folder-name-input').value.trim();
      if (!name) return;
      createFolder(name);
      hideModal('#folder-modal');
      renderSidebar();
    });
    $('#folder-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#folder-create-btn').click(); });

    // Search + sort
    $('#search-input').addEventListener('input', debounce((e) => {
      filter.query = e.target.value;
      renderGrid();
    }, 150));
    $('#sort-select').addEventListener('change', (e) => { sortBy = e.target.value; renderGrid(); });

    // Card grid -> open editor
    $('#card-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-card]');
      if (!card) return;
      openDiagram(card.dataset.card);
    });

    // Editor header
    $('#back-btn').addEventListener('click', closeEditor);
    $('#title-input').addEventListener('input', (e) => saveField('title', e.target.value));
    $('#code-input').addEventListener('input', (e) => { saveField('code', e.target.value); updatePreview(); });
    $('#code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.target;
        const start = el.selectionStart, end = el.selectionEnd;
        el.value = el.value.slice(0, start) + '  ' + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + 2;
        saveField('code', el.value);
        updatePreview();
      }
    });

    $('#favorite-btn').addEventListener('click', () => {
      const d = currentDiagram();
      if (!d) return;
      d.favorite = !d.favorite;
      touch(d);
      persist();
      $('#favorite-btn').textContent = d.favorite ? '★' : '☆';
      $('#favorite-btn').classList.toggle('active', d.favorite);
    });

    $('#info-btn').addEventListener('click', () => (drawerOpen ? closeDrawer() : openDrawer()));
    $('#close-drawer').addEventListener('click', closeDrawer);

    $('#desc-input').addEventListener('input', (e) => saveField('description', e.target.value));
    $('#folder-select').addEventListener('change', (e) => { saveField('folderId', e.target.value || null); renderSidebar(); });

    $('#tag-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        e.preventDefault();
        const d = currentDiagram();
        const tag = e.target.value.trim().toLowerCase().replace(/\s+/g, '-');
        if (!d.tags) d.tags = [];
        if (!d.tags.includes(tag)) d.tags.push(tag);
        e.target.value = '';
        touch(d);
        persist();
        renderTagChips(d);
        renderSidebar();
      }
    });
    $('#tag-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-tag]');
      if (!btn) return;
      const d = currentDiagram();
      d.tags = (d.tags || []).filter((t) => t !== btn.dataset.removeTag);
      touch(d);
      persist();
      renderTagChips(d);
      renderSidebar();
    });

    $('#delete-btn').addEventListener('click', () => {
      confirmDialog('Delete this diagram? This can\u2019t be undone.').then((ok) => {
        hideModal('#confirm-modal');
        if (ok) { deleteDiagram(currentDiagramId); closeEditor(); toast('Diagram deleted'); }
      });
    });

    $('#confirm-ok').addEventListener('click', () => { if (confirmResolver) confirmResolver(true); });
    $('#confirm-cancel').addEventListener('click', () => { if (confirmResolver) confirmResolver(false); });

    // Export dropdown
    $('#export-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#export-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', () => $('#export-dropdown').classList.add('hidden'));
    $('#export-dropdown').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-format]');
      if (!btn) return;
      $('#export-dropdown').classList.add('hidden');
      if (btn.dataset.format === 'png') await exportPNG();
      if (btn.dataset.format === 'svg') await exportSVG();
      if (btn.dataset.format === 'pdf') await exportPDF();
    });

    $('#export-library-btn').addEventListener('click', exportLibraryBackup);
    $('#import-library-btn').addEventListener('click', importLibraryBackup);

    // Menu-driven actions from main.js
    window.vault.onMenu('menu:new-diagram', () => { renderTemplateGrid(); showModal('#template-modal'); });
    window.vault.onMenu('menu:export-library', exportLibraryBackup);
    window.vault.onMenu('menu:import-library', importLibraryBackup);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') { e.preventDefault(); persist(); toast('Saved'); }
      if (e.key === 'Escape') {
        if (!$('#confirm-modal').classList.contains('hidden')) { if (confirmResolver) confirmResolver(false); return; }
        if (!$('#template-modal').classList.contains('hidden')) { hideModal('#template-modal'); return; }
        if (!$('#folder-modal').classList.contains('hidden')) { hideModal('#folder-modal'); return; }
        if (drawerOpen) { closeDrawer(); return; }
        if (!$('#editor-view').classList.contains('hidden')) { closeEditor(); return; }
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------- */
  async function boot() {
    library = await window.vault.loadLibrary();
    wireEvents();
    renderSidebar();
    await renderGrid();
  }

  boot();
})();
