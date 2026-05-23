// scripts/render.js
//
// DOM hydration helpers consumed by main.js. Pure where possible; the
// orchestrator (`hydrate`) mutates the document in well-defined ways:
//   - removes any section whose data array is empty
//   - writes --reveal-index on every [data-reveal-child] for CSS stagger
//   - replaces [data-year] with the current year
//   - replaces <time data-updated> with the build date
//
// The actual entry markup for each section is emitted at build
// time; render.js is responsible for hydration only.
//

/**
 * Mapping from section DOM ids to the corresponding key in the
 * `content` object exported by `scripts/data.js`. Used by `hydrate` to
 * decide which sections must be removed because their data arrays are
 * empty.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
const SECTION_KEYS = Object.freeze([
  ['neural-model-checking', 'nmcSummary'],
  ['publications', 'publications'],
  ['academic-training', 'training'],
  ['research-and-leadership', 'experience'],
  ['awards-and-scholarships', 'awards'],
  ['teaching-and-talks', 'teaching'],
  ['academic-service', 'service'],
  ['contact', 'contact'],
]);

/**
 * Mount `html` as the section identified by `sectionId` if (and only if)
 * the document does not already contain that section. Returns the
 * resulting section element, or `null` if `html` did not parse to a
 * single root element.
 *
 * Pure with respect to its inputs: when the section already exists the
 * function performs no mutation and returns the existing node.
 *
 * @param {string} sectionId
 * @param {string} html
 * @returns {Element | null}
 */
export function mountIfMissing(sectionId, html) {
  const existing = document.getElementById(sectionId);
  if (existing) return existing;
  const tmpl = document.createElement('template');
  tmpl.innerHTML = String(html ?? '');
  const node = tmpl.content.firstElementChild;
  if (!node) return null;
  const main = document.querySelector('main#main') || document.querySelector('main');
  if (main) main.appendChild(node);
  return node;
}

/**
 * Remove the section element with the given id (if any) and every nav
 * link that points at it (matched by `href="#<sectionId>"`). Both the
 * inline header nav and the dialog overlay duplicate are covered.
 *
 * Per , this runs before any IntersectionObserver is installed
 * so that observers do not bind to nodes that are about to be removed.
 *
 * @param {string} sectionId
 */
export function hideEmptySection(sectionId) {
  if (!sectionId) return;
  const section = document.getElementById(sectionId);
  if (section) section.remove();
  const navLinks = document.querySelectorAll(`a[href="#${CSS.escape(sectionId)}"]`);
  for (const a of navLinks) {
    const li = a.closest('li');
    if (li && li.parentElement) li.remove();
    else a.remove();
  }
}

/**
 * For every `[data-reveal]` ancestor inside `root`, set
 * `style.--reveal-index` on each `[data-reveal-child]` descendant in
 * source order so that the CSS stagger
 * (`transition-delay: calc(var(--reveal-index) * var(--reveal-stagger))`)
 * fires deterministically.
 *
 * @param {ParentNode} [root]
 */
export function wireRevealIndices(root) {
  const scope = root ?? document;
  const reveals = scope.querySelectorAll('[data-reveal]');
  for (const r of reveals) {
    const children = r.querySelectorAll('[data-reveal-child]');
    for (let i = 0; i < children.length; i += 1) {
      children[i].style.setProperty('--reveal-index', String(i));
    }
  }
}

/**
 * Replace the meta-token elements rendered as placeholders by the
 * static HTML scaffold:
 *
 *   - `[data-year]` → current four-digit year
 *   - `<time data-updated>` → ISO-8601 build date (the `buildDate`
 *     argument); when absent, falls back to today's date in `YYYY-MM-DD`.
 *
 * Existing non-empty `datetime` and text content are respected so the
 * static HTML can ship a sensible default for no-JS visitors.
 *
 * @param {{ year?: number, buildDate?: string }} [opts]
 */
export function replaceMetaTokens(opts) {
  const now = new Date();
  const year = (opts && Number.isFinite(opts.year)) ? opts.year : now.getFullYear();
  const buildDate =
    (opts && typeof opts.buildDate === 'string' && opts.buildDate)
    || now.toISOString().slice(0, 10);

  for (const el of document.querySelectorAll('[data-year]')) {
    el.textContent = String(year);
  }
  for (const el of document.querySelectorAll('time[data-updated]')) {
    el.setAttribute('datetime', buildDate);
    el.textContent = buildDate;
  }
}

/**
 * Determine whether a value from `data.js` should be considered empty
 * for the purposes of .
 *
 * @param {unknown} value
 * @param {string} dataKey
 * @returns {boolean}
 */
function isEmpty(value, dataKey) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if (dataKey === 'contact') {
      const emails = /** @type {{ emails?: unknown[] }} */ (value).emails;
      return !Array.isArray(emails) || emails.length === 0;
    }
    return Object.keys(value).length === 0;
  }
  return false;
}

/**
 * Boot-time hydration. Must run *before* any IntersectionObserver
 * installs so that empty sections are removed from the DOM first
 *.
 *
 *   1. Walk `SECTION_KEYS`; for any section whose corresponding data
 *      slice is empty, remove the section element and any matching nav
 *      links.
 *   2. Wire `--reveal-index` on every `[data-reveal-child]`.
 *   3. Replace meta tokens (`[data-year]`, `<time data-updated>`).
 *
 * @param {Record<string, unknown> | null | undefined} content
 *   The `content` object exported by `scripts/data.js`.
 * @param {{ buildDate?: string }} [opts]
 *   Optional meta-token overrides; `main.js` passes the build-time
 *   constant for `<time data-updated>`.
 */
export function hydrate(content, opts) {
  if (content) {
    for (const [sectionId, dataKey] of SECTION_KEYS) {
      if (isEmpty(content[dataKey], dataKey)) {
        hideEmptySection(sectionId);
      }
    }
  }
  wireRevealIndices(document);
  replaceMetaTokens(opts);
}

export { SECTION_KEYS };
