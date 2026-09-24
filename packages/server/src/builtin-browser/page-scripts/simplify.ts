// Ported from GenericAgent's simphtml.py (MIT, Copyright (c) 2025 lsdefine) — https://github.com/lsdefine/genericagent
/**
 * web_scan's page side: the simplified DOM a model reads instead of the page's raw HTML.
 *
 * These are JavaScript SOURCE STRINGS, run in the page through the driver (which wraps them in
 * an async function), never functions serialized with toString(): the bundler rewrites a
 * function's body (it injects `__name` helpers), and the page has none of them.
 *
 * - `optHTML(text_only)` and `findMainList` are GenericAgent's page JS verbatim, except that
 *   their console logging is gone (it kept a reference to every analyzed node in the page's
 *   console for the life of the page), a page with nothing visible yields nothing instead of a
 *   TypeError, optHTML leaves the tree it serialized on `optHTML.lastRoot`, and their comments
 *   and one visible string are in English. As upstream, `nodeInfo` is never filled, so the
 *   layout analysis after the copy (partition / overlay marks, dialog hoisting) returns at once;
 *   it is kept as it is, since parity with GenericAgent's output is the point.
 * - The rest ports what simphtml.py did to that output in Python — optimize_html_for_tokens,
 *   the cutlist (the main list folded to three items plus a `[FAKE ELEMENT]` hint naming the
 *   selector of the rest) and smart_truncate — onto the tree optHTML built, inside the page, so
 *   the server needs no HTML parser. Lengths are the serialized HTML's, as `len(str(tag))` was.
 */

