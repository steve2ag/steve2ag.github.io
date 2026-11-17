// Small UI behaviors. The page works fully without JavaScript.
(() => {
  // Hairline under the sticky header once the page scrolls.
  const header = document.getElementById('site-header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Highlight the nav link for the section in view.
  const links = new Map(
    [...document.querySelectorAll('.site-nav a')].map((a) => [a.getAttribute('href').slice(1), a])
  );
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute('aria-current'));
        links.get(entry.target.id)?.setAttribute('aria-current', 'true');
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  // Project recordings loop like GIFs, but only while on screen. Visitors who prefer
  // reduced motion (or have no JavaScript) keep the native controls and press play themselves.
  const videos = document.querySelectorAll('.shot video');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const videoObserver = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) target.play().catch(() => { target.controls = true; });
        else target.pause();
      }
    }, { threshold: 0.25 });
    videos.forEach((video) => {
      video.controls = false;
      videoObserver.observe(video);
    });
  }

  // Copy-to-clipboard for the email address.
  const status = document.getElementById('copy-status');
  document.querySelectorAll('[data-copy]').forEach((button) => {
    const label = button.querySelector('span');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        label.textContent = 'Copied';
        status.textContent = 'Email address copied to clipboard';
      } catch {
        label.textContent = 'Press Ctrl+C';
        const range = document.createRange();
        range.selectNodeContents(button.previousElementSibling);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setTimeout(() => { label.textContent = 'Copy'; status.textContent = ''; }, 2000);
    });
  });
})();
