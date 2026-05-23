# Self-hosted variable fonts

This directory holds the self-hosted variable WOFF2 binaries used by
the website. They are referenced from:

- `index.html``<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/Lora-VariableFont.woff2" crossorigin>`
- `styles/typography.css``@font-face` declarations for `Lora` and `DM Sans`

Both fonts ship under the SIL Open Font License (OFL), which permits
self-hosting and redistribution. The binaries are intentionally kept
out of the source tree by default so the repository stays small and
the licensing decision (commit vs. fetch at build time) is explicit.

## Required files

| File | Source | Purpose |
| --- | --- | --- |
| `Lora-VariableFont.woff2` | https://fonts.google.com/specimen/Lora | Display headings (`--font-serif`); preloaded in `index.html`. |
| `DMSans-VariableFont.woff2` | https://fonts.google.com/specimen/DM+Sans | Body text and UI (`--font-sans`). |

Both files must be variable WOFF2 (single binary covering the full
weight range) so the `font-weight` ranges declared in
`styles/typography.css` resolve correctly.

## How to fetch the binaries

### Option A — Google Fonts download

1. Open the Google Fonts page for the family and click "Get font".
2. In the cart, click "Download all". You receive a ZIP with the
   variable TTF.
3. Convert the variable TTF to variable WOFF2 with
   [`fonttools`](https://github.com/fonttools/fonttools):

   ```
   pip install fonttools brotli
   fonttools ttLib.woff2 compress -o Lora-VariableFont.woff2 \
     'Lora[wght].ttf'
   ```

4. Drop the WOFF2 into this directory.
5. Repeat for the other family.

### Option B — google-webfonts-helper

[google-webfonts-helper](https://gwfh.mranftl.com/fonts) serves
already-converted WOFF2 variable files. Pick "Modern browsers", select
the subsets you need, rename the file to match the names above, and
drop it here.

## License

Both fonts are licensed under the SIL Open Font License v1.1. When you
add the binaries to the repository, also commit their accompanying
`OFL.txt` files (or keep them in `LICENSES/fonts/`).

## CLS-stable swap

`styles/typography.css` declares `font-display: swap` plus per-face
`size-adjust` / `ascent-override` / `descent-override` /
`line-gap-override` and a `font-size-adjust` ratio on `body`. Together
those keep layout stable when the browser swaps from the fallback
family to the loaded webfont, keeping Cumulative Layout Shift below
0.1.

If you change the font binaries, re-measure CLS with
`npm run test:lh` and adjust the override values in
`styles/typography.css` accordingly.
