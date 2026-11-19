# Diaz on Demand

The video-on-demand product of Diaz Martial Arts: members browse a library of lessons across the school's disciplines, watch the free ones without paying, and go Premium to unlock everything. Staff publish the lessons, manage member access, and read the training journal for curriculum insight. This glossary is the shared language for every app and package in the repository.

## Language

### The business

**Diaz on Demand**:
The product: the web app, the mobile app and the API behind them.
_Avoid_: DoD, the VOD, the platform, the app (when the whole product is meant)

**Diaz Martial Arts**:
The business that owns the content and the schools. Diaz is its owner and the product's business partner.
_Avoid_: the gym, the academy, DMA

**School**:
One Diaz Martial Arts training location. There are several, and a member may belong to any of them.
_Avoid_: franchise, location, gym, branch, academy

**Discipline**:
One of the martial arts the school teaches: BJJ, Muay Thai or Haganah. Every program, lesson and journal entry belongs to exactly one.
_Avoid_: art, style, martial art, category, sport

### People

**Member**:
A person with a Diaz on Demand account, whatever they pay and whichever school they train at.
_Avoid_: user, customer, subscriber, account, viewer

**Student**:
A member who is not staff. The default role of every new account.
_Avoid_: regular member, basic user, learner

**Staff**:
Members who work for the school: coaches and admins together.
_Avoid_: team, employees, operators

**Coach**:
A staff member who teaches. Coaches manage the library and read the journal's Trends and member journals, but do not change anyone's access.
_Avoid_: instructor, teacher, trainer, professor

**Admin**:
A staff member who runs the business side of the product: everything a coach can do, plus changing a member's access and banning members.
_Avoid_: owner, superuser, manager

### Access and billing

