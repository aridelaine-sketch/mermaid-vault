'use strict';
/**
 * FlowGraph: bidirectional conversion between a simple node/edge graph
 * model and Mermaid flowchart syntax.
 *
 *   FlowGraph.parse(code)     -> { ok, model, error, unsupportedLines }
 *   FlowGraph.generate(model) -> mermaid source (string)
 *   FlowGraph.autoLayout(model, direction) -> model with x/y filled in
 *
 * Scope, deliberately: flowchart/graph diagrams only, 8 node shapes, 6 edge
 * kinds, `-->|label|` style edge labels. Subgraphs, styling (classDef/
 * style/click), and the newer `@{ shape: ... }` syntax are NOT understood —
 * parse() reports that plainly via `ok:false` rather than silently
 * dropping them, so the caller can fall back to text-only editing instead
 * of destroying content it doesn't recognize.
 */
(function (root) {
  const SHAPES = [
    { key: 'subroutine', open: '[[', close: ']]', label: 'Subroutine' },
    { key: 'stadium', open: '([', close: '])', label: 'Stadium' },
    { key: 'cylinder', open: '[(', close: ')]', label: 'Cylinder' },
    { key: 'circle', open: '((', close: '))', label: 'Circle' },
    { key: 'hexagon', open: '{{', close: '}}', label: 'Hexagon' },
    { key: 'rect', open: '[', close: ']', label: 'Rectangle' },
    { key: 'round', open: '(', close: ')', label: 'Rounded' },
    { key: 'rhombus', open: '{', close: '}', label: 'Rhombus' }
  ];
  const SHAPE_BY_KEY = Object.fromEntries(SHAPES.map((s) => [s.key, s]));

  // Ordered longest/most-specific token first (e.g. '-.->' before '-.-')
  // so a fixed-order scan never mis-splits a longer token.
  const ARROWS = [
    { key: 'dottedArrow', token: '-.->' },
    { key: 'dotted', token: '-.-' },
    { key: 'thickArrow', token: '==>' },
    { key: 'thick', token: '===' },
    { key: 'arrow', token: '-->' },
    { key: 'line', token: '---' }
  ];
  const ARROW_BY_KEY = Object.fromEntries(ARROWS.map((a) => [a.key, a]));

  // Same ordering rule as SHAPES: compound brackets before the single-char
  // ones that share a prefix, or `[[Foo]]` would be misread as rect `[...]`.
  const SHAPE_TOKEN_ALT = [
    '\\[\\[.+?\\]\\]', '\\(\\[.+?\\]\\)', '\\[\\(.+?\\)\\]', '\\(\\(.+?\\)\\)',
    '\\{\\{.+?\\}\\}', '\\[.+?\\]', '\\(.+?\\)', '\\{.+?\\}'
  ].join('|');
  const ARROW_TOKEN_ALT = ARROWS.map((a) => a.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const ID_RE = '[A-Za-z0-9_\\-]+';

  const EDGE_RE = new RegExp(
    `^\\s*(${ID_RE})(${SHAPE_TOKEN_ALT})?\\s*(${ARROW_TOKEN_ALT})\\s*(?:\\|(.*?)\\|)?\\s*(${ID_RE})(${SHAPE_TOKEN_ALT})?\\s*$`
  );
  const NODE_RE = new RegExp(`^\\s*(${ID_RE})(${SHAPE_TOKEN_ALT})?\\s*$`);
  const DIRECTION_RE = /^\s*(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i;

  function parseShapeToken(tok) {
    if (!tok) return null;
    for (const def of SHAPES) {
      if (tok.length >= def.open.length + def.close.length && tok.startsWith(def.open) && tok.endsWith(def.close)) {
        return { shape: def.key, label: tok.slice(def.open.length, tok.length - def.close.length) };
      }
    }
    return null;
  }

  function isBlankOrComment(line) {
    const t = line.trim();
    return t === '' || t.startsWith('%%');
  }

  // Lines using constructs we don't model. Anything here means parse()
  // returns ok:false rather than quietly losing information.
  const UNSUPPORTED_LINE_RE = /^\s*(subgraph|end\b|classDef|class\s|style\s|click\s|linkStyle|%%\{)/i;

  const OTHER_DIAGRAM_RE = /^\s*(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|quadrantChart|timeline|sankey|requirementDiagram|C4Context)\b/i;

  function parse(code) {
    const lines = (code || '').split('\n');
    let direction = 'TD';
    const nodes = new Map(); // id -> { id, label, shape }
    const edges = [];
    const order = []; // node ids in first-seen order, for stable layout
    let edgeCounter = 0;

    const ensureNode = (id, shapeInfo) => {
      if (!nodes.has(id)) {
        nodes.set(id, { id, label: shapeInfo ? shapeInfo.label : id, shape: shapeInfo ? shapeInfo.shape : 'rect' });
        order.push(id);
      } else if (shapeInfo) {
        const n = nodes.get(id);
        n.label = shapeInfo.label;
        n.shape = shapeInfo.shape;
      }
    };

    let sawAnyContentLine = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (isBlankOrComment(raw)) continue;

      if (!sawAnyContentLine) {
        const otherMatch = raw.match(OTHER_DIAGRAM_RE);
        if (otherMatch) {
          return { ok: false, error: `Visual editing currently supports flowcharts only \u2014 this is a ${otherMatch[1]} diagram.`, model: null };
        }
      }

      if (i === 0 || (!sawAnyContentLine && DIRECTION_RE.test(raw))) {
        const m = raw.match(DIRECTION_RE);
        if (m) { direction = m[2].toUpperCase(); if (direction === 'TB') direction = 'TD'; continue; }
      }

      if (UNSUPPORTED_LINE_RE.test(raw)) {
        return { ok: false, error: 'This diagram uses subgraphs, styling, or click bindings that the visual editor doesn\u2019t support yet.', model: null };
      }

      const edgeMatch = raw.match(EDGE_RE);
      if (edgeMatch) {
        sawAnyContentLine = true;
        const [, fromId, fromShapeTok, arrowToken, label, toId, toShapeTok] = edgeMatch;
        const arrowDef = ARROWS.find((a) => a.token === arrowToken);
        ensureNode(fromId, parseShapeToken(fromShapeTok));
        ensureNode(toId, parseShapeToken(toShapeTok));
        edges.push({ id: 'e' + (edgeCounter++), from: fromId, to: toId, label: label || '', kind: arrowDef ? arrowDef.key : 'arrow' });
        continue;
      }

      const nodeMatch = raw.match(NODE_RE);
      if (nodeMatch) {
        sawAnyContentLine = true;
        const [, id, shapeTok] = nodeMatch;
        ensureNode(id, parseShapeToken(shapeTok));
        continue;
      }

      return { ok: false, error: 'This diagram has a line the visual editor doesn\u2019t understand:\n' + raw.trim(), model: null };
    }

    if (!sawAnyContentLine) {
      return { ok: true, model: { direction, nodes: [], edges: [] } };
    }

    return {
      ok: true,
      model: { direction, nodes: order.map((id) => nodes.get(id)), edges }
    };
  }

  function shapeToken(shapeKey, label) {
    const def = SHAPE_BY_KEY[shapeKey] || SHAPE_BY_KEY.rect;
    return def.open + label + def.close;
  }

  function generate(model) {
    const direction = model.direction || 'TD';
    const lines = ['flowchart ' + direction];
    const declared = new Set();

    // Declare every node once (even isolated ones with no edges), so
    // shape + label always survive the round trip.
    for (const n of model.nodes) {
      lines.push('    ' + n.id + shapeToken(n.shape, n.label));
      declared.add(n.id);
    }
    for (const e of model.edges) {
      const arrowDef = ARROW_BY_KEY[e.kind] || ARROW_BY_KEY.arrow;
      const labelPart = e.label ? `|${e.label}|` : '';
      lines.push(`    ${e.from} ${arrowDef.token}${labelPart} ${e.to}`);
    }
    return lines.join('\n') + '\n';
  }

  function computeRanks(nodes, edges) {
    const ids = nodes.map((n) => n.id);
    const indeg = new Map(ids.map((id) => [id, 0]));
    const adj = new Map(ids.map((id) => [id, []]));
    for (const e of edges) {
      if (adj.has(e.from)) adj.get(e.from).push(e.to);
      if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1);
    }

    // Plain BFS distance-from-root layering. This tolerates cycles for
    // free (a visited node is simply never re-enqueued, so a back-edge
    // like a validation "retry" loop just renders pointing to an earlier
    // rank instead of stalling the whole layout) — unlike a Kahn's-
    // algorithm approach, which can never make progress at all when every
    // node has indegree > 0, exactly the case for a flowchart with a
    // decision-and-retry loop.
    const rank = new Map();
    const queue = [];
    const seed = (id) => { if (!rank.has(id)) { rank.set(id, 0); queue.push(id); } };

    const roots = ids.filter((id) => indeg.get(id) === 0);
    (roots.length ? roots : ids.slice(0, 1)).forEach(seed);

    let qi = 0;
    while (qi < queue.length) {
      const id = queue[qi++];
      const base = rank.get(id);
      for (const nxt of adj.get(id) || []) {
        if (!rank.has(nxt)) { rank.set(nxt, base + 1); queue.push(nxt); }
      }
      // Every node that's still unranked once the current frontier is
      // exhausted belongs to a separate disconnected piece (including an
      // isolated cycle with no natural root) — seed one more root for it.
      if (qi === queue.length) {
        const next = ids.find((id2) => !rank.has(id2));
        if (next) seed(next);
      }
    }
    return rank;
  }

  function autoLayout(model, direction) {
    const dir = direction || model.direction || 'TD';
    const rank = computeRanks(model.nodes, model.edges);
    const byRank = new Map();
    for (const n of model.nodes) {
      const r = rank.get(n.id) || 0;
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(n.id);
    }
    const maxRank = Math.max(0, ...Array.from(byRank.keys()));
    const NODE_GAP = 110, RANK_GAP = 160, MARGIN = 70;

    const pos = new Map();
    for (const [r, ids] of byRank.entries()) {
      const effRank = (dir === 'BT' || dir === 'RL') ? maxRank - r : r;
      ids.forEach((id, i) => {
        const along = MARGIN + i * NODE_GAP;
        const cross = MARGIN + effRank * RANK_GAP;
        if (dir === 'LR' || dir === 'RL') pos.set(id, { x: cross, y: along });
        else pos.set(id, { x: along, y: cross });
      });
    }
    return {
      direction: model.direction,
      nodes: model.nodes.map((n) => ({ ...n, ...(pos.get(n.id) || { x: MARGIN, y: MARGIN }) })),
      edges: model.edges
    };
  }

  const FlowGraph = { parse, generate, autoLayout, SHAPES, ARROWS, parseShapeToken };

  root.FlowGraph = FlowGraph;
  if (typeof module !== 'undefined' && module.exports) module.exports = FlowGraph;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
