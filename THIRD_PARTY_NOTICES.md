# Third-party notices

## Brand icons (`web/icons.js`)

The icon shapes come from [simple-icons](https://github.com/simple-icons/simple-icons) 15.22.0, released under CC0-1.0, and are inlined without a dependency (`scripts/build-icons.js`, mapping in `brand-map.json`). The icons appear next to model and tool names only so you can tell which provider or service a call belongs to. This project is not affiliated with, sponsored by or endorsed by any of these companies.

CC0 covers the copyright in the simple-icons files only. It does not grant any trademark right: each name and logo remains a trademark of its owner, and the owner's brand guidelines apply.

### Attributions required by the logo licenses

- **Git**: the Git logo is by [Jason Long](https://twitter.com/jasonlong), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Shown here as a single-color icon.
- **Yarn**: the Yarn logo comes from [yarnpkg/assets](https://github.com/yarnpkg/assets), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Shown here as a single-color icon.

### Trademark notices

- Redis is a registered trademark of Redis Ltd. Any rights therein are reserved to Redis Ltd. This project is not endorsed, supported or certified by Redis.
- Node.js is a trademark of the OpenJS Foundation. Kubernetes is a registered trademark of The Linux Foundation.
- Claude and Anthropic, GitHub, Git (word mark: Software Freedom Conservancy), Notion, npm, pnpm, Yarn, uv, Supabase, Sentry and Stripe are trademarks of their respective owners. Other product names that appear as text (for example in tool names) are trademarks of their respective owners.

### Brand guideline review (2026-11-16)

Each owner's public brand guideline was read on 2026-11-16. None of them is a license to ship their logo inside another product: at most they allow a logo to refer to the service, unchanged and without implying endorsement. So:

- Logos are drawn in the owner's own color. Black or gray logos use the theme text color (the owner's black or white variant). Colors are never shifted for contrast.
- Logos whose guideline forbids how this app would show them are **not drawn**: the neutral category symbol is shown instead, and the service is still recognized by name (`noIcon` in `brand-map.json`).

| Icon | Guideline | What it says | Here |
|---|---|---|---|
| Claude (Anthropic) | none found | No public logo guideline found | Drawn; unverified |
| GitHub | [brand.github.com](https://brand.github.com/foundations/logo) | Logo may show that a project integrates with GitHub; do not modify, including color | Drawn, black / white |
| Git | [git-scm.com logos](https://git-scm.com/community/logos) | CC BY 3.0 | Drawn, credit above |
| Yarn | [yarnpkg/assets](https://github.com/yarnpkg/assets) | CC BY 4.0 | Drawn, credit above |
| npm | [npm/logos](https://github.com/npm/logos) | Do not change the colors | Drawn, brand red |
| Kubernetes | [Linux Foundation trademark usage](https://www.linuxfoundation.org/legal/trademark-usage) | No color variations; official versions only | Drawn, brand blue |
| Redis | [Redis trademark policy](https://redis.io/legal/trademark-policy/) | Nominative reference allowed with the attribution line | Drawn, notice above |
| Node.js | [Node.js branding](https://nodejs.org/en/about/branding) | OpenJS Foundation trademark policy (PDF) | Drawn; unverified |
| Notion, pnpm, uv, Supabase, Sentry, Stripe | – | No public guideline could be read (Stripe: Marks Usage Agreement) | Drawn; unverified |
| OpenAI | [openai.com/brand](https://openai.com/brand/) | Use exactly as provided; no use without permission | Not drawn |
| Google (Gemini, Gmail, Drive, Docs, Calendar, Cloud, Chrome) | [Google trademark rules](https://partnermarketinghub.withgoogle.com/brands/google/trademarks-and-terms/trademark-guidelines-for-proper-usage/) | Do not alter any element; use needs approval | Not drawn |
| Figma | [Figma brand use](https://www.figma.com/using-the-figma-brand/) | Do not modify | Not drawn (multi-color logo) |
| Slack | [Slack media kit](https://slack.com/media-kit) | Brand center rules | Not drawn (multi-color logo) |
| Python | [PSF trademark policy](https://www.python.org/psf/trademarks/) | Unaltered logo, with ™ | Not drawn (two-color logo) |
| Docker | [Docker trademark guidelines](https://www.docker.com/legal/trademark-guidelines/) | Logo marks need written permission | Not drawn |
| PostgreSQL | [PostgreSQL trademark policy](https://www.postgresql.org/about/policies/trademarks/) | Not presented with other logos | Not drawn |
| Linear | [linear.app/brand](https://linear.app/brand) | Do not combine with other graphics without consent | Not drawn |
| Vercel | [Vercel brands](https://vercel.com/geist/brands) | Uses in software otherwise need permission | Not drawn |
| Atlassian, Jira, Confluence | [Atlassian logos](https://atlassian.design/foundations/logos) | Approved colors and tiles only | Not drawn |

If an unverified owner objects, add its slug to `noIcon.slugs` and run `node scripts/build-icons.js`.