/** GenericAgent's optHTML: the visible, main-content DOM as HTML, or as text with `text_only`. */
const OPT_HTML = String.raw`function optHTML(text_only=false) {
function createEnhancedDOMCopy() {
  const nodeInfo = new WeakMap();
  const ignoreTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'COLGROUP', 'COL', 'TEMPLATE', 'PARAM', 'SOURCE'];
  const ignoreIds = ['ljq-ind'];
  function cloneNode(sourceNode, keep=false) {
    if (sourceNode.nodeType === 8 ||
        (sourceNode.nodeType === 1 && (
          ignoreTags.includes(sourceNode.tagName) ||
          (sourceNode.id && ignoreIds.includes(sourceNode.id))
        ))) {
      return null;
    }
    if (sourceNode.nodeType === 3) return sourceNode.cloneNode(false);
    const clone = sourceNode.cloneNode(false);
    if ((sourceNode.tagName === 'INPUT' || sourceNode.tagName === 'TEXTAREA') && sourceNode.value) clone.setAttribute('value', sourceNode.value);
    if (sourceNode.tagName === 'INPUT' && (sourceNode.type === 'radio' || sourceNode.type === 'checkbox') && sourceNode.checked) clone.setAttribute('checked', '');
    else if (sourceNode.tagName === 'SELECT' && sourceNode.value) clone.setAttribute('data-selected', sourceNode.value);
    try { if (sourceNode.matches && sourceNode.matches(':-webkit-autofill')) { clone.setAttribute('data-autofilled', 'true'); if (!sourceNode.value) clone.setAttribute('value', '(protected autofill value: a trusted click in the page releases it)'); } } catch(e) {}

    const isDropdown = sourceNode.classList?.contains('dropdown-menu') ||
             /dropdown|menu/i.test(sourceNode.className) || sourceNode.getAttribute('role') === 'menu';
    const _ddItems = isDropdown ? sourceNode.querySelectorAll('a, button, [role="menuitem"], li').length : 0;
    const isSmallDropdown = _ddItems > 0 && _ddItems <= 7 && sourceNode.textContent.length < 500;

    const childNodes = [];
    for (const child of sourceNode.childNodes) {
      const childClone = cloneNode(child, keep || isSmallDropdown);
      if (childClone) childNodes.push(childClone);
    }
    if (sourceNode.tagName === 'IFRAME') {
      try {
        const iDoc = sourceNode.contentDocument || sourceNode.contentWindow?.document;
        if (iDoc && iDoc.body && iDoc.body.children.length > 0) {
          const wrapper = document.createElement('div');
          wrapper.setAttribute('data-iframe-content', sourceNode.src || '');
          for (const ch of iDoc.body.childNodes) {
            const c = cloneNode(ch, keep);
            if (c) wrapper.appendChild(c);
          }
          if (wrapper.childNodes.length) childNodes.push(wrapper);
        }
      } catch(e) {}
    }
    if (sourceNode.shadowRoot) {
      for (const shadowChild of sourceNode.shadowRoot.childNodes) {
        const shadowClone = cloneNode(shadowChild, keep);
        if (shadowClone) childNodes.push(shadowClone);
      }
    }

    const rect = sourceNode.getBoundingClientRect();
    const style = window.getComputedStyle(sourceNode);
    const area = (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) <= 0)?0:rect.width * rect.height;
    const isVisible = (rect.width > 1 && rect.height > 1 &&
                  style.display !== 'none' && style.visibility !== 'hidden' &&
                  parseFloat(style.opacity) > 0 &&
                  Math.abs(rect.left) < 5000 && Math.abs(rect.top) < 5000)
                  || isSmallDropdown;
    const zIndex = style.position !== 'static' ? (parseInt(style.zIndex) || 0) : 0;

    let info = {
          rect, area, isVisible, isSmallDropdown, zIndex,
          style: {
            display: style.display, visibility: style.visibility,
            opacity: style.opacity, position: style.position
          }};

    const nonTextChildren = childNodes.filter(child => child.nodeType !== 3);
    const hasValidChildren = nonTextChildren.length > 0;

    if (hasValidChildren) {
      const childrenInfos = nonTextChildren.map(c => nodeInfo.get(c)).filter(i => i && i.rect && i.rect.width > 0 && i.rect.height > 0);
      const bgAlpha = (() => {
        const c = style.backgroundColor;
        if (!c || c === 'transparent') return 0;
        const m = c.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
        return m ? parseFloat(m[1]) : 1;
      })();
      const hasVisualBg = bgAlpha > 0.1 || style.backgroundImage !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none') || style.boxShadow !== 'none';

      if (!hasVisualBg && childrenInfos.length > 0) {
        // Skip fixed/absolute children when computing parent's merged rect (they're out of flow)
        const flowChildren = childrenInfos.filter(cInfo => cInfo.style && cInfo.style.position !== 'fixed' && cInfo.style.position !== 'absolute');
        if (flowChildren.length > 0) {
          let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
          for (const cInfo of flowChildren) {
            minL = Math.min(minL, cInfo.rect.left);
            minT = Math.min(minT, cInfo.rect.top);
            maxR = Math.max(maxR, cInfo.rect.right);
            maxB = Math.max(maxB, cInfo.rect.bottom);
          }
          info.rect = { left: minL, top: minT, right: maxR, bottom: maxB, width: maxR - minL, height: maxB - minT };
          info.area = info.rect.width * info.rect.height;
        } else {
          const maxC = childrenInfos.filter(i => i.isVisible).sort((a, b) => b.area - a.area)[0];
          if (maxC && maxC.area > 10000 && (!isVisible || maxC.area > info.area * 5)) info = maxC;
        }
      }
    }

    if (sourceNode.nodeType === 1 && sourceNode.tagName === 'DIV') {
      if (!hasValidChildren && !sourceNode.textContent.trim()) return null;
    }
    // aria-hidden + not visible = truly hidden (e.g. mobile menus), remove even if has children
    if (sourceNode.getAttribute && sourceNode.getAttribute('aria-hidden') === 'true' && !info.isVisible) {
      return null;
    }
    if (info.isVisible || hasValidChildren || keep) {
      childNodes.forEach(child => clone.appendChild(child));
      return clone;
    }
    return null;
  }

  return {
    domCopy: cloneNode(document.body),
    getNodeInfo: node => nodeInfo.get(node),
    isVisible: node => {
      const info = nodeInfo.get(node);
      return info && info.isVisible;
    }
  };
}
const { domCopy, getNodeInfo, isVisible } = createEnhancedDOMCopy();
if (!domCopy) return ''; // nothing visible on the page (the original throws here)
if (text_only) {
  const blocks = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','LI','TR','SECTION','ARTICLE','HEADER','FOOTER','NAV','BLOCKQUOTE','PRE','HR','BR','DT','DD','FIGCAPTION','DETAILS','SUMMARY']);
  domCopy.querySelectorAll('*').forEach(el => {
    if (blocks.has(el.tagName)) el.insertAdjacentText('beforebegin', '\n');
  });
  domCopy.querySelectorAll('input:not([type=hidden]),textarea,select').forEach(el=>{
    const p=[el.tagName,el.id&&'#'+el.id,el.getAttribute('name')&&'name='+el.getAttribute('name'),el.tagName==='INPUT'&&'type='+(el.getAttribute('type')||'text'),el.getAttribute('placeholder')&&'"'+el.getAttribute('placeholder')+'"',el.getAttribute('data-autofilled')&&'autofilled',el.disabled&&'disabled',el.tagName==='SELECT'&&el.getAttribute('data-selected')&&'="'+el.getAttribute('data-selected')+'"'].filter(Boolean).join(' ');
    el.insertAdjacentText('beforebegin','\n['+p+']\n');
  });
  domCopy.querySelectorAll('button[disabled]').forEach(el=>el.insertAdjacentText('beforebegin','[DISABLED] '));
  return domCopy.textContent;
}
const viewportArea = window.innerWidth * window.innerHeight;

function analyzeNode(node, pPathType='main') {
    // Non-element nodes and leaves
    if (node.nodeType !== 1 || !node.children.length) {
      node.nodeType === 1 && (node.dataset.mark = 'K:leaf');
      return;
    }
    const pathType = (node.dataset.mark === 'K:secondary') ? 'second' : pPathType;
    const nodeInfoData = getNodeInfo(node);
    if (!nodeInfoData || !nodeInfoData.rect) return;
    const rectn = nodeInfoData.rect;
    if (rectn.width < window.innerWidth * 0.8 && rectn.height < window.innerHeight * 0.8) return node;
    if (node.tagName === 'TABLE') return;
    const children = Array.from(node.children);
    if (children.length === 1) {
      node.dataset.mark = 'K:container';
      return analyzeNode(children[0], pathType);
    }
    if (children.length > 10) return;

    // The children's geometry, largest first
    const childrenInfo = children.map(child => {
      const info = getNodeInfo(child) || { rect: {}, style: {} };
      return { node: child, rect: info.rect, style: info.style,
          area: info.area, zIndex: (info.zIndex || 0), isVisible: info.isVisible };
    });
    childrenInfo.sort((a, b) => b.area - a.area);

    // Do the children partition the parent or cover one another?
    const isOverlay = hasOverlap(childrenInfo);
    node.dataset.mark = isOverlay ? 'K:overlayParent' : 'K:partitionParent';

    if (isOverlay) handleOverlayContainer(childrenInfo, pathType);
    else handlePartitionContainer(childrenInfo, pathType);

    for (const child of children)
      if (!child.dataset.mark || child.dataset.mark[0] !== 'R') analyzeNode(child, pathType);
  }

  // A container whose children partition it
  function handlePartitionContainer(childrenInfo, pathType) {
    childrenInfo.sort((a, b) => b.area - a.area);
    const totalArea = childrenInfo.reduce((sum, item) => sum + item.area, 0);
    const hasMainElement = childrenInfo.length >= 1 &&
                          (childrenInfo[0].area / totalArea > 0.5) &&
                          (childrenInfo.length === 1 || childrenInfo[0].area > childrenInfo[1].area * 2);
    if (hasMainElement) {
      childrenInfo[0].node.dataset.mark = 'K:main';
      for (let i = 1; i < childrenInfo.length; i++) {
        const child = childrenInfo[i];
        let className = (child.node.getAttribute('class') || '').toLowerCase();
        let isSecondary = containsButton(child.node);
        if (className.includes('nav')) isSecondary = true;
        if (className.includes('breadcrumbs')) isSecondary = true;
        if (className.includes('header') && className.includes('table')) isSecondary = true;
        if (child.node.innerHTML.trim().replace(/\s+/g, '').length < 500) isSecondary = true;
        if (child.node.textContent.trim().length > 200) isSecondary = true;  // P3: keep a child with real text content
        if (child.style.visibility === 'hidden') isSecondary = false;
        if (isSecondary) child.node.dataset.mark = 'K:secondary';
        else child.node.dataset.mark = 'K:nonEssential';
      }
    } else {
      return; // relaxed: skip equalmany filtering, list truncation handles token budget
      const uniqueClassNames = new Set(childrenInfo.map(item => item.node.getAttribute('class') || '')).size;
      const highClassNameVariety = uniqueClassNames >= childrenInfo.length * 0.8;
      if (pathType !== 'main' && highClassNameVariety && childrenInfo.length > 5) {
        childrenInfo.forEach(child => child.node.dataset.mark = 'R:equalmany');
      } else {
        childrenInfo.forEach(child => child.node.dataset.mark = 'K:equal');
      }
    }
  }

  function containsButton(container) {
    const hasStandardButton = container.querySelector('button, input[type="button"], input[type="submit"], [role="button"]') !== null;
    if (hasStandardButton) return true;
    const hasClassButton = container.querySelector('[class*="-btn"], [class*="-button"], .button, .btn, [class*="btn-"]') !== null;
    return hasClassButton;
  }

  function handleOverlayContainer(childrenInfo, pathType) {
    // elementFromPoint ground truth: let the browser say what is visually on top
    const _efp = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
    if (_efp) { let _el = _efp; while (_el) { const _h = childrenInfo.find(c => c.node.id && c.node.id === _el.id); if (_h) { _h.zIndex = 9999; break; } _el = _el.parentElement; } }
    const sorted = [...childrenInfo].sort((a, b) => b.zIndex - a.zIndex);
    if (sorted.length === 0) return;

    const top = sorted[0];
    const rect = top.rect;
    const topNode = top.node;
    const isComplex = top.node.querySelectorAll('input, select, textarea, button, a, [role="button"]').length >= 1;

    const textContent = topNode.textContent?.trim() || '';
    const textLength = textContent.length;
    const hasLinks = topNode.querySelectorAll('a').length > 0;
    const isMostlyText = textLength > 7 && !hasLinks;

    const centerDiff = Math.abs((rect.left + rect.width/2) - window.innerWidth/2) / window.innerWidth;
    const minDimensionRatio = Math.min(rect.width / window.innerWidth, rect.height / window.innerHeight);
    const maxDimensionRatio = Math.max(rect.width / window.innerWidth, rect.height / window.innerHeight);
    const isNearTop = rect.top < 50;
    const isDialog = (top.node.querySelector('iframe') || top.node.querySelector('button') || top.node.querySelector('input')) && centerDiff < 0.3;

    if (isComplex && centerDiff < 0.2 &&
        ((minDimensionRatio > 0.2 && rect.width/window.innerWidth < 0.98) || minDimensionRatio > 0.95)) {
      top.node.dataset.mark = 'K:mainInteractive';
       sorted.slice(1).forEach(e => {
          if ((parseInt(e.zIndex)||0) <= (parseInt(sorted[0].zIndex)||0)) {
              e.node.dataset.mark = 'R:covered';
          } else {
              e.node.dataset.mark = 'K:noncovered';
          }
      });
    } else {
      if (isComplex && isNearTop && maxDimensionRatio > 0.4 && top.isVisible) {
        top.node.dataset.mark = 'K:topBar';
      } else if (isMostlyText || isComplex || isDialog) {
        topNode.dataset.mark = 'K:messageContent';
      } else {
        topNode.dataset.mark = 'R:floatingAd';
      }
      const rest = sorted.slice(1);
      rest.length && (!hasOverlap(rest) ? handlePartitionContainer(rest, pathType) : handleOverlayContainer(rest, pathType));
    }
  }

  function hasOverlap(items) {
    return items.some((a, i) =>
      items.slice(i+1).some(b => {
        const r1 = a.rect, r2 = b.rect;
        if (!r1.width || !r2.width || !r1.height || !r2.height) {return false;}
        const epsilon = 1;
        const x1 = r1.x !== undefined ? r1.x : r1.left;
        const y1 = r1.y !== undefined ? r1.y : r1.top;
        const x2 = r2.x !== undefined ? r2.x : r2.left;
        const y2 = r2.y !== undefined ? r2.y : r2.top;
        return !(x1 + r1.width <= x2 + epsilon || x1 >= x2 + r2.width - epsilon ||
            y1 + r1.height <= y2 + epsilon || y1 >= y2 + r2.height - epsilon
        );
      })
    );
}

// Hoist top 1-2 deep fixed dialogs to body level for overlay detection
const _fc = [...domCopy.querySelectorAll('*')].filter(el => {
  if (el.parentNode === domCopy) return false;
  const info = getNodeInfo(el);
  if (!info?.rect || info.style.position !== 'fixed') return false;
  const r = info.rect, cover = (r.width * r.height) / viewportArea;
  const cd = Math.abs((r.left + r.width/2) - window.innerWidth/2) / window.innerWidth;
  return cover > 0.15 && cover < 1.0 && cd < 0.3 && el.querySelector('button, input, a, [role="button"], iframe');
}).filter((el, _, arr) => !arr.some(o => o !== el && o.contains(el)))
  .sort((a, b) => (getNodeInfo(b).rect.width * getNodeInfo(b).rect.height) - (getNodeInfo(a).rect.width * getNodeInfo(a).rect.height))
  .slice(0, 2);
_fc.forEach(el => { el.parentNode.removeChild(el); domCopy.appendChild(el); });
const result = analyzeNode(domCopy);
domCopy.querySelectorAll('[data-mark^="R:"]').forEach(el=>el.parentNode?.removeChild(el));
let root = domCopy;
while (root.children.length === 1) {
  root = root.children[0];
}
for (let ii = 0; ii < 3; ii++) {
  root.querySelectorAll('div').forEach(div => (!div.textContent.trim() && div.children.length === 0) && div.remove());
}
root.querySelectorAll('[data-mark]').forEach(e => e.removeAttribute('data-mark'));
root.removeAttribute('data-mark');
root.querySelectorAll('iframe').forEach(f => {
  if (f.children.length) {
    const d = document.createElement('div');
    for (const a of f.attributes) d.setAttribute(a.name, a.value);
    d.setAttribute('data-tag', 'iframe');
    while (f.firstChild) d.appendChild(f.firstChild);
    f.parentNode.replaceChild(d, f);
  }
});
optHTML.lastRoot = root; // the tree itself, for the post-processing (added: see POST_PROCESS)
return root.outerHTML;
}`;

