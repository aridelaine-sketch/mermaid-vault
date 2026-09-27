'use strict';
/**
 * A minimal interactive flowchart canvas: add nodes, drag to reposition,
 * drag from a node's handle to connect, inline label editing, and a
 * selection-driven inspector for shape/arrow-kind/delete. Deliberately
 * hand-rolled in plain SVG rather than a charting library, since the data
 * model (FlowGraph) is tiny and this keeps the whole app dependency-free.
 *
 * Position is authoring-only: FlowGraph.generate() never emits x/y (plain
 * Mermaid flowchart text has no coordinate system), so dragging a node
 * never touches the Mermaid source — only onLayoutChange fires, which the
 * caller persists separately from the diagram's `code`.
 */
window.createVisualEditor = function createVisualEditor(svgEl, wrapEl, callbacks) {
  const CANVAS_W = 2400, CANVAS_H = 1600;
  const NODE_H = 46;
  const HANDLE_R = 7;

  const COLORS = {
    nodeFill: '#eee6cf', nodeStroke: '#c9a34e', nodeStrokeSelected: '#3fa796',
    text: '#202b33', edge: '#5b6a75', edgeSelected: '#3fa796',
    labelBg: '#f6f3ea', handle: '#3fa796', ghost: '#3fa796'
  };

  svgEl.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`);
  svgEl.setAttribute('width', CANVAS_W);
  svgEl.setAttribute('height', CANVAS_H);

  let model = { direction: 'TD', nodes: [], edges: [] };
  let selection = null; // { type: 'node'|'edge', id }
  let seq = 1;

  const onGraphChange = callbacks.onGraphChange || (() => {});
  const onLayoutChange = callbacks.onLayoutChange || (() => {});
  const onSelectionChange = callbacks.onSelectionChange || (() => {});

  function nodeWidth(label) {
    return Math.max(90, Math.min(260, (label || '').length * 8 + 36));
  }
  function findNode(id) { return model.nodes.find((n) => n.id === id); }
  function nodeBox(n) {
    const w = nodeWidth(n.label);
    return { x: n.x - w / 2, y: n.y - NODE_H / 2, w, h: NODE_H, cx: n.x, cy: n.y };
  }
  function pointInNode(n, px, py) {
    const b = nodeBox(n);
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }

  function svgPoint(clientX, clientY) {
    const rect = svgEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function el(tag, attrs) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ------------------------------- shapes ------------------------------ */
  function shapeElement(shape, b) {
    const { x, y, w, h, cx, cy } = b;
    switch (shape) {
      case 'round':
        return el('rect', { x, y, width: w, height: h, rx: 14, ry: 14 });
      case 'stadium':
        return el('rect', { x, y, width: w, height: h, rx: h / 2, ry: h / 2 });
      case 'circle':
        return el('ellipse', { cx, cy, rx: w / 2, ry: h / 2 });
      case 'rhombus':
        return el('polygon', { points: `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}` });
      case 'hexagon': {
        const n = w * 0.18;
        return el('polygon', { points: `${x + n},${y} ${x + w - n},${y} ${x + w},${cy} ${x + w - n},${y + h} ${x + n},${y + h} ${x},${cy}` });
      }
      case 'cylinder': {
        const ry = Math.min(12, h * 0.28);
        const d = `M${x},${y + ry} a${w / 2},${ry} 0 0 0 ${w},0 l0,${h - 2 * ry} a${w / 2},${ry} 0 0 1 -${w},0 z`;
        return el('path', { d });
      }
      case 'subroutine': {
        const g = el('g', {});
        g.appendChild(el('rect', { x, y, width: w, height: h }));
        g.appendChild(el('line', { x1: x + 8, y1: y, x2: x + 8, y2: y + h, stroke: COLORS.nodeStroke, 'stroke-width': 2 }));
        g.appendChild(el('line', { x1: x + w - 8, y1: y, x2: x + w - 8, y2: y + h, stroke: COLORS.nodeStroke, 'stroke-width': 2 }));
        return g;
      }
      case 'rect':
      default:
        return el('rect', { x, y, width: w, height: h });
    }
  }

  /* ------------------------------- render ------------------------------ */
  function render() {
    svgEl.innerHTML = '';

    const edgeLayer = el('g', {});
    const nodeLayer = el('g', {});
    svgEl.appendChild(edgeLayer);
    svgEl.appendChild(nodeLayer);

    for (const e of model.edges) {
      const from = findNode(e.from), to = findNode(e.to);
      if (!from || !to) continue;
      const selected = selection && selection.type === 'edge' && selection.id === e.id;
      const isDotted = e.kind === 'dotted' || e.kind === 'dottedArrow';
      const isThick = e.kind === 'thick' || e.kind === 'thickArrow';
      const hasArrow = e.kind !== 'line' && e.kind !== 'dotted' && e.kind !== 'thick';

      const g = el('g', { 'data-edge': e.id, style: 'cursor:pointer;' });
      const hit = el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: 'transparent', 'stroke-width': 16 });
      const line = el('line', {
        x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        stroke: selected ? COLORS.edgeSelected : COLORS.edge,
        'stroke-width': isThick ? 3.5 : 1.8,
        'stroke-dasharray': isDotted ? '4,4' : 'none',
        'marker-end': hasArrow ? 'url(#vault-arrowhead)' : ''
      });
      g.appendChild(hit);
      g.appendChild(line);

      if (e.label) {
        const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
        const w = Math.max(24, e.label.length * 7 + 12);
        g.appendChild(el('rect', { x: mx - w / 2, y: my - 10, width: w, height: 20, fill: COLORS.labelBg, opacity: 0.92 }));
        const t = el('text', { x: mx, y: my + 4, 'text-anchor': 'middle', 'font-size': 12, fill: COLORS.text, 'font-family': 'ui-monospace, monospace' });
        t.textContent = e.label;
        g.appendChild(t);
      }
      g.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });
      g.addEventListener('click', (ev) => { ev.stopPropagation(); select('edge', e.id); });
      g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); openLabelEditor('edge', e.id); });
      edgeLayer.appendChild(g);
    }

    for (const n of model.nodes) {
      const b = nodeBox(n);
      const selected = selection && selection.type === 'node' && selection.id === n.id;
      const g = el('g', { 'data-node': n.id, style: 'cursor:grab;' });

      const shape = shapeElement(n.shape, b);
      applyPresentation(shape, selected);
      g.appendChild(shape);

      const text = el('text', { x: b.cx, y: b.cy + 4, 'text-anchor': 'middle', 'font-size': 13, fill: COLORS.text, 'font-family': 'ui-monospace, monospace' });
      text.textContent = n.label;
      g.appendChild(text);

      const handle = el('circle', { cx: b.x + b.w + 2, cy: b.cy, r: HANDLE_R, fill: COLORS.handle, opacity: selected ? 1 : 0.35, 'data-handle': n.id, style: 'cursor:crosshair;' });
      g.appendChild(handle);

      g.addEventListener('mousedown', (ev) => { if (ev.target === handle) return; ev.stopPropagation(); beginNodeDrag(n.id, ev); });
      g.addEventListener('click', (ev) => { ev.stopPropagation(); if (!dragMoved) select('node', n.id); });
      g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); openLabelEditor('node', n.id); });
      handle.addEventListener('mousedown', (ev) => { ev.stopPropagation(); beginConnectDrag(n.id, ev); });

      nodeLayer.appendChild(g);
    }
  }

  function applyPresentation(node, selected) {
    // shapeElement may return a <g> (subroutine); style every leaf shape inside it.
    const targets = node.tagName.toLowerCase() === 'g' ? Array.from(node.children).filter((c) => c.tagName !== 'line') : [node];
    for (const t of targets) {
      t.setAttribute('fill', COLORS.nodeFill);
      t.setAttribute('stroke', selected ? COLORS.nodeStrokeSelected : COLORS.nodeStroke);
      t.setAttribute('stroke-width', selected ? 2.5 : 1.6);
    }
  }

  function ensureArrowMarker() {
    let defs = svgEl.querySelector('defs');
    if (defs) return;
    defs = el('defs', {});
    const marker = el('marker', { id: 'vault-arrowhead', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' });
    marker.appendChild(el('path', { d: 'M0,0 L8,4 L0,8 Z', fill: COLORS.edge }));
    defs.appendChild(marker);
    svgEl.appendChild(defs);
  }

  /* ------------------------------ selection ----------------------------- */
  function select(type, id) {
    selection = { type, id };
    render();
    ensureArrowMarker();
    onSelectionChange(selection, type === 'node' ? findNode(id) : model.edges.find((e) => e.id === id));
  }
  function clearSelection() {
    if (!selection) return;
    selection = null;
    render();
    ensureArrowMarker();
    onSelectionChange(null, null);
  }

  /* -------------------------------- drag -------------------------------- */
  let dragMoved = false;

  function beginNodeDrag(id, ev) {
    dragMoved = false;
    select('node', id);
    const start = svgPoint(ev.clientX, ev.clientY);
    const n = findNode(id);
    const offset = { x: n.x - start.x, y: n.y - start.y };

    function onMove(e2) {
      const p = svgPoint(e2.clientX, e2.clientY);
      if (Math.abs(p.x - start.x) > 3 || Math.abs(p.y - start.y) > 3) dragMoved = true;
      n.x = Math.max(40, Math.min(CANVAS_W - 40, p.x + offset.x));
      n.y = Math.max(30, Math.min(CANVAS_H - 30, p.y + offset.y));
      render();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onLayoutChange(model);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function beginConnectDrag(fromId, ev) {
    const from = findNode(fromId);
    const ghost = el('line', { x1: from.x, y1: from.y, x2: from.x, y2: from.y, stroke: COLORS.ghost, 'stroke-width': 2, 'stroke-dasharray': '5,4' });
    svgEl.appendChild(ghost);
    let dropTarget = null;

    function onMove(e2) {
      const p = svgPoint(e2.clientX, e2.clientY);
      ghost.setAttribute('x2', p.x);
      ghost.setAttribute('y2', p.y);
      dropTarget = model.nodes.find((n) => n.id !== fromId && pointInNode(n, p.x, p.y)) || null;
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      ghost.remove();
      if (dropTarget) {
        const id = 'e' + (seq++);
        model.edges.push({ id, from: fromId, to: dropTarget.id, label: '', kind: 'arrow' });
        select('edge', id);
        onGraphChange(model);
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* --------------------------- label editing ---------------------------- */
  const editorInput = document.createElement('input');
  editorInput.className = 'visual-label-editor hidden';
  wrapEl.appendChild(editorInput);

  function openLabelEditor(type, id) {
    select(type, id);
    const target = type === 'node' ? findNode(id) : model.edges.find((e) => e.id === id);
    let x, y;
    if (type === 'node') { x = target.x; y = target.y; } else {
      const from = findNode(target.from), to = findNode(target.to);
      x = (from.x + to.x) / 2; y = (from.y + to.y) / 2;
    }
    const svgRect = svgEl.getBoundingClientRect();
    const wrapRect = wrapEl.getBoundingClientRect();
    editorInput.style.left = (svgRect.left - wrapRect.left + x - 70) + 'px';
    editorInput.style.top = (svgRect.top - wrapRect.top + y - 12) + 'px';
    editorInput.value = target.label || '';
    editorInput.classList.remove('hidden');
    editorInput.focus();
    editorInput.select();

    function commit() {
      target.label = editorInput.value.trim() || (type === 'node' ? target.id : '');
      editorInput.classList.add('hidden');
      editorInput.removeEventListener('keydown', onKey);
      editorInput.removeEventListener('blur', commit);
      render();
      ensureArrowMarker();
      onGraphChange(model);
    }
    function onKey(e2) {
      if (e2.key === 'Enter') { e2.preventDefault(); commit(); }
      if (e2.key === 'Escape') { editorInput.value = target.label; commit(); }
    }
    editorInput.addEventListener('keydown', onKey);
    editorInput.addEventListener('blur', commit, { once: true });
  }

  /* --------------------------- canvas background ------------------------ */
  svgEl.addEventListener('click', (ev) => {
    if (ev.target === svgEl) clearSelection();
  });
  svgEl.addEventListener('dblclick', (ev) => {
    if (ev.target !== svgEl) return;
    const p = svgPoint(ev.clientX, ev.clientY);
    addNodeAt(p.x, p.y);
  });

  /* --------------------------------- API --------------------------------- */
  function addNodeAt(x, y) {
    const id = 'N' + (seq++);
    model.nodes.push({ id, label: id, shape: 'rect', x, y });
    onGraphChange(model);
    openLabelEditor('node', id); // invite an immediate rename, not just a bare "N1"
    return id;
  }

  function deleteSelected() {
    if (!selection) return;
    if (selection.type === 'node') {
      model.nodes = model.nodes.filter((n) => n.id !== selection.id);
      model.edges = model.edges.filter((e) => e.from !== selection.id && e.to !== selection.id);
    } else {
      model.edges = model.edges.filter((e) => e.id !== selection.id);
    }
    clearSelection();
    onGraphChange(model);
  }

  function setSelectedShape(shape) {
    if (!selection || selection.type !== 'node') return;
    findNode(selection.id).shape = shape;
    render();
    ensureArrowMarker();
    onGraphChange(model);
  }

  function setSelectedArrowKind(kind) {
    if (!selection || selection.type !== 'edge') return;
    const e = model.edges.find((x) => x.id === selection.id);
    e.kind = kind;
    render();
    ensureArrowMarker();
    onGraphChange(model);
  }

  function setDirection(direction) {
    model.direction = direction;
    onGraphChange(model);
  }

  function loadModel(newModel) {
    model = JSON.parse(JSON.stringify(newModel));
    seq = 1 + model.nodes.reduce((m, n) => { const num = parseInt(String(n.id).replace(/\D/g, ''), 10); return isNaN(num) ? m : Math.max(m, num); }, 0);
    selection = null;
    render();
    ensureArrowMarker();
    onSelectionChange(null, null);
  }

  function getModel() { return JSON.parse(JSON.stringify(model)); }

  render();
  ensureArrowMarker();

  return { loadModel, getModel, addNodeAt, deleteSelected, setSelectedShape, setSelectedArrowKind, setDirection, clearSelection };
};
