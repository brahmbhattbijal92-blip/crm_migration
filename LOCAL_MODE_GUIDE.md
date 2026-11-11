# Local Mode and Cloud Mode: Your Guide

> **Feature status:** Local and Cloud modes require sign-in and organization membership. Paid plans and a full Local backup download are not available yet.

## 1. Introduction: What Is Local Mode vs. Cloud Mode?

- **Local Mode** is like a personal notebook kept at your desk. Your records stay on the device you are using.
- **Cloud Mode** is like a shared office filing cabinet. People in your organization can use the same records, based on their access.
- The two places are separate. Switching modes does not automatically copy records from one to the other.

## 2. How Access and Sign-In Works

- Register with your work email, then sign in.
- Once your account is connected to an organization, the system checks your access at the front door and takes you to that organization's dashboard.
- If you are new, your organization may need to finish setting up your account first. Ask your administrator for help if you cannot enter.
- **Current version:** The organization sign-in gate applies to both modes. Choosing Local Mode remembers that choice, then asks you to sign in before opening the dashboard.

## 3. Cost, Security and Pricing Tiers

- **Free users:** Local Mode is planned to be free. It does not require a paid subscription or a credit card.
- **Paid users:** Cloud Mode is planned to sync records with your team. Paid users are also planned to be able to save a Local backup file on their computer.
- **Current version:** Paid plans and the full Local backup download are not available in the app yet.
- Local records stay on your device instead of syncing to your team's shared workspace. Anyone who can use the same device and browser may be able to see them, so avoid using Local Mode on a shared or public computer.
- If you use a sharing feature, the information you choose to share may be sent to that feature's destination.

## 4. The 3 Golden Rules

1. **Your team cannot see Local Mode work.** It does not sync to the organization.
2. **You must register or sign in before using either mode.** The system checks your organization access before opening the dashboard.
3. **Protect your Local records.** Client data is in browser IndexedDB, not the browser history list. The Local/Cloud preference is in localStorage. Clearing browsing history alone usually does not clear IndexedDB, but clearing site data/cookies, resetting the browser profile, or storage eviction can remove Local records. The paid backup described below is not available yet.

## 5. Step-by-Step Guide to the System

### Step 1: Register or Log In

- Choose **Register organization** to create a new organization account, or **Sign in** if you already belong to one.
- After your organization access is confirmed, the system takes you to the dashboard.
- To open Local Mode after sign-in, choose **Local Storage Mode** in the dashboard's **Workspace** selector. Your Local database is scoped to the signed-in user, browser profile, and exact site address.

### Step 2: Choose Your Workspace

- In the dashboard, use **Workspace** to choose **Local Storage Mode** or **Cloud Sync Mode**.
- Local is your notebook on this device. Cloud is the shared filing cabinet for your organization.
- The current app asks you to confirm before switching because the records are not copied between the two places.

### Step 3: Enter Records and Work

- Add and update records as usual.
- In Local Mode, records stay in this browser on this device. Your teammates will not see them. They are not automatically copied to Supabase Cloud.
- In Cloud Mode, records are available to people in your organization who have access.

### Step 4: Save a Local Backup (Paid Feature, Planned)

- When the paid backup feature is available, choose **Download Local Backup** in the dashboard.
- Save the backup file in a safe place on your computer.
- This extra copy is planned to help you recover records if browser data is cleared. The current app does not yet provide a full Local backup download.

### Step 5: Switch from Local to Cloud

- Change **Workspace** from **Local Storage Mode** to **Cloud Sync Mode**, then confirm the switch.
- Your Local records stay on your device. They are not erased, uploaded, or copied by the switch.
- The dashboard then shows your organization's Cloud records. If they look different, that is because Cloud and Local are separate places.
- Switch back to **Local** to see your Local records again. Ask your administrator for help if Cloud Mode is not available to your account.

## 6. Local Documents and Reminders

- Choose **Choose local folder** before staging a document. The file contents go into the selected folder; the app keeps document details and the folder handle in browser IndexedDB. The browser may ask for folder permission again.
- Local mode still requires sign-in and organization membership even though its client data is stored in the browser.
- The scheduled expiry worker reads Cloud Supabase clients only. Local passport or visa dates do not create worker reminders. Reminder events are simulated database records, not emails or texts.
- For dashboard buttons, expiry-reminder timing, data lifecycle, and purge instructions, see the [Dashboard User Guide](docs/DASHBOARD_USER_GUIDE.md).