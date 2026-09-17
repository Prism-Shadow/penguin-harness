---
title: Cost Center
description: Track Token usage, cost, and server errors by agent, model, and time range.
---

The Cost Center shows how many Tokens your agents use, what those requests cost, and which requests failed. To open it, select **Cost Center** in the sidebar. The page, headed **Costs & usage**, lives at `/usage`.

- To narrow what the page shows, see [Filter by agent, model, and time range](#filter-by-agent-model-and-time-range).
- For totals, see [Read the summary cards](#read-the-summary-cards).
- For trends over time, see [Read the charts](#read-the-charts) and [Gaps in the charts](#gaps-in-the-charts).
- For failed requests, see [Review and clear server errors](#review-and-clear-server-errors).

## Filter by agent, model, and time range

At the top of the page, choose an agent (**All agents** by default), a model (**All models** by default), and a date range: **Last hour**, **Last 24 hours**, **Last 7 days** (the default), **Last 30 days**, **Last 90 days**, or **Custom**, which adds a start and an end date.

The range also sets the chart precision, so there is no separate precision control:

| Date range | Chart precision |
| --- | --- |
| Last hour | Per minute |
| Last 24 hours | Hourly |
| Last 7, 30 or 90 days | Daily |
| Custom | Daily up to 92 days, weekly up to 190 days, monthly beyond that |

The same range and agent filter decide which rows the server error panel lists, and which rows its **Clear** deletes.

## Read the summary cards

Three cards show totals: **Today**, **Last 7 days**, and **Total** for the selected date range. All three follow the agent and model filters. Each card lists the Tokens, the number of requests and the cost.

Prices are shown in the display currency you choose under [System settings › General](/settings#general). Only models with configured pricing count toward cost. When some records have no price, an asterisk appears beside **Cost** and a note at the bottom of the page says so.

## Read the charts

Four charts show the selected range as time series:

| Chart | What it draws |
| --- | --- |
| **Requests & success rate by agent** | Each bucket's requests as one stacked bar, a segment per agent, on the left axis. Each agent's success rate is its own dashed line on a right-hand 0–100% axis, drawn above the bars. |
| **Requests & success rate by model** | The same, per model. |
| **Token trend** | Three-segment stacked bars, with a dashed cache-hit-rate line in front. |
| **Cost trend** | A line with points over a filled area. |

The two requests charts name the four busiest agents or models. The rest fold into one neutral series whose label says how many it holds, such as "Other (3)"; a single leftover keeps its own name.

Every chart responds to the pointer the same way:

- Hover a column to see that bucket's figures in a bubble.
- Hover one bar segment to single it out.
- Hover a line to single that line out.
- In a requests chart, hover an agent or model in the legend to highlight its bars and line together.

## Gaps in the charts

A dash in the hover table means there is no rate for that bucket: no requests, every request aborted, or no cache traffic. A bucket in which nothing at all was recorded is left out of every chart, and a break mark shows the skip.

## Review and clear server errors

The **Errors** panel at the bottom of the page shows the errors the server recorded:

- Summary figures: **Total**, **Unexpected**, **Expected** and the **Most common** error code.
- A table of errors with their time, **Source · code**, **Type** and **Message**. Click a message to expand its full text. The table shows 10 rows a page and pages with **Newer** and **Older** instead of scrolling.

The model filter does not apply to this panel.

When unexpected errors were recorded in the last 7 days, a dot marks **Cost Center** in the sidebar and a notice under the page title counts them. Select **Mark as read** to dismiss both; they come back only when a newer error arrives.

### Clear error records

**Before you begin:** only a Project owner can clear errors.

1. Set the date range and the agent filter to the rows you want to delete.
2. In the **Errors** panel, select **Clear**. It appears only when the panel lists errors and, for a custom range, both dates are set.
3. Check the confirmation. It names a preset range the way the picker does, such as "in the last 7 days", and a custom range by its dates.
4. Confirm. The deletion cannot be undone.

When an admin clears errors, the deletion also removes the unattributed error rows that only admins can see.
