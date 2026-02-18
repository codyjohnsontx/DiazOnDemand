# Diaz Martial Arts Website

Production-ready Next.js marketing site for a BJJ gym, deployable to Vercel.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- ESLint + Prettier
- SEO metadata, robots, sitemap

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy environment file and update values:

```bash
cp .env.example .env.local
```

3. Run dev server:

```bash
npm run dev
```

Site runs at `http://localhost:3000`.

## Editable Content Files

All primary content is in `/content`:

- `/Users/codypjohnson/Desktop/Coding/diazOnDemand/DiazMartialArts/content/site.ts`
- `/Users/codypjohnson/Desktop/Coding/diazOnDemand/DiazMartialArts/content/programs.ts`
- `/Users/codypjohnson/Desktop/Coding/diazOnDemand/DiazMartialArts/content/coaches.ts`
- `/Users/codypjohnson/Desktop/Coding/diazOnDemand/DiazMartialArts/content/faq.ts`
- `/Users/codypjohnson/Desktop/Coding/diazOnDemand/DiazMartialArts/content/schedule.ts`
- `/Users/codypjohnson/Desktop/Coding/diazOnDemand/DiazMartialArts/content/upcoming.ts` (fallback list)

## Schedule Setup

`/schedule` ships with three sections:

1. Weekly schedule table from `/content/schedule.ts`
2. Monthly Google Calendar embed
3. Upcoming events list limited to the next 60 days

Environment variables:

- `NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL`
  - Google Calendar embed URL for the monthly iframe section.
- `NEXT_PUBLIC_GOOGLE_CALENDAR_ICS_URL` (optional)
  - Public ICS URL used to fetch upcoming events.
  - If missing or unavailable, the site falls back to `/content/upcoming.ts`.

## Contact Form (Formspree)

Set `NEXT_PUBLIC_FORMSPREE_ENDPOINT` in `.env.local`.

- If set: form submits directly to Formspree.
- If unset: form shows a clear setup message.

## Vercel Deploy

1. Push repo to GitHub.
2. Import project into Vercel.
3. Add environment variables from `.env.example` in Vercel project settings.
4. Deploy.

## Quality Scripts

```bash
npm run lint
npm run format:check
```
