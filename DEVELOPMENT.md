# Development

The installable extension is in `anti-red-tag/`. It needs no build step or runtime dependencies.

Use Node.js 22 or newer:

```sh
npm ci
npx playwright install chromium
npm run test:all
```

Individual checks:

```sh
npm run check
npm test
npm run test:ui
npm run test:browser
```

To run the browser tests in Opera GX, set `GX_BROWSER_PATH` to its executable. Example in PowerShell:

```powershell
$env:GX_BROWSER_PATH = 'C:\Users\your-name\AppData\Local\Programs\Opera GX\opera.exe'
npm run test:all
```

Tests use isolated browser profiles and local fixture pages. The UI suite always uses Chromium. Screenshots are written to the ignored `test-results/` folder.

Generate toolbar icons with `node scripts/icons.cjs`. To preview the interface without installing it, open `anti-red-tag/controller.html` in a browser; browser actions are simulated.

Package only the `anti-red-tag/` folder into `anti-red-tag.zip`. Local dependencies, test profiles, test output, and historical archives are excluded from Git and the installable release.
