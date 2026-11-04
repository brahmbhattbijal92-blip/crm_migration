const TRUSTED_APP_ORIGIN = 'http://localhost:3000';
const TRUSTED_PORTAL_ORIGIN = 'https://online.immi.gov.au';
const PROFILE_TTL_MS = 5 * 60 * 1000;
const MAX_FIELD_LENGTH = 320;

function profileStorageKey(tabId) {
  return `migration-profile:${tabId}`;
}

function isTrustedPortalUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === TRUSTED_PORTAL_ORIGIN && url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const allowedFields = [
    'firstName',
    'lastName',
    'email',
    'company',
    'passportExpiresAt',
    'visaSubclass',
    'visaExpiresAt',
  ];
  const normalized = {};

  for (const field of allowedFields) {
    const value = profile[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) return null;
    normalized[field] = value;
  }

  if (!normalized.firstName || !normalized.lastName) return null;
  return normalized;
}

function isTrustedAppSender(sender) {
  if (!sender.url || !sender.origin) return false;
  try {
    return new URL(sender.url).origin === TRUSTED_APP_ORIGIN && sender.origin === TRUSTED_APP_ORIGIN;
  } catch {
    return false;
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isTrustedAppSender(sender) || message?.type !== 'migration-assistant:share-profile') {
    sendResponse({ ok: false, error: 'Untrusted sender or unsupported request.' });
    return false;
  }

  const profile = normalizeProfile(message.profile);
  if (!profile) {
    sendResponse({ ok: false, error: 'The selected client profile is incomplete or invalid.' });
    return false;
  }

  chrome.tabs.query({ lastFocusedWindow: true }).then(async (tabs) => {
    const portalTabs = tabs.filter((tab) => tab.id && tab.url && isTrustedPortalUrl(tab.url));
    if (portalTabs.length === 0) {
      sendResponse({ ok: false, error: 'Open an approved ImmiAccount tab in this window first.' });
      return;
    }
    if (portalTabs.length > 1) {
      sendResponse({ ok: false, error: 'More than one approved portal tab is open. Close extra portal tabs and retry.' });
      return;
    }
    const tab = portalTabs[0];

    await chrome.storage.session.set({
      [profileStorageKey(tab.id)]: {
      profile,
      expiresAt: Date.now() + PROFILE_TTL_MS,
      },
    });

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'migration-assistant:profile-ready' });
      sendResponse({ ok: true, target: new URL(tab.url).hostname });
    } catch {
      await chrome.storage.session.remove(profileStorageKey(tab.id));
      sendResponse({ ok: false, error: 'The portal helper is not available on this page. Reload the approved portal tab.' });
    }
  }).catch(() => {
    sendResponse({ ok: false, error: 'Unable to reach the active browser tab.' });
  });

  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId || !sender.tab.url || !isTrustedPortalUrl(sender.tab.url)) {
    sendResponse({ ok: false, error: 'This action is only available on the approved portal.' });
    return false;
  }

  if (message?.type !== 'migration-assistant:consume-profile') {
    sendResponse({ ok: false, error: 'Unsupported portal request.' });
    return false;
  }

  chrome.storage.session.get(profileStorageKey(tabId)).then(async (stored) => {
    const entry = stored[profileStorageKey(tabId)];
    await chrome.storage.session.remove(profileStorageKey(tabId));
    if (!entry || entry.expiresAt <= Date.now()) {
      sendResponse({ ok: false, error: 'No shared client profile is available. Share one from the practice dashboard first.' });
      return;
    }

    sendResponse({ ok: true, profile: entry.profile });
  }).catch(() => {
    sendResponse({ ok: false, error: 'The temporary profile session could not be read.' });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void chrome.storage.session.remove(profileStorageKey(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(profileStorageKey(tabId));
});
