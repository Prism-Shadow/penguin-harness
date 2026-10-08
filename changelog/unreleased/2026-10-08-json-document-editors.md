# Configuration Data, Module Definition and Assessment Data use Loom's JSON editor

- **Date:** 2026-10-08
- **Type:** feat
- **Scope:** `web`, `activities`

Configuration Data and Module Definition are now the same full-height JSON editor as Activity Spec, titled as Loom titles them ("Configuration Data - *title* - *product* [*ref*]", "Module Definition - …") and saved with **Save Configuration Data** and **Save Definition**. They have JSON colours, folding, search and the **Diff** toolbar: counts with regions, previous and next, side by side or inline, **Revert all** and the minimap. **Discard edit** and the section's help sit in the header. Where the document comes from, whether it is edited here, and whether it is out of date are shown under it.

Assessment Data keeps its items editor and **Generate assessment**. Its **Edit as JSON** fold now opens the same editor, saved with **Save Assessment**.

Text that is not a JSON object can no longer be saved in any of them. Before, Save was pressed and then refused. Now the button stays off and the editor says why.
