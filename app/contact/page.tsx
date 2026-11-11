'use client';

import type { FormEvent } from 'react';
import Link from 'next/link';

const CONTACT_EMAIL = 'hybride.crm.migration@gmail.com';

export default function ContactPage() {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') ?? '').trim();
    const replyEmail = String(formData.get('email') ?? '').trim();
    const subject = String(formData.get('subject') ?? '').trim();
    const message = String(formData.get('message') ?? '').trim();
    const body = `From: ${name}\nReply email: ${replyEmail}\n\n${message}`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
            <button type="submit" className="bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">Open email app</button>
            <p className="text-xs leading-5 text-zinc-500">This opens your email app with the message ready to send. The website does not store or send it for you.</p>
          </form>
        </section>

        <aside className="border-t border-zinc-800 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <h2 className="text-sm font-semibold">Email us directly</h2>
          <a href={`mailto:${CONTACT_EMAIL}`} className="mt-2 inline-block break-all text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200">{CONTACT_EMAIL}</a>
          <p className="mt-3 text-sm leading-6 text-zinc-400">You can also contact us from your usual email app.</p>
        </aside>
      </div>
    </main>
  );
}