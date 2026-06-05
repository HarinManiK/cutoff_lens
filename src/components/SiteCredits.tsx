const creditLinks = [
  { label: "LinkedIn", href: "https://www.linkedin.com/in/harinmani/" },
  { label: "GitHub", href: "https://github.com/HarinManiK" },
  { label: "itch.io", href: "https://harin-mani.itch.io/ajax" },
];

export function SiteCredits() {
  return (
    <footer className="site-credits" aria-label="Creator credits">
      <div className="site-credits__inner">
        <div className="site-credits__identity">
          <p className="site-credits__byline">Created by Harin Mani Karri</p>
          <a className="site-credits__email" href="mailto:kharinmani@gmail.com">
            kharinmani@gmail.com
          </a>
          <div className="site-credits__links">
            {creditLinks.map((link) => (
              <a href={link.href} key={link.href} rel="noreferrer" target="_blank">
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
