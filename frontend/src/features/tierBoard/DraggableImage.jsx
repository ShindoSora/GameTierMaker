(() => {
  'use strict';

  const { useState, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { dragState, clearDragEvent } = window.GameTierApp;
  function DraggableImage({ imageId, onDelete, onAddToUnassigned, imagesMeta }) {
    const [menu, setMenu] = useState(null);
    const meta = imagesMeta && imagesMeta[imageId];
    const isRemote = meta && meta.is_remote;
    const isRemoteOk = isRemote && !meta.remote_failed;
    const src = isRemote ? meta.path : `/api/images/${encodeURIComponent(imageId)}/original`;
    const style = isRemoteOk
      ? {
          opacity: 0.7,
          cursor: 'not-allowed',
        }
      : {};
    useEffect(() => {
      if (!menu) return;
      const closeMenu = () => setMenu(null);
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu, true);
      window.addEventListener('blur', closeMenu);
      return () => {
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu, true);
        window.removeEventListener('blur', closeMenu);
      };
    }, [menu]);
    const handleDragStart = (e) => {
      dragState.imageId = imageId;
      e.dataTransfer.setData('text/plain', imageId);
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.classList.add('dragging');
    };
    const handleDragEnd = (e) => {
      e.currentTarget.classList.remove('dragging');
      dragState.imageId = null;
      clearDragEvent();
    };
    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({
        x: e.clientX,
        y: e.clientY,
      });
    };
    return (
      <>
        <div
          className="drag-image"
          data-image-id={imageId}
          draggable={!isRemote}
          style={style}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onContextMenu={handleContextMenu}
        >
          <img
            src={src}
            alt=""
            draggable="false"
            className="drag-image-foreground"
            onError={(e) => {
              e.currentTarget.closest('.drag-image').style.display = 'none';
            }}
          />
        </div>
        {menu &&
          ReactDOM.createPortal(
            <div
              className="context-menu"
              style={{
                left: menu.x,
                top: menu.y,
              }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div
                className="context-menu-item"
                onClick={() => {
                  onAddToUnassigned(imageId);
                  setMenu(null);
                }}
              >
                {t('image.addToUnassigned')}
              </div>
              <div className="context-menu-separator" />
              <div
                className="context-menu-item"
                onClick={() => {
                  onDelete(imageId, false);
                  setMenu(null);
                }}
              >
                {t('image.removeFromTemplate')}
              </div>
              <div
                className="context-menu-item"
                style={{
                  color: 'var(--danger)',
                }}
                onClick={() => {
                  onDelete(imageId, true);
                  setMenu(null);
                }}
              >
                {t('image.deleteGlobally')}
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
  Object.assign(window.GameTierApp, {
    DraggableImage,
  });
})();
