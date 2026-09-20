import DOMPurify from '/vendor/purify.es.mjs';

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['data-nav', 'data-params', 'data-action', 'data-base', 'data-subdir', 'data-filename', 'data-tag'],
  });
}

export function setSafeHtml(element, html) {
  element.innerHTML = sanitizeHtml(html);
}

export function setSafeOuterHtml(element, html) {
  element.outerHTML = sanitizeHtml(html);
}
