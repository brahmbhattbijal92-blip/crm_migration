# Migration Form Assistant

## Install for local development

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `extension` directory.
3. Copy the extension ID shown by Chrome.
4. Add `NEXT_PUBLIC_MIGRATION_EXTENSION_ID=<extension-id>` to the app's local `.env`, then restart Next.js.
5. Keep the app at `http://localhost:3000` for this development build. The extension accepts external messages only from that exact origin.
6. Keep exactly one ImmiAccount tab open at `https://online.immi.gov.au`, select a client on `/dashboard`, then choose **Share selected client**. Click the extension's floating **Fill form from client** button.

## Security behavior

- The manifest only injects the content script on `https://online.immi.gov.au/*`.
- The service worker verifies the exact app origin and active portal origin.
- Profile data is held only in service-worker memory, expires after five minutes, and is consumed once per tab. It is cleared on tab navigation and close.
- The content script only matches the declared fields, fills blank visible inputs, and dispatches native input/change events. Existing non-empty values are not overwritten.
- Credential-vault usernames, passwords, OTPs, database keys, and service-role keys are never shared.
- This build supports `http://localhost:3000` only. Before production, add the exact HTTPS app origin to both `manifest.json` `externally_connectable.matches` and `service-worker.js` `TRUSTED_APP_ORIGIN`, and review the government portal host/field selectors against its current forms.
