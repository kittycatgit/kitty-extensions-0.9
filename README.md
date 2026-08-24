# Kitty Extensions (0.9)

Paperback 0.9 extensions I maintain.

## Available Extensions

- [DankeFursLesen](https://danke.moe)
- [Manga18Club](https://manga18.club)
- [ManhwaToon](https://www.manhwatoon.me)
- [ToonTop](https://toontop.io)

## Installation

Add this URL as a repository in Paperback:

```
https://kittycatgit.github.io/kitty-extensions-0.9/
```

Sources marked as adult are hidden unless adult content is enabled in the app's
settings.

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

`src/generic` is the shared Madara implementation from
[Inkdex](https://github.com/inkdex/madara-extensions), used under the GPL-3.0 and
relied on by ManhwaToon. The extensions in this repository are my own.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
