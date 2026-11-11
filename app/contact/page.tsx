'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

const CONTACT_EMAIL = 'hybride.crm.migration@gmail.com';

export default function ContactPage() {
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsSending(true);
    setSendStatus('');
    setErrorMessage('');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          subject: formData.get('subject'),
          message: formData.get('message'),
          website: formData.get('website'),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Your message could not be sent. Please try again.');

      setSendStatus('Your message has been sent. We will reply to the email address you provided.');
      form.reset();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Your message could not be sent. Please try again.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">CRM Migration</Link>
          <nav aria-label="Main navigation" className="flex gap-4 text-sm text-zinc-300">
            <Link href="/help" className="hover:text-white">Help</Link>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:py-12">
        <section>
          <p className="text-xs font-semibold uppercase text-emerald-400">Contact</p>
          <h1 className="mt-2 text-3xl font-semibold">Ask us a question</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
            Send a question or describe an issue. Add the email address where you would like us to reply.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 max-w-xl space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm text-zinc-300">Your name</span>
              <input required name="name" maxLength={120} autoComplete="name" className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-zinc-300">Your email</span>
              <input required type="email" name="email" maxLength={320} autoComplete="email" className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-zinc-300">Subject</span>
              <input required name="subject" maxLength={160} defaultValue="Question about CRM Migration" className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-zinc-300">Question or message</span>
              <textarea required name="message" rows={7} maxLength={4000} className="w-full resize-y border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
              Leave this field empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <button type="submit" disabled={isSending} className="bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
              {isSending ? 'Sending...' : 'Send message'}
            </button>
            {sendStatus && <p role="status" className="text-sm text-emerald-300">{sendStatus}</p>}
            {errorMessage && <p role="alert" className="text-sm text-rose-300">{errorMessage}</p>}
            <p className="text-xs leading-5 text-zinc-500">Your message is sent to our contact team. It is not stored in your CRM workspace.</p>
          </form>
        </section>

        <aside className="border-t border-zinc-800 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <h2 className="text-sm font-semibold">Email us directly</h2>
          <p className="mt-2 break-all text-sm text-emerald-300">{CONTACT_EMAIL}</p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">Messages sent with the form go directly to our contact team.</p>
        </aside>
      </div>
    </main>
  );
}