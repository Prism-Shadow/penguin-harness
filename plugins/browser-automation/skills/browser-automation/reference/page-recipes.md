# Page recipes

Scripts for the situations where plain `querySelector` and `click` are not enough. Each runs with `penguin browser exec <<'EOF' … EOF` unless it says `cdp`. Adapt the selectors to what a scan of the page shows.

## Fill a field a framework controls

React, Vue and similar frameworks keep their own copy of an input's value. Setting `el.value` changes the screen but not that copy, so the form submits the old value. Use the prototype's setter, then fire the events the framework listens to:

```js
const el = document.querySelector('input[name="q"]');
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, 'usb c hub');
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return el.value;
```

When that still does not register, type for real: `penguin browser type 'usb c hub' --selector 'input[name="q"]'`.

## Choose an option

A native `<select>`:

```js
const select = document.querySelector('select#sort');
select.value = [...select.options].find((o) => o.text.includes('Newest')).value;
select.dispatchEvent(new Event('change', { bubbles: true }));
return select.value;
```

A custom dropdown (a button that opens a list) needs trusted clicks, in two calls: `penguin browser click '<the dropdown button>'`, scan to find the option that appeared, then `penguin browser click '<the option>'`.

## Wait for content that loads late

```js
const deadline = Date.now() + 10000;
while (Date.now() < deadline) {
  const rows = document.querySelectorAll('.result');
  if (rows.length > 0) return rows.length;
  await new Promise((r) => setTimeout(r, 250));
}
return 'still empty after 10s';
```

Give the exec a longer `--timeout` than the loop's own deadline.

## Load a list that grows on scroll

```js
let last = -1;
for (let i = 0; i < 20; i++) {
  const count = document.querySelectorAll('.feed-item').length;
  if (count === last) break;
  last = count;
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 800));
}
return last;
```

Then extract the items in a second exec, with `--save` when they are many.

## A table as JSON

```js
const table = document.querySelector('table');
const head = [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim());
const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
  Object.fromEntries([...tr.cells].map((td, i) => [head[i] ?? `col${i}`, td.innerText.trim()])),
);
return JSON.stringify(rows);
```

## Upload a file

A file input only accepts files from a real file picker or from `DataTransfer`. For content you have in hand:

```js
const input = document.querySelector('input[type=file]');
const file = new File(['name,qty\nhub,1\n'], 'order.csv', { type: 'text/csv' });
const transfer = new DataTransfer();
transfer.items.add(file);
input.files = transfer.files;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
return input.files.length;
```

For a file on this machine, hand its path to the input through the DevTools Protocol, in three calls one right after the other (the node ids are valid until the page changes):

```bash
penguin browser cdp DOM.getDocument --params '{"depth":1}'
penguin browser cdp DOM.querySelector --params '{"nodeId":1,"selector":"input[type=file]"}'
penguin browser cdp DOM.setFileInputFiles --params '{"nodeId":42,"files":["/home/me/report.pdf"]}'
```

Use the `root.nodeId` the first call returns and the `nodeId` the second returns. Check `input.accept` first, and when a page has several file inputs, pick by the container around them.

## Download what the page links to

A PDF that opens in the browser instead of downloading can be fetched from the page and saved through a link (same origin, or a server that allows it):

```js
const response = await fetch('https://example.com/invoice.pdf');
const url = URL.createObjectURL(await response.blob());
const a = Object.assign(document.createElement('a'), { href: url, download: 'invoice.pdf' });
a.click();
return response.status;
```

The desktop app asks the user where to save it.

## Frames and shadow roots

Same-origin iframes are part of the scan and reachable as `frame.contentDocument`. A cross-origin iframe (a payment form, an embedded widget) is not reachable from the page's JavaScript; evaluate inside it through the DevTools Protocol:

```bash
penguin browser cdp Page.getFrameTree
penguin browser cdp Page.createIsolatedWorld --params '{"frameId":"<frame id whose url matches>"}'
penguin browser cdp Runtime.evaluate --params '{"contextId":7,"expression":"document.title","returnByValue":true}'
```

An open shadow root is `host.shadowRoot`. A closed one is only visible to the protocol: `DOM.getDocument` with `{"depth":-1,"pierce":true}` walks through it, and `DOM.getBoxModel` gives the coordinates for a `click --at`.

## Images, canvases and captchas

- The largest image on a page: `return [...document.images].sort((a, b) => b.naturalWidth - a.naturalWidth)[0]?.src;`
- A canvas as an image: `return document.querySelector('canvas').toDataURL('image/png');` (with `--save`, since it is long).
- What the page looks like: `penguin browser screenshot -o page.png`, then look at the file. A captcha is for the user to solve in the Browser panel.

## Coordinates for a trusted click

`click --at x,y` takes CSS pixels in the viewport, the numbers `getBoundingClientRect()` returns:

```js
const r = document.querySelector('#target').getBoundingClientRect();
return `${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)}`;
```

Scroll the element into view first (`el.scrollIntoView({ block: 'center' })`) and measure after; `penguin browser click '<selector>'` does both itself.
