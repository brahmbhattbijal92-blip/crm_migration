(() => {
  const FIELD_MAP = [
    {
      key: 'firstName',
      selectors: [
        'input[autocomplete="given-name"]',
        'input[name="firstName" i]',
        'input[name*="givenName" i]',
        'input[id*="givenName" i]',
        'input[name*="first_name" i]',
      ],
    },
    {
      key: 'lastName',
      selectors: [
        'input[autocomplete="family-name"]',
        'input[name="lastName" i]',
        'input[name*="surname" i]',
        'input[name*="familyName" i]',
        'input[id*="surname" i]',
        'input[name*="last_name" i]',
      ],
    },
    {
      key: 'email',
      selectors: ['input[type="email"]', 'input[autocomplete="email"]', 'input[name*="email" i]'],
    },
    {
      key: 'company',
      selectors: ['input[autocomplete="organization"]', 'input[name*="company" i]', 'input[name*="employer" i]'],
    },
    {
      key: 'passportExpiresAt',
      selectors: [
        'input[name*="passport" i][name*="expir" i]',
        'input[id*="passport" i][id*="expir" i]',
      ],
    },
    {
      key: 'visaSubclass',
      selectors: ['input[name*="visa" i][name*="subclass" i]', 'input[id*="visa" i][id*="subclass" i]'],
    },
    {
      key: 'visaExpiresAt',
      selectors: ['input[name*="visa" i][name*="expir" i]', 'input[id*="visa" i][id*="expir" i]'],
    },
  ];

  let root;
  let button;
  let status;
  let isFilling = false;

  function hasRecognizedForm() {
    const formFieldKeys = new Set(['firstName', 'lastName', 'passportExpiresAt', 'visaSubclass', 'visaExpiresAt']);
    return FIELD_MAP.some((field) =>
      formFieldKeys.has(field.key) && field.selectors.some((selector) => document.querySelector(selector))
    );
  }

  function createUtility() {
    if (!document.body) return false;
    if (!hasRecognizedForm()) {
      root?.remove();
      root = null;
      button = null;
      status = null;
      return false;
    }
    if (root) return true;
    root = document.createElement('aside');
    root.className = 'migration-assistant-root';
    root.setAttribute('aria-label', 'Migration profile assistant');
    root.innerHTML = `
      <div class="migration-assistant-card">
        <p class="migration-assistant-title">Migration assistant</p>
        <p class="migration-assistant-status" aria-live="polite">Share a profile from the practice dashboard.</p>
        <button class="migration-assistant-button" type="button">Fill form from client</button>
      </div>
    `;
    button = root.querySelector('.migration-assistant-button');
    status = root.querySelector('.migration-assistant-status');
    button.addEventListener('click', fillFormFromSharedProfile);
    document.body.appendChild(root);
    return true;
  }

  function isVisibleAndWritable(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
    if (element.disabled || element.readOnly || element.type === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findField(selectors) {
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (isVisibleAndWritable(candidate)) return candidate;
      }
    }
    return null;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function applyProfile(profile) {
    let filled = 0;
    let skipped = 0;
    let notFound = 0;

    for (const field of FIELD_MAP) {
      const value = profile[field.key];
      if (typeof value !== 'string' || value.length === 0) continue;

      const input = findField(field.selectors);
      if (!input) {
        notFound += 1;
        continue;
      }
      if (input.value.trim() && input.value !== value) {
        skipped += 1;
        continue;
      }
      if (input.value !== value) {
        setNativeValue(input, value);
        filled += 1;
      } else {
        skipped += 1;
      }
    }

    return { filled, skipped, notFound };
  }

  async function fillFormFromSharedProfile() {
    if (isFilling) return;
    isFilling = true;
    button.disabled = true;
    status.textContent = 'Retrieving the one-time shared profile...';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'migration-assistant:consume-profile' });
      if (!response?.ok || !response.profile) {
        status.textContent = response?.error || 'No shared client profile is available.';
        return;
      }

      const result = applyProfile(response.profile);
      status.textContent = result.filled > 0
        ? `Filled ${result.filled} blank field${result.filled === 1 ? '' : 's'}. ${result.skipped} existing field${result.skipped === 1 ? ' was' : 's were'} left unchanged.`
        : `No blank matching fields found. ${result.skipped} existing field${result.skipped === 1 ? ' was' : 's were'} left unchanged.`;
    } catch {
      status.textContent = 'Could not fill this page. Check the form and try again.';
    } finally {
      button.disabled = false;
      isFilling = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'migration-assistant:profile-ready') {
      if (!createUtility()) return;
      status.textContent = 'Client profile ready for one-time form fill.';
      button.classList.add('migration-assistant-button-ready');
    }
  });

  createUtility();
  const observer = new MutationObserver(createUtility);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
