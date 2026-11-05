# Amazon orders

Find orders, list them, or read one order's details on amazon.com. Every Amazon site works the same way; only the host and the page's language differ (see [Other Amazon sites](#other-amazon-sites)). This is read-only work: never press *Buy it again*, *Cancel items*, *Return or replace* or anything else that changes an order without the user's explicit confirmation.

## 1. Open the orders page and check the sign-in

```bash
penguin browser open https://www.amazon.com/your-orders/orders
```

The header line shows where the tab ended up. A URL containing `/ap/signin` (or a page titled "Amazon Sign-In") means the browser is signed out of Amazon: follow the skill's sign-in rules. Ask the user to sign in in the Browser panel, or offer

```bash
penguin browser import --from chrome --cookies --domain amazon.com
```

then open the orders page again. Amazon may still ask for the password again ("re-authentication") on the orders page even with valid cookies; that is also for the user to do in the panel.

## 2. Narrow the list

- A period: add `timeFilter` — `last30`, `months-3`, or `year-2026` for a calendar year: `https://www.amazon.com/your-orders/orders?timeFilter=year-2026`.
- A search over the whole order history (item titles, order numbers, recipients):

  ```bash
  penguin browser open 'https://www.amazon.com/your-orders/search?search=usb%20c%20hub'
  ```

  URL-encode the query. The search box on the orders page does the same.

## 3. Read the rows in one exec

Scan once (`penguin browser scan`) to confirm the current structure, then extract every order on the page in one call. The page shows one card per order, with a header holding the order date, the total and the order number, and a link per item. Amazon changes its class names over time, so the script below reads the header by its labels rather than by class, and finds items by their product links; adjust it to what the scan shows.

```bash
penguin browser exec --no-monitor <<'EOF'
const cards = [...document.querySelectorAll('.order-card, .js-order-card')];
const after = (text, label) => {
  const m = text.match(new RegExp(label + '\\s*\\n\\s*([^\\n]+)', 'i'));
  return m ? m[1].trim() : null;
};
return JSON.stringify(cards.map((card) => {
  const text = card.innerText;
  const items = [...card.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]')]
    .map((a) => a.innerText.trim())
    .filter((title, i, all) => title && all.indexOf(title) === i);
  return {
    date: after(text, 'Order placed'),
    total: after(text, 'Total'),
    order: (text.match(/Order\s*#\s*([\d-]{10,})/i) || [])[1] ?? null,
    items,
  };
}));
EOF
```

`innerText` follows the page's styling, so the labels may arrive in capitals ("ORDER PLACED"); the match ignores case. A `null` field means the label was not found: scan that card and fix the pattern instead of guessing the value.

## 4. Page through

Ten orders show per page. The *Next* link is the last item of the pagination bar:

```bash
penguin browser exec --no-monitor <<'EOF'
return document.querySelector('.a-pagination .a-last a')?.href ?? null;
EOF
```

`null` means this is the last page. Otherwise open the returned URL (a separate call — never read the next page in the script that navigates to it) and run the extraction again. The pages differ only in their `startIndex` parameter (0, 10, 20, …), which you can also set directly.

## 5. Check one order

For the exact items, prices, payment and delivery of one order, open its detail page and read it there rather than trusting the list:

```bash
penguin browser open 'https://www.amazon.com/gp/your-account/order-details?orderID=112-1234567-1234567'
penguin browser scan --text
```

## Other Amazon sites

amazon.co.uk, amazon.de, amazon.co.jp, amazon.cn and the others have the same pages under their own host: `https://www.amazon.de/your-orders/orders`, `https://www.amazon.co.jp/your-orders/orders`, and so on (the older `/gp/css/order-history` path still redirects there). An account belongs to one site, so import cookies for that host (`--domain amazon.de`). The page is in the site's language, so the labels in the extraction script change too — "Bestellung aufgegeben" and "Summe" on amazon.de, for example, and their Japanese and Chinese counterparts on amazon.co.jp and amazon.cn. Scan once and use the labels the page actually shows.
