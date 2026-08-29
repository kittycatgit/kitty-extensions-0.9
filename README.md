# Kitty Extensions (0.9)

Paperback 0.9 extensions I maintain.

## Available Extensions

- [DankeFursLesen](https://danke.moe)
- [HiperDex](https://hiperdex.tv)
- [Manga18Club](https://manga18.club)
- [MangaHub](https://mangahub.io)
- [ManhwaRead](https://manhwaread.com)
- [ManhwaToon](https://www.manhwatoon.me)
- [OniSaga](https://onisaga.com)
- [ScytheScans](https://scythescans.com)
- [ToonTop](https://toontop.io)
- [ZinManga](https://www.zinmanga.net)

## Installation

Add this URL as a repository in Paperback:

```
https://kittycatgit.github.io/kitty-extensions-0.9/
```

Sources marked as adult are hidden unless adult content is enabled in the app's
settings.

## Versioning

Extensions use a whole number in the first position and leave the rest at
zero — `2.0.0`, then `3.0.0`, then `4.0.0`. Read it as version 2, 3, 4; the
trailing zeroes exist only because the app compares versions as semver and
will not recognise a bare number as newer.

Bump it on every release, however small the change, or the app will not offer
the update.

## Development

Requires Node.js 24+.

```sh
npm install
npm run conformance        # tsc + lint + format checks
npm test                   # run every extension's test suite
npm run bundle             # build into bundles/
npm run dev                # local server, rebuilds on change
```

Pushing to `main` bundles the extensions and publishes them to GitHub Pages.

## Credits

Two shared theme implementations come from [Inkdex](https://github.com/inkdex),
used under the GPL-3.0:

- `src/generic` - the Madara base, relied on by ManhwaToon
- `src/mangastream` - the MangaStream/MangaReader base, relied on by ScytheScans

The extensions in this repository are my own.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
