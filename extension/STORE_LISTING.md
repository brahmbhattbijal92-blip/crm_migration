# Chrome Web Store Listing

## Product details

- Name: Migration Form Assistant
- Short description: Fill blank immigration form fields using a client profile you choose in CRM Migration. Review every field; the extension never submits the form.
- Category: Productivity
- Support email: hybride.crm.migration@gmail.com
- Privacy policy: https://crm-migration-three.vercel.app/extension-privacy
- Distribution: Unlisted

## Full description

Migration Form Assistant helps you transfer selected profile details from the CRM Migration dashboard to a supported ImmiAccount form.

Choose a client in CRM Migration and start sharing. On the supported immigration form, choose **Fill form from client**. The extension fills matching blank fields only. It leaves values already entered unchanged. Review all information and submit the form yourself.

The extension works only on `online.immi.gov.au`. It does not submit forms, store credentials, send analytics, or collect browsing history. A shared profile is temporary, is available for up to five minutes, and is cleared after use, navigation, or tab closure.

## Single purpose

Transfer fields from a client profile explicitly selected in CRM Migration into matching blank fields on the supported ImmiAccount website, at the user's request.

## Permission justifications

- `storage`: Temporarily hold the user-selected profile in browser session storage until it is used or expires.
- `https://online.immi.gov.au/*`: Detect the supported portal tab and add the user-initiated fill control on that site only.

The broad `tabs` permission is not requested. The portal host permission limits URL access to the supported portal.

## Privacy disclosures

- Data handled: first name, last name, email, company, passport expiry, visa subclass, and visa expiry, when present in the selected client profile.
- Collection: The extension receives these fields only after the user selects a client and starts sharing from the CRM Migration dashboard.
- Use: The extension temporarily holds the selected fields and fills matching blank fields on the supported portal after the user clicks its fill button.
- Retention: The temporary profile expires after five minutes and is removed after use, portal-tab navigation, or tab closure.
- Sharing: The extension does not send profile data to the extension developer, analytics providers, or advertising services. If the user later submits the portal form, the portal processes the form under its own terms and privacy practices.
- Security: The extension uses Chrome session storage for the temporary profile and does not include usernames, passwords, one-time codes, or vault contents.
- Limited Use: The use of data received by this extension is limited to the disclosed form-filling purpose and complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Submission checklist

- Upload the ZIP with `manifest.json` at its root.
- Upload a 128 x 128 store icon and at least one genuine screenshot of the extension working on the supported portal.
- Complete the Chrome Web Store privacy and data-use fields to match the disclosures above.
- Submit as unlisted and wait for Google review.
- After Google assigns the extension ID, set that exact ID as `NEXT_PUBLIC_MIGRATION_EXTENSION_ID` in Vercel Production and redeploy the CRM app.