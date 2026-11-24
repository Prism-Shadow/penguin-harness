export function appUrl(id, path = location.pathname) {
  const match = path.match(
    /^(.*?)\/(?:server\/([^/]+)\/)?api\/projects\/([^/]+)\/agents\/([^/]+)\/workbenches\/[^/]+\/ui\//,
  );
  if (!match) return null;
  return (
    match[1] +
    "/app/" +
    match[3] +
    "/" +
    match[4] +
    "/" +
    encodeURIComponent(id) +
    (match[2] ? "?machine=" + match[2] : "")
  );
}
