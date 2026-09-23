# Production bundle comparison

Measured with Node 20+ and `npm ci && npm run build` from base commit
`f633838d202822d116336e63d87a88c088c1f41c` and this change.

| Build | Initial application JS | Gzip | Largest deferred application chunk |
| --- | ---: | ---: | ---: |
| Before | 690.33 kB | 195.07 kB | none |
| After | 450.78 kB | 127.92 kB | 196.48 kB (`CaseFile`, 57.09 kB gzip) |
| Change | -239.55 kB (-34.7%) | -67.15 kB (-34.4%) | review/export loaded on demand |

`Room`/evidence editing is also deferred (26.32 kB, 9.06 kB gzip). Vite's
build manifest is emitted and the service worker precaches all manifest
assets during installation, so the lazy split preserves the first-online-
load then offline operating model.

Provider-specific OneDrive and Google Drive chunks remain on demand. The
comparison is the initial application chunk rather than the sum of every
optional chunk, because startup parse/download cost is the targeted metric.
