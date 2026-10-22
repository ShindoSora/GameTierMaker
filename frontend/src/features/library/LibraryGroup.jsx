(() => {
  'use strict';

  const { useState } = React;
  const { t } = window.GameTierI18n;
  const { storeDragEvent, calculateInsertIndex, dragState, clearDragEvent, DraggableImage } = window.GameTierApp;
  // Colors identify the source, independent of group order or account nickname.
  const accountPlatforms = [
    { idPrefix: 'psn_import_', label: 'PS', aliases: ['PS', 'PSN', 'PlayStation'], legacy: 'PSN', color: '#00439C' },
    { idPrefix: 'xbox:', label: 'Xbox', aliases: ['Xbox'], legacy: 'Xbox', color: '#107C10' },
    { idPrefix: 'nintendo:', label: 'Nintendo', aliases: ['Nintendo'], legacy: 'Nintendo', color: '#E60012' },
    { idPrefix: 'steam_import_', label: 'Steam', aliases: ['Steam'], legacy: 'Steam', color: '#66C0F4' },
  ];
  function getLibraryGroupPlatform(group) {
    return accountPlatforms.find((platform) => group.id.startsWith(platform.idPrefix));
  }
  function getLibraryGroupColor(group) {
    if (group.id === 'default_upload') return '#A78BFA';
    if (group.id === 'local_upload') return '#F5B942';
    return getLibraryGroupPlatform(group)?.color || '#94A3B8';
  }
  function getLibraryGroupName(group) {
    if (group.id === 'default_upload') return t('library.groups.downloadedImages');
    if (group.id === 'local_upload') return t('library.groups.uploadedImages');
    const platform = getLibraryGroupPlatform(group);
    if (!platform) return group.name;
    const accountId = group.id.slice(platform.idPrefix.length);
    let name = (group.name || '').trim();
    const alias = platform.aliases.find((label) => name.toLowerCase().startsWith(label.toLowerCase() + ':'));
    if (alias) name = name.slice(alias.length + 1).trim();
    if (name === `${platform.legacy} ${accountId.slice(0, 8)}`) name = accountId.slice(0, 8);
    return `${platform.label}:${name || accountId.slice(0, 8)}`;
  }
  function getLibraryGroupDetails(group) {
    const platform = getLibraryGroupPlatform(group);
    const title = getLibraryGroupName(group);
    return { platform: platform?.label || '', name: platform ? title.slice(platform.label.length + 1) : title };
  }
  function LibraryGroup({ group, onDelete, onClear, onDropToGroup,
    onDeleteImage, onAddToUnassigned, imagesMeta }) {
    const [dragOver, setDragOver] = useState(false);
    const [insertIndex, setInsertIndex] = useState(-1);
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      storeDragEvent(e);
      setDragOver(true);
      setInsertIndex(calculateInsertIndex(e.currentTarget, dragState.imageId, group.image_ids.length));
    };
    const handleDragLeave = (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setDragOver(false);
        setInsertIndex(-1);
      }
    };
    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      storeDragEvent(e);
      const index = calculateInsertIndex(e.currentTarget, dragState.imageId, group.image_ids.length);
      const imageId = e.dataTransfer.getData('text/plain');
      setDragOver(false);
      setInsertIndex(-1);
      clearDragEvent();
      if (imageId) onDropToGroup(imageId, group.id, index);
    };
    const details = getLibraryGroupDetails(group);
    const cards = [];
    group.image_ids.forEach((id, index) => {
      if (dragOver && insertIndex === index && id !== dragState.imageId) {
        cards.push(<div key={`insert-${index}`} className="insert-indicator" />);
      }
      const meta = imagesMeta?.[id];
      const title = meta?.game_name || meta?.original_name || t('library.unnamedCover');
      cards.push(
        <div className="library-cover-card" key={id}>
          <DraggableImage imageId={id} onDelete={onDeleteImage}
            onAddToUnassigned={onAddToUnassigned} imagesMeta={imagesMeta} />
          <span className="library-cover-name" title={title}>{title}</span>
        </div>
      );
    });
    if (dragOver && insertIndex >= group.image_ids.length) {
      cards.push(<div key="insert-end" className="insert-indicator" />);
    }
    return (
      <section className="library-group-overlay library-group-browser"
        data-library-group-id={group.id}
        style={{ '--group-accent': getLibraryGroupColor(group) }}
        aria-label={getLibraryGroupName(group)}>
        <header className="library-browser-header">
          <div className="library-browser-heading">
            <span className="library-browser-eyebrow">{details.platform || t('library.browser')}</span>
            <h2>{details.name}</h2>
            <span className="library-browser-count">{t('library.coverCount', { count: group.image_ids.length })}</span>
          </div>
          <div className="library-browser-actions">
            <button className="btn btn-xs" onClick={() => onClear(group.id)} title={t('group.clearTitle')}>
              {t('actions.clear')}
            </button>
            <button className="btn btn-xs btn-danger" onClick={() => onDelete(group.id)} title={t('group.deleteTitle')}>
              {t('group.deleteTitle')}
            </button>
          </div>
        </header>
        <div className={`library-group-overlay-grid library-browser-grid ${dragOver ? 'drag-over' : ''}`}
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          {cards.length ? cards : <div className="library-browser-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" />
              <path d="m3 17 5-5 4 4 4-6 5 7" />
            </svg>
            <strong>{t('library.emptyGroup')}</strong>
            <span>{t('library.emptyGroupHint')}</span>
          </div>}
        </div>
      </section>
    );
  }
  Object.assign(window.GameTierApp, {
    getLibraryGroupName, getLibraryGroupColor, getLibraryGroupPlatform, getLibraryGroupDetails, LibraryGroup,
  });
})();
