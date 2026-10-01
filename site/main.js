// Download page extras. Everything works without this script: the links point straight to the
// latest release's files.
(() => {
  const REPO = 'GuyDea/codesplainer';
  const RELEASES = `https://github.com/${REPO}/releases`;

  // Mark the downloads for this computer's operating system.
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  const os = /mac/i.test(platform)
    ? 'mac'
    : /win/i.test(platform)
      ? 'windows'
      : /linux|x11/i.test(platform)
        ? 'linux'
        : null;
  const card = os && document.querySelector(`.platform[data-os="${os}"]`);
  if (card) {
    card.classList.add('current');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'This computer';
    card.querySelector('h3')?.after(badge);
  }

  // Show the demo in the visitor's color scheme; on narrow screens without the legend, which
  // would cover most of the diagram.
  const frame = document.getElementById('demo-frame');
  if (frame) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const narrow = window.matchMedia('(max-width: 40rem)').matches;
    frame.src = `demo/?sample=flow&theme=${dark ? 'dark' : 'light'}${narrow ? '&legend=0' : ''}`;
  }

  const link = (text, href) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
  };

  // Show the latest version. Until a release is published (or when it lacks a file), the
  // download buttons lead to the releases page instead of a 404.
  const info = document.getElementById('release-info');
  const downloads = document.querySelectorAll('a[data-asset]');
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then((res) => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      return res.json();
    })
    .then((release) => {
      if (!release) {
        downloads.forEach((a) => (a.href = RELEASES));
        info?.replaceChildren(
          'No release has been published yet. ',
          link('See the releases page', RELEASES),
          ', or run it from source below.',
        );
        return;
      }
      const files = new Set((release.assets ?? []).map((asset) => asset.name));
      downloads.forEach((a) => {
        if (!files.has(a.dataset.asset)) a.href = release.html_url;
      });
      const date = new Date(release.published_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      info?.replaceChildren(
        `Version ${release.tag_name}, released ${date}. Free and open source (MIT). `,
        link('All releases', RELEASES),
      );
    })
    // Offline or rate limited: keep the direct links.
    .catch(() => {});
})();
