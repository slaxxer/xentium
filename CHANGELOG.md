# Changelog

## Themes you can ship, and a page whose regions mean something

### Added

- **Themes are distributed through the marketplace.** The catalogue gains
  `kind: plugin | theme` rather than growing a second marketplace — one catalogue, one
  entitlement path, one download gate. The ACP extension browser grows a Plugins / Themes
  tab pair, listings carry a screenshot, and installing a theme **stages it as a draft**,
  so nothing reaches visitors until the admin publishes.

- **Sections paint, and blocks have a handle.** A `section` takes a background image and
  an up-to-three-stop gradient plus a minimum height; an `image` takes an `href`; and
  every block takes an optional `className`. `data-nv-block` already gave CSS a target,
  but ids are opaque and a rebuilt block gets a new one, so there was no *stable* handle
  to write a rule against. Alongside it a **documented class contract**, asserted by a
  test: these names are now a compatibility promise, and a designed plate is a background
  image on a stable selector rather than a new prop on every block.

- **An empty region can be clicked.** A region with nothing in it rendered nothing, so
  "the header" was a thing an admin could see in the tree and could not reach on the page.
  Empty regions now render a labelled placeholder **in the editor only**, and it opens the
  same add-block picker the region's `+` opens — one picker, one code path, whichever
  surface asked.

### Changed

- **One region set: header / main / aside / footer.** The regions had grown by accretion —
  three navbar zones, three footer slots, `beforeBody`/`afterBody` on one template, and a
  pair of masthead bands. Each was defensible alone; together, "where does this go?" had a
  different answer per template, and the names promised landmarks the markup never emitted.
  Every template is now the four HTML5 landmarks, and the regions render the real elements.

- **The navbar is a block inside the header**, because a navbar is part of a header — which
  is what a header is. Ordering a masthead above or below the nav strip is now ordering
  blocks in a list, which is all the bands existed to fake. Position within the row is
  `align`, a node-level field beside `variant` and `visibility` for the same reason those
  are: a navbar is exactly where a plugin's block wants to sit, and a prop threaded through
  52 components would be honoured by core and ignored by everything else.

  Existing documents are carried over at boot, across every scope including the theme
  baseline. An unknown region is kept and skipped by design — disabling a plugin must never
  delete an admin's layout — so without that migration, a site that had ever saved a layout
  would keep every navbar block in its document and simply stop rendering them: no error,
  no missing row, just a site with no navigation.

- **A theme's custom CSS is contained.** Once themes are downloaded, that stylesheet is a
  stranger's code running on every page of your site. It is now parsed through the postcss
  pass that already scoped it: `@import` is refused and `url()` is constrained to the
  package's own assets, which is all a theme needs, because it carries them. A remote
  reference is not only a request made with the visitor's IP on it — through attribute
  selectors it reads the page one character at a time.

- **A theme's custom CSS is a layer, like its tokens.** Importing used to overwrite the
  admin's stylesheet outright: no baseline recorded, unlike a layout, and nowhere else for
  it to live, unlike a token. A package shipping only `custom-light.css` blanked the
  admin's **dark** stylesheet too, because both keys were always written together. The
  theme's CSS now has its own layer — staged by the import, promoted by the same publish,
  and emitted *before* the admin's so an equally specific rule still goes the admin's way.
  `resetAppearance` leaves it alone: it drops my edits, not someone else's work.

### Fixed

- **The navbar left the top of every page.** Wrapping the nav strip in a `<header>` made
  that wrapper the navbar's containing block, and `position: sticky` travels within its
  parent's box — so the navbar stuck for about 48px of scroll and then scrolled away, site
  wide. Green under typecheck, lint and 738 tests; visible only by scrolling.

- **A right-aligned run never moved.** `:first-of-type` is not "the first one that matches":
  every block wrapper is a `div`, so the selector matched the first child of the row
  regardless of alignment.

- **Marketplace listing images were invisible.** `Cross-Origin-Resource-Policy: same-origin`
  silently broke every cross-origin image embed — no console error, and `curl` saw a
  perfectly good 200.

- **The orphan-purge job would have deleted every uploaded background.** Backgrounds get
  their own upload directory, and the scheduled purge had to be taught about it — a job
  that removes what nothing references treats a directory it has never heard of as garbage.
