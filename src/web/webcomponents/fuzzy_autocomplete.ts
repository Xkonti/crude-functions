/**
 * Fuzzy Autocomplete Web Component
 *
 * A reusable autocomplete component that fetches suggestions from an API
 * endpoint and displays them in a dropdown. Supports keyboard navigation
 * and highlighting of matched characters.
 *
 * Usage:
 * ```html
 * <fuzzy-autocomplete endpoint="/api/files/search" input-id="handler-input" show-icon="right">
 *   <input type="text" id="handler-input" name="handler">
 * </fuzzy-autocomplete>
 * ```
 *
 * Attributes:
 * - endpoint: The API endpoint to fetch suggestions from (required)
 * - input-id: The ID of the input element to attach to (required)
 * - min-chars: Minimum characters before searching (default: 1)
 * - debounce: Debounce delay in ms (default: 300)
 * - show-icon: Show validation icon ("left" or "right", omit to hide)
 * - warning-tooltip: Tooltip text for warning icon (default: "File not found...")
 */

/**
 * Returns the fuzzy autocomplete web component definition.
 * Include once per page that uses the autocomplete.
 */
export function fuzzyAutocompleteComponent(): string {
  return `
<style>
  fuzzy-autocomplete {
    display: block;
    position: relative;
  }

  .fuzzy-input-wrapper {
    display: flex;
    align-items: stretch;
    position: relative;
  }

  .fuzzy-input-wrapper.icon-left {
    flex-direction: row-reverse;
  }

  .fuzzy-input-wrapper input {
    flex: 1;
    min-width: 0;
  }

  .fuzzy-input-wrapper.icon-left input {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .fuzzy-input-wrapper.icon-right input {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .fuzzy-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.75rem;
    background: var(--pico-form-element-background-color, #fff);
    border: 1px solid var(--pico-form-element-border-color, #ccc);
    color: var(--pico-muted-color, #666);
    cursor: help;
    min-width: 2.5rem;
  }

  .fuzzy-input-wrapper.icon-left .fuzzy-icon {
    border-right: none;
    border-radius: var(--pico-border-radius, 4px) 0 0 var(--pico-border-radius, 4px);
  }

  .fuzzy-input-wrapper.icon-right .fuzzy-icon {
    border-left: none;
    border-radius: 0 var(--pico-border-radius, 4px) var(--pico-border-radius, 4px) 0;
  }

  .fuzzy-icon.valid {
    color: #2e7d32;
    background: #e8f5e9;
    border-color: #a5d6a7;
  }

  .fuzzy-icon.warning {
    color: #e65100;
    background: #fff3e0;
    border-color: #ffcc80;
  }

  .fuzzy-icon.unknown {
    color: var(--pico-muted-color, #999);
  }

  .fuzzy-icon svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .fuzzy-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 300px;
    overflow-y: auto;
    background: var(--pico-background-color, #fff);
    border: 1px solid var(--pico-muted-border-color, #ddd);
    border-top: none;
    border-radius: 0 0 var(--pico-border-radius, 4px) var(--pico-border-radius, 4px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    display: none;
  }

  .fuzzy-dropdown.visible {
    display: block;
  }

  .fuzzy-item {
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--pico-muted-border-color, #eee);
    font-family: var(--pico-font-family-monospace, monospace);
    font-size: 0.875rem;
  }

  .fuzzy-item:last-child {
    border-bottom: none;
  }

  .fuzzy-item:hover,
  .fuzzy-item.selected {
    background: var(--pico-primary-background, #e3f2fd);
  }

  .fuzzy-item mark {
    background: var(--pico-mark-background-color, #ffeb3b);
    color: inherit;
    padding: 0;
  }

  .fuzzy-no-matches {
    padding: 0.75rem;
    color: var(--pico-muted-color, #666);
    font-style: italic;
    text-align: center;
  }

  .fuzzy-loading {
    padding: 0.75rem;
    color: var(--pico-muted-color, #666);
    text-align: center;
  }
</style>

<script>
(function() {
  if (customElements.get('fuzzy-autocomplete')) return;

  // SVG icons
  const ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    unknown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
  };

  class FuzzyAutocomplete extends HTMLElement {
    constructor() {
      super();
      this.selectedIndex = -1;
      this.matches = [];
      this.knownPaths = new Set(); // Paths we've seen in search results
      this.debounceTimer = null;
      this.validationTimer = null;
      this.abortController = null;
      this.validationState = 'unknown'; // 'valid', 'warning', 'unknown'
    }

    connectedCallback() {
      const inputId = this.getAttribute('input-id');
      if (!inputId) {
        console.error('fuzzy-autocomplete: input-id attribute is required');
        return;
      }

      this.input = this.querySelector('#' + inputId);
      if (!this.input) {
        console.error('fuzzy-autocomplete: input element not found:', inputId);
        return;
      }

      this.endpoint = this.getAttribute('endpoint') || '/api/files/search';
      this.minChars = parseInt(this.getAttribute('min-chars') || '1', 10);
      this.debounceMs = parseInt(this.getAttribute('debounce') || '300', 10);
      this.iconPosition = this.getAttribute('show-icon'); // 'left', 'right', or null
      this.warningTooltip = this.getAttribute('warning-tooltip') ||
        'File not found. The function may not work until this file exists.';

      // Wrap input if icon is shown
      if (this.iconPosition) {
        this.setupIconWrapper();
      }

      // Create dropdown
      this.dropdown = document.createElement('div');
      this.dropdown.className = 'fuzzy-dropdown';
      this.appendChild(this.dropdown);

      // Bind events
      this.input.addEventListener('input', this.onInput.bind(this));
      this.input.addEventListener('keydown', this.onKeyDown.bind(this));
      this.input.addEventListener('blur', this.onBlur.bind(this));
      this.input.addEventListener('focus', this.onFocus.bind(this));

      // Prevent form submission when selecting with Enter
      this.input.setAttribute('autocomplete', 'off');

      // Initial validation if there's a value
      if (this.input.value.trim()) {
        this.validateCurrentValue();
      }
    }

    setupIconWrapper() {
      // Create wrapper
      this.inputWrapper = document.createElement('div');
      this.inputWrapper.className = 'fuzzy-input-wrapper icon-' + this.iconPosition;

      // Move input into wrapper
      this.input.parentNode.insertBefore(this.inputWrapper, this.input);
      this.inputWrapper.appendChild(this.input);

      // Create icon element
      this.iconElement = document.createElement('div');
      this.iconElement.className = 'fuzzy-icon unknown';
      this.iconElement.innerHTML = ICONS.unknown;
      this.iconElement.title = 'Type to search for files';
      this.inputWrapper.appendChild(this.iconElement);
    }

    updateIcon(state) {
      if (!this.iconElement) return;

      this.validationState = state;
      this.iconElement.className = 'fuzzy-icon ' + state;

      switch (state) {
        case 'valid':
          this.iconElement.innerHTML = ICONS.check;
          this.iconElement.title = 'File exists';
          break;
        case 'warning':
          this.iconElement.innerHTML = ICONS.warning;
          this.iconElement.title = this.warningTooltip;
          break;
        default:
          this.iconElement.innerHTML = ICONS.unknown;
          this.iconElement.title = 'Type to search for files';
      }
    }

    disconnectedCallback() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      if (this.validationTimer) {
        clearTimeout(this.validationTimer);
      }
      if (this.abortController) {
        this.abortController.abort();
      }
    }

    onInput() {
      const query = this.input.value.trim();

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      // Reset to unknown while typing
      if (this.iconPosition) {
        this.updateIcon('unknown');
      }

      if (query.length < this.minChars) {
        this.hideDropdown();
        return;
      }

      this.debounceTimer = setTimeout(() => {
        this.fetchSuggestions(query);
      }, this.debounceMs);
    }

    onFocus() {
      // Show dropdown if we have matches
      if (this.matches.length > 0 || this.input.value.trim().length >= this.minChars) {
        if (this.matches.length > 0) {
          this.showDropdown();
        } else {
          this.fetchSuggestions(this.input.value.trim());
        }
      }
    }

    onBlur() {
      // Delay hiding to allow click events to fire
      setTimeout(() => {
        this.hideDropdown();
        // Validate on blur
        if (this.iconPosition && this.input.value.trim()) {
          this.validateCurrentValue();
        }
      }, 150);
    }

    onKeyDown(e) {
      if (!this.dropdown.classList.contains('visible')) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.selectNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.selectPrev();
          break;
        case 'Enter':
          if (this.selectedIndex >= 0 && this.selectedIndex < this.matches.length) {
            e.preventDefault();
            this.selectItem(this.selectedIndex);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this.hideDropdown();
          break;
        case 'Tab':
          // Allow tab but select current item if one is selected
          if (this.selectedIndex >= 0 && this.selectedIndex < this.matches.length) {
            this.selectItem(this.selectedIndex);
          }
          this.hideDropdown();
          break;
      }
    }

    selectNext() {
      if (this.matches.length === 0) return;
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.matches.length - 1);
      this.updateSelection();
    }

    selectPrev() {
      if (this.matches.length === 0) return;
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.updateSelection();
    }

    updateSelection() {
      const items = this.dropdown.querySelectorAll('.fuzzy-item');
      items.forEach((item, i) => {
        item.classList.toggle('selected', i === this.selectedIndex);
      });

      // Scroll into view
      const selected = items[this.selectedIndex];
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }

    selectItem(index) {
      if (index >= 0 && index < this.matches.length) {
        const path = this.matches[index].path;
        this.input.value = path;
        this.knownPaths.add(path); // Remember this as a valid path
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
        this.hideDropdown();

        // Mark as valid since user selected from list
        if (this.iconPosition) {
          this.updateIcon('valid');
        }
      }
    }

    async validateCurrentValue() {
      const value = this.input.value.trim();

      if (!value) {
        this.updateIcon('unknown');
        return;
      }

      // Check if we already know this path is valid
      if (this.knownPaths.has(value)) {
        this.updateIcon('valid');
        return;
      }

      // Fetch to check if value exists as exact match
      try {
        const url = this.endpoint + '?q=' + encodeURIComponent(value) + '&limit=50';
        const response = await fetch(url, { credentials: 'same-origin' });

        if (response.ok) {
          const data = await response.json();
          const matches = data.matches || [];

          // Add all matches to known paths
          matches.forEach(m => this.knownPaths.add(m.path));

          // Check for exact match
          const exactMatch = matches.some(m => m.path === value);
          this.updateIcon(exactMatch ? 'valid' : 'warning');
        } else {
          this.updateIcon('warning');
        }
      } catch (err) {
        console.error('fuzzy-autocomplete: validation error', err);
        this.updateIcon('warning');
      }
    }

    async fetchSuggestions(query) {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.abortController = new AbortController();

      // Show loading state
      this.dropdown.innerHTML = '<div class="fuzzy-loading">Searching...</div>';
      this.showDropdown();

      try {
        const url = this.endpoint + '?q=' + encodeURIComponent(query);
        const response = await fetch(url, {
          signal: this.abortController.signal,
          credentials: 'same-origin'
        });

        if (!response.ok) {
          throw new Error('Search failed');
        }

        const data = await response.json();
        this.matches = data.matches || [];

        // Add all matches to known paths
        this.matches.forEach(m => this.knownPaths.add(m.path));

        this.renderMatches(query);

        // Update icon based on whether current value matches
        if (this.iconPosition) {
          const currentValue = this.input.value.trim();
          const exactMatch = this.matches.some(m => m.path === currentValue);
          if (exactMatch) {
            this.updateIcon('valid');
          } else if (currentValue.length > 0) {
            // Don't show warning while actively searching - leave as unknown
            // Warning will show on blur
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          return; // Ignore aborted requests
        }
        console.error('fuzzy-autocomplete: fetch error', err);
        this.dropdown.innerHTML = '<div class="fuzzy-no-matches">Error loading suggestions</div>';
      }
    }

    renderMatches(query) {
      this.selectedIndex = -1;

      if (this.matches.length === 0) {
        this.dropdown.innerHTML = '<div class="fuzzy-no-matches">No matches found</div>';
        this.showDropdown();
        return;
      }

      const html = this.matches.map((match, i) => {
        const highlighted = this.highlightMatch(match.path, query);
        return '<div class="fuzzy-item" data-index="' + i + '">' + highlighted + '</div>';
      }).join('');

      this.dropdown.innerHTML = html;

      // Add click handlers
      this.dropdown.querySelectorAll('.fuzzy-item').forEach(item => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Prevent blur
          const index = parseInt(item.dataset.index, 10);
          this.selectItem(index);
        });
        item.addEventListener('mouseover', () => {
          this.selectedIndex = parseInt(item.dataset.index, 10);
          this.updateSelection();
        });
      });

      this.showDropdown();
    }

    highlightMatch(path, query) {
      // Simple subsequence highlighting
      const queryLower = query.toLowerCase();
      const pathLower = path.toLowerCase();
      let result = '';
      let queryIdx = 0;

      for (let i = 0; i < path.length; i++) {
        if (queryIdx < queryLower.length && pathLower[i] === queryLower[queryIdx]) {
          result += '<mark>' + this.escapeHtml(path[i]) + '</mark>';
          queryIdx++;
        } else {
          result += this.escapeHtml(path[i]);
        }
      }

      return result;
    }

    escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    showDropdown() {
      this.dropdown.classList.add('visible');
    }

    hideDropdown() {
      this.dropdown.classList.remove('visible');
      this.selectedIndex = -1;
    }
  }

  customElements.define('fuzzy-autocomplete', FuzzyAutocomplete);
})();
</script>
`;
}
