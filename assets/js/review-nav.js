/* =====================================================================
   Review, outside the review page: the due-count badge on every
   "Review" link in the header, and the small card on a course's page
   ("2 to review · 3 of 5 mistakes fixed") that opens the review for
   that course. The review page itself is review.js.

   P.review.setDue(n)               update every badge
   P.review.courseCard(slot, id)    fill a course page's card (only once there are mistakes)
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;

  const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/></svg>';

  function setDue(n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    P.boot.reviewDue = n;
    P.$$('[data-review-due]').forEach((badge) => {
      badge.textContent = !n ? '' : n > 99 ? '99+' : String(n);
      badge.hidden = !n;
      badge.setAttribute('aria-hidden', 'true');
      const link = badge.closest('a');
      if (!link) return;
      if (n) link.setAttribute('aria-label', `Review, ${n} due`);
      else link.removeAttribute('aria-label');
    });
  }

  async function courseCard(slot, courseId) {
    if (!slot || !courseId) return;
    let s = null;
    try {
      s = (await P.get('/api/review/stats?course=' + encodeURIComponent(courseId))).courses[0];
    } catch (e) {
      return; // the course page works without it
    }
    if (!s || !s.made) return;
    const lead = s.due ? `${s.due} to review` : s.learning ? `${s.learning} coming up` : '';
    slot.innerHTML = `<a class="rvcard" href="review.html?course=${encodeURIComponent(courseId)}">
        <span class="rvcard__icon">${ICON}</span>
        <span class="rvcard__body">${lead ? `<span class="rvcard__lead">${lead}</span><span class="rvcard__dot" aria-hidden="true"> · </span>` : ''}<span>${s.fixed} of ${s.made} ${s.made === 1 ? 'mistake' : 'mistakes'} fixed</span></span>
        <span class="rvcard__go">Review</span>
      </a>`;
  }

  P.review = { setDue, courseCard, due: () => P.boot.reviewDue || 0 };
  setDue(P.boot.reviewDue);
})();
