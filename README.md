# Steve A. Avendaño García · Personal landing page

Source for **https://steve2ag.github.io**, a one-page site for recruiters and hiring managers.

Plain HTML, CSS and a little JavaScript. No framework, no build step, no dependencies: GitHub Pages serves the files as they are.

```
index.html             All page content (edit text here)
assets/styles.css      Styles, light and dark themes, print styles
assets/main.js         Sticky-header hairline, active nav link, copy-email button
assets/scene.js        Hero animation: procedural LiDAR-style scene with 3D detections
assets/favicon.svg     Browser tab icon
assets/og-image.png    Link-preview image (LinkedIn, Slack, email…), 1200×630
assets/work/           Project recordings (MP4 + WebM fallback) and poster frames
tools/og-card.html     Source for og-image.png
data/Steve_Avendano_CV.pdf   The CV behind every "Download CV" button
```

## Preview locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish with GitHub Pages (one-time)

1. Push to `main`.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then pick `main` and `/ (root)`, and save.
3. After a minute or two the site is live at `https://steve2ag.github.io`. Every later push to `main` redeploys automatically.

The root URL works because the repository is named `steve2ag.github.io`. Renaming the repository changes the site's address, so the absolute URLs in `index.html` (`canonical`, `og:url`, `og:image`, JSON-LD `url`) and the URL printed on `tools/og-card.html` would need to change with it.

## Updating content

- **New CV:** replace `data/Steve_Avendano_CV.pdf` (same file name), then update the matching text in `index.html` and the "Updated …" date in the footer.
- **Headline or key numbers changed:** also edit `tools/og-card.html` and regenerate the preview image:

  ```bash
  python3 -m http.server 8000 &
  npx playwright screenshot --viewport-size=1200,630 --wait-for-timeout=1500 \
    http://localhost:8000/tools/og-card.html assets/og-image.png
  ```

  LinkedIn caches previews. Paste the URL into https://www.linkedin.com/post-inspector/ to refresh it.
