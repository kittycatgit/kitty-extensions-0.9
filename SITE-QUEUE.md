# Site queue (from the 90-site list, 2026-11-10)

Fingerprints came from curl plus Camoufox for anything Cloudflare-gated or
client-rendered. Each line is the live engine, not a guess from the site name.

## Done (live-tested)

DanmeiNovel, ManhuaHot, SleepyTranslations, KSGroupScans, YakshaComics, S2Read,
Tritinia (Madara) · EvaScans, MadaraScans, AthreaScans (Themesia/mangareader) ·
LazyGirlTranslations, PandaTranslations, NoodleBrainSquad (src/lightnovel) ·
ErisScans, WriterScans, GrimScans, KewnScans, MistScans (src/meowing) ·
NyxScans, KenComics (src/vcomics) · KeroScans, DesireScans (src/kero) ·
RitharScans, ArtLapsa, KitsuneDawn (src/lwcomics) ·
AquaReader, ArenaScans, LinkManga (Madara with custom skins) ·
MangaMikan, ReadManhwas (src/mangaberri) · RenaScans, FroPi, NuviaToon, ManhwaH

## Queue

### Madara

- manhuarmtl.com — textbook Madara (`/manga/<slug>/`, ajax chapters); Cloudflare-gated, so local tests need the bypass.

Notes from the three custom skins now done: aquareader keeps stock Madara markup
on `?s=` but aqua cards everywhere else, so its parser reads both; arenascans
serves `a.acard` listings and an `h*`-prefixed hero block but an untouched
chapter ajax route; linkmanga's WAF 403s every query string, so its listing is
`/manga/page/N/`, genres browse as `/manga-genre/<slug>/page/N/`, the reader
must not get `?style=list`, and title search goes through the
`wp-manga-search-manga` POST because `/search/<query>/` now answers "Access
Denied" with a 200.

### Themesia

- katreadingcafe.com — `themesia` + `/series/<slug>/`, novels; Cloudflare-gated. Try src/lightnovel first, fall back to mangastream.

### "meowing" engine — base built as src/meowing, one child left

- asmotoon.com — same vendor, newer JS-rendered build: chapters come from `loadChaptersList()`, series uid in `div#chapters-list[data-series-uid]`, root-level `/<slug>` series URLs, so it needs its own getChapters against that loader
- Base notes: `/series/` ships the whole catalogue in one response (search and filters run locally off it), cards carry `alt`/`title`/`tags`/`data-type`/`data-status`, chapter anchors carry `title`/`d` (date)/`c` (coin cost, >1 = locked), pages are `img.myImage[uid]` under `#pages` resolved to `cdn.meowing.org/uploads/<uid>`, and a bare "start reading" anchor duplicates chapter 1 without attributes

### vcomics — done as src/vcomics

Both sites are driven by a public JSON API on `api.<host>`, so the Astro markup
is never parsed: `/api/query` (page, perPage, view=archive, orderBy of
lastChapterAddedAt|createdAt|views|averageRating, searchTerm, genreIds
comma-joined, seriesType, seriesStatus), `/api/genres`, `/api/post?postId=`,
`/api/chapters?postId=` (complete list, no paging) and `/api/chapter?chapterId=`
(images, or `content` for novels, plus the lock flags). Media urls come back
with a doubled slash after the host.

### Laravel / Livewire

- done as src/lwcomics (ritharscans, artlapsa, kitsunedawn): one Laravel/Livewire platform. Browsing only exists as the `pages::search` component, so listings come from `POST /livewire/update` with the page's csrf token, the component snapshot and the session cookies — which must be tracked by the extension's own interceptor, since the shared cookie store drops them and the site then answers "Your session expired". Paging is a `gotoPage` call, not a property update. Details come from the `ComicSeries` JSON-LD node, chapters from `a[href*="/read/"][title^="Chapter"]`, and pages from page one's own url as a template plus `pageCount` out of the reader snapshot (some sites add a `/revisions/<id>/` folder in that path).
- skydemonorder.com — Livewire, and the only one of this group that stays Cloudflare-gated: /projects renders in Camoufox but under a 403 interstitial with no project links, and it is not the `pages::search` platform src/lwcomics drives. Local tests cannot pass its challenge, so anything written for it can only be verified on device.
- storyseedling.com — **parked, needs a decoder.** Browsing and the chapter list are easy: `POST /ajax` form-urlencoded with `action=fetch_browse` (`search`, `status` of any|ongoing|completed|hiatus|dropped|cancelled, `orderBy` of recent|latest|random, `curpage`, `includeGenres[]=<numeric id>`, plus `post=<token>` scraped from `x-data="browse('<token>')"`), and `action=series_toc` with `id=<seriesId>` and that page's own token returns every chapter with is_locked, price and date. The chapter text is the problem: it renders as Kangxi-radical glyphs (U+2Fxx) under a substitution font, interleaved with ~1500 decoy spans whose `cls<hash><timestamp>` classes are hidden by a per-request stylesheet. Finishing it means fetching that stylesheet to drop the hidden spans and deriving the glyph map, which is its own project.

### "mangaberri" engine — done as src/mangaberri

Shape: `/manga?page=N`, `/latest`, `/ongoing`, `/completed`, `/genre/<slug>`,
`/search?q=`, series at `/title/<slug>`, reader at `/read/<id>`, pages at
`/mangas/<chapterId>/pNNNN_<hash>.webp`. Chapter rows are
`a[data-chapter-row][data-chapter-id][data-created-at]`. The two skins place the
cover inside the series link on some rails and beside it on others, and a reader
page also carries other chapters' covers — both handled in the parser. The
earlier "origin stalls under curl" note was transient; plain curl works.

### Next.js / RSC

- done as src/kero: `/series?page=&q=&sort=latest|popular|newest&type=&status=&genre=a,b` (genre is comma-joined AND; repeating the key is ignored), details and chapters from the `"series"` record on `/series/comic/<slug>`, pages from `/series/comic/<slug>/chapter/<n>`. Read the RSC payload by JSON-parsing each `self.__next_f.push([1,"..."])` literal — unescaping the html by hand corrupts any string containing a quote. Page objects carry isEncrypted/hasFragments/hasStrips flags, which this refuses loudly rather than guessing at.
- philiascans.org — `/series/<slug>`, reader `/read/<opaque-token>?lang=en`. The flight payload holds no chapter list and the app calls `/api/v1/internal/bot-verify`, so expect a gate in front of the data; fingerprint that endpoint before writing anything.
- manhuatop.org — `/series/?sort=`, `/manhua/<slug>/chapter-<n>`, `/api/auth/session`; Cloudflare-gated
- oriyami.com — `/manga|/manhwa|/manhua/<slug>`, chapters in the flight payload, `/library?q=`
- komix.to — `/title/<slug>`, `/api/page-data/home`, `/browse`
- schalescans.com — **check before building**: its chapter records carry `mangadex_id` and `primary_url: https://mangadex.org/chapter/<uuid>`, so the site is largely an index over MangaDex rather than its own library. Worth deciding whether it adds anything over the MangaDex source.
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
