<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/icons/listseerr-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/icons/listseerr-light.png">
  <img alt="Listseerr" src="docs/icons/listseerr-light.png" width="120">
</picture>

# Listseerr

**Sync curated movie & TV show lists to Seerr as automated requests.**

[![CI](https://github.com/guillevc/listseerr/actions/workflows/ci.yaml/badge.svg)](https://github.com/guillevc/listseerr/actions/workflows/ci.yaml)
[![GitHub Release](https://img.shields.io/github/v/release/guillevc/listseerr)](https://github.com/guillevc/listseerr/releases)
[![Docker Image](https://img.shields.io/badge/ghcr.io-blue?logo=docker&logoColor=white)](https://ghcr.io/guillevc/listseerr)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/guillevc)

<p>
  <a href="docs/screenshots/dashboard.png"><img src="docs/screenshots/dashboard.png" width="49%"></a>
  <a href="docs/screenshots/lists.png"><img src="docs/screenshots/lists.png" width="49%"></a>
</p>

[More screenshots →](docs/screenshots)

</div>

## 🧩 Overview

Listseerr connects list providers (Trakt, MDBList, and more) to Seerr. Point it at curated lists and it creates a Seerr request for each movie and show on a schedule.

Curate and filter in the list provider. Listseerr just syncs those lists to requests.

```
┌──────────┐     ┌───────────┐         ┌───────────┐     ┌───────────┐
│  Trakt   │◀────│           │         │           │     │   *arr    │
├──────────┤     │           │ request │           │────▶│   stack   │
│ StevenLu │◀────│ Listseerr │────────▶│   Seerr   │     └───────────┘
├──────────┤     │           │         │           │
│  MDBList │◀────│           │         └───────────┘
├──────────┤     └───────────┘               ▲
│  AniList │◀────┘                           │ approve
└──────────┘                           ┌─────┴─────┐
                                       │   User    │
                                       └───────────┘
```

**How it works:** Listseerr fetches media from your lists → creates requests in Seerr → you review and approve → your \*arr stack downloads the media. Listseerr skips media you already rejected or that is already in your library.

> **Tip:** Create a dedicated Seerr user without auto-approve permissions so you can review requests before anything gets downloaded.

## 🔗 Supported Providers

| Provider                                                                       |   Status   | Requirements                                        |
| :----------------------------------------------------------------------------- | :--------: | :-------------------------------------------------- |
| [Trakt](https://trakt.tv)                                                      |     ✅     | [Free API key](https://trakt.tv/oauth/applications) |
| [MDBList](https://mdblist.com)                                                 |     ✅     | [Free API key](https://mdblist.com/preferences/)    |
| [StevenLu (Popular, All, Metacritic/IMDb/RT thresholds)](https://stevenlu.com) |     ✅     | None                                                |
| [AniList](https://anilist.co)                                                  |     ✅     | None                                                |
| IMDB                                                                           | 🗓️ Planned |                                                     |
| Letterboxd                                                                     | 🗓️ Planned |                                                     |
| TheMovieDB                                                                     | 🗓️ Planned |                                                     |
| MyAnimeList                                                                    | 🗓️ Planned |                                                     |

**Want another provider?** [Open an issue →](https://github.com/guillevc/listseerr/issues/new)

## 🚀 Quick Start

**1. Create `compose.yaml`**

```yaml
services:
  listseerr:
    image: ghcr.io/guillevc/listseerr:latest
    container_name: listseerr
    ports:
      - 3000:3000
    environment:
      TZ: 'UTC'
      ENCRYPTION_KEY: '' # Required — generate with: openssl rand -hex 32
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

**2. Start the container**

```bash
docker compose up -d
```

**3. Set up your lists**

Open [http://localhost:3000](http://localhost:3000), create your account, and start adding lists.

## ⚙️ Configuration

All configuration is done via environment variables:

| Variable         | Description                                                                                       | Default                  |
| :--------------- | :------------------------------------------------------------------------------------------------ | :----------------------- |
| `ENCRYPTION_KEY` | **Required.** Encryption key for sensitive data. Generate with `openssl rand -hex 32`             | —                        |
| `PORT`           | Server port                                                                                       | `3000`                   |
| `DATABASE_PATH`  | Path to SQLite database                                                                           | `/app/data/listseerr.db` |
| `LOG_LEVEL`      | `debug` · `info` · `warn` · `error`                                                               | `info`                   |
| `TZ`             | Timezone ([IANA format](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones))            | `UTC`                    |
| `AUTH_DISABLED`  | Skip the in-app login (for use behind a trusted reverse proxy). Only enable on a trusted network. | `false`                  |

## 🔑 Password Recovery

```bash
# Docker
docker exec -it listseerr bun /app/dist/reset-password.js

# Local
bun run password:reset
```

If you ran with `AUTH_DISABLED=true` and later turn it off, the auto-created `admin` account has no password — run the recovery script above to set one, then log in.

## 💜 Support

If Listseerr is useful to you, consider supporting its development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/guillevc)

## 📄 License

[MIT](LICENSE)
