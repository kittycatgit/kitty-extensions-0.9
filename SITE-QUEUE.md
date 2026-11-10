# Site queue (from the 90-site list, 2026-11-10)

Fingerprints came from curl plus Camoufox for anything Cloudflare-gated or
client-rendered. Each line is the live engine, not a guess from the site name.

## Done (live-tested)

DanmeiNovel, ManhuaHot, SleepyTranslations, KSGroupScans, YakshaComics, S2Read,
Tritinia (Madara) · EvaScans, MadaraScans, AthreaScans (Themesia/mangareader) ·
LazyGirlTranslations, PandaTranslations, NoodleBrainSquad (src/lightnovel) ·
ErisScans, WriterScans, GrimScans, KewnScans, MistScans (src/meowing)

## Queue

### Madara, needs a parser or WAF override

- aquareader.org — Madara backend, fully custom "aqua-" skin (`aqua-series-info__title`, `aqua-series-cover__img`); needs its own parser. Folder already scaffolded.
- arenascans.org — Madara child "madara-child-mk": results are `a.acard` + `img.ac-cover`, random alphanumeric slugs. Folder already scaffolded.
- linkmanga.com — Madara, but the WAF 403s any query string (`?s=`, `?m_orderby=`). Use `/search/<query>/` for search (works) and `POST /wp-admin/admin-ajax.php action=wp-manga-search-manga` as the typeahead; needs query-free discover paths. Folder already scaffolded.
- manhuarmtl.com — textbook Madara (`/manga/<slug>/`, ajax chapters); Cloudflare-gated, so local tests need the bypass.

### Themesia

- katreadingcafe.com — `themesia` + `/series/<slug>/`, novels; Cloudflare-gated. Try src/lightnovel first, fall back to mangastream.

### "meowing" engine — base built as src/meowing, one child left

- asmotoon.com — same vendor, newer JS-rendered build: chapters come from `loadChaptersList()`, series uid in `div#chapters-list[data-series-uid]`, root-level `/<slug>` series URLs, so it needs its own getChapters against that loader
- Base notes: `/series/` ships the whole catalogue in one response (search and filters run locally off it), cards carry `alt`/`title`/`tags`/`data-type`/`data-status`, chapter anchors carry `title`/`d` (date)/`c` (coin cost, >1 = locked), pages are `img.myImage[uid]` under `#pages` resolved to `cdn.meowing.org/uploads/<uid>`, and a bare "start reading" anchor duplicates chapter 1 without attributes

### vcomics (Astro + React, one base, two children)

- nyxscans.com, kencomics.com — `/series/<slug>` + `/series/<slug>/chapter-<n>`, `/_vcomics/` assets, `/api/track-visit`; catalog ships in `/series`, decimal chapter numbers, coin locks

### Laravel / Livewire

- ritharscans.com and artlapsa.com — identical codebase: `/series/<uuid>`, reader `/read/<uuid>`, search via `POST /livewire/update`
- kitsunedawn.com — same stack but SSR search works (`/search?query=`), `/library`, cdn.kitsunedawn.com
- skydemonorder.com — Livewire, Cloudflare-gated (renders fine in Camoufox)
- storyseedling.com — Livewire, `/series/<numericId>/<chapter>`, search is Livewire-only

### "mangaberri" engine (one base, two children)

- mangamikan.com, readmanhwas.com — shared assets (`/assets/app.css`, `mangaberri-overdrive.css`); both stall under plain curl but render fine in Camoufox

### Next.js / RSC

