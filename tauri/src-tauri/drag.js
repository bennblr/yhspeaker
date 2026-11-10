(function () {
  // Веб-клиент рисует свою шапку и помечает её -webkit-app-region: drag, как в
  // Electron. WebView2 это свойство не обрабатывает, поэтому перетаскивание
  // окна и двойной клик по шапке повторяем через мост.
  if (!window.la2speak || window.la2speak.__dragInstalled) return;
  window.la2speak.__dragInstalled = true;

  var timer = null;

  function isDragSurface(node) {
    var element = node;
    while (element && element.nodeType === 1) {
      var mark = element.getAttribute && element.getAttribute('data-tauri-drag-region');
      if (mark !== null && mark !== 'false') return true;
      var style = window.getComputedStyle(element);
      if (style && style.getPropertyValue('-webkit-app-region') === 'drag') return true;
      element = element.parentElement;
    }
    return false;
  }

  function isInteractive(node) {
    var element = node;
    while (element && element.nodeType === 1) {
      if (element.hasAttribute && element.hasAttribute('data-tauri-drag-region')) return false;
      if (
        element.matches &&
        element.matches(
          '.app-no-drag, button, input, textarea, select, a, [role="menuitem"], [role="menu"]',
        )
      ) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  document.addEventListener(
    'pointerdown',
    function (event) {
      if (event.button !== 0) return;
      if (!isDragSurface(event.target) || isInteractive(event.target)) return;
      if (event.detail === 2) {
        cancel();
        window.la2speak.windowControls.toggleMaximize();
        return;
      }
      // Небольшая задержка позволяет отличить одиночный клик от двойного.
      cancel();
      timer = setTimeout(function () {
        timer = null;
        window.la2speak.__startDragging();
      }, 130);
    },
    true,
  );

  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
})();
