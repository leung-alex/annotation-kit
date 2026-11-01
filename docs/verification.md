# Verification and screenshot environments

All screenshots here were captured on Windows from the extracted examples using committed synthetic fixtures. They are running interfaces, not image-generated mockups or screenshots from the old Aione implementation.

| Scenario | Evidence | Host |
| --- | --- | --- |
| Web element and comment | [React](screenshots/web-react.png), [DSH](screenshots/web-dsh.png) | React DOM host / Electron guest |
| Text, code, Markdown | [Text](screenshots/text-react.png), [Code](screenshots/code-dsh.png), [Markdown](screenshots/markdown-dsh.png) | React / DSH retained viewers |
| PDF, Word, PowerPoint | [PDF](screenshots/pdf-dsh.png), [Word region](screenshots/office-dsh.png), [PowerPoint request](screenshots/ppt-dsh.png) | DSH PDF viewer and Office conversion |
| Spreadsheet | [XLSX](screenshots/spreadsheet-dsh.png) | DSH's patched FortuneSheet 1.0.4 |
| Assistant reply | [React](screenshots/assistant-react.png), [DSH](screenshots/assistant-dsh.png) | Actual selectable rendered prose |
| Sent cards | [React](screenshots/sent-react.png), [DSH web](screenshots/sent-dsh.png), [DSH quotes](screenshots/quotes-sent-dsh.png) | Serialized, persisted message presentation |

The React example uses React/React DOM 18.3.1 and Microsoft Edge; exact browser metadata is in [react-environment.json](screenshots/react-environment.json). Its web images use html2canvas on its own document. The DSH example is official 0.2.1-rc.5 (`b830ec950faba0a46dda564be3e2d854afed94f1`) plus the registered annotation patch, React 18 and Electron 44.7.0 on Windows x64. DSH web screenshots use native guest `capturePage`; PDF/Office region images crop the viewer's existing page canvas.

## Library checks

`pnpm verify` passes strict TypeScript, 86 behavior tests, the library build and a packed consumer installed outside this repository. The external consumer imports the public entries, compiles with strict TypeScript and produces a React 18 Vite build. The package check rejects private Aione paths and bundled React. Native preloads retain the MIT react-grab license.

Tests cover immutable text/cell snapshots, original formulas and raw values, session/source batch isolation, exact-payload acknowledgement, failed admission and retry, cancellation, image restore/removal, assistant anchors and comment editing. Rich-editor undo/redo and DSH message policies also remain covered by the Aione adapter suite.

The browser interaction check exercises actual pointer selection, web PNG handoff, text/assistant references, serialization, sent-card display and reload recovery. Its source is [verify-demo.mjs](../scripts/verify-demo.mjs).

`pnpm test:sheets` starts an independent Vite fixture using the real FortuneSheet 1.0.4 workbook and React 18. It checks 33 scenarios: all three annotation entry points, single cells, native range drags, 20 rapid event replays, saved cell coordinates/values, immutable snapshots after selection/source changes, reload/edit recovery, superseded gestures, and cancellation on Escape, pointer cancellation, outside clicks, session changes and unmount. Quick replays hold React Scheduler work until after pointerup's animation frame, reproducing the ordering that made 0.1.0 freeze `A2` while the final selection was `A2:D3`. The fix queues capture as a React transition and reads the public workbook API after that commit; it adds no timer or frame-count delay.

The fixture applies only FortuneSheet's existing host read-only InputBox guard during dependency transformation, because the unpatched npm 1.0.4 effect otherwise loops. It does not change selection code or installed dependencies and requires no DSH/Aione checkout. CI installs Chromium for this check; locally it uses Edge on Windows or Playwright Chromium elsewhere (`ANNOTATION_SHEET_BROWSER` overrides the channel). `ANNOTATION_SHEET_EVIDENCE` optionally saves screenshots and JSON outside the source tree. For differential checks, `ANNOTATION_SHEET_SURFACE_SOURCE` supplies an alternate SheetSurface source under the same module identity and `ANNOTATION_SHEET_CHECK` filters scenario names.

To verify the shipped JavaScript, set `ANNOTATION_SHEET_PACKAGE` to an installed annotation-kit package directory. The same fixture then imports that package's `dist/react.js` and stylesheet instead of the source surface.

## DSH operations exercised

- Native web element selection, a captured PNG, draft admission, send and card expansion.
- Code and Markdown selection and structured-reference submission.
- PDF text selection and independent batch send while preserving an unrelated ordinary draft.
- Word conversion, text comment and cropped region image saved as an unsent source batch.
- PowerPoint conversion and direct plain-text quick-request submission.
- XLSX range/comment saved as an independent batch; CSV range/comment sent independently with the ordinary draft intact.
- Assistant selection added to the real rich editor, comment editing, submission and the resulting sent card.
- Restart recovery: reopened Word's two unsent comments through their page markers, restored the same original 450 × 157 PNG (SHA-256 unchanged), reopened the XLSX `B2:C4` batch, and expanded the persisted assistant comment in its sent card.

The local demo model returns a fixed, explicitly labeled reply. These checks establish annotation admission/presentation and persistence; they do not evaluate a remote model's understanding of images or document changes.

Electron 44.7 can emit `resize` during `capturePage` without changing the viewport. The library ignores that redundant notification, while retaining invalidation for real viewport changes and scrolling. A preload regression and native capture exercise cover this case.

## Clean-source replay

On Windows x64, the example source was restored to the exact clean rc.5 baseline, then `dsh:prepare --package .artifacts/annotation-kit-0.1.0.tgz`, `dsh:build`, `dsh:check` and `dsh:start` were executed. DSH's additional `build:check` passed both Host and client aggregate checks. The documented revert command was also executed successfully. Modified source and an additional unregistered adapter file were each rejected by the integrity check; restoring the registered files made it pass again.

The packed consumer and DSH/Aione integrations use the same `annotation-kit-0.1.0.tgz`, SHA-512 `20d2d7bca19478afe7c581519695d6830088f84a03527b7d87e2d23c6ce1e1e343aab4950477701ad6d3787899370fce0df4f256db924cee904093c6d42e7dad`.

macOS and Linux desktop interaction have not been exercised for this release; no cross-platform desktop acceptance is implied. The CI workflow runs library verification on Windows and Ubuntu; its remote status is separate from the local results above.