- keroscans.net and desirescans.com — same platform: `/series/comic/<slug>/chapter/<n>`, `?q=` server search, `?type=`/`?sort=` filters, coin store
- renascans.net — `/manga/<slug>/chapter-<n>`, `/series?q=`
- philiascans.org — `/series/<slug>`, reader `/read/<opaque-token>?lang=en`, Madara-style `/all-mangas?m_orderby=` vocabulary
- nuviatoon.org — `/comics/<slug>/chapter/<n>`, also `/novels`
- fropi.net — `/series/<hex10>-<slug>/chapter-<n>`
- manhwah.com — `/title-detail/<slug>`, `/chapter-detail/<mongoid>`, `/advanced-search`
- manhuatop.org — `/series/?sort=`, `/manhua/<slug>/chapter-<n>`, `/api/auth/session`; Cloudflare-gated
- oriyami.com — `/manga|/manhwa|/manhua/<slug>`, chapters in the flight payload, `/library?q=`
- komix.to — `/title/<slug>`, `/api/page-data/home`, `/browse`
- schalescans.com — `/manga/<slug>`, `/read/<slug>/<n>`, Vercel, no gate
- lunarx.to — Next.js shell over `api.lunarx.to` (`/api/...`)
- hangulplanet.com — `/novel/<slug>`, `?cpage=` chapter paging
- teanovel.com — `/novel/<slug>/<n>`, chapter list behind a dialog
- woopread.com — `/series/<slug>`, `/search?q=`
- lotusscribe.com — `/novel/<slug>/<id>-<title>`, homepage is the full index
- wetriedtls.com — `/series/<slug>`, chapter list client-rendered, `api.wetriedtls.com`
- readnovel.eu — canonical host for wuxiaworld.eu and wuxia.click (one extension covers all three): `/novel/<slug>`, `/chapter/<slug>-<n>`

### JSON APIs

- namicomi.com — `api.namicomi.com`, MangaDex-shaped
- comick.live — `/api/chapters/latest`, `/api/widget/data` (Comick clone, not comick.io)
- manga.uno — `/api/home`, `/api/genres`, SPA routes `/m/<slug>`
- justmanga.cc — `core.justmanga.cc`, AniList ids; route unconfirmed
- wuxiaworld.com — `/api/novels/search`, `/novels` is SSR
- botitranslation.com — `api.mystorywave.com` (StoryWave platform)
- cherrymist.cafe — `/api/public/*`, `/api/settings/*`
- kaliscans.org — bespoke multi-tenant PHP, `/api/manga/search` returns an HTML fragment
- kmanga.kodansha.com — official Kodansha; catalog and episode lists are public, the viewer is ticket-gated, so metadata only

### WordPress one-offs

- mangack.com — theme "Ifenzi", `/manga/<slug>`, `/chapter/<slug>-chapter-<n>`
- mangadrama.com — theme "init-manga", no Madara ajax
- freemanhwa.net — hardened asset paths, root-level series slugs
- asianovel.net — Fictioneer theme, `/chapter/chapter-<id>`, wp-json; Cloudflare-gated
- secondlifetranslations.com — OceanWP + `novel` CPT, chapters under a per-novel abbreviation
- dragonholictranslations.com — theme "lumina" + Alpine, `/wp-json/wp/v2/series/<id>`
- velicresrealm.com — GeneratePress + `novel`/`chapter` CPTs, REST available
- witchculttranslation.com — single work (Re:Zero), per-arc TOC pages
- ninetysevenkoi.wordpress.com — WordPress.com, hand-built TOC pages per series

### Other engines

- reader.deathtollscans.net — FoOlSlide 0.8.19, `/read/<slug>/en/<vol>/<ch>/`, POST search
- bato1.com — Batoto clone; series page showed only 20 of 475+ chapters, check completeness first
- qtoon.org — Laravel + Nuxt shell, `/manhwa/<id>/<slug>`, reader `/read/<id>`
- readmanga.cc — Laravel, `/manga/<slug>`, `/read/<slug>/chapter-<n>`
- mangayi.com — Nuxt SSR, `/read/<slug>/chapter/<n>`
- kuramanga.com — Astro, root-level `/<slug>/chapter-<n>`
- nexcomic.com — custom SSR, `/series/<slug>/chapter-<n>`
- manhuabuddy.com — custom, `/manhwa/<slug>`, `/search?s=`
- timelesstoons.org — htmx, `/chapter/<seriesHex>-<chapterHex>` (no chapter numbers in URLs)
- nineheavens.org — custom, `/novels/<slug>`, `?tab=chapters&page=`, coin paywall
- novelping.com — Node/Express, `/book/<slug>/chapter-<n>`
- puretl.com — Squarespace, `/<slug>/c<n>`, some novels paid
- baka-tsuki.org — MediaWiki at `/project/`, api.php available
- kaizenscan.com — renders behind Cloudflare, engine not identified yet
- lunatoons.net — same

## Not buildable

- comickfan.com — Cloudflare 522, origin down
- hadesscans.com — WP maintenance plugin, no content served

## Skipped as abandoned

- decadencescans.blogspot.com — last post 2014, release posts were DDL links
- nuxscans.blogspot.com — last post 2021
