# DSH 0.2.1-rc.5 example

[中文步骤](README.zh-CN.md) · [Library README](../../README.md)

The example is pinned to official tag `dsh-v0.2.1-rc.5`, commit `b830ec950faba0a46dda564be3e2d854afed94f1`. It creates `.dsh/runtime` and isolated `.dsh/data` / `.dsh/electron-data`. It never searches for or edits your existing DSH or Aione checkouts.

## Prepare, build and start

Use Node 22.19+ (or Node 24+) and the repository's pinned pnpm 11.28.5. The first install/build downloads DSH dependencies, Electron and DSH's primary tool runtime; allow enough disk space and network time.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dsh:prepare
pnpm dsh:build
pnpm dsh:check
pnpm dsh:start
```

To validate an unpublished package instead, run `pnpm pack --pack-destination .artifacts`, then `pnpm dsh:prepare --package .artifacts/annotation-kit-0.1.0.tgz`. You can supply a clean local clone with `--source <directory>`; it must contain the pinned tag and commit. The library tarball is still installed through normal package management. Neither mode references Aione.

`prepare` verifies HEAD and source cleanliness before applying the registered patch, stages the complete adapter, resolves its DSH development links, then installs. `check` verifies the pinned baseline, patch fingerprint and every owned source/lockfile hash. Version drift or an unregistered edit stops the command. Build artifacts and data are separate from source. Logs are under `.dsh/runtime/.logs/annotation-kit`.

## Exercise every surface

1. Open a workspace containing [`examples/fixtures`](../fixtures). Select **Annotation demo (local)** in the model picker and send an initial prompt. This is a deterministic local model with no network or tool calls. If you choose a real provider, use that provider's normal configuration instead.
2. Open the included demonstration website in the right browser pane. Toggle Annotate. Select an element or drag a region, comment and Save. Confirm the reference and original screenshot enter the draft. Edit, send and expand the sent card.
3. Open `example.ts` and `notes.md`; select text and add it to the draft. The quote must retain the original source after the file changes.
4. Open `launch-review.pdf`, `launch-review.docx` and `launch-review.pptx`. Select text or a page region, write a comment and save it. Confirm it remains outside the ordinary draft. Send the independent batch. The PPT plain-text quick request submits directly.
5. Open `launch-plan.xlsx` and `launch-plan.csv`. Select a rectangular range, comment and save. Review the original displayed/raw values and formulas. Send the batch while preserving any existing ordinary draft.
6. Select text in the assistant's demo reply. Add it to the draft and edit its comment; navigate back to the original reply from the card.
7. Leave a document batch unsent, restart the example, and reopen the same session and source. Verify its comment, original text and any stored image. Also check sent cards after restart.

The fixtures are synthetic and committed. Optional regeneration: `pip install reportlab python-docx python-pptx openpyxl`, then `python examples/fixtures/generate.py`. No generation tools are required to use the supplied files.

Run `pnpm fixtures:serve` in a second terminal, then open `http://127.0.0.1:4180/` in DSH's browser. In the model picker, open the **Model** row to see the local model. The example launcher sets `ANNOTATION_KIT_LOCAL_DEMO=1` so the local model can be used without the product's account welcome screen; the normal Host authentication and guest ownership checks still apply. Stock launches without this flag retain the original welcome behavior.

## What is patched

One [version-pinned patch](patches/dsh-0.2.1-rc.5.patch) provides browser toolbar/panel seats, assistant-prose selection, structured reference and message presentation, image admission, and native guest selection/capture. The example adapter registers through the standard web-app bundle. DSH's original frame, browser permissions, navigation restrictions, file preview and conversion services remain in use. MOM login, Aione's shell and brand/loading changes are absent.

The main application frame receives `window.annotationKitDesktop`; visited guest pages receive only the private selection preload. Native capture requires a visible application window. Source compatibility is deliberately limited to the pinned version; do not apply this patch blindly to another release.

## Revert

Stop the example, then:

```sh
pnpm dsh:check
pnpm dsh:revert
```

Revert checks owned source hashes before reversing the patch and restoring the original lockfile. It removes only the generated adapter directory. It retains data and build caches. Reinstall/rebuild stock DSH before running that reverted checkout. If you made an unregistered edit, export it first; the helper refuses to overwrite it.

This example is source integration, not a plugin marketplace submission. Public library consumers install `annotation-kit`; unmodified DSH desktop users need upstream extension support or this explicitly patched build.
