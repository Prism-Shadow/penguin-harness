/** Shared dictionary contract for supported translations. */
export type Strings = {
  siteName: string;
  announcement: {
    label: string;
    prev: string;
    next: string;
    flashModels: string;
    penguinGo: string;
  };
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
  hero: {
    platformLead: string;
    platformActions: string[];
    platformTail: string;
    automationLead: string;
    automationActions: string[];
    automationTail: string;
    downloadCta: string;
    cliInstall: string;
    stats: { value: string; label: string }[];
    supportedModelsLabel: string;
    supportedModels: string[];
    supportedModelsMore: string;
  };
  install: {
    linux: string;
    macos: string;
    windows: string;
    online: string;
    offline: string;
    offlineNote: string;
    offlineHints: { linux: string; macos: string; windows: string };
    offlineRelease: string;
    desktopNote: string;
    desktopPage: string;
  };
  download: {
    eyebrow: string;
    title: string;
    recommended: string;
    platforms: {
      mac: { name: string; require: string };
      windows: { name: string; require: string };
      linux: { name: string; require: string };
    };
    speed: {
      title: string;
      subtitle: string;
      github: string;
      githubHint: string;
      oss: string;
      ossHint: string;
      testing: string;
      skipped: string;
      unreachable: string;
      belowFloor: string;
      selected: string;
      automatic: string;
      manual: string;
    };
    statusProbing: string;
    statusRefining: string;
    statusOss: (version: string) => string;
    statusGithub: string;
    altGithub: string;
    altOss: string;
    checksums: string;
    allReleases: string;
    faq: { title: string; intro: string; linux: { question: string; answer: string } };
    cliHint: string;
    cliHintLink: string;
  };
  copy: { copy: string; copied: string };
  pillars: {
    eyebrow: string;
    title: string;
    subtitle: string;
    root: string;
    concepts: string[];
    diagramLabel: string;
    items: { title: string; tag: string; desc: string }[];
  };
  compare: {
    eyebrow: string;
    title: string;
    subtitle: string[];
    langchain: { name: string; speed: string; mode: string; note: string };
    penguin: { name: string; speed: string; mode: string; note: string };
  };
  selfImprove: {
    eyebrow: string;
    title: string;
    subtitle: string;
    videoLabel: string;
    videoCaption: string;
    nodeOptimizer: string;
    nodeEvaluator: string;
    nodeTarget: string;
    badgeOld: string;
    badgeNew: string;
    edgeSpawn: string;
    edgeBench: string;
    edgeFeedback: string;
    edgeImprove: string;
    trends: { label: string; hint: string }[];
    diagramLabel: string;
  };
  quickstart: {
    eyebrow: string;
    title: string;
    subtitle: string;
    stepOne: string;
    chooseInstall: string;
    stepTwo: string;
    chooseLaunch: string;
    tabs: { desktop: string; install: string; web: string; cli: string };
    desktop: { title: string; desc: string; cta: string; steps: string[] };
    install: {
      title: string;
      desc: string;
      osLabel: string;
      onlineTitle: string;
      offlineTitle: string;
      offlineDesc: string;
      offlineCommand: string;
    };
    web: { title: string; desc: string; command: string; steps: string[] };
    cli: { title: string; desc: string; command: string };
    localNote: string;
  };
  cases: {
    eyebrow: string;
    title: string;
    subtitle: string;
    tabs: { label: string; prompt: string; caption: string; cost: string }[];
  };
  scenarios: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: { title: string; alt: string; body: string }[];
  };
  contract: {
    eyebrow: string;
    title: string;
    subtitle: string;
    intro: string;
    items: { term: string; text: string }[];
    outro: string;
  };
  benchmark: {
    eyebrow: string;
    title: string;
    subtitle: string;
    higherBetter: string;
    lowerBetter: string;
    dimScore: string;
    dimTokens: string;
    dimCost: string;
    dataTitle: string;
    dataDesc: string;
    dataFootnote: string;
    codeTitle: string;
    codeDesc: string;
    codeFootnote: string;
    colFramework: string;
    colModel: string;
    colAccuracy: string;
    colTokens: string;
    colCost: string;
  };
  features: {
    eyebrow: string;
    title: string;
    subtitle: string;
    more: string;
    items: { title: string; desc: string }[];
  };
  skills: {
    eyebrow: string;
    title: string;
    subtitle: string;
    groups: { title: string; skills: string[] }[];
  };
  security: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: { title: string; desc: string }[];
  };
  community: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: {
      discord: { name: string; desc: string };
      x: { name: string; desc: string };
      wechat: { name: string; desc: string };
      github: { name: string; desc: string };
    };
  };
  cta: { title: string; subtitle: string; download: string; quickstart: string; docs: string };
  footer: {
    tagline: string;
    product: string;
    resources: string;
    quickstart: string;
    features: string;
    selfImprove: string;
    cases: string;
    blog: string;
    repo: string;
    docs: string;
    releases: string;
    license: string;
    copyright: string;
  };
  blog: {
    title: string;
    subtitle: string;
    all: string;
    news: string;
    practice: string;
    perspectives: string;
    changelog: string;
    pinned: string;
    copyLink: string;
    linkCopied: string;
    back: string;
    empty: string;
    notFound: string;
    backHome: string;
    toc: string;
  };
};