/** GenericAgent's findMainList and its helpers: the page's repeated lists, best first. */
const FIND_MAIN_LIST = String.raw`function findMainList(startElement = null) {
        const root = startElement || document.body;
        const MIN_CHILDREN = 8;
        const MAX_CONTAINERS = 20;

        // Global scan: candidate containers ranked by l1 + l2*0.1 (l2 = grandchildren, which catches tables and other nested lists)
        const candidates = [];
        const allEls = root.querySelectorAll('*');
        for (const node of allEls) {
            if (node.closest('svg')) continue;
            const l1 = node.children.length;
            if (l1 < 5) continue;
            let l2 = 0;
            for (const child of node.children) l2 += child.children.length;
            const score = l1 + l2 * 0.1;
            if (score >= MIN_CHILDREN) candidates.push({node, score});
        }
        candidates.sort((a, b) => b.score - a.score);
        const toProcess = candidates.slice(0, MAX_CONTAINERS).map(c => c.node);

        // Candidate groups per container, scored
        let allCandidates = [];
        for (const container of toProcess) {
            const topGroups = findTopGroups(container, 3);
            for (const groupInfo of topGroups) {
                const items = findMatchingElements(container, groupInfo.selector);
                if (items.length >= 5) {
                    const score = scoreContainer(container, items) + groupInfo.score;
                    if (score >= 30) {
                        allCandidates.push({ container, selector: groupInfo.selector, items, score });
                    }
                }
            }
        }

        // Best first
        allCandidates.sort((a, b) => b.score - a.score);

        // Dedupe: drop a candidate that overlaps a better one by more than half
        const kept = [];
        for (const cand of allCandidates) {
            let dominated = false;
            for (const k of kept) {
                if (k.container.contains(cand.container) || cand.container.contains(k.container)) {
                    const kSet = new Set(k.items);
                    const overlap = cand.items.filter(it => kSet.has(it)).length;
                    if (overlap > cand.items.length * 0.5) { dominated = true; break; }
                }
            }
            if (!dominated) kept.push(cand);
        }

        function describeResult(container, items, selector, score) {
            if(container&&!container.id)container.id='_ljq'+(window._lci=(window._lci||0)+1);
            const cTag = container ? container.tagName : null;
            const cId = container ? (container.id || '') : '';
            const cClass = container ? (String(container.className || '').trim()) : '';
            const result = {
                containerTag: cTag, containerId: cId, containerClass: cClass,
                itemCount: items.length,
            };
            let prefix = '';
            if (cId) prefix = '#' + CSS.escape(cId);
            if (selector) result.selector = prefix ? (prefix + ' > ' + selector) : selector;
            if (score !== undefined) result.score = score;
            if (items.length > 0) {
                result.firstItemPreview = items[0].outerHTML.substring(0, 200);
                result.itemTags = items.slice(0, 10).map(el => el.tagName + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : ''));
            }
            return result;
        }

        if (kept.length === 0) return [];

        return kept.map(c => describeResult(c.container, c.items, c.selector, c.score));
    }

    function findTopGroups(container, limit) {
        const children = Array.from(container.children).filter(c => !c.closest('svg'));
        const totalChildren = children.length;
        if (totalChildren < 3) return [];

        const minGroupSize = Math.max(3, Math.floor(totalChildren * 0.2));
        const groups = [];

        // Tag and class frequencies
        const tagFreq = {}, classFreq = {}, tagMap = {}, classMap = {};

        children.forEach(child => {
            // Tags
            const tag = child.tagName.toLowerCase();
            if (tag === "td") return;
            tagFreq[tag] = (tagFreq[tag] || 0) + 1;
            if (!tagMap[tag]) tagMap[tag] = [];
            tagMap[tag].push(child);

            // Classes
            if (child.className) {
                child.className.trim().split(/\s+/).forEach(cls => {
                    if (cls) {
                        classFreq[cls] = (classFreq[cls] || 0) + 1;
                        if (!classMap[cls]) classMap[cls] = [];
                        classMap[cls].push(child);
                    }
                });
            }
        });

        // Group score
        const scoreGroup = (selector, elements) => {
            const coverage = elements.length / totalChildren;
            let specificity = selector.startsWith('.')
            ? (0.6 + (selector.match(/\./g).length - 1) * 0.1) // class selector
            : (selector.includes('.')
               ? (0.7 + (selector.match(/\./g).length) * 0.1) // tag + class
               : 0.3); // bare tag
            return (coverage * 0.5) + (specificity * 0.5);
        };

        // Tag groups
        Object.keys(tagFreq).forEach(tag => {
            if (tag !== "div" && tagFreq[tag] >= minGroupSize) {
                groups.push({
                    selector: tag,
                    elements: tagMap[tag],
                    score: scoreGroup(tag, tagMap[tag]) - 0.5
                });
            }
        });

        // Class groups
        Object.keys(classFreq).forEach(cls => {
            if (classFreq[cls] >= minGroupSize) {
                const selector = '.' + CSS.escape(cls);
                groups.push({
                    selector,
                    elements: classMap[cls],
                    score: scoreGroup(selector, classMap[cls])
                });
            }
        });
        // Tag + class combinations
        const topTags = Object.keys(tagFreq).filter(t => tagFreq[t] >= minGroupSize).slice(0, 3);
        const topClasses = Object.keys(classFreq).filter(c => classFreq[c] >= minGroupSize).sort((a, b) => classFreq[b] - classFreq[a]).slice(0, 3);

        // Tag + class
        topTags.forEach(tag => {
            topClasses.forEach(cls => {
                const elements = children.filter(el =>
                                                 el.tagName.toLowerCase() === tag &&
                                                 el.className && el.className.split(/\s+/).includes(cls)
                                                );

                if (elements.length >= minGroupSize) {
                    const selector = tag + '.' + CSS.escape(cls);
                    groups.push({selector, elements, score: scoreGroup(selector, elements)});
                }
            });
        });

        // Two-class combinations
        for (let i = 0; i < topClasses.length; i++) {
            for (let j = i + 1; j < topClasses.length; j++) {
                const elements = children.filter(el =>
                                                 el.className && el.className.split(/\s+/).includes(topClasses[i]) && el.className.split(/\s+/).includes(topClasses[j]));

                if (elements.length >= minGroupSize) {
                    const selector = '.' + CSS.escape(topClasses[i]) + '.' + CSS.escape(topClasses[j]);
                    groups.push({selector, elements,score: scoreGroup(selector, elements)});
                }
            }
        }
        // The best N groups
        return groups.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    function findMatchingElements(container, selector) {
        try {
            return Array.from(container.querySelectorAll(selector));
        } catch (e) {
            // An invalid selector matches nothing
            return [];
        }
    }

    function scoreContainer(container, items) {
        if (!container || items.length < 3) return 0;
        // 1. Areas
        const containerRect = container.getBoundingClientRect();
        const containerArea = containerRect.width * containerRect.height;
        if (containerArea < 10000) return 0; // too small

        // The items' areas
        const itemAreas = [];
        let totalItemArea = 0;
        let visibleItems = 0;

        items.forEach(item => {
            const rect = item.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > 0) {
                totalItemArea += area;
                itemAreas.push(area);
                visibleItems++;
            }
        });
        // Too few visible items scores nothing
        if (visibleItems < 3) return 0;
        // Guard against outliers: the items cannot cover more than the container
        totalItemArea = Math.min(totalItemArea, containerArea * 0.98);
        const areaRatio = totalItemArea / containerArea;
        // 3. Scores, on continuous curves rather than steps
        // 3.2 Area ratio: up to 40, a sigmoid
        const areaScore = 40 / (1 + Math.exp(-12 * (areaRatio - 0.4)));

        // 3.3 Uniformity: up to 20, decaying with the coefficient of variation
        let uniformityScore = 0;
        if (itemAreas.length >= 3) {
            const mean = itemAreas.reduce((sum, area) => sum + area, 0) / itemAreas.length;
            const variance = itemAreas.reduce((sum, area) => sum + Math.pow(area - mean, 2), 0) / itemAreas.length;
            const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
            uniformityScore = 20 * Math.exp(-2.5 * cv);
        }

        const baseScore = Math.log2(visibleItems) * 5 + Math.floor(visibleItems / 5) * 0.25;
        const rawCountScore = Math.min(40, baseScore);
        const countScore = rawCountScore * Math.max(0.1, uniformityScore / 20);

        // 3.4 Container size: up to 15, a sigmoid
        const viewportArea = window.innerWidth * window.innerHeight;
        const containerViewportRatio = containerArea / viewportArea;
        const sizeScore = 2 * (1 - 1/(1 + Math.exp(-10 * (containerViewportRatio - 0.25))));

        let layoutScore = 0;
        if (items.length >= 3) {
            // Rows and columns from the coordinates
            const uniqueRows = new Set(items.map(item => Math.round(item.getBoundingClientRect().top / 5) * 5)).size;
            const uniqueCols = new Set(items.map(item => Math.round(item.getBoundingClientRect().left / 5) * 5)).size;
            // A single row or column scores full marks; a grid scores its quality
            if (uniqueRows === 1 || uniqueCols === 1) { layoutScore = 20;
            } else {
                const coverage = Math.min(1, items.length / (uniqueRows * uniqueCols));
                const efficiency = Math.max(0, 1 - (uniqueRows + uniqueCols) / (2 * items.length));
                layoutScore = 20 * (0.7 * coverage + 0.3 * efficiency);
            }
        }

        // Total, around 100
        const totalScore = countScore + areaScore + uniformityScore + layoutScore + sizeScore;

        return totalScore;
    }`;

