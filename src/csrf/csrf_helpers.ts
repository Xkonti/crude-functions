/**
 * Helper functions for CSRF protection in templates.
 */

import { escapeHtml } from "../web/templates.ts";

/**
 * Generates a hidden input field for CSRF protection in HTML forms.
 *
 * Include this in every form that performs state-changing operations.
 *
 * @param token The CSRF token from context (c.get("csrfToken"))
 * @returns HTML string for the hidden input field
 *
 * @example
 * ```html
 * <form method="POST" action="/submit">
 *   ${csrfInput(csrfToken)}
 *   <input type="text" name="data" />
 *   <button type="submit">Submit</button>
 * </form>
 * ```
 */
export function csrfInput(token: string): string {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`;
}
