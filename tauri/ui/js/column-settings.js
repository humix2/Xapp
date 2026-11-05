// The ⚙ panel under a column header: zoom, auto-refresh, and per-type
// options (search: sort + operators, home: feed tab, explore: tab).
import {
  EXPLORE_TAB_OPTIONS, HOME_FEED_OPTIONS, OPERATOR_OPTIONS, REFRESH_OPTIONS, SORT_OPTIONS, ZOOM_OPTIONS,
  DEFAULT_REFRESH_MS, DEFAULT_ZOOM, columnKind, exploreTab, homeFeed,
} from './column-types.js';

function select(options, value, onChange) {
  const el = document.createElement('select');
  for (const [v, label] of options) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = label;
    el.appendChild(opt);
  }
  el.value = String(value);
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function labeled(text, control) {
  const label = document.createElement('label');
  label.textContent = text;
  label.appendChild(control);
  return label;
}

/**
 * @param col     the column config (mutated in place)
 * @param actions { save(), applyPage(), reload(), retitle(), reschedule() }
 */
export function buildSettingsPanel(col, actions) {
  const panel = document.createElement('div');
  panel.className = 'column-settings';
  panel.hidden = true;

  panel.append(
    labeled('文字サイズ', select(ZOOM_OPTIONS, col.zoom ?? DEFAULT_ZOOM, (v) => {
      col.zoom = Number(v);
      actions.save();
      actions.applyPage();
    })),
    labeled('自動更新', select(REFRESH_OPTIONS, col.refreshMs ?? DEFAULT_REFRESH_MS, (v) => {
      col.refreshMs = Number(v);
      actions.save();
      actions.reschedule();
    })),
  );

  const kind = columnKind(col);
  if (kind === 'search') {
    panel.append(labeled('並び替え', select(SORT_OPTIONS, col.sort === 'top' ? 'top' : 'live', (v) => {
      col.sort = v;
      actions.save();
      actions.retitle();
      actions.reload();
    })));

    if (!col.operators) col.operators = [];
    const ops = document.createElement('div');
    ops.className = 'column-settings-operators';
    for (const [op, short, title] of OPERATOR_OPTIONS) {
      const label = document.createElement('label');
      label.className = 'operator-toggle';
      label.title = title;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = col.operators.includes(op);
      box.addEventListener('change', () => {
        col.operators = box.checked ? [...col.operators, op] : col.operators.filter((o) => o !== op);
        actions.save();
        actions.reload();
      });
      label.append(box, document.createTextNode(short));
      ops.appendChild(label);
    }
    panel.appendChild(ops);
  }

  if (kind === 'home') {
    panel.append(labeled('表示', select(HOME_FEED_OPTIONS, homeFeed(col), (v) => {
      col.homeFeed = v;
      actions.save();
      actions.retitle();
      actions.applyPage();
    })));
  }

  if (kind === 'explore') {
    panel.append(labeled('表示', select(EXPLORE_TAB_OPTIONS, exploreTab(col), (v) => {
      col.exploreTab = v;
      actions.save();
      actions.retitle();
      actions.reload();
    })));
  }

  return panel;
}
