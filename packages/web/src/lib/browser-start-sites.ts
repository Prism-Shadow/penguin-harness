export const START_PAGE_SITES = [
  { id: "google", url: "https://www.google.com/", monogram: "G" },
  { id: "bing", url: "https://www.bing.com/", monogram: "b" },
  { id: "baidu", url: "https://www.baidu.com/", monogram: "du" },
  { id: "github", url: "https://github.com/", monogram: "GH" },
  { id: "stackoverflow", url: "https://stackoverflow.com/", monogram: "SO" },
  { id: "wikipedia", url: "https://www.wikipedia.org/", monogram: "W" },
] as const;

export type StartPageSiteId = (typeof START_PAGE_SITES)[number]["id"];
