'use client';

export default function BackToTop() {
  return (
    <button
      className="back-to-top"
      onClick={() => {
        const header = document.querySelector('.doc-header') || document.querySelector('.tag-viewer-header');
        if (header) {
          header.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }}
      title="回到顶部"
      aria-label="回到顶部"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}
