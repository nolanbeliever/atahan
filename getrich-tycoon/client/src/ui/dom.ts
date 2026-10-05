// Tiny DOM builder. Text is always set via textContent (never innerHTML) so
// player-provided strings (names, chat) cannot inject markup.

export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value' && 'value' in el) {
        (el as unknown as HTMLInputElement).value = String(v);
      } else if (k === 'checked' && 'checked' in el) {
        (el as unknown as HTMLInputElement).checked = Boolean(v);
      } else if (k === 'disabled') {
        (el as unknown as HTMLButtonElement).disabled = Boolean(v);
      } else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Insert a trusted, static SVG icon string. */
export function icon(svg: string, cls = ''): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `icon ${cls}`;
  span.style.display = 'inline-grid';
  span.innerHTML = svg; // static constant from icons.ts only
  return span;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
