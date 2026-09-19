/** Shared dictionary contract for supported translations. */
export type Strings = {
  siteName: string;
  nav: {
    highlights: string;
    selfImprove: string;
    quickstart: string;
    cases: string;
    scenarios: string;
    benchmark: string;
    contract: string;
    features: string;
    blog: string;
    download: string;
    docs: string;
    github: string;
    openMenu: string;
    closeMenu: string;
  };
  theme: { label: string; light: string; dark: string; system: string };
  lang: { label: string; en: string; system: string };
  sections: Record<string, string>;
  doc: {
    toc: string;
    copyMarkdown: string;
    copied: string;
    prev: string;
    next: string;
    notFound: string;
    backHome: string;
  };
  search: {
    open: string;
    label: string;
    placeholder: string;
    start: string;
    noResults: string;
    noResultsHint: string;
    results: string;
    close: string;
    keyboardHint: string;
  };
  footer: { repo: string; license: string; site: string; copyright: string };
};
