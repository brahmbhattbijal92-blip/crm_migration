'use client';

import React, { useState, useEffect } from 'react';
import type { Client } from '../types/data';
import { useDataService } from '../hooks/useDataService';
import { useStorage, type StoragePreference } from '../context/StorageContext';
import CredentialVault from './CredentialVault';

export default function ClientManager() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const dataService = useDataService();
  const { storagePreference, updateStoragePreference } = useStorage();
  
  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  // 1. SELECT - Fetch data on load
  async function refreshClientsList() {
    try {
      setLoading(true);
      setErrorMessage('');
      const result = await dataService.searchRecords({ term: '', limit: 100 });
      setClients(result.items);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to load client records.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    dataService.searchRecords({ term: '', limit: 100 })
      .then((result) => {
        if (active) {
          setClients(result.items);
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Unable to load client records.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [dataService]);

  // 2. INSERT - Submit form to database execution
  async function handleOnboard(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName || !lastName || !email) return;

    try {
      await dataService.saveClient({
        id: crypto.randomUUID(),
        name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        email: email.trim(),
      });
      setFirstName('');
      setLastName('');
      setEmail('');
      await refreshClientsList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to save this client.');
    }
  }

  // 3. DELETE - Soft delete execution
  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to archive this client record?")) return;
    try {
      await dataService.deleteClient(id);
      await refreshClientsList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to delete this client.');
    }
  }

  return (
    <div className="space-y-8">
      {/* ONBOARDING INPUT FORM CONTAINER */}
      <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-xl max-w-2xl">
        <h3 className="text-lg font-semibold text-zinc-100 mb-4">Onboard New Migration Client</h3>
        <form onSubmit={handleOnboard} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                placeholder="Doe"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
              placeholder="john.doe@example.com"
            />
          </div>
          <button
            type="submit"
            className="bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-semibold text-xs px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
          >
            + Onboard Client Profile
          </button>
        </form>
      </div>

      {/* DATA GRID DISPLAY TABLE */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-zinc-100">Active Client Records</h3>
          <div className="flex items-center gap-3">
            <label htmlFor="storage-preference" className="text-xs text-zinc-400">Storage</label>
            <select
              id="storage-preference"
              value={storagePreference}
              onChange={(event) => void updateStoragePreference(event.target.value as StoragePreference)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
            >
              <option value="local">Local</option>
              <option value="cloud">Cloud</option>
            </select>
            <button
              onClick={() => void refreshClientsList()}
              className="text-xs text-zinc-400 hover:text-emerald-400 font-medium transition-colors cursor-pointer"
            >
              Refresh
            </button>
          </div>
        </div>

        {errorMessage && (
          <p role="alert" className="border-b border-rose-900 bg-rose-950/40 px-5 py-3 text-sm text-rose-300">
            {errorMessage}
          </p>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500 animate-pulse">Loading client records...</div>
        ) : clients.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">No client records yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-900/50 text-zinc-400 text-xs font-semibold border-b border-zinc-800">
                  <th className="p-4">Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Updated</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {clients.map((client) => (
                  <React.Fragment key={client.id}>
                    {/* Clean Main Table Row */}
                    <tr className="hover:bg-zinc-900/30 transition-colors border-b border-zinc-900">
                      <td className="p-4 font-medium text-zinc-200">{client.name}</td>
                      <td className="p-4 text-zinc-400">{client.email}</td>
                      <td className="p-4 text-zinc-500">{new Date(client.updatedAt).toLocaleDateString()}</td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleDelete(client.id)}
                          className="text-xs font-semibold text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded hover:bg-rose-500/10 transition-all cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    
                    {/* Expandable Cryptographic Vault Sub-Row Block */}
                    {storagePreference === 'cloud' && (
                      <tr>
                        <td colSpan={4} className="bg-zinc-950/40 px-6 pb-4 pt-1">
                          <CredentialVault clientId={client.id} clientName={client.name} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
