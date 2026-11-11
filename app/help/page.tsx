import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Help and how-to | CRM Migration',
  description: 'Simple instructions for using the CRM Migration workspace.',
};

const topics = [
  ['getting-started', 'Getting started'],
  ['clients', 'Clients'],
  ['reminders', 'Reminders'],
  ['documents', 'Documents'],
  ['money', 'Grants and invoices'],
  ['lifecycle', 'Inactive clients'],
  ['team', 'Team and credentials'],
  ['sharing', 'Sharing a client'],
  ['troubleshooting', 'Quick fixes'],
] as const;

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">CRM Migration</Link>
          <nav aria-label="Main navigation" className="flex gap-4 text-sm text-zinc-300">
            <Link href="/" className="hover:text-white">Home</Link>
            <Link href="/contact" className="hover:text-white">Contact</Link>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-12 lg:py-12">
        <aside>
          <p className="mb-3 text-xs font-semibold uppercase text-zinc-500">On this page</p>
          <nav aria-label="Help topics" className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-300 lg:flex-col lg:gap-3">
            {topics.map(([id, label]) => <a key={id} href={`#${id}`} className="hover:text-emerald-300">{label}</a>)}
          </nav>
        </aside>

        <article className="max-w-3xl">
          <p className="text-xs font-semibold uppercase text-emerald-400">Help and how-to</p>
          <h1 className="mt-2 text-3xl font-semibold">Using your workspace</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Simple steps for everyday work. Choose a topic to jump to the instructions you need.
          </p>

          <section id="getting-started" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Getting started</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Sign in with your work email. New teams can register an organization.</li>
              <li>Choose <strong>Cloud</strong> to work with your team, or <strong>Local</strong> to keep this work in your current browser.</li>
              <li>Check the selected workspace before adding or editing information. Local and Cloud records are separate and do not copy between each other.</li>
            </ol>
          </section>

          <section id="clients" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Clients</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Select <strong>New client</strong>, enter the details, then choose <strong>Add client</strong>.</li>
              <li>Select a client in the list to see their profile and related work. Choose <strong>Edit profile</strong> to make changes, then save.</li>
              <li>Use the search box to find a client. Choose <strong>Show archived</strong> to view archived clients; open one to restore it.</li>
              <li>Archive a client to move them out of the active list while keeping their history. Permanent removal is only available for eligible archived clients and cannot be undone.</li>
              <li>In Cloud mode, an administrator can assign a client to an agent from the client profile.</li>
            </ul>
          </section>

          <section id="reminders" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Reminders</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>For a personal follow-up, edit a client and set <strong>Agent reminder date (all day)</strong>. Add a short note if useful, then save.</li>
              <li>The reminder appears ahead of its date, is active for the whole selected local calendar day, and leaves the Dashboard the next day. It does not send an email.</li>
              <li>Passport and visa dates appear in the expiry review list. Automatic expiry notices are separate from your all-day reminders and appear in the expiry notice audit.</li>
            </ul>
          </section>

          <section id="documents" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Documents</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Select a client, choose a file, and select <strong>Stage document</strong>.</li>
              <li>In Local mode, first choose the folder where files should be kept. In Cloud mode, staged files are shared with the organization according to access.</li>
              <li>Use the document list under the selected client to review staged files.</li>
            </ol>
          </section>

          <section id="money" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Grants and invoices</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Choose <strong>Add grant entry</strong> to record funds for a client. Enter the source, amount, currency, and date.</li>
              <li>Choose <strong>Add invoice</strong> to record a bill. Grant funds in the same currency are applied first.</li>
              <li>Open an invoice and choose <strong>Record payment</strong> when money is received. The remaining amount due updates automatically.</li>
              <li>Balances are shown separately for each currency.</li>
            </ul>
          </section>

          <section id="lifecycle" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Inactive clients</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Open <strong>Data lifecycle</strong> to find active clients with no recent activity.</li>
              <li>Choose how long a client has been inactive, then select clients to export a spreadsheet.</li>
              <li>This page is for reviewing and exporting. To remove a client, use the archive process from the main Dashboard.</li>
            </ul>
          </section>

          <section id="team" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Team and credentials</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Team managers can open <strong>Team</strong> to invite agents and manage access.</li>
              <li>Use the credentials area on a client profile to save portal sign-in details. To reveal saved details, follow the one-time code sent to your work email.</li>
              <li>Do not share your password or sign-in code with anyone.</li>
            </ul>
          </section>

          <section id="sharing" className="scroll-mt-6 border-b border-zinc-800 py-7">
            <h2 className="text-xl font-semibold">Sharing a client</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li>Select the client in the Dashboard and choose <strong>Share selected client</strong>.</li>
              <li>Open the supported immigration form and choose <strong>Fill form from client</strong> in the browser extension.</li>
              <li>Review every field yourself before submitting the form. Sharing fills matching fields; it does not submit the form.</li>
            </ol>
          </section>

          <section id="troubleshooting" className="scroll-mt-6 py-7">
            <h2 className="text-xl font-semibold">Quick fixes</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
              <li><strong>A client is missing:</strong> check the workspace selector, clear the search box, and check whether the archived list is selected.</li>
              <li><strong>A reminder count is zero:</strong> the count is for reminders due today. Future reminders appear as upcoming. Check the client profile for the saved date.</li>
              <li><strong>Recent changes are missing:</strong> choose <strong>Refresh data</strong> and confirm you are in the same workspace where you made the change.</li>
              <li><strong>A button is unavailable:</strong> select a client first or ask your team manager whether your account has access to that task.</li>
            </ul>
          </section>

          <p className="border-t border-zinc-800 pt-5 text-sm text-zinc-400">
            Need help with something else? <Link href="/contact" className="text-emerald-300 underline underline-offset-4 hover:text-emerald-200">Contact us</Link>. Need to return to work? <Link href="/dashboard" className="text-emerald-300 underline underline-offset-4 hover:text-emerald-200">Open the Dashboard</Link> or <Link href="/login" className="text-emerald-300 underline underline-offset-4 hover:text-emerald-200">sign in</Link>.
          </p>
        </article>
      </div>
    </main>
  );
}