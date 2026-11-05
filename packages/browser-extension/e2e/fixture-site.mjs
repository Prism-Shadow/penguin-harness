// The e2e's target site: an order list shaped like a shop's (rows, a search box, "Buy it again"
// buttons that tell a trusted click from a scripted one, a link that opens a new tab).
// Adapted from the built-in browser's e2e fixture.
import http from "node:http";

const ORDERS = Array.from({ length: 24 }, (_, i) => ({
  id: `114-${String(3021000 + i * 137).padStart(7, "0")}-${String(8800 + i).padStart(7, "0")}`,
  date: new Date(Date.UTC(2026, 8, 20 - i)).toISOString().slice(0, 10),
  total: `$${(19.99 + i * 7.35).toFixed(2)}`,
  item: ["USB-C cable", "Desk lamp", "Coffee beans", "Notebook", "Headphones", "Water bottle"][
    i % 6
  ],
}));

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<link rel="icon" href="data:,">
<style>body{font-family:sans-serif;margin:24px;color:#222}.order-row{border:1px solid #ddd;border-radius:6px;padding:8px 12px;margin:6px 0}
.toast{position:fixed;right:16px;bottom:16px;background:#333;color:#fff;padding:8px 14px;border-radius:6px}
nav a{margin-right:12px}</style></head><body>${body}</body></html>`;
}

function ordersPage(url) {
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const matching = ORDERS.filter((o) => q === "" || o.item.toLowerCase().includes(q));
  const rows = matching
    .slice(0, 10)
    .map(
      (o) => `<div class="order-row" data-order-id="${o.id}">
  <span class="order-date">${o.date}</span> · <span class="order-total">${o.total}</span> ·
  Order # <span class="order-id">${o.id}</span>
  <div class="item-title">${o.item}</div>
  <button class="buy-again" type="button">Buy it again</button>
</div>`,
    )
    .join("\n");
  return page(
    q ? `Your Orders: ${q}` : "Your Orders",
    `<nav><a href="/orders">Your Orders</a><a id="help" href="/help" target="_blank">Help (new tab)</a></nav>
<h1>Your Orders</h1>
<form id="search-form" action="/orders" method="get">
  <input id="q" name="q" placeholder="Search all orders" value="${q}">
  <button id="search" type="submit">Search Orders</button>
</form>
<p id="count">${matching.length} orders placed</p>
<div id="orders">${rows}</div>
<script>
document.querySelectorAll('.buy-again').forEach((b) => b.addEventListener('click', (e) => {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = 'Added to cart: ' + e.target.closest('.order-row').querySelector('.item-title').textContent + (e.isTrusted ? ' (trusted click)' : ' (script click)');
  document.body.appendChild(t);
}));
</script>`,
  );
}

/** Starts the site on 127.0.0.1 (port 0: any free one). */
export function startFixtureSite(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader("content-type", "text/html; charset=utf-8");
    switch (url.pathname) {
      case "/":
      case "/orders":
        return res.end(ordersPage(url));
      case "/help":
        return res.end(page("Help center", `<h1>Help center</h1><p>Opened in a new tab.</p>`));
      default:
        res.statusCode = 404;
        return res.end(page("Not found", "<h1>404</h1>"));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address();
      resolve({ origin: `http://127.0.0.1:${bound}`, close: () => server.close() });
    });
  });
}