**Tier**:
Which of the two levels of access a member has right now: Free or Premium.
_Avoid_: plan, level, membership type, access level (that is a lesson's)

**Free**:
The tier every member starts on. It plays the free lessons, which are a genuine taste of the content rather than a trailer.
_Avoid_: basic, trial, guest, freemium

**Premium**:
The tier that unlocks every lesson. A member is Premium through a live subscription or a manual grant, and never while banned.
_Avoid_: paid, pro, VOD, full access, unlocked

**Entitlement**:
What a member may watch right now, with the date it ends if it has one. It is always worked out from the member's subscriptions, grants and ban, never set directly.
_Avoid_: permission, access rights, status

**Subscription**:
A member's recurring Stripe payment for Premium. A member accumulates subscriptions over time, because each cancel-and-resubscribe starts a new one.
_Avoid_: plan, membership, recurring payment, billing

**Checkout**:
The Stripe-hosted purchase that starts a subscription. Only one checkout may be open for a member at a time.
_Avoid_: payment page, purchase flow, cart

**Billing portal**:
The Stripe-hosted page where a member cancels, changes their card and downloads invoices.
_Avoid_: account settings, manage subscription, customer portal

**Manual grant**:
Premium given to a member by an admin, with or without an end date, for access the school collected for outside Stripe.
_Avoid_: comp, free premium, override, manual entitlement, in-person subscription

**Remove access**:
An admin ending a member's manual grant. It touches nothing the member pays Stripe for.
_Avoid_: revoke, cancel, downgrade

**Revocation**:
Access being withdrawn from one subscription because its payment was refunded in full or charged back. It reaches that one subscription only, never the member as a whole.
_Avoid_: ban, cancellation, suspension, removal

**Restore**:
An admin clearing a revocation that followed a refund made by mistake. A chargeback cannot be restored; the member pays again instead.
_Avoid_: reinstate, undo, re-grant

**Ban**:
An admin barring a member: they are Free whatever their subscriptions say and cannot start a checkout until the ban is lifted. A ban does not stop Stripe billing.
_Avoid_: revoke, block, suspend, deactivate, remove access

**Access status**:
The one-line answer to what a member can watch and, when it is nothing, the most recent reason why.
_Avoid_: account state, entitlement status, standing

**Access history**:
The append-only record of every grant, removal, restore, ban and lifted ban on a member: who did it, why and when.
_Avoid_: audit log, activity, changelog

### The library

**Library**:
Everything published that a member can browse: programs, their courses and their lessons.
_Avoid_: catalogue, catalog, content, videos

**Program**:
The top-level grouping of the library: an ordered set of courses in one discipline.
_Avoid_: series, track, collection, curriculum

**Course**:
An ordered set of lessons within a program.
_Avoid_: module, unit, section, class, track

**Lesson**:
The unit a member watches, completes and favorites: one piece of instruction with at most one video.
_Avoid_: video, episode, class, clip, session

**Video**:
The footage attached to a lesson. A lesson exists without one; it is then not yet filmed.
_Avoid_: asset, media, clip, recording, lesson

**Access level**:
Whether a lesson is Free or Premium. It belongs to the lesson, not to the course or program around it.
_Avoid_: tier (that is a member's), paid, locked, gated

**Free lesson**:
A lesson every visitor can watch, signed in or not.
_Avoid_: public lesson, preview, sample, teaser

**Premium lesson**:
A lesson only a Premium member can watch.
_Avoid_: paid lesson, locked lesson, gated lesson, PAID

**Published**:
Visible in the library. An unpublished program, course or lesson exists only for staff.
_Avoid_: live, active, visible, released, draft (for the unpublished state)

**Not yet filmed**:
The honest state of a published lesson that has no video a member can play. It is listed so the curriculum is visible, and plays once it is recorded.
_Avoid_: missing video, broken, placeholder, coming soon

**Demo program**:
A program whose lessons carry labelled demonstration clips instead of Diaz's own instruction. It shows visitors how a track flows and is never counted as training.
_Avoid_: showcase, featured demo, demo track, instructor showcase

**Demo video**:
The demonstration clip on a demo program's lesson. Watching one saves no position; the member marks the lesson complete themselves.
_Avoid_: showcase video, sample, trailer

**Progress**:
How far a member has watched a lesson and whether they completed it.
_Avoid_: history, watch state, playback position

**Completed**:
A lesson the member watched to the end or marked complete themselves.
_Avoid_: finished, watched, done

**Up next**:
The one lesson the library recommends a member open now: the lesson they left unfinished, or the next one not yet completed.
_Avoid_: recommendation, suggested, continue, resume

**Favorite**:
A lesson a member saved to come back to.
_Avoid_: bookmark, saved, like, watchlist

### The curriculum

**Curriculum**:
The school's fixed map of what it teaches, laid out per discipline as phases, tracks, skills and levels. Lessons and journal entries are tagged with it; nobody types it in free text.
_Avoid_: syllabus, taxonomy, tags, categories

**Phase**:
A stage of a discipline's curriculum, such as Fundamentals or Foundations.
_Avoid_: stage, module, belt, chapter

**Track**:
A named theme within a phase, such as Guard Retention - Defense or Stance, Guard & Footwork. It is the thing a journal entry says worked or did not.
_Avoid_: topic, category, course, subject, curriculum item

**Skill**:
The attribute a lesson trains within its discipline, such as Timing or Escape.
_Avoid_: attribute, focus, competency

**Level**:
How advanced a lesson is: intro, core or advanced.
_Avoid_: difficulty, grade, rank, belt

### The journal

**Journal**:
A member's own record of their training sessions, written by them and readable by staff for coaching and curriculum insight. Nothing about it is private from staff, and the product never says it is.
_Avoid_: diary, log, training notes, private journal

**Training session**:
A time the member actually trained, on one calendar day in one discipline. The journal records sessions; it does not record watching.
_Avoid_: class, workout, lesson, visit

**Journal entry**:
One training session as the member wrote it down: the day, the discipline, the tracks they worked on with an outcome each, and an optional note. A member may edit or permanently delete their own.
_Avoid_: post, log, record, session (the session is what happened; the entry is the writing)

**Outcome**:
The member's verdict on one track in one session: Worked or Didn't work.
_Avoid_: rating, result, score, feedback

**Adult confirmation**:
A member's one-time confirmation that they are 18 or older, required before they write their first journal entry.
_Avoid_: age gate, age verification, consent

**Trends**:
The staff view that adds up outcomes per track across members over a date range. A track appears only once enough different members have tagged it, so one member's week cannot pass for a pattern.
_Avoid_: analytics, insights, report, dashboard, stats

**Member journals**:
The staff view of one member's entries and notes in full, with no threshold.
_Avoid_: members view, member detail, journal admin
