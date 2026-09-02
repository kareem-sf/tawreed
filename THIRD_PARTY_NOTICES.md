# Third-Party Notices

Tawreed includes open-source libraries through the npm and Cargo lockfiles.
Their respective licenses continue to apply. The following assets are copied
into `public/` and embedded in each desktop package.

## Tesseract.js

- Components: `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0
- Source: https://github.com/naptha/tesseract.js
- License: Apache License 2.0
- Included files: OCR worker, JavaScript/WASM loaders, and Tesseract WASM cores

The full Apache License 2.0 text is included at
`third_party/licenses/APACHE-2.0.txt` and in the release asset `LICENSES.txt`.

## Tesseract Language Data

- Source: https://github.com/naptha/tessdata/tree/gh-pages/4.0.0_fast
- License declared by the source repository: Apache License 2.0
- English SHA-256: `18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b`
- Arabic SHA-256: `cfdec92af6c72289984b03dfe5e03d25f7fee591733081aa6f40761f3f5884cf`

The committed models match the cited upstream files byte-for-byte.

## PDF.js

- Component: `pdfjs-dist` 6.2.108
- Source: https://github.com/mozilla/pdf.js
- License: Apache License 2.0
- Included files: character maps, standard fonts, ICC/WASM support assets, and
  the generated PDF worker

Component-specific notices for Adobe CMaps, Liberation fonts, Foxit/PDFium
fonts, OpenJPEG, QCMS, and JBIG2 are retained beside the files in
`public/pdfjs/`.

## ExcelJS

- Component: `exceljs` 4.4.0
- Source: https://github.com/exceljs/exceljs
- License: MIT
- Used to generate the master and per-package workbook files.

## UI Components

Selected UI primitives were adapted from Magic UI and are licensed under MIT.
Source attribution is retained in the relevant component files.

This notice is informational and does not replace the license text shipped by
each dependency or asset.
