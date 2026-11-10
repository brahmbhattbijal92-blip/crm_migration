'use client';

import Link from 'next/link';
import React, { startTransition, useEffect, useState } from 'react';
import {
  deactivateOrganizationAgent,
  inviteOrganizationAgent,
  listOrganizationMembers,
  requestOrganizationAgentReactivation,
} from './actions';

type TeamMember = Awaited<ReturnType<typeof listOrganizationMembers>>[number];

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  async function refreshMembers() {
    try {
      const nextMembers = await listOrganizationMembers();
      setMembers(nextMembers);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Team members could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    startTransition(() => {
      void listOrganizationMembers()
        .then((nextMembers) => {
          if (!active) return;
          setMembers(nextMembers);
          setErrorMessage('');
        })
        .catch((error: unknown) => {
          if (active) setErrorMessage(error instanceof Error ? error.message : 'Team members could not be loaded.');
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
      });

    return () => { active = false; };
  }, []);

  function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsInviting(true);
    setErrorMessage('');
    setSuccessMessage('');
    startTransition(async () => {
      try {
        const invitation = await inviteOrganizationAgent(email);
        setEmail('');
        if (invitation.status === 'self') {
          setErrorMessage('You cannot invite your own account as an agent.');
        } else if (invitation.status === 'privileged-member') {
          setErrorMessage('This person is already an owner or administrator in the organization.');
        } else if (invitation.status === 'already-active') {
          setErrorMessage('This person is already an active agent in the organization.');
        } else if (invitation.status === 'reactivation-email-sent') {
          setSuccessMessage(`Reactivation email sent to ${invitation.email}.`);
        } else {
          const messages = {
            invited: `Agent invitation sent to ${invitation.email}.`,
            added: `Existing account ${invitation.email} was added as an agent.`,
          };
          setSuccessMessage(messages[invitation.status]);
          await refreshMembers();
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Agent invitation failed.');
      } finally {
        setIsInviting(false);
      }
    });
  }

  function handleSetAgentActive(member: TeamMember) {
    const memberName = member.displayName || member.email || 'this agent';
    const isActive = member.role === 'inactive';
    const confirmation = isActive
      ? `Send a reactivation email to ${member.email || memberName}? They will regain access after verifying the code.`
      : `Deactivate ${memberName}? They will lose access, but their membership and records will be retained.`;
    if (!window.confirm(confirmation)) return;

    setRemovingUserId(member.userId);
    setErrorMessage('');
    setSuccessMessage('');
    startTransition(async () => {
      try {
        if (isActive) {
          const result = await requestOrganizationAgentReactivation(member.userId);
          setSuccessMessage(`Reactivation email sent to ${result.email}.`);
        } else {
          await deactivateOrganizationAgent(member.userId);
          setSuccessMessage(`${memberName} was deactivated in the organization.`);
          await refreshMembers();
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Agent status could not be changed.');
      } finally {
        setRemovingUserId(null);
      }
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1000px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-zinc-800 pb-5">
          <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-200">Dashboard</Link>
          <p className="mt-3 text-xs font-semibold uppercase text-emerald-400">Organization</p>
          <h1 className="mt-1 text-2xl font-semibold">Team access</h1>
        </header>

        {errorMessage && <p role="alert" className="border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {successMessage && <p role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{successMessage}</p>}

        <section className="border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-base font-semibold">Invite migration agent</h2>
            <p className="mt-1 text-xs text-zinc-500">Agents receive access to this organization after accepting their email invitation.</p>
          </div>
          <form onSubmit={handleInvite} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 space-y-1.5">
              <span className="text-xs text-zinc-400">Agent work email</span>
              <input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </label>
            <button type="submit" disabled={isInviting} className="bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
              {isInviting ? 'Sending invite...' : 'Invite agent'}
            </button>
          </form>
        </section>

        <section className="border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-base font-semibold">Organization members</h2>
            <p className="mt-1 text-xs text-zinc-500">{members.length} members</p>
          </div>
          <div className="divide-y divide-zinc-800">
            {isLoading ? (
              <p className="px-5 py-8 text-sm text-zinc-500">Loading team...</p>
            ) : members.length === 0 ? (
              <p className="px-5 py-8 text-sm text-zinc-500">No members found.</p>
            ) : members.map((member) => (
              <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-zinc-200">{member.displayName || member.email || 'Pending agent'}</p>
                  {member.displayName && <p className="mt-0.5 text-xs text-zinc-500">{member.email}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="border border-zinc-700 px-2 py-1 text-xs uppercase text-zinc-400">{member.role}</span>
                  {(member.role === 'agent' || member.role === 'inactive') && (
                    <button
                      type="button"
                      disabled={removingUserId !== null}
                      onClick={() => void handleSetAgentActive(member)}
                      className="text-xs text-rose-300 underline underline-offset-4 hover:text-rose-200 disabled:opacity-50"
                    >
                      {removingUserId === member.userId
                        ? (member.role === 'inactive' ? 'Sending email...' : 'Deactivating...')
                        : (member.role === 'inactive' ? 'Send reactivation email' : 'Deactivate agent')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
