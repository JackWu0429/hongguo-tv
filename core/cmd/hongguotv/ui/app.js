(function () {
  'use strict';

  // TV remote buttons are handled as zones instead of by screen geometry.  A
  // geometry-only algorithm often jumps from the sidebar into a right-side
  // action because those controls happen to be vertically closer.
  var zoneSelectors = {
    sidebar: '.side-item',
    channels: '.channel-tab',
    actions: '.round-action',
    controls: '.control-button'
  };
  var status = document.getElementById('core-status');
  var notice = document.getElementById('action-notice');
  var shell = document.querySelector('.app-shell');
  var lastContentFocus = null;
  var lastPageFocus = {};
  var keyNames = {
    19: 'ArrowUp',
    20: 'ArrowDown',
    21: 'ArrowLeft',
    22: 'ArrowRight',
    23: 'Enter',
    66: 'Enter',
    4: 'Escape',
    111: 'Escape'
  };

  function pageMode() {
    return shell && shell.dataset.mode ? shell.dataset.mode : 'recommend';
  }

  function focusables(selector) {
    var result = [];
    var query = selector || Object.keys(zoneSelectors).map(function (zone) { return zoneSelectors[zone]; }).join(',');
    Array.prototype.forEach.call(document.querySelectorAll(query), function (element) {
      var style = window.getComputedStyle(element);
      if (!element.disabled && style.display !== 'none' && style.visibility !== 'hidden') result.push(element);
    });
    return result;
  }

  function markFocus(element) {
    document.querySelectorAll('.is-focused').forEach(function (node) { node.classList.remove('is-focused'); });
    if (element) element.classList.add('is-focused');
  }

  function zoneOf(element) {
    if (!element) return '';
    if (element.classList.contains('side-item')) return 'sidebar';
    if (element.classList.contains('channel-tab')) return 'channels';
    if (element.classList.contains('round-action')) return 'actions';
    if (element.classList.contains('control-button')) return 'controls';
    if (element.classList.contains('primary-action')) return 'hero';
    return '';
  }

  function goFocus(element) {
    if (!element) return;
    element.focus({ preventScroll: false });
    markFocus(element);
    if (zoneOf(element) !== 'sidebar') {
      lastContentFocus = element;
      lastPageFocus[pageMode()] = element;
    }
  }

  function firstContentFocus() {
    var remembered = lastPageFocus[pageMode()];
    if (remembered && document.contains(remembered) && !remembered.disabled) return remembered;
    return document.querySelector('.channel-tab.is-active') || document.querySelector('.primary-action');
  }

  function activeSidebar() {
    return document.querySelector('.side-item.is-active') || document.querySelector('.side-item');
  }

  function activeChannel() {
    return document.querySelector('.channel-tab.is-active') || document.querySelector('.channel-tab');
  }

  function moveWithinZone(zone, current, direction) {
    var items = focusables(zoneSelectors[zone]);
    var index = items.indexOf(current);
    if (index < 0) return items[0] || null;
    if (direction === 'up' || direction === 'left') index -= 1;
    if (direction === 'down' || direction === 'right') index += 1;
    return items[index] || null;
  }

  function moveFrom(current, direction) {
    var zone = zoneOf(current);
    if (zone === 'sidebar') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'right') return firstContentFocus();
      return null;
    }
    if (zone === 'channels') {
      if (direction === 'left' || direction === 'right') {
        var channelTarget = moveWithinZone(zone, current, direction);
        return channelTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'down') return document.querySelector('.primary-action');
      if (direction === 'up') return activeSidebar();
      return null;
    }
    if (zone === 'hero') {
      if (direction === 'right') return document.querySelector('.round-action');
      if (direction === 'down') return document.querySelector('.control-button');
      if (direction === 'up') return activeChannel();
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'actions') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return document.querySelector('.primary-action');
      return null;
    }
    if (zone === 'controls') {
      if (direction === 'left' || direction === 'right') {
        var controlTarget = moveWithinZone(zone, current, direction);
        return controlTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return document.querySelector('.primary-action');
      return null;
    }
    return direction === 'right' ? firstContentFocus() : activeSidebar();
  }

  function normalizedKey(event) {
    var key = event.key;
    if (!key || key === 'Unidentified' || key === 'Unknown') key = keyNames[event.keyCode] || '';
    if (key === 'GoBack' || key === 'BrowserBack') key = 'Escape';
    return key;
  }

  function handleKey(event) {
    var key = normalizedKey(event);
    var current = document.activeElement;
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[key];

    if (key === 'Enter') {
      if (current && typeof current.click === 'function') {
        current.click();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (key === 'Escape' || key === 'Backspace') {
      if (zoneOf(current) !== 'sidebar') {
        goFocus(activeSidebar());
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (!direction) return;
    var target = moveFrom(current, direction);
    if (target) {
      goFocus(target);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function focusPageContent() {
    goFocus(firstContentFocus());
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.remove('is-hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(function () { notice.textContent = '当前为 TV 界面骨架，未调用假数据。'; }, 2600);
  }

  function activatePage(item) {
    document.querySelectorAll('.side-item').forEach(function (node) { node.classList.toggle('is-active', node === item); });
    var label = item.querySelector('span:last-child');
    shell.dataset.mode = item.dataset.page || 'recommend';
    document.getElementById('page-context').textContent = label ? label.textContent : '页面';
    showNotice('页面骨架已切换：' + (label ? label.textContent : '页面') + '，真实数据接口待接入。');
  }

  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('focusin', function (event) {
    markFocus(event.target);
    if (zoneOf(event.target) !== 'sidebar') {
      lastContentFocus = event.target;
      lastPageFocus[pageMode()] = event.target;
    }
  });

  document.querySelectorAll('.side-item').forEach(function (item) {
    item.addEventListener('click', function () {
      activatePage(item);
      focusPageContent();
    });
  });

  document.querySelectorAll('[data-action]').forEach(function (item) {
    item.addEventListener('click', function () { showNotice('已收到操作：' + item.dataset.action + '。真实接口待接入。'); });
  });

  document.querySelectorAll('.channel-tab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.channel-tab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      showNotice('频道已切换，真实分类接口待接入。');
    });
  });

  function loadStatus() {
    fetch('/api/v1/status').then(function (response) { return response.json(); }).then(function (data) {
      status.textContent = data.ok ? 'Go 核心服务已连接' : '核心服务异常';
      status.dataset.ok = data.ok ? 'true' : 'false';
    }).catch(function () {
      status.textContent = '核心服务未连接';
      status.dataset.ok = 'false';
    });
  }

  goFocus(document.querySelector('.side-item.is-active'));
  loadStatus();
}());