/**
 * simphtml.py's Python half, in the page: optimize_html_for_tokens, the cutlist, smart_truncate
 * and get_html's two entry points (the scan, and the snapshot the change monitor diffs).
 *
 * It works on the detached clone optHTML built — the tree its `root.outerHTML` serializes, kept
 * on `optHTML.lastRoot` — rather than parsing that string again: parsing HTML (DOMParser,
 * innerHTML) is a Trusted Types sink, and a page that enforces them would refuse every scan.
 * Python's soup of `str(root)` has that root as its one top-level tag, so the tree is the soup.
 */
const POST_PROCESS = String.raw`const __PENGUIN_HINT = '[FAKE ELEMENT]';
const __PENGUIN_KEEP_ATTRS = new Set(['id', 'class', 'name', 'src', 'href', 'alt', 'value', 'type', 'placeholder',
  'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple',
  'role', 'aria-label', 'aria-expanded', 'aria-hidden', 'contenteditable',
  'title', 'for', 'action', 'method', 'target', 'colspan', 'rowspan']);

function __penguinTags(root) {
  return [root, ...root.querySelectorAll('*')];
}
// A Trusted Types page may refuse an attribute write (an <embed> src); that attribute stays.
function __penguinSet(el, name, value) {
  try { el.setAttribute(name, value); } catch (e) {}
}

// optimize_html_for_tokens
function __penguinOptimize(root) {
  for (const svg of Array.from(root.querySelectorAll('svg'))) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const a of Array.from(svg.attributes)) svg.removeAttribute(a.name);
  }
  const tags = __penguinTags(root);
  for (const tag of tags) tag.removeAttribute('style');
  for (const tag of tags) {
    const src = tag.getAttribute('src');
    if (src !== null) {
      if (src.startsWith('data:')) __penguinSet(tag, 'src', '__img__');
      else if (src.length > 30) __penguinSet(tag, 'src', '__url__');
    }
    const href = tag.getAttribute('href');
    if (href !== null && href.length > 30) __penguinSet(tag, 'href', '__link__');
    const action = tag.getAttribute('action');
    if (action !== null && action.length > 30) __penguinSet(tag, 'action', '__url__');
    for (const a of ['value', 'title', 'alt']) {
      const v = tag.getAttribute(a);
      if (v !== null && v.length > 100) __penguinSet(tag, a, v.slice(0, 50) + ' ...');
    }
    for (const attr of Array.from(tag.attributes).map((a) => a.name)) {
      if (__PENGUIN_KEEP_ATTRS.has(attr)) continue;
      if (attr.startsWith('data-v')) tag.removeAttribute(attr);
      else if (attr.startsWith('data-')) {
        if (tag.getAttribute(attr).length > 20) __penguinSet(tag, attr, '__data__');
      } else tag.removeAttribute(attr);
    }
  }
}

// optHTML hands an iframe with content over as div[data-tag=iframe]; it is an iframe again here.
// (A detached element loads nothing.) Returns the root, which is new when it was one of them.
function __penguinIframes(root) {
  let out = root;
  for (const div of __penguinTags(root).filter((el) => el.matches('div[data-tag="iframe"]'))) {
    const frame = div.ownerDocument.createElement('iframe');
    for (const a of Array.from(div.attributes)) if (a.name !== 'data-tag') frame.setAttribute(a.name, a.value);
    while (div.firstChild) frame.appendChild(div.firstChild);
    if (div === out) out = frame;
    else div.replaceWith(frame);
  }
  return out;
}

// get_html(cutlist=False): the simplified page as a tree, or null for a page with none.
function __penguinSimplified() {
  if (!document.body) return null;
  optHTML.lastRoot = null;
  optHTML(false);
  const root = optHTML.lastRoot;
  if (!root) return null;
  __penguinOptimize(root);
  return __penguinIframes(root);
}

// str(soup). A text node serializes '>' as '&gt;', which would hand the reader a selector that
// does not match ("#list &gt; li"); inside a hint it is written out, which is still valid HTML.
function __penguinSerialize(root) {
  return root.outerHTML.replace(/\[FAKE ELEMENT\][^<]*/g, (hint) => hint.replace(/&gt;/g, '>'));
}

// BeautifulSoup's get_text(" ", strip=True)
function __penguinText(el) {
  const out = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.data.trim();
    if (t) out.push(t);
  }
  return out.join(' ');
}

// BeautifulSoup's .string: the text of a tag whose only descendant chain ends in one string
function __penguinStringOf(el) {
  let node = el;
  while (node.childNodes.length === 1) {
    const only = node.firstChild;
    if (only.nodeType === 3) return only.data;
    if (only.nodeType !== 1) return null;
    node = only;
  }
  return null;
}
function __penguinIsHint(el) {
  const s = __penguinStringOf(el);
  return s !== null && s.includes(__PENGUIN_HINT);
}

// get_html's cutlist: each long main list keeps 3 items (or up to 6 that contain the
// instruction), and a hint names the selector that finds the rest.
function __penguinCutlist(root, lists, instruction) {
  for (const entry of lists) {
    const sel = entry && typeof entry === 'object' ? entry.selector : null;
    if (!sel) continue;
    let items;
    try { items = Array.from(root.querySelectorAll(sel)); } catch (e) { continue; }
    if (items.length < 5) continue;
    const total = items.reduce((n, it) => n + it.outerHTML.length, 0);
    const avg = total / items.length;
    if (avg < 200 || (avg < 700 && total < 2500)) continue;
    const hit = instruction && instruction.trim() ? items.filter((it) => __penguinText(it).includes(instruction)) : [];
    const keep = hit.length ? hit.slice(0, 6) : items.slice(0, 3);
    const removed = items.filter((it) => !keep.includes(it));
    const samples = [];
    for (const rm of removed.slice(0, 5)) {
      const t = Array.from(__penguinText(rm)).slice(0, 40).join('');
      if (t) samples.push(t);
    }
    let hint = __PENGUIN_HINT + ' ' + removed.length + ' more items hidden, selector: "' + sel + '"';
    if (samples.length) hint += ' Hidden items: ' + samples.map((t) => '"' + t + '"').join(',');
    const div = root.ownerDocument.createElement('div');
    div.textContent = hint;
    if (keep.length) keep[keep.length - 1].after(div);
    for (const it of removed) it.remove();
  }
}

// smart_truncate: bring the tree close to the budget. Pass through single children to the
// first fork; there, if the three largest children can absorb the excess they share it in
// proportion (recursing into big ones, cutting small ones), otherwise children go from the end.
// A list's [FAKE ELEMENT] hint is never cut.
function __penguinSmartTruncate(root, budget) {
  const CUT_THRESHOLD = 8000;
  const doc = root.ownerDocument;
  const cut = (ele, keep) => {
    let s = ele.outerHTML.length;
    let over = s - keep;
    if (over <= 0) return;
    const kept = Array.from(ele.querySelectorAll('*')).filter(__penguinIsHint);
    for (const p of kept) p.remove();
    s = ele.outerHTML.length;
    over = s - keep;
    if (over <= 0) { for (const p of kept) ele.appendChild(p); return; }
    const marker = ' [TRUNCATED ' + Math.floor(over / 1000) + 'k chars]';
    const inner = ele.innerHTML;
    const overhead = s - inner.length;
    const innerKeep = Math.max(keep - overhead - marker.length, 0);
    try {
      ele.innerHTML = innerKeep > 0 ? inner.slice(0, innerKeep) : '';
    } catch (e) {
      // A Trusted Types page refuses markup from a string: the element keeps its text instead.
      ele.textContent = ele.textContent.slice(0, innerKeep);
    }
    ele.appendChild(doc.createTextNode(marker));
    for (const p of kept) ele.appendChild(p);
  };
  const walk = (node, budget) => {
    const total = node.outerHTML.length;
    if (total <= budget) return;
    const kids = Array.from(node.children).filter((c) => !__penguinIsHint(c)).map((c) => [c, c.outerHTML.length]);
    if (!kids.length) return;
    const kidsTotal = kids.reduce((n, k) => n + k[1], 0);
    const remaining = Math.max(budget - (total - kidsTotal), 0);
    if (kids.length === 1) { walk(kids[0][0], remaining); return; }
    const over = kidsTotal - remaining;
    if (over <= 0) return;
    const ranked = kids.map((_, i) => i).sort((a, b) => kids[b][1] - kids[a][1]);
    let tops = ranked.slice(0, Math.min(3, ranked.length));
    let topTotal = tops.reduce((n, i) => n + kids[i][1], 0);
    if (topTotal < over) {
      let removed = 0;
      while (kids.length && removed < over) {
        const [c, l] = kids.pop();
        c.remove();
        removed += l;
      }
      return;
    }
    const maxSize = kids[ranked[0]][1];
    const filtered = tops.filter((i) => kids[i][1] >= maxSize * 0.1);
    const filteredTotal = filtered.reduce((n, i) => n + kids[i][1], 0);
    if (filteredTotal >= over) { tops = filtered; topTotal = filteredTotal; }
    const actions = tops.map((i) => [kids[i][0], kids[i][1] - Math.floor(over * kids[i][1] / topTotal)]);
    for (const [c, keep] of actions) {
      if (keep <= 0) c.remove();
      else if (keep > CUT_THRESHOLD) walk(c, keep);
      else cut(c, keep);
    }
  };
  walk(root, budget);
}

// web_scan: get_html(cutlist=True, maxchars) or its text form, which keeps the head and the
// tail of an over-long text around an omission marker.
function __penguinScan(opts) {
  if (!document.body) return { content: '', truncated: false };
  if (opts.textOnly) {
    let page = optHTML(true);
    page = page.replace(/ {2,}/g, ' ').replace(/^ +/gm, '').replace(/(\n\s*){3,}/g, '\n\n').trim();
    const max = opts.maxChars;
    const omit = '\n\n[omitted long content]\n\n';
    if (page.length < max + omit.length * 2) return { content: page, truncated: false };
    return { content: page.slice(0, Math.floor(max / 2)) + omit + page.slice(Math.floor(-max / 2)), truncated: true };
  }
  let lists = [];
  try { lists = findMainList(document.body) || []; } catch (e) { lists = []; }
  const root = __penguinSimplified();
  if (!root) return { content: '', truncated: false };
  if (Array.isArray(lists) && lists.length) __penguinCutlist(root, lists, opts.instruction || '');
  let content = __penguinSerialize(root);
  let truncated = false;
  if (content.length > opts.maxChars) {
    __penguinSmartTruncate(root, opts.maxChars);
    content = __penguinSerialize(root);
    truncated = true;
  }
  // smart_truncate cannot shorten one element whose bulk is its own text; no page reaches the
  // reader at more than twice the budget.
  if (content.length > opts.maxChars * 2) content = content.slice(0, opts.maxChars) + ' [TRUNCATED]';
  return { content, truncated };
}`;

/** Everything above, for a script to define before it calls into it. */
export const SIMPLIFY_LIBRARY = [OPT_HTML, FIND_MAIN_LIST, POST_PROCESS].join("\n");

export interface ScanScriptOptions {
  textOnly: boolean;
  /** The content budget in characters (the text form's too). */
  maxChars: number;
  /** List items that contain this text are the ones kept when a list is folded. */
  instruction?: string;
}

/** The scan: resolves `{ content, truncated }`. */
export function scanScript(opts: ScanScriptOptions): string {
  const args = {
    textOnly: opts.textOnly,
    maxChars: opts.maxChars,
    instruction: opts.instruction ?? "",
  };
  return `${SIMPLIFY_LIBRARY}\nreturn __penguinScan(${JSON.stringify(args)});`;
}
