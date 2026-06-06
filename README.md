This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Deploying on Railway

This app uses a SQLite database (via Prisma). The container filesystem is
**wiped on every deploy**, so the database file must live on a persistent
[Railway Volume](https://docs.railway.com/reference/volumes) — otherwise all
decks are lost on each redeploy.

One-time setup in the Railway dashboard:

1. Open your service → **Variables** → add a **Volume** mounted at `/data`.
2. In **Variables**, set `DATABASE_URL=file:/data/db.sqlite`.
3. Set `ANTHROPIC_API_KEY` to your Anthropic API key.
4. Redeploy.

The `start` script (`mkdir -p /data && prisma db push && next start`) ensures
the `/data` directory exists and applies the schema before booting. Because the
database now lives on the mounted Volume, decks persist across deployments.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
