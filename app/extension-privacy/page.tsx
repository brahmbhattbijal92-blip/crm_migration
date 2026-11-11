import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Extension Privacy | CRM Migration',
  description: 'Privacy information for Migration Form Assistant.',
};

export default function ExtensionPrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">CRM Migration</Link>
          <Link href="/contact" className="text-sm text-zinc-300 hover:text-white">Contact</Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-xs font-semibold uppercase text-emerald-400">Privacy</p>
        <h1 className="mt-2 text-3xl font-semibold">Migration Form Assistant</h1>
        <p className="mt-3 text-sm text-zinc-500">Last updated: November 11, 2026</p>

        <div className="mt-8 space-y-7 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-zinc-100">What the extension does</h2>
            <p className="mt-2">Migration Form Assistant transfers selected client details from the CRM Migration dashboard into matching blank fields on the supported ImmiAccount website. It only acts after you start sharing a selected client and click the extension's fill button. It does not submit the form.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Information it handles</h2>
            <p className="mt-2">The extension may handle a selected client's first name, last name, email address, company, passport expiry date, visa subclass, and visa expiry date. It does not receive credential-vault passwords, usernames, or verification codes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">How information is used and kept</h2>
            <p className="mt-2">The selected details are held temporarily in browser session storage for up to five minutes so you can fill the supported form. They are removed after use, when the portal tab navigates, or when it closes. The extension does not use this information for advertising, analytics, or tracking.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Sharing</h2>
            <p className="mt-2">The extension does not send the selected details to its developer or to analytics or advertising services. It places details into the form on the supported portal only after your action. If you submit that form, the portal handles the information under its own privacy policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Your choice</h2>
            <p className="mt-2">You choose whether to share a client and whether to fill the form. Review every field before submitting the portal form. Existing non-empty fields are not overwritten.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Chrome Web Store Limited Use</h2>
            <p className="mt-2">The use of information received by this extension is limited to its disclosed form-filling purpose and complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100">Contact</h2>
            <p className="mt-2">Questions about this policy can be sent through the <Link href="/contact" className="text-emerald-300 underline underline-offset-4 hover:text-emerald-200">Contact page</Link>.</p>
          </section>
        </div>
      </article>
    </main>
  );
}