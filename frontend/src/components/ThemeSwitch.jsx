// Lucian UX/UI Prompt #021 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#021
(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const stars = [
    {left:30, top:20},
    {left:58, top:56, animationDelay:'-.6s', width:3, height:3},
    {left:86, top:26, animationDelay:'-1.2s'},
    {left:44, top:72, animationDelay:'-1.8s', width:3, height:3},
    {left:110, top:60, animationDelay:'-.9s', width:2, height:2},
    {left:20, top:46, animationDelay:'-1.5s', width:2, height:2},
  ];

  function ThemeSwitch({ theme, toggleTheme }) {
    const night = theme === 'dark';
    return (
      <div className={`u021${night ? ' is-night' : ''}`} data-value={theme}>
        <button className="u021-sw" type="button" role="switch" aria-checked={night}
          aria-label={t('theme.dark')} title={t(night ? 'theme.light' : 'theme.dark')}
          onClick={toggleTheme}>
          <span className="u021-halo" aria-hidden="true"><i /><i /><i /></span>
          <span className="u021-stars" aria-hidden="true">
            {stars.map((style, index) => <i key={index} style={style} />)}
          </span>
          <span className="u021-clouds" aria-hidden="true"><i /><i /></span>
          <span className="u021-knob" aria-hidden="true">
            <span className="u021-moon"><i /><i /><i /></span>
          </span>
        </button>
      </div>
    );
  }

  Object.assign(window.GameTierApp, { ThemeSwitch });
})();
